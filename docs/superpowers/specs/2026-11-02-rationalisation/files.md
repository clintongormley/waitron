> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Files on disk: a rationalised design

Part: every file Waitron writes outside `venue.db` and `node.db`. First read against `main` at
`64eeabb036`; brought into line with the owner's review of 4 November against `main` at
`e0da0ad18a`. Read only: nothing was run except `grep`, `sed` and `git log`. Each claim below that
is not a `file:line` names the grep behind it.

The inventory was last measured in full against `68732329c1`, by listing every non-test line that
writes, renames or removes a file. For this pass I only searched the changes since then for new
file writes, which found one new kind (item 87). Items 85 and 86 are written by code nothing on a
box calls yet.

Two words used throughout:

- **flow** — a job that spans a restart, such as a first setup, a restore, a Start again or a TLS
  repair. Today each one hands work to the next start through files in the state folder.
- **scratch** — a folder that exists only while one step runs, such as a decrypted backup copy being
  checked.

---

## 1. The target picture

**The database holds the venue; files hold only what the database cannot.** A file stays outside
the database for one of seven reasons (rule F1): it is needed before a database can be opened; it
must outlive the database being replaced, restored or deleted; it is a secret that must stay out of
backups; it is a lock; it is a log; it is a backup or export; or another program owns it (Docker,
systemd, the print agent, Litestream). Today most files pass that test. One does not:

**`modules.json`** is a venue-wide, dashboard-editable setting (on/off overrides only,
`packages/module/src/config.ts:5-11`) that travels in backups as a loose file
(`apps/server/src/backup-optional-state.ts:10-16`). It moves into the `settings` table, so it always
travels with the database it describes (owner, 2026-11-04), provided T5 shows the core migration set
can run first: boot reads it before opening the database (`boot.ts:1079`, database opened at
`boot.ts:1148`). If T5 fails, it stays a file with a durable write.

Two others look as if they fail and stay:

- **`backup.env`'s rotation time** (`WAITRON_BACKUP_KEY_ROTATED_AT`, `backup-env-writer.ts:46`) is
  not a secret, but it stays in `backup.env` until A1323 replaces it (owner, 2026-11-04). It is not
  a display value: `backup-recovery-pack-api.ts:243` feeds `backup-recovery-pack-status.ts:94-98` and
  `:180-185`, which decide that a pack is out of date and how long the old key must be kept. So it
  cannot go to `activity_log`, which product logic never decides from.
- **The join ("adopt") flow** writes `pending-adoption.json`, `tls/venue-ca.*` and
  `reset-request.json`. It cannot finish yet: finishing refuses `mirror.venue_not_copied` while the
  spare holds no venue row (`apps/server/src/reserved-identity.ts:68-69`, explained at
  `finish-adoption.ts:28-33`). It is reachable from the setup API (`setup-api.ts:130-133` takes an
  `adopt` hook; `boot.ts:1620-1621` supplies it with `adoptFromPrimary`). README §5 U5 keeps it: A947
  slice 3b finishes adoption, and A1018's start check already reads what adoption writes.

**One record per flow.** Today a flow is a constellation of single-purpose files at the top of the
state folder: a restore is 7 files (`restore-request.ts:62-71`); a first setup is 9 kinds of file
spread over `<state>` and `<venue>`. In the target, each flow owns one folder under
`<state>/flows/<flow>/` holding **one mutable record** (`record.json`) plus whatever **immutable
attachments** it needs (a backup archive, document chunks, an append-only decision log). The record is
written last when a flow starts, so a reader never sees a half-staged flow
(`restore-request.ts:172-174` already does this with a marker), and **a flow ends with one rename of
its folder into scratch**, then a delete — so a crash mid-clean-up can never leave a record without
its attachments. The crash-safety arguments in the code support splitting *attachments* from the
*record* (big payloads are written before the small marker), not splitting the record into several
files, so I found no argument against one record per flow.

**What a first setup keeps.** A1322 removes "Continue with your setup password" (owner, 2026-11-04),
so a failed setup is always Start again. `flows/setup/` then holds what a running setup writes, what
the repair page reads to say how far the setup got, and what Start again needs to delete it:
`record.json`, `documents/`, `import/` and `start-again-guesses.json`. What Continue was holding up,
read, not run:

- `first-setup-resolutions/<uuid>/` goes whole (item 55). Both of its writers
  hang off Continue. The owner audit runs only for `recover` (`first-setup-owner.ts:246-250`). The
  finish audit is reached only when the last ownership event is `recover`
  (`first-setup-activation.ts:238-243`, `:250`). Its other two actions, `retire` and
  `select-workspace`, have no writer: a grep finds them only in the record's own validator
  (`packages/provisioning/src/first-setup-resolution.ts:214-262`).
- The record loses the `resume` and `recover` events and `claimNonceHash`, which only those paths
  use (`first-setup-owner.ts:223`, `:299`). It keeps `ownerVerifier`, because the "files found"
  page's Move still asks for the setup password
  (`packages/provisioning/src/first-setup-start-again-choose.ts:106`). That is why
  `start-again-guesses.json` stays too.
