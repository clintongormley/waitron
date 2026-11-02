> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Files on disk: a rationalised design

Part: every file Waitron writes outside `venue.db` and `node.db`. Read against `main` at `64eeabb036`
(2 November 2026). Read only: nothing was run except `grep`, `sed` and `git log`. Each claim below
that is not a `file:line` names the grep behind it.

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
systemd, the print agent, Litestream). Today most files pass that test. Three things fail it:

1. **`modules.json`** is a venue-wide, dashboard-editable setting (on/off overrides only,
   `packages/module/src/config.ts:5-11`) that travels in backups as a loose file
   (`apps/server/src/backup-optional-state.ts:10-16`). It belongs in the `settings` table, so it
   always travels with the database it describes. That is a decision (§6, D3) because boot reads it
   before opening the database (`boot.ts:929`, database opened at `boot.ts:998`).
2. **`backup.env`'s rotation time** (`WAITRON_BACKUP_KEY_ROTATED_AT`, `backup-env-writer.ts:46`)
   is not a secret. It belongs in `box_settings`.
3. **The join ("adopt") flow** writes `pending-adoption.json`, `tls/venue-ca.*` and
   `reset-request.json` for a step that `finish-adoption.ts:31-44` says "CANNOT SUCCEED TODAY". It
   is still reachable from the setup API (`grep -rln adoptFromPrimary apps/server/src` → `setup-api.ts`,
   `boot.ts`). I recommend deleting it until the replication work it waits for exists (D1).

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

**One state-folder layout, with one owner per folder.** Everything temporary moves under
`<state>/scratch/`, which the start empties under the venue lock — replacing today's scatter of
`backup-staging/`, `restore-staging/`, `restore-entry-*`, `stream-restore-*`, `cloud-snapshots/staging/`
and five kinds of `/tmp` folder, of which the start sweeps only two (`start-space.ts:88-101`; the
other prefixes appear in no sweep: `grep -rn -E "stream-restore-|restore-entry-|archive-validate-|…"`
finds only their `mkdtemp` sites and an operator message telling the owner to delete one by hand,
`restore-command.ts:573`). What survives a plain `waitron.sh reset` (`tls/` and the Start-again
records, `deploy/waitron.sh:806-813`) is gathered so that the reset's keep-list is two names.

**One durable write, everywhere.** Today there are at least six ways to write a file safely, and
the most used one, `writeFileAtomic`, "does not fsync" (`packages/provisioning/src/fs-atomic.ts:36-38`).
It writes `secrets.env`, `trading.env`, `modules.json`, `backup.env`, `recovery.json`, the restore
request and the configuration import. On a restaurant box a power cut is an ordinary event, so the
target has one helper: write a temporary name, flush it, rename, flush the folder
(`writeFileDurable`, `fs-atomic.ts:52-80`, already does this). The one deliberate exception is the
5-second holder heartbeat (`venue.holder.json`), which is a liveness hint, not data.

**Secrets in two places, not ten.** Short secrets (the vault key and its previous version, the
account key, the backup recovery key) live in one file, `<state>/secrets.env`. Certificate keys stay
as PEM files under `tls/`, because the web server reads them as files. Everything else that holds a
private key is either a flow attachment (deleted when its flow ends) or Waitron Cloud's own key,
which must stay out of backups (`state-secrets.ts:10-14`). The TLS repair archive, which today keeps
every old certificate-authority private key forever inside `tls/` — so it even survives a plain
reset — keeps only the newest repair, deleted after the next healthy start.

**The resulting layout** (documented once, in one source module that every path is read from, and
that the `waitron.sh` reset keep-list and the guards are tested against):