- A setup that saved its trading settings has no way left to finish, so Start again has to delete
  it, which it refuses today: `trading.env` is on the refused list
  (`packages/provisioning/src/first-setup-start-again-deletion.ts:60-71`), and
  `assertHeldStartAgainOffered` answers `trading-settings`
  (`apps/server/src/first-setup-resolution.ts:86-100`). So A1322 moves `trading.env` onto the deletion
  list (`first-setup-start-again-deletion.ts:136-147`). The refusal for an invoice or another record
  Waitron never deletes stays. T9 checks that nothing is left behind.
- The repair of a damaged claim mark (`repairMarker`, `first-setup-owner.ts:254-281`) has nothing
  left to repair once the claim goes (below).
- **`waitron-provision`'s way back in goes with Continue** (builder decision, README §10). Today the
  command picks up a stopped setup through `recoverFirstSetupOwner`, using the administrator's password
  (`packages/provisioning/src/cli.ts:313-345`), the same `recover` event as Continue. The command is not
  in the image (`deploy/Dockerfile:203-213`), so a box never runs it. After A1322 it refuses a stopped
  attempt, so the command line and the page behave alike. These are then unused and go too, each found
  by `git grep`, read not run:
  - `resumeFirstSetupCommand` (`first-setup-command.ts:14`; its one caller is `cli.ts:428`), and the
    `ownership?.kind === "recover"` block around that call (`cli.ts:424-430`).
  - `preparation.resume` and its `resumeBinding` (`first-setup-preparation.ts:27`, `:118`,
    `first-setup-runtime.ts:265`). Its one caller outside tests is `first-setup-command.ts:44`.
  - The module seat's `commandResume` and `resume` (`packages/module/src/initial-setup.ts:36`, `:40`), and
    fiscal-verifactu's two implementations (`packages/fiscal-verifactu/src/initial-hour-setup.ts:143`,
    `:149`). `preparation.resume` is the only caller of the seat's `resume`
    (`first-setup-preparation.ts:144`). That last change is in the fiscal package, so the owner lands it.

**A backup recovery cut off during setup is redone, not resumed** (owner, 2026-11-04). The approved
A1131bc already removes the folder that recovery ran from: since its slice 3 the repair page's
Recover from backup deletes the failed setup and hands over to the fresh-box restore, which writes
straight into the usual folders, and its slice 4, still to come, deletes the old recovery's routes,
its `resume`, its journal and the folder switch
(`docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md` §7 and "Slices"). So
`flows/setup/` has no `backup-recovery/` folder, nothing is ever promoted out of a nested folder, and
the box never sells from one. A fresh-box restore that stops is `flows/restore/`'s business: stopped
before Restore was pressed, the person starts it again; stopped after the request was saved, the next
start runs it (`restore-request.ts:466`).

**One state-folder layout, with one owner per folder.** Everything temporary moves under
`<state>/scratch/`, which the start empties under the venue lock — replacing today's scatter of
`backup-staging/`, `restore-staging/`, `restore-entry-*`, `stream-restore-*`, `cloud-snapshots/staging/`
and five kinds of `/tmp` folder, of which the start sweeps only two (`start-space.ts:88-101`; the
other prefixes appear in no sweep: `grep -rn -E "stream-restore-|restore-entry-|archive-validate-|…"`
finds only their `mkdtemp` sites and an operator message telling the owner to delete one by hand,
`restore-command.ts:573`). What survives a plain `waitron.sh reset` (`tls/` and the Start-again
records, `deploy/waitron.sh:806-813`) is gathered so that the reset's keep-list is two names.

Three more changes follow from that layout (all owner, 2026-11-04):

- **The venue folder is fixed inside the state folder on a box.** `WAITRON_VENUE_DIR` is honoured only
  in development; the box never sets it (`grep -rn WAITRON_VENUE_DIR deploy` → only `waitron.sh`'s own
  fallback, `:562`). That removes the venue-folder claim, `first-setup-claim.json`, whose "publication
  complete" status moves into `record.json` (`first-setup-state.ts:572`), and the cross-filesystem
  set-aside branch (`first-setup-start-again-set-aside.ts:101-109`, `:241-250`). `setup-operation.lock`
  goes too, once T3 passes.
- **The Start-again records move into `records/`, and confirmations stop being written.** A
  confirmation is written once (`apps/server/src/first-setup-resolution.ts:472`) and no code reads it:
  a grep finds only tests, the reset's keep-list and the host-path list. It holds the setup
  administrator's name and email until `reset --all`, no screen shows it, and the operator has no
  terminal. The Keep and Move choice records stay. So does the set-aside folder, which holds only
  files Start again did not create, after a cut-off Start again (A1098); what the setup wrote, Start
  again deletes. CLAUDE.md §3's rule, `deploy/README.md` and the guard
  `scripts/start-again-records-writers.test.ts`, which reads path text, change with the code.
- **Waitron Cloud's files are grouped in `cloud/`,** and each flow deletes its record when it ends.
  Recovery and replacement are preproduction only (`cloud-recovery.ts:153`, `boot.ts:3185-3187`).

**One durable write, everywhere.** Today there are at least six ways to write a file safely, and
the most used one, `writeFileAtomic`, "does not fsync" (`packages/provisioning/src/fs-atomic.ts:36-38`).
It writes `secrets.env`, `trading.env`, `modules.json`, `backup.env`, `recovery.json`, the restore
request and the configuration import. On a restaurant box a power cut is an ordinary event, so the
target has one helper: write a temporary name, flush it, rename, flush the folder
(`writeFileDurable`, `fs-atomic.ts:52-80`, already does this). The one deliberate exception is the
5-second holder heartbeat (`venue.holder.json`), which is a liveness hint, not data. A1329 (owner,
2026-11-04) moves the box's key files to `writeFileDurable` first, ahead of this helper:
`secrets.env` is written by `box-secrets.ts:225` with the helper that does not flush.

**Secrets: three box files, and every other secret named.** `secrets.env` holds the vault key ring.
`backup.env` holds the backup key and its rotation time. `trading.env` holds identity and no secret.
Restore treats the three differently, so they stay three files (README U7). `WAITRON_ACCOUNT_KEY` is
removed completely, not moved (owner, 2026-11-04): its two uses become keys made from the vault key
ring (`tables-people.md` §6 item 8). The names of these keys, and what an archive carries, wait for
A1323.

The backup key has one home, `backup.env` (owner, 2026-11-04). `WAITRON_BACKUP_RECOVERY_KEY` and
`WAITRON_BACKUP_DIR` leave `compose.yml` and `.env`, so the key is set only from the dashboard, and
the environment can no longer override it (`box-env.ts:28-31`).

Certificate keys stay as PEM files under `tls/`, because the web server reads them as files. Waitron
Cloud's own key and link stay in `cloud/`, out of backups (`state-secrets.ts:10-14`). A private key
held by a flow is an attachment, deleted when its flow ends. Some secrets are not in files at all:
the signing key is in `node.db`, two-step secrets are on `persons`, and outside-service logins are
sealed in `venue_credentials`.

The TLS repair archive today keeps every old certificate-authority private key forever inside `tls/`,
so it even survives a plain reset. It keeps only the newest repair, deleted after the next healthy
start (owner, 2026-11-04).

The recovery bundle goes, with `POST /api/box/recovery-bundle`, `waitron-recovery unpack` and
`WAITRON_RECOVERY_PASSPHRASE` (owner, 2026-11-04). The recovery pack replaced it: no screen calls the
route (a grep of `apps/dashboard/src`, `apps/till/src` and `apps/setup/src` finds only a comment), and
`/app/bin-recovery.js unpack` is named only in `deploy/README.md:557`. Backups do not depend on it:
`RECOVERY_FILES` and `collectStateSecrets` in `state-secrets.ts` serve archives
(`archive-entries.ts:36`) and stay.

The B3 USB-installer scripts add two host-side secrets that stay out of `secrets.env` on purpose: the
disk recovery key (`/var/lib/waitron-host/disk-recovery/<disk id>.json`, `scripts/box/disk-key.mjs:33,39`)
and the Wi-Fi password in the boot copy (`/boot/waitron-recovery/wifi.json`,
`scripts/box/wifi-record.mjs:11,282`). The installer design keeps the first outside every venue backup
and rollback, and the second on the unencrypted boot partition so the box can join Wi-Fi before its
disk is unlocked (`docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:619-626`, `:699-725`;
read in the design, not run). Both belong to the host, not the Waitron server, so this design leaves
them where they are (items 85 and 86).

**The resulting layout** (documented once, in one source module that every path is read from, and
that the `waitron.sh` reset keep-list and the guards are tested against):

```
/var/lib/waitron/state/                 the `state` volume
  secrets.env                           vault key ring                reset: deleted   backups: yes
  backup.env                            backup key, rotation time     reset: deleted   backups: yes (a Cloud managed restore leaves it out)
  trading.env                           node id, environment, intent  reset: deleted   backups: yes
  recovery.json, recovery.lock          failed-start counter + lock   reset: deleted
  spare-space, spare-space.released     disk reserve (CLAUDE.md §3)   reset: deleted
  backup-room-note.json,
  backup-room-start-deleted.json        full-disk start hand-offs     reset: deleted
  module-records/<module>.json          fiscal hour history           reset: deleted   backups: yes
  stream/                               Litestream config + pid       reset: deleted
  cloud/                                Waitron Cloud link            reset: deleted   backups: never
  handover/<operation id>/              a stepped-down box's final copy (A1018)  reset: deleted
  tls/                                  CA, leaf, newest repair       reset: KEPT      backups: CA+leaf
  records/                              Start-again choices,
                                        set-aside                     reset: KEPT (only --all)
  flows/setup/      record.json + documents/ + import/ + start-again-guesses.json
  flows/restore/    record.json + payload (artifact | db + entries) + keys
  flows/tls-repair/ record.json
  scratch/                              every temporary folder; emptied at every start
  venue/                                venue.db, node.db, locks, holder, Litestream folder
/var/lib/waitron/logs/                  waitron.log (+5), crash-reports/ (7 days at every start)
/var/lib/waitron/backups/               *.backup.enc (7 copies / 30 days)
/var/lib/waitron-print-agent/           the print agent's own config, token, CA copy
/var/lib/waitron-host/disk-recovery/    B3 host only: disk recovery key, one file per disk
/boot/waitron-recovery/wifi.json        B3 host only: Wi-Fi join copy, read before unlock
```