```
/var/lib/waitron/state/                 the `state` volume
  secrets.env                           every short secret            reset: deleted   backups: yes
  trading.env                           node id, environment, intent  reset: deleted   backups: yes
  recovery.json, recovery.lock          failed-start counter + lock   reset: deleted
  spare-space, spare-space.released     disk reserve (CLAUDE.md §3)   reset: deleted
  backup-room-note.json,
  backup-room-start-deleted.json        full-disk start hand-offs     reset: deleted
  module-records/<module>.json          fiscal hour history           reset: deleted   backups: yes
  stream/                               Litestream config + pid       reset: deleted
  cloud/                                Waitron Cloud link (if kept)  reset: deleted   backups: never
  tls/                                  CA, leaf, newest repair       reset: KEPT      backups: CA+leaf
  records/                              Start-again confirmations,
                                        choices, set-aside            reset: KEPT (only --all)
  flows/setup/      record.json + documents/ + resolutions/ + import/ + backup-recovery/<id>/
  flows/restore/    record.json + payload (artifact | db + entries) + keys
  flows/tls-repair/ record.json
  scratch/                              every temporary folder; emptied at every start
  venue/                                venue.db, node.db, locks, holder, claim, Litestream folder
/var/lib/waitron/logs/                  waitron.log (+5), crash-reports/ (7 days at every start)
/var/lib/waitron/backups/               *.backup.enc (7 copies / 30 days)
/var/lib/waitron-print-agent/           the print agent's own config, token, CA copy
```

---

## 2. Target list

| Target item | What it does | Why it must exist (F1 reason) |
| --- | --- | --- |
| `logs/waitron.log` + 5 rotated | Server diary; the recovery page tails it | Log; must be readable when the database is not |
| `logs/crash-reports/` | Post-mortem of a frozen server | Log; written by a watchdog thread while the main thread is stuck |
| `state/secrets.env` | Vault key (+ previous), account key, backup recovery key | Secret, needed before any sealed row can be opened |
| `state/trading.env` | Node id, environment, onboarding intent; its presence means "set up" | Needed before the database is opened (picks the mode); read by `waitron.sh reset` with the box down |
| `state/tls/ca.*`, `server.*` | Box's certificate authority and web certificate | Needed before the web server starts; must survive a plain reset so phones keep trusting |
| `state/tls/repair/` (newest only) | Old certificates set aside during a TLS repair | Lets a repair be undone; deleted after the next healthy start |
| `state/recovery.json` + `recovery.lock` | Failed-start counter and its cross-process lock | Must work when the database cannot be opened |
| `state/spare-space` + `.released` | 8 MiB disk reserve and "reserve used" marker | Space to start on a full disk (CLAUDE.md §3, unchanged) |
| `state/backup-room-note.json` | Where local backups are, for a full-disk start | Read before the database is opened (CLAUDE.md §3, unchanged) |
| `state/backup-room-start-deleted.json` | Backups a full-disk start deleted, until an alert is recorded | Written before the database is opened |
| `state/module-records/<module>.json` | Fiscal hour history (prepared + retained from restored backups) | Must outlive the database being replaced; travels in backups |
| `state/stream/litestream.yml` + `.pid` | Litestream's config and orphan-stop pid | Owned by another program |
| `state/cloud/` (only if Cloud stays) | Cloud link key; per-flow Cloud recovery and replacement records | Secret that must stay out of backups (`state-secrets.ts:10-14`) |
| `state/records/` | Start-again confirmations, Keep/Move choices, set-aside files | Must survive reset (owner decision, CLAUDE.md §3) |
| `state/flows/setup/` | One first-setup record, plus documents, decision log, staged import, backup-recovery workspace | Must outlive the database being deleted (Start again) and a restart mid-setup |
| `state/flows/restore/` | One staged restore: record + payload + keys | Hands a restore to the next start, before the database is opened |
| `state/flows/tls-repair/` | Repair progress record | Resumes a cut repair; runs when the web server cannot |
| `state/scratch/` | Every temporary folder | Working space; emptied at every start |
| `venue/venue.lock`, `migrations.lock` | One process per venue folder; one migrator | Locks (never unlinked, CLAUDE.md §3) |
| `venue/venue.holder.json` | Who holds the folder, heartbeat | Read by a start refused the lock |
| `venue/first-setup-claim.json` | Ties the venue folder to the setup attempt | Only while the venue folder may live apart from the state folder (D4) |
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

---

## 3. Mapping (every current item)