---

## 2. Target list

| Target item | What it does | Why it must exist (F1 reason) |
| --- | --- | --- |
| `logs/waitron.log` + 5 rotated | Server diary; the recovery page tails it | Log; must be readable when the database is not |
| `logs/crash-reports/` | Post-mortem of a frozen server | Log; written by a watchdog thread while the main thread is stuck |
| `state/secrets.env` | The vault key ring: the current key, and the previous one during a rotation | Secret, needed before any sealed row can be opened |
| `state/backup.env` | The backup key and its rotation time | The key that opens archives must exist outside the database; restore treats it differently from `secrets.env` (README U7) |
| `state/trading.env` | Node id, environment, onboarding intent; its presence means "set up" | Needed before the database is opened (picks the mode); read by `waitron.sh reset` with the box down |
| `state/tls/ca.*`, `server.*` | Box's certificate authority and web certificate | Needed before the web server starts; must survive a plain reset so phones keep trusting |
| `state/tls/repair/` (newest only) | Old certificates set aside during a TLS repair | Lets a repair be undone; deleted after the next healthy start |
| `state/recovery.json` + `recovery.lock` | Failed-start counter and its cross-process lock | Must work when the database cannot be opened |
| `state/spare-space` + `.released` | 8 MiB disk reserve and "reserve used" marker | Space to start on a full disk (CLAUDE.md §3, unchanged) |
| `state/backup-room-note.json` | Where local backups are, for a full-disk start | Read before the database is opened (CLAUDE.md §3, unchanged) |
| `state/backup-room-start-deleted.json` | Backups a full-disk start deleted, until an alert is recorded | Written before the database is opened |
| `state/module-records/<module>.json` | Fiscal hour history (prepared + retained from restored backups) | Must outlive the database being replaced; travels in backups |
| `state/stream/litestream.yml` + `.pid` | Litestream's config and orphan-stop pid | Owned by another program |
| `state/cloud/` | Cloud link key; per-flow Cloud recovery and replacement records | Secret that must stay out of backups (`state-secrets.ts:10-14`) |
| `state/handover/<operation id>/` | The final copy of `venue.db` a stepped-down box hands over (A1018, #2442) | Must outlive the database being replaced; `apps/server/src/handover-capture.ts:60-62` |
| `state/records/` | Start-again Keep/Move choices, set-aside files | Must survive reset (owner decision, CLAUDE.md §3) |
| `state/flows/setup/` | One first-setup record, plus documents, staged import and the count of wrong passwords on the "files found" page | Holds a running setup, and lets the repair page show it and Start again delete it, when the database may be missing |
| `state/flows/restore/` | One staged restore: record + payload + keys | Hands a restore to the next start, before the database is opened |
| `state/flows/tls-repair/` | Repair progress record | Resumes a cut repair; runs when the web server cannot |
| `state/scratch/` | Every temporary folder | Working space; emptied at every start |
| `venue/venue.lock`, `migrations.lock` | One process per venue folder; one migrator | Locks (never unlinked, CLAUDE.md §3) |
| `venue/venue.holder.json` | Who holds the folder, heartbeat | Read by a start refused the lock |
| `venue/first-setup-deleting.json` | Start-again deletion in progress | Must survive a crash mid-deletion |
| `venue/.venue.db-litestream/` | Litestream's own progress | Owned by another program |
| `backups/*.backup.enc` | Encrypted backups | Backup |
| print-agent `config.json`, `token`, `server-ca.crt` | The print agent's settings and login | Another program, possibly on another machine |
| Docker volumes, container logs, images | The box's containers | Owned by Docker |
| `/opt/waitron/compose.yml`, `.env`, `waitron.sh` | Install layout and local overrides | Install files |
| AppArmor profile, Bluetooth drop-in, `waitron-box` units, socket, `/run` lock | Host integration for printing and clock | Install files; owned by systemd |
| Docker apt source | Lets install put Docker on a bare host | Install file |
| Mailpit database | Practice inbox | Another program; retention added |
| Development files | Local dev box | Development only |
| `/var/lib/waitron-host/disk-recovery/<disk id>.json` (B3 host) | Disk recovery key, written once per disk | Secret that must stay out of venue backups and rollback; owned by the host service |
| `/boot/waitron-recovery/wifi.json` (B3 host) | Wi-Fi join settings for the locked box | Needed before the disk is unlocked; owned by the host service |

---

## 3. Mapping (every current item)

Numbers are the item's position in the inventory. Items 33 and 56 describe one folder and are mapped
together.

| # | Current | Fate | Why |
| --- | --- | --- | --- |
| 0 | `waitron.log` + rotations | keep | Log, needed when the database is not; already bounded (~60 MB). |
| 1 | `secrets.env` | keep | Holds the vault key ring only. The account key is removed, not moved into it, and the backup key stays in `backup.env`. |
| 2 | `tls/ca.*` | keep | Needed before the listener; survives reset by design. |
| 3 | `tls/server.*` (+ `.previous`, `.tmp`) | keep; close the crash window | A crash between two renames can leave a mismatched pair (`box-secrets.ts:231-237`); write key+cert as one file or one folder swap (§5, test T6). |
| 4 | `tls/venue-ca.*` | keep (U5) | Written by the join flow (`box-secrets.ts:99-100`); the listener never reads them (`box-secrets.ts:89-91`). They hold the main box's certificate authority (`box-secrets.ts:90-91`), the venue's authority A947 relies on: a spare that takes over issues its certificate from it (A947 design §6.3 step 4). |
| 5 | `tls/repair-pending.json` + `tls/repair-archive/` | replace with `flows/tls-repair/record.json` + `tls/repair/` (newest only) | Archive holds old private keys and nothing deletes it (`grep -rn repair-archive` → only `box-tls-repair.ts:292`, `box-secrets.ts:202`); it survives plain reset inside `tls/`. |
| 6 | `recovery.lock` | keep | Lock; never unlinked (CLAUDE.md §3). |
| 7 | `recovery.json` | keep; durable write | Must work when the database cannot; today `writeFileAtomic` without flush. |
| 8 | `trading.env` (+ `.replaced`) | keep, **minus the account key**; delete `.replaced` when the restore's first start completes | Needed before the database opens; nothing deletes `.replaced` (`grep -rn REPLACED_SUFFIX` → only `restore.ts:98,826`). |
| 9 | `modules.json` | move to `settings` (if T5 passes) | A venue-wide, dashboard-editable setting that today travels in backups as a loose file. |
| 10 | `backup.env` | keep, as the one home of the backup key; durable write | Holds the key and, until A1323, its rotation time, which product logic reads. Its writer does a read-modify-write with no lock (`backup-env-writer.ts:31-49`). |
| 11 | `spare-space` | keep | CLAUDE.md §3 rule unchanged. |
| 12 | `spare-space.released` | keep | CLAUDE.md §3 rule unchanged. |
| 13 | `backup-room-note.json` | keep | Read before the database opens (CLAUDE.md §3 unchanged). |
| 14 | `backup-room-start-deleted.json` | keep | Written by a full-disk start before the database opens; deleted once the alert is recorded. |
| 15 | `backup-staging/` | move to `scratch/backup/` | Same sweep as every scratch folder; the staging-turn rule (CLAUDE.md §3) moves with it. |
| 16 | local backup archives | keep | Backup; already pruned (7 copies, 30 days). |
| 17 | `restore-request.*` (7 files) | merge into `flows/restore/` (one record + payload) | Marker-last crash safety is kept; ending becomes one folder rename instead of a parallel delete (`restore-request.ts:329-340`). |
| 18 | `reset-request.json` | keep (U5) | Undoes an adopt (`reset-request.ts:24-28`, `:102-114`), and U5 keeps adoption. |
| 19 | `rebuild-first-start.json` | merge into `flows/restore/record.json` (phase "first start pending") | It is the restore flow's last phase; one record per flow. |
| 20 | `pending-adoption.json` | keep (U5) | The adoption latch: finishing refuses `mirror.venue_not_copied` until the spare holds a venue row (`reserved-identity.ts:68-69`, `finish-adoption.ts:28-33`); it closes in A947 slice 3b. |
| 21 | `restore-staging/` | move to `scratch/restore/` | Only `staged-recovery/` is swept at start (`start-space.ts:98-101`); the other four prefixes are never swept. |
| 22 | `restore-entry-*`, `stream-restore-*` | move to `scratch/` | No start sweep (grep above); a crash leaves a plain venue copy in the state folder. |
| 23 | `*.incoming`, `.venue.db-replaced-*` | keep | Crash-safe database swap; the set-aside folder already has a recovery path (`restore.ts:770-790`). |
| 24 | `/tmp` folders (holdings, history, proof, repair-cloud, node-copy) | move to `scratch/` | `/tmp` is the container's own layer; `restart: unless-stopped` restarts the same container, so a crash leftover persists unswept. |
| 25 | `cloud-connection.json` | move to `cloud/connection.json` | Secret that must stay out of backups; no deleter today. |
| 26 | `cloud-recovery.json` | move to `cloud/recovery.json`, deleted when the flow ends | Preproduction only (`cloud-recovery.ts:153`); no deleter today. |
| 27 | `cloud-replacement.json` | move to `cloud/replacement.json`, deleted when the flow ends | Preproduction only (`boot.ts:3185-3187`); no deleter today. |
| 28 | `cloud-staff.key/.crt` | move to `cloud/` | Operator-installed; kept out of backups on purpose (`cloud-remote.ts:24`). |
| 29 | `cloud-snapshots/` | keep `state.json` in `cloud/`; staging joins the backup service's own folder, `scratch/backup/` | Backups and Cloud snapshots are one service with different backends (owner, 2026-11-04; `jobs.md`), so one staging folder and one turn. Today Cloud's staging (a plain copy) is cleared only after a successful Cloud status call (`cloud-snapshot-worker.ts:153-163`). |
| 30 | `first-fiscal-documents/<module>.json` + chunks | move to `flows/setup/documents/` | Immutable chunks with manifest last are a real crash-safety split; keep them as attachments. |
| 31 | `module-operation-public.json` | merge into `flows/setup/record.json` | Setup-time record of public keys; one record per flow. |
| 32 | `module-evidence/<module>/<source>.json` | merge into `module-records/<module>.json` | Same fiscal hour history as item 54; one copy per module. |
| 33 + 56 | `first-setup-resolutions/backup-recovery/<id>/` | delete (A1131bc slice 4) | The old recovery's folder. A recovery cut off during setup is redone, not resumed (owner, 2026-11-04), and the fresh-box restore writes into the usual folders, so nothing is left to promote. |
| 34 | `waitron-recovery unpack` output | delete | Goes with the recovery bundle (owner, 2026-11-04). |
| 35 | backup verification scratch (caller's) | keep | Caller-chosen scratch; nothing on the box calls it (`grep -rln verifyBackupArtifact` → only its own entry files). |
| 36 | dev `.env`, dev state, receipt-look output | keep | Development only. |
| 37 | `venue.lock` | keep | Lock (CLAUDE.md §3). |
| 38 | `venue.holder.json` | keep | Liveness hint; the one write allowed to skip flushing. |
| 39 | `crash-reports/` | keep; prune at every start | Today pruned only when the disk is low (`start-space.ts:128-132` returns before the crash-report loop). |
| 40 | `migrations.lock` | keep | Lock. |
| 41 | `<archive>.partial` | keep | Safe-copy working name; its folder becomes `scratch/`. |
| 42 | `verification-venue-*` | keep | Removed in a `finally`; its root becomes `scratch/` when the box calls it. |
| 43 | `stream/litestream.yml` | keep | Rewritten at every stream start, so a torn write heals itself. |
| 44 | `stream/litestream.pid` | keep | Orphan-stop only. |
| 45 | `.venue.db-litestream/` | keep | Litestream's own (CLAUDE.md §3). |
| 46 | Litestream restore scratch | keep (inside `scratch/`) | Its parent folder moves with item 22. |
| 47 | bucket download `.part` | keep | Safe-download working name; removed on failure. |
| 48 | `setup-operation.json` + `.lock` | record → `flows/setup/record.json`; lock → delete (once T3 passes) | The lock is a create-exclusive file that any other owner id "takes over" (`packages/provisioning/src/setup-operation.ts:102-145`); the venue lock already allows one process. |
| 49 | `configuration-import.*` | move to `flows/setup/import/` | Marker-last pair is kept as an attachment; one flow folder. |
| 50 | `fiscal-readiness.json` | merge into `flows/setup/record.json` | Setup-time evidence; Start again does not delete it today (`first-setup-start-again-deletion.ts:135-154` does not list it). |
| 51 | `first-setup.json` + `first-setup-claim.json` | state → `flows/setup/record.json`; claim → delete | One setup record. The claim exists because the venue folder can be configured apart from the state folder, which stops on a box; its "publication complete" status moves into the record. |
| 52 | `first-setup-node-key.json` | merge into `flows/setup/record.json` | A verifier, not the key; one record per flow. |
| 53 | `<module>.recovery.json` | merge into `flows/setup/record.json` | A manifest of the delivered document. |
| 54 | `module-preparation-state.json` | merge into `module-records/<module>.json` | It is read at every backup, so it is long-lived, not setup-only. |
| 55 | `first-setup-resolutions/<uuid>/` | delete with Continue (A1322) | Both writers hang off Continue, and the other two actions have no writer (§1). |
| 57 | `first-setup-deleting.json` | keep | Start again's flow record; must survive a crash mid-deletion. |
| 58 | Start-again confirmations | delete: stop writing them | Nothing reads them, no screen shows them, and they hold the setup administrator's name and email until `reset --all` (owner, 2026-11-04). |
| 59 | Start-again choices | move to `records/choices/` | Survive reset by owner decision; holds an administrator's name and email. |
| 60 | Start-again set-aside | move to `records/set-aside/` | Survives reset by owner decision (A1098); holds only files Start again did not create. |
| 61 | `first-setup-start-again-guesses.json` | keep (in `flows/setup/`) | Must work when the database is missing; counted before checking (`first-setup-start-again-guesses.ts:112-114`). |
| 62 | `.first-setup-<uuid>.tmp`, `<file>.tmp` | replace with the one durable-write helper | One helper for every file. |
| 63 | `waitron-provision` outputs | keep; its `modules.json` write goes with item 9, or becomes durable if T5 fails; its way back into a stopped setup goes with Continue (§1) | Not in the image (`deploy/Dockerfile:203-213`). |
| 64 | fiscal emergency/receipt directories | delete (fiscal, owner lands it) | Replaced, so it meets the amended R5: no caller outside its own package (`grep -rln allocation-configuration` → tests only); superseded 2026-10-19; `initial-setup.ts:381-382` still names the variables. |
| 65 | print-agent `config.json` | keep | Another program's settings. |
| 66 | print-agent `token` | keep | Its login. |
| 67 | print-agent `server-ca.crt` | keep | Trust before HTTPS works. |
| 68 | `/dev/usb/lpN` | keep | A device, not a file. |
| 69 | dev print-agent folder | keep | Development only. |
| 70 | Docker named volumes | keep | Where the box lives; `box_socket` is outside the reset list but holds nothing of its own. |
| 71 | Mailpit database | keep; cap it | No message-count limit is set in `deploy/compose.yml:88-91`. |
| 72 | Docker container logs | keep | Bounded by Docker (`compose.yml:97-101`, `:169-173`). |
| 73 | `/opt/waitron/compose.yml`, `.env.example` | keep `compose.yml` (atomic download); delete `.env.example` from the box | `fetch` writes straight onto the file (`deploy/waitron.sh:42`, `:199-204`); the example is documentation. |
| 74 | `/opt/waitron/.env` | keep; **drop `WAITRON_BACKUP_RECOVERY_KEY` and `WAITRON_BACKUP_DIR` from it** | A second home for the backup key (`compose.yml:37-38`); `.env.example:41-42` lists both. |
| 75 | `/opt/waitron` temporary files | keep | Install safety copies. |
| 76 | `waitron.sh` self-replacement | keep | Keeps the script in step. |
| 77 | AppArmor profile | keep | Needed for Bluetooth. |
| 78 | Bluetooth drop-in | keep | Stops the PIN being answered for the agent. |
| 79 | `waitron-box` script, units, group | keep | Clock helper. |
| 80 | `/run/waitron-box/box.sock` | keep | Clock doorway. |
| 81 | `/run/waitron-box-state/*` | keep | Clock-set lock and restart marker. |
| 82 | journal lines, timesyncd timestamp | keep | Audit of clock changes on the host. |
| 83 | Docker apt source | keep | Install on a bare host. |
| 84 | Docker images | keep; clear build cache after a branch install | `grep -n prune deploy/waitron.sh` finds none. |
| 85 | `/boot/waitron-recovery/wifi.json` + `wifi.json.next` (B3 Wi-Fi boot copy, #2432) | keep (host-owned) | Read before the disk is unlocked, so it cannot live in the state volume. Written as `.next`, flushed, renamed, folder flushed (`scripts/box/wifi-boot-copy.mjs:36-38`, `:236-253`); removed by `:262-268`. It holds the Wi-Fi password (`scripts/box/wifi-record.mjs:11`). Nothing outside `scripts/box/` calls it yet (`git grep -l -E 'publishWifiBootCopy|createWifiBootCopyPublisher' -- ':!docs'` → its own file and its test). |
| 86 | `/var/lib/waitron-host/disk-recovery/<disk id>.json` + `.next` (B3 disk recovery key, #2370) | keep (host-owned) | Written once per disk and never removed (`scripts/box/disk-key.mjs:33,39`, `:246-273`, "nothing may remove a key" at `:259`). The design keeps it outside venue backups and rollback (`docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md:619-626`). Nothing outside `scripts/box/` calls it yet (`git grep -l createDiskRecoveryStore -- ':!docs'` → its own file and its test). |
| 87 | `handover/<operation id>/venue.db` + `.retake-<uuid>` (A1018 Slice 4, #2442) | keep; A1018 owns it | The final copy a stepped-down box describes and hands over (`apps/server/src/handover-capture.ts:60-62`, `handover-source-api.ts:121-134`). New since the inventory. It is a plain copy of the database, and I found no code that deletes a finished one: the only `rm` calls replace the copy or clear a leftover retake (`handover-capture.ts:108`, `handover-source-api.ts:109-112`, `:134`). |

---

## 4. How each worry is answered

**Performance.** Files are off the sale path except two: the log and the holder heartbeat.

- Every log line is an `appendFileSync` on the main thread (`log-file.ts:70`), plus a copy to
  standard output (`boot.ts:1124`, `:1140`). This design does not change it, but it is the one file
  cost worth measuring (T1).
- The holder heartbeat is a 150-byte rename every 5 seconds (`venue-liveness.ts:10`); it stays
  unflushed on purpose.
- Flushing every other write adds a few milliseconds to rare events (setup steps, key rotation, a
  restore). None is on a sale.
- Moving `/tmp` scratch onto the state volume replaces copies through the container's layered
  filesystem with copies on a plain volume. That should not be slower; T2 checks it.
- Moving `modules.json` into `settings` costs one row read at start.

**Data loss.**

- **Power cuts.** At least seven kinds of file are written without a flush today (`writeFileAtomic`,
  `fs-atomic.ts:36-38`). `secrets.env` is among them, and losing it makes every stored credential
  and every backup unreadable (`state-secrets.ts:30-33`). One durable helper closes this.
- **Torn pairs.** The web certificate and key are renamed separately (`box-secrets.ts:231-237`).
  One file, or one folder swap, closes that.
- **Wrong module set after a restore.** `modules.json` travels beside the database as a separate,
  optional file (`backup-optional-state.ts:10-16`), so a restore can pair a database with another
  time's module list. In `settings` it is restored with the database it describes.
- **Two homes for the backup key.** `.env` (`compose.yml:38`) and `backup.env`. If they disagree,
  `box-env.ts:28-31` lets the environment win, so a key the owner rotated from the dashboard can be
  silently overridden. One home, `backup.env`, closes this.
- **Unencrypted copies left after a crash.** Five scratch prefixes are never swept, and `/tmp`
  survives a container restart. One `scratch/` folder, emptied at every start under the venue lock,
  bounds a plain copy's life to one run.
- **What this design deliberately does not touch:** the spare file, the backup-room note, the
  staging turn, the Start-again choice records and set-aside, and the never-unlinked locks (all
  CLAUDE.md §3).

**Upgrades.**

- Before go-live, every layout change here ships with a reset (CLAUDE.md §3 "No backwards-compatibility
  … until Waitron is in production"), so no file-moving code is written. That is the argument for
  settling the layout now: after go-live, every path change is an on-box migration with no
  framework.
- The target also removes three upgrade hazards:
  - It deletes the leftover-name refusals for an older first-setup layout
    (`packages/provisioning/src/first-setup-workspace.ts:7-13`, "nothing reads them now"), which
    are backwards-compatibility code the rule forbids.
  - It replaces path names scattered over many modules (`restore-request.ts:62-71`,
    `spare-space-name.ts`, `first-setup-start-again-names.ts`, `start-space.ts:13`, and the
    `find` keep-list at `deploy/waitron.sh:813`) with one list.
  - A1131bc slice 4 ends the nested-state-folder mode, which today every state rule has to
    understand separately (`first-setup-entry.ts:74-92`).
- `compose.yml` downloads become atomic, so a cut install cannot leave a box that will not start.
- `packages/handover/src/manifest.ts` names these files one by one (`:109-151`), so its list moves
  with the layout.

---

## 5. Measure or test before building

| # | Test | Result that would change the design |
| --- | --- | --- |
| T1 | On box hardware, time `appendFileSync` per log line, and count the log lines one sale writes. | If logging costs over about 1 ms a sale, add a buffered asynchronous writer (and keep a flush on the failure path the recovery page reads). |
| T2 | Copy a 200 MB database into `/tmp` and into the state volume inside the container, timing both. | If the volume is much slower, keep a box-local scratch on a different mount, but still under one swept root. |
| T3 | Confirm that every first-setup operation runs while its process holds `venue.lock` (setup mode, the repair page, the provisioning command). | If any does not, keep a lock for setup, but make it a SQLite lock like `migrations.lock`, not a create-exclusive file with takeover. |
| T4 | Kill the process between the parallel deletes in `clearStagedRestore` (`restore-request.ts:329-340`), leaving the marker without its artifact, then start. | If the next start refuses or loops, the folder-rename ending is a fix, not just tidying. That raises its priority. |
| T5 | List every reader of the module list that runs before `venue.db` can be opened (`boot.ts:1079`, `first-setup-entry.ts:350`, `mirror-bundle.ts:163`) and check whether the core migration set can run first. | If a module's migrations must run before the core set can be read, `modules.json` stays a file with a durable write. |
| T6 | Check that Node's TLS listener accepts key and certificate read from one PEM file. | If not, use a folder swap (write `tls/leaf-new/`, rename over `tls/leaf/`). |
| T7 | `git log -S module-evidence` to establish whether Start again leaving `module-evidence/` (it is not in `first-setup-start-again-deletion.ts:135-154`) is deliberate. | If deliberate, `module-records/<module>.json` keeps two sections with different Start-again treatment; if not, one. |
| T8 | Power-cut test on a box: rotate the vault key, cut power within 1 second, then boot. | If the old key survives intact today, the flush is still right but less urgent; if `secrets.env` comes back empty, it is urgent. |
| T9 | With A1322 built, cut a setup at each status from `claimed` to `publication`, press Start again, and list what is left in both folders. | Any file a later setup or start trips over goes on the deletion list. |

---

## 6. Decisions for the owner

Every decision in this file is settled and stated above. `waitron-provision`'s way back in goes with
Continue (§1). No question is open in this area.