Numbers are the item's position in the inventory. Items 33 and 56 describe one folder and are mapped
together.

| # | Current | Fate | Why |
| --- | --- | --- | --- |
| 0 | `waitron.log` + rotations | keep | Log, needed when the database is not; already bounded (~60 MB). |
| 1 | `secrets.env` | keep; **becomes the one short-secret file** | Absorbs the account key from `trading.env` and the recovery key from `backup.env`. |
| 2 | `tls/ca.*` | keep | Needed before the listener; survives reset by design. |
| 3 | `tls/server.*` (+ `.previous`, `.tmp`) | keep; close the crash window | A crash between two renames can leave a mismatched pair (`box-secrets.ts:231-237`); write key+cert as one file or one folder swap (§5, test T6). |
| 4 | `tls/venue-ca.*` | delete (D1) | Only written by the join flow, which cannot finish (`finish-adoption.ts:31-44`); the listener never reads them (`box-secrets.ts:89-91`). |
| 5 | `tls/repair-pending.json` + `tls/repair-archive/` | replace with `flows/tls-repair/record.json` + `tls/repair/` (newest only) | Archive holds old private keys and nothing deletes it (`grep -rn repair-archive` → only `box-tls-repair.ts:292`, `box-secrets.ts:202`); it survives plain reset inside `tls/`. |
| 6 | `recovery.lock` | keep | Lock; never unlinked (CLAUDE.md §3). |
| 7 | `recovery.json` | keep; durable write | Must work when the database cannot; today `writeFileAtomic` without flush. |
| 8 | `trading.env` (+ `.replaced`) | keep, **minus the account key**; delete `.replaced` when the restore's first start completes | Needed before the database opens; `.replaced` holds an old account key and nothing deletes it (`grep -rn REPLACED_SUFFIX` → only `restore.ts:98,826`). |
| 9 | `modules.json` | move to `settings` (D3) | A venue-wide, dashboard-editable setting that today travels in backups as a loose file. |
| 10 | `backup.env` | merge into `secrets.env`; rotation time to `box_settings` | Third secret file; its writer does a read-modify-write with no lock (`backup-env-writer.ts:31-49`). |
| 11 | `spare-space` | keep | CLAUDE.md §3 rule unchanged. |
| 12 | `spare-space.released` | keep | CLAUDE.md §3 rule unchanged. |
| 13 | `backup-room-note.json` | keep | Read before the database opens (CLAUDE.md §3 unchanged). |
| 14 | `backup-room-start-deleted.json` | keep | Written by a full-disk start before the database opens; deleted once the alert is recorded. |
| 15 | `backup-staging/` | move to `scratch/backup/` | Same sweep as every scratch folder; the staging-turn rule (CLAUDE.md §3) moves with it. |
| 16 | local backup archives | keep | Backup; already pruned (7 copies, 30 days). |
| 17 | `restore-request.*` (7 files) | merge into `flows/restore/` (one record + payload) | Marker-last crash safety is kept; ending becomes one folder rename instead of a parallel delete (`restore-request.ts:329-340`). |
| 18 | `reset-request.json` | delete (D1) | Only undoes an adopt (`reset-request.ts:24-28`, `:102-114`). |
| 19 | `rebuild-first-start.json` | merge into `flows/restore/record.json` (phase "first start pending") | It is the restore flow's last phase; one record per flow. |
| 20 | `pending-adoption.json` | delete (D1) | Cannot succeed today (`finish-adoption.ts:31-44`); stays until a reset. |
| 21 | `restore-staging/` | move to `scratch/restore/` | Only `staged-recovery/` is swept at start (`start-space.ts:98-101`, `boot.ts:1002`); the other four prefixes are never swept. |
| 22 | `restore-entry-*`, `stream-restore-*` | move to `scratch/` | No start sweep (grep above); a crash leaves a plain venue copy in the state folder. |
| 23 | `*.incoming`, `.venue.db-replaced-*` | keep | Crash-safe database swap; the set-aside folder already has a recovery path (`restore.ts:770-790`). |
| 24 | `/tmp` folders (holdings, history, proof, repair-cloud, node-copy) | move to `scratch/` | `/tmp` is the container's own layer; `restart: unless-stopped` restarts the same container, so a crash leftover persists unswept. |
| 25 | `cloud-connection.json` | move to `cloud/connection.json` (D5) | Secret that must stay out of backups; no deleter today. |
| 26 | `cloud-recovery.json` | move to `cloud/recovery.json`, deleted when the flow ends (D5) | Preproduction only (`cloud-recovery.ts:153`); no deleter today. |
| 27 | `cloud-replacement.json` | move to `cloud/replacement.json`, deleted when the flow ends (D5) | Preproduction only (`boot.ts:2902-2903`); no deleter today. |
| 28 | `cloud-staff.key/.crt` | move to `cloud/` | Operator-installed; kept out of backups on purpose (`cloud-remote.ts:24`). |
| 29 | `cloud-snapshots/` | keep `state.json` in `cloud/`; staging to `scratch/` | Staging (a plain copy) is cleared only after a successful Cloud status call (`cloud-snapshot-worker.ts:153-163`). |
| 30 | `first-fiscal-documents/<module>.json` + chunks | move to `flows/setup/documents/` | Immutable chunks with manifest last are a real crash-safety split; keep them as attachments. |
| 31 | `module-operation-public.json` | merge into `flows/setup/record.json` | Setup-time record of public keys; one record per flow. |
| 32 | `module-evidence/<module>/<source>.json` | merge into `module-records/<module>.json` | Same fiscal hour history as item 54; one copy per module. |
| 33 + 56 | `first-setup-resolutions/backup-recovery/<id>/` | move to `flows/setup/backup-recovery/<id>/`; **a selected recovery is promoted into the real folders** (D2) | Today a selected recovery leaves the box running for good from a nested state folder (`first-setup-launch.ts:104-110`). |
| 34 | `waitron-recovery unpack` output | keep | Operator-owned export of a recovery bundle. |
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
| 48 | `setup-operation.json` + `.lock` | record → `flows/setup/record.json`; lock → delete (D4 test T3) | The lock is a create-exclusive file that any other owner id "takes over" (`packages/provisioning/src/setup-operation.ts:102-145`); the venue lock already allows one process. |
| 49 | `configuration-import.*` | move to `flows/setup/import/` | Marker-last pair is kept as an attachment; one flow folder. |
| 50 | `fiscal-readiness.json` | merge into `flows/setup/record.json` | Setup-time evidence; Start again does not delete it today (`first-setup-start-again-deletion.ts:131-148` does not list it). |
| 51 | `first-setup.json` + `first-setup-claim.json` | state → `flows/setup/record.json`; claim → keep (D4) | One setup record; the claim exists because the venue folder can be configured apart from the state folder. |
| 52 | `first-setup-node-key.json` | merge into `flows/setup/record.json` | A verifier, not the key; one record per flow. |
| 53 | `<module>.recovery.json` | merge into `flows/setup/record.json` | A manifest of the delivered document. |
| 54 | `module-preparation-state.json` | merge into `module-records/<module>.json` | It is read at every backup, so it is long-lived, not setup-only. |
| 55 | `first-setup-resolutions/<uuid>/` | move to `flows/setup/resolutions/` | Append-only, hash-chained, each file immutable; files are the right shape for it. |
| 57 | `first-setup-deleting.json` | keep | Start again's flow record; must survive a crash mid-deletion. |
| 58 | Start-again confirmations | move to `records/confirmations/` (D6) | Survive reset by owner decision. |
| 59 | Start-again choices | move to `records/choices/` (D6) | Survive reset by owner decision; holds an administrator's name and email. |
| 60 | Start-again set-aside | move to `records/set-aside/` (D6) | Survives reset by owner decision (A1098). |
| 61 | `first-setup-start-again-guesses.json` | keep (in `flows/setup/`) | Must work when the database is missing; counted before checking (`first-setup-start-again-guesses.ts:112-114`). |
| 62 | `.first-setup-<uuid>.tmp`, `<file>.tmp` | replace with the one durable-write helper | One helper for every file. |
| 63 | `waitron-provision` outputs | keep; make its `modules.json` write durable (or drop with item 9) | Not in the image (`deploy/Dockerfile:203-213`). |
| 64 | fiscal emergency/receipt directories | delete (fiscal, owner signs) | No caller outside its own package (`grep -rln allocation-configuration` → tests only); superseded 2026-10-19; `initial-setup.ts:381-382` still names the variables. |
| 65 | print-agent `config.json` | keep | Another program's settings. |
| 66 | print-agent `token` | keep | Its login. |
| 67 | print-agent `server-ca.crt` | keep | Trust before HTTPS works. |
| 68 | `/dev/usb/lpN` | keep | A device, not a file. |
| 69 | dev print-agent folder | keep | Development only. |
| 70 | Docker named volumes | keep | Where the box lives; `box_socket` is outside the reset list but holds nothing of its own. |
| 71 | Mailpit database | keep; cap it | No message-count limit is set in `deploy/compose.yml:88-91`. |
| 72 | Docker container logs | keep | Bounded by Docker (`compose.yml:97-101`, `:169-173`). |
| 73 | `/opt/waitron/compose.yml`, `.env.example` | keep `compose.yml` (atomic download); delete `.env.example` from the box | `fetch` writes straight onto the file (`deploy/waitron.sh:42`, `:199-204`); the example is documentation. |
| 74 | `/opt/waitron/.env` | keep; **drop `WAITRON_BACKUP_RECOVERY_KEY` from it** | A second home for the backup key (`compose.yml:37`). |
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

---

## 4. How each worry is answered

**Performance.** Files are off the sale path except two: the log and the holder heartbeat.

- Every log line is an `appendFileSync` on the main thread (`log-file.ts:70`), plus a copy to
  standard output (`boot.ts:974`, `:990`). This design does not change it, but it is the one file
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
- **Two homes for the backup key.** `.env` (`compose.yml:37`) and `backup.env`. If they disagree,
  `box-env.ts:28-31` lets the environment win, so a key the owner rotated from the dashboard can be
  silently overridden. One home closes this.
- **Unencrypted copies left after a crash.** Five scratch prefixes are never swept, and `/tmp`
  survives a container restart. One `scratch/` folder, emptied at every start under the venue lock,
  bounds a plain copy's life to one run.
- **What this design deliberately does not touch:** the spare file, the backup-room note, the
  staging turn, the Start-again records and set-aside, and the never-unlinked locks (all CLAUDE.md
  §3).

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
  - It ends the nested-state-folder mode (D2), which today every state rule has to understand
    separately (`first-setup-entry.ts:108-121`).
- `compose.yml` downloads become atomic, so a cut install cannot leave a box that will not start.

---

## 5. Measure or test before building

| # | Test | Result that would change the design |
| --- | --- | --- |
| T1 | On box hardware, time `appendFileSync` per log line, and count the log lines one sale writes. | If logging costs over about 1 ms a sale, add a buffered asynchronous writer (and keep a flush on the failure path the recovery page reads). |
| T2 | Copy a 200 MB database into `/tmp` and into the state volume inside the container, timing both. | If the volume is much slower, keep a box-local scratch on a different mount, but still under one swept root. |
| T3 | Confirm that every first-setup operation runs while its process holds `venue.lock` (setup mode, the repair page, the provisioning command). | If any does not, keep a lock for setup, but make it a SQLite lock like `migrations.lock`, not a create-exclusive file with takeover. |
| T4 | Kill the process between the parallel deletes in `clearStagedRestore` (`restore-request.ts:329-340`), leaving the marker without its artifact, then start. | If the next start refuses or loops, the folder-rename ending is a fix, not just tidying. That raises its priority. |
| T5 | List every reader of the module list that runs before `venue.db` can be opened (`boot.ts:929`, `first-setup-entry.ts:350`, `mirror-bundle.ts:163`) and check whether the core migration set can run first. | If a module's migrations must run before the core set can be read, `modules.json` stays a file (D3 becomes "keep, but make it durable"). |
| T6 | Check that Node's TLS listener accepts key and certificate read from one PEM file. | If not, use a folder swap (write `tls/leaf-new/`, rename over `tls/leaf/`). |
| T7 | `git log -S module-evidence` to establish whether Start again leaving `module-evidence/` (it is not in `first-setup-start-again-deletion.ts:131-148`) is deliberate. | If deliberate, `module-records/<module>.json` keeps two sections with different Start-again treatment; if not, one. |
| T8 | Power-cut test on a box: rotate the vault key, cut power within 1 second, then boot. | If the old key survives intact today, the flush is still right but less urgent; if `secrets.env` comes back empty, it is urgent. |
| T9 | Check whether a selected backup recovery can still be abandoned (phases at `first-setup-backup-workspace.ts:34-35`). | If it can, promotion (D2) must wait until abandonment is no longer possible, and the evidence moves to `records/set-aside/` rather than being deleted. |

---

## 6. Decisions for the owner

- **D1. Delete the join ("adopt") flow until replication lands.**
  - What it would delete: `pending-adoption.json`, `tls/venue-ca.*`, `reset-request.json`, their
    routes and the reset step.
  - Today the flow leaves a box "adoption-pending until a replacement copy mechanism lands"
    (`finish-adoption.ts:41-44`).
  - **Recommend: delete.** The backlog's replication work will design its own join.
- **D2. Promote a selected first-setup backup recovery into the real folders, instead of running
  from `flows/setup/backup-recovery/<id>/target/`.**
  - **Recommend: yes, once T9 shows abandonment is closed.** One layout is what makes every other
    rule here enforceable.
  - It touches recovery, so it is risk-triggered work.
  - A related, larger question: Waitron has three restore paths (the staged restore at next start,
    the first-setup backup recovery, and Cloud recovery). This design gives each one flow folder.
    Merging them into one path is out of scope for files, but recommended as its own item.
- **D3. Move `modules.json` into the `settings` table.**
  - **Recommend: yes, if T5 shows the core set can migrate first.** Otherwise keep it as a file
    with a durable write.
- **D4. Fix the venue folder inside the state folder on a box (stop honouring `WAITRON_VENUE_DIR`
  outside development), and delete `setup-operation.lock`.**
  - With the venue folder fixed, the venue-folder claim and the cross-filesystem set-aside branch
    (`first-setup-start-again-set-aside.ts:101-109`, `:241-250`) can go.
  - The box never sets the variable (`grep -rn WAITRON_VENUE_DIR deploy` → only `waitron.sh`'s own
    fallback, `:562`).
  - **Recommend: yes for the lock (after T3). The claim is a smaller win; do it only if D2 is
    done.**
- **D5. Waitron Cloud files.**
  - Recovery and replacement are preproduction only. **Recommend: keep, grouped in `cloud/`, with
    each flow deleting its record when it ends.**
  - The alternative is to drop all three until Cloud is live.
- **D6. Move the Start-again records into `records/`.**
  - The CLAUDE.md §3 rule ("removed only by `waitron.sh reset --all`") is unchanged, but its guard
    `scripts/start-again-records-writers.test.ts` reads path text, so the guard and the rule's
    pointer change.
  - **Recommend: yes.** It makes the reset keep-list `tls` and `records`.
- **D7. Fold the account key and the backup key into `secrets.env`, and remove
  `WAITRON_BACKUP_RECOVERY_KEY`/`WAITRON_BACKUP_DIR` from `compose.yml`/`.env`.**
  - The backup key would then be set only from the dashboard. This needs agreement with the
    environment-variables part.
  - **Recommend: yes.**
- **D8. Keep only the newest TLS repair archive, deleted after the next healthy start.**
  - Today old certificate-authority keys outlive a plain reset.
  - **Recommend: yes.**
- **D9. Delete the superseded fiscal emergency-register code** (item 64).
  - It is fiscal-package code, so it waits for the owner under the lanes rule.
  - **Recommend: delete.**
