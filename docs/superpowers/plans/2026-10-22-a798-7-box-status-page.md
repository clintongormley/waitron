# A798-B slice 7 — the Box status page and Liberar

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **Nothing fiscal moves.** This slice does not change when anything is filed, and does not touch
> invoices, the record chain or its hashes, series or numbering, or AEAT filing. Reintentar ahora is
> not in it (build plan decision 11; it is slice 7b). The one fiscal read is the Veri\*Factu
> module's existing staff-notice source, asked through slice 6's reader, which fails a source that
> changes a row. If a task finds it needs more, STOP and report.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation. Implementers are dispatched
> as `subagent_type: "implementer"`. The tasks run in their numbered order; every commit leaves the
> root guards green.
>
> **Existing assertions.** This plan changes exactly these existing assertions, declared here so no
> implementer has to decide one. All are in Task 8 and go in one commit of their own whose message
> begins `Changed test checks (A798 slice 7):` and lists each `file:line` with its before and after;
> the pull request names them.
> 1. `apps/dashboard/src/i18n/alerts.test.ts:287-292`, "keeps the disk warning to two sentences
>    while there is no Box status page", is **deleted** and replaced by a case that counts three
>    sentences in each language and can fail in Spanish (Task 8, Step 0), and
>    `apps/dashboard/src/i18n/alerts.test.ts:273-275`'s English sentence **gains** its last
>    sentence. Both pin the behaviour this slice removes — the sentence left out until the page
>    existed (slice 5's plan, decision 4; `docs/backlog.md:5559-5563` says slice 7 deletes the
>    test). This is the build plan's rule for an assertion that pins removed behaviour
>    (`2026-10-21-a798-b-degraded-trading-build.md:9-12`), not the whole-shape exception.
> 2. `apps/server/src/alert-sources.test.ts:158-166`, `:174-182` and `:189-197`, and
>    `apps/server/src/boot.free-space.test.ts:96-104` and `:113-121`: each object **gains**
>    `screen: "box-status"`, every existing value unchanged. The owner's standing exception
>    (2026-09-27): an assertion that pins a whole shape may gain the key a new field adds.
>
> Every other test this plan touches gains cases, mocks or helpers only. Any other assertion that
> turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `39fe307e4` (2026-10-22), this branch's base
> (`feat/a798-7-box-status-page`, worktree `waitron-feat-a798-7-box-status-page`). Every claim about
> how the box behaves today cites a probe in "Measured for this plan", run that day on macOS 26,
> Node v26.11.1, from scratch files under `~/waitron-campaign-b/a798-7-plan-probe/` (scripts in
> `scripts/`, logs beside them) and a throwaway worktree of `39fe307e4` made with
> `git worktree add --detach` and `pnpm install --frozen-lockfile --offline` (`Done in 9.7s`,
> `install.log`), since removed. A claim marked **(read)** comes from reading code, not running it.
> Nothing was measured on Linux.
>
> **Revision 2 (2026-10-22)** folds in the round-1 review
> (`~/waitron-campaign-b/a798-7-plan-review/round1.md`, 0 Critical, 4 Important, 13 Minor) and the
> claim check (`…/a798-7-plan-review/claim-check.md`, 55 true, 2 false, 8 too wide, 1 unverified),
> under the runner's rulings: the staging turn keeps a page refresh out of it and reports a backup
> only while a backup run holds it (I1); the card readers are read only with the payments module on
> (I2, F1); the Clock row says nothing about internet time when the box cannot tell (I3, F2); the
> replacement disk-warning test can fail in Spanish (I4); Task 14 runs where its disk has room (F3);
> every Minor, too-wide and unverified finding is applied in place.
>
> **Revision 3 (2026-10-22)** folds in the round-3 check (`…/a798-7-plan-review/round3.md`, 0
> Critical, 2 Important, 12 Minor), with its experiments under `…/a798-7-plan-review/round3/exp/`:
> the CLAUDE.md rule names the start's clean-up as its exception (I1); the separator proof now
> mutates the one path builder both `lstat` and `rm` use (I2); a deletion asked while a backup run
> holds or waits for the staging turn is skipped, never queued (m1); a survey counts a vanished file
> as gone (m2); Task 2 is split into 2a and 2b (m11); every other Minor is applied in place.

**Words used in this plan.**
- The **page** is the new dashboard screen "Box status" / "Estado del equipo" (screen id
  `box-status`), one row per part of the box (design §4.3, picture 4).
- **Liberar** is the page's "Free {size}" / "Liberar {size}" button: it deletes only files the box can
  make again (design §4.6 item 6).
- **Leftovers** are the files Liberar may delete: crash reports older than a week, rotated logs but
  the newest, and what a backup run that was cut off left in backup staging (decision 6).
- The **stop** is slice 3's full-disk stop (`DiskFullState`, `apps/server/src/disk-full-state.ts:6-22`);
  the **warning** is slice 5's low-space warning (`FreeSpaceState`, `free-space-watch.ts:19-23`).
- **Staff notices** are slice 4–6's notices (`OwnedStaffNotice`), the ones a till's strip shows; the
  page reads the same sources through the same reader (decision 1).
- The **bell's alerts** are `GET /management-api/alerts`, already watched by the dashboard.
- A **turn** is one `db.withWriteLock(...)` with no change-log drain, as the equipment read uses
  (`apps/server/src/device-api.ts:398-403`).
- The **staging turn** is a new in-process lock over backup staging. Every backup run holds it while
  it uses backup staging; a Liberar deletion takes it, and skips staging when a backup run holds it
  or waits for it. A page refresh never takes it (decision 7).

**Goal:** a manager with `system.manage` opens Settings ("Ajustes") → Box status and sees, in one place, whether
each part of the box is well — sales, the tax agency, the bucket copy, printers, card readers, the
clock and the disk — with the action that fixes each, and can free the disk space the box can make
again, seeing how much before pressing. The page and Liberar keep working on a full disk.

**Architecture:** five pieces.
1. **Server, Liberar's rules** (`apps/server/src/free-space-now.ts`): `surveyLeftovers` sums what may
   be deleted; `deleteLeftovers` deletes exactly that set; `createSpaceFreer` runs one deletion at a
   time, then takes a fresh free-space reading and lets the stop lift. A deletion touches backup
   staging only inside the staging turn (`apps/server/src/backup-staging-turn.ts`), which the backup
   sweep holds around every run; the survey only measures, without the turn.
2. **Server, the read** (`apps/server/src/box-health.ts`, `disk-usage.ts`): one answer with the last
   sale, the staff notices, whether the box files, the bucket copy, the clock, the printers, the card
   readers when the payments module is on, whether Liberar can be pressed on this node, and the disk
   (free, total, what fills it, what Liberar can free, the stop and the warning).
3. **Server, the routes** (`apps/server/src/box-health-api.ts`): `GET /api/box/health` and
   `POST /api/box/free-space`, both `system.manage`, both answering on a full disk (decision 3).
4. **Dashboard**: the page (`apps/dashboard/src/screens/box-status-screen.ts`), its rows worked out by
   a pure function (`box-status-rows.ts`) from the read and the bell's alerts, the sidebar item in
   Settings ("Ajustes") before Diagnostics, and the two disk alerts pointing at the page.
5. **Guides**: a new `box-status` guide in English and Spanish; the till-notices guide points managers
   at it.

**Tech stack:** TypeScript, Hono, `node:sqlite` behind drizzle, Lit, Vitest 4.1.11 (Node for
`apps/server` and `packages/dashboard-kit`; real headless Chromium for `apps/dashboard`).

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §4.1 (the dashboard is a running box's operator place), §4.3 (the Box status page,
`:494-507`), §4.4 (each part's row), §4.6 item 6 (Liberar, `:594-606`), §5, §6 default 15, §7 (no
new table), §8 item 7, §11 item 5 (the plaintext dump a cut-off backup leaves). Picture:
`docs/backlog/mockups/a798-degraded-trading/4-box-status-page.png`. Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1,
row 7 (auth; FULL; no migration; lands itself; depends on 4 and 5, both landed) and decision 11
(Reintentar ahora is 7b). Backlog: A798-B (`docs/backlog.md:5539-5557`), "The disk warning does not
point at the Box status page yet" (`:5559-5563`), "The Box status page's rows from a module are not
in the staff-notice seat" (`:5570-5573`, detail `docs/backlog/box.md:733-739`), "A failed
staff-notice check is seen only in the log" (`:5588-5590`).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-7-plan-probe/`. The Vitest probe ran in the
throwaway worktree's `apps/server` with
`env -u AI_AGENT -u CLAUDECODE ../../node_modules/.bin/vitest run src/zz-box-full.e2e.test.ts --silent=false`,
on the small HFS+ image `apps/server/src/testing/full-disk.ts` makes (`openSmallDisk`), the venue
migrated with every manifest set and provisioned with `provisionBillVenue`, the session the bill
venue's admin's.

- **M1 — what `GET /api/box/status` answers on a full disk** (`scripts/zz-box-full.e2e.test.ts`,
  `p1-box-full.log`). Mounted with `mountBoxStatusApi` and boot's passive middleware
  (`apps/server/src/boot.ts:987-991`). With room: `200` passive and not. Full, nothing waiting in
  `change_log`: passive `200`; **not passive `507 {"error":{"code":"storage.disk_full"}}`** — the
  session's last-seen write (`packages/identity/src/management-session.ts:87-93`). Full, one row
  waiting in `change_log`: **passive `507 storage.disk_full`** — the drain at the end of
  `withTransaction` (`packages/db/src/tenancy.ts:30-42`). Failing case for "the existing read
  already answers on a full disk": `200` on the last line. It printed `507`. So the page's first
  read, which is not passive (decision 15), and any read while a change waits, fail today.
- **M2 — a manager's session can be checked without a write on a full disk with a change waiting**
  (same probe and log). `authorizeManager(db, { …, permission: "system.manage", touch: false })`
  outside any transaction: `ok`. The same inside `db.withWriteLock(...)`: `ok`. Control, the same
  inside `withTransaction`: `refused storage.disk_full`. Failing case for decision 3's fallback:
  `refused` on either of the first two. Both printed `ok`; the control shows the disk was full.
- **M3 — deleting a file on a full disk works and gives its space back; a file held open does not
  give it back until it is closed** (same probe and log). A 1 MiB file written with room, then the
  disk filled: free `0` before `rm`, `1048576` after. A second 1 MiB file opened for reading, then
  unlinked: free `0` after unlink, `1048576` only after `close`. Failing cases: free unchanged after
  `rm`; free up before `close`. So deleting a staged dump while a backup run reads it frees nothing
  until the run closes it — and the run deletes it itself (`apps/server/src/backup-sweep.ts:218-221`)
  — which is why decision 7 skips staging while a run holds it.
- **M4 — `rm` does not follow a symbolic link** (`scripts/p4-symlink-rm.mjs`,
  `p4-symlink-rm.log`, `node p4-symlink-rm.mjs`, `node:fs/promises`). In a folder named
  `backup-staging`: a link named `backup-encrypt-link` to a folder holding `venue.db`, removed with
  `rm(path, { recursive: true })`, and a link named like a staged dump to that `venue.db`, removed
  with `rm(path)`: both links gone, `target dir files [ 'venue.db' ] target file exists true`. A real
  `backup-encrypt-*` folder holding a link to that folder, removed recursively: the target still
  held `venue.db`. `lstat` of the folder link: `isSymbolicLink true`, `size 71` (the link's own),
  where `stat` follows it. Failing case: the target emptied. Decision 6 still skips links, so no
  link's size is ever counted as freed. **The claim check found one trap** (`claim-check/m4.log`):
  `rm(join(staging, "backup-encrypt-slash") + "/", { recursive: true })`, a link to a folder with a
  trailing separator, deleted the link's TARGET (`venue after trailing-slash rm ENOENT`). `join` never
  adds a trailing separator. What protects a target is the link check, an `lstat` of the entry's own
  path; a trailing separator is dangerous because it defeats that check (`lstat("link/")` describes
  the target). The round-3 check's `sep-probe.log` measured it: with the separator before `rm` alone
  the target survived (the link check had already skipped the entry); with it in the shared path both
  `lstat` and `rm` read, `venue.db survives: false`. Task 2a's Step 3 makes one path builder serve
  both, and Task 2b case 7 and its proof by deletion pin it. The claim check's line about a real
  folder holding a link ran after its trailing-slash step had already removed `venue/`, so it
  measured nothing; this plan's own `p4-symlink-rm.log` and the round-3 check's
  `real-folder-link.log` (with a control that is deleted) are the receipts for that sentence.
- **M5 — who writes backup staging, and when (read).** `runOnce` is called only by `tick`
  (`apps/server/src/backup-sweep.ts:303-310`; `grep -rn "runOnce(" apps/server/src` outside tests
  finds that one call), and `tick` only by `runBackupSweep` (`:265-301`), which only the backup
  supervisor starts (`backup-supervisor.ts:241-249`). `grep -rn "BACKUP_STAGING_DIR\|stagingDir"`
  over `apps` and `packages`, outside tests, finds no other product writer of
  `<state>/backup-staging` (the restore uses `RESTORE_STAGING_DIR`; `apps/server/scripts/cloud-backup-fixture.ts`
  is a development script). A start deletes the staging leftovers unless another process holds the
  venue folder (`apps/server/src/start-space.ts:52-110`, A978), so on a running box the ways a
  leftover can be there that this reading found are: a run in this process whose own clean-up
  failed; a start that found the venue folder held by another process; and a first-setup
  workspace's state folder (`docs/backlog/box.md`, "A box whose first setup was retired into a new
  workspace keeps that workspace's backup staging…"). Not run.
- **M6 — the sale time's spelling (read).** The three callers of `insertSale` — `recordSale`
  (`packages/core/src/record-sale.ts:305`, writing `issuedAt` at `:313`), `record-correction.ts:264`
  (`:271`) and `record-substitution.ts:189` (`:196`) — all write `now.instant.toISOString()`, one
  spelling, so ordering the column as text orders by time (CLAUDE.md §3, "A time stored as text…").
  So "last sale" is the latest sale, correction or substitution (decision 13b).
- **M7 — where the size writer stops saying "0 MB"** (`scripts/p5-mb-rounding.mjs`,
  `p5-mb-rounding.log`, `node p5-mb-rounding.mjs`): the megabyte branch of `formatBytes`
  (`Intl.NumberFormat` `megabyte`, no decimals) printed `"0 MB"` for 1 and 499,999 bytes and `"1 MB"`
  for 500,000, 999,999 and 1,000,000, in `en-GB` and `es-ES`. Failing case for decision 8's threshold:
  `"1 MB"` at 499,999. Node's `Intl`, not Chromium's; slice 5's P1 found the two printing the same `"950 MB"` for
  this format.
- **M8 — the box image has no `timedatectl`** (the round-1 review's `r1/timedatectl-image.log` and
  the claim check's `claim-check/timedatectl.log`, both on `ghcr.io/clintongormley/waitron:main`,
  revision `39fe307e4511817aff3615508cad9405eba616b6`, amd64 under emulation on an arm64 Mac):
  `command -v timedatectl` printed nothing (`exit=127`, "no timedatectl"); the control,
  `command -v node`, printed `/usr/local/bin/node`. The runtime stage is `node:26-slim`
  (`deploy/Dockerfile:161`) **(read)**, and `grep -rn timedatectl deploy/` finds no host mount. So
  `checkTimeHealth` answers `source: "unavailable"` on every box built from this commit
  (`apps/server/src/time-health.ts:34-43`).
- **M9 — a venue without the payments module has no `card_readers` table** (the claim check's
  `claim-check/scripts/zz-claim-payments.test.ts`, `payments-off.log`): with the payments set left
  out of the migrated sets, `select … from card_readers` threw `no such table: card_readers` while
  `printers` and `sales` answered. `payments` is `tier: "toggleable"`
  (`packages/composition/src/modules.ts:236-251`), and trading mode migrates only the enabled sets
  (`apps/server/src/boot.ts:926-927`) **(read)**.
- **M10 — room on the full-disk test file's small disk** (the claim check's `t14-room.log`,
  `m1-m3.clean.log`, macOS 32m HFS+ image): `32,755,712` bytes free on the empty image;
  `18,116,608` free after the file's existing 11 cases, which keep their folders
  (`apps/server/src/start-full-disk.e2e.test.ts:54-60`, `needDisk` at `:63-69`, one disk for the whole file); a migrated,
  provisioned, checkpointed venue folder took `3,576,456` bytes.
- **M11 — a staging turn shared by surveys keeps a press out** (the round-1 review's
  `r1/turn-contention.mjs`, `r1/turn-contention.log`): a turn written to revision 1's interface, a
  survey's `ifFree` holding it, then a press's `ifFree`: `press : {"ran":false}`; control, the press
  alone: `{"ran":true,…}`. Revision 2's turn (Task 1) has no survey holder.

---

## Departures from the design and from picture 4

1. **The page reads a new route, not `GET /api/box/status`.** Design §4.3: "It reads the existing
   `GET /api/box/status` plus the printer, reader and disk checks". That route fails on a full disk
   in the two ways M1 measured, and every call lists each backup destination remotely
   (`collectBoxStatus` → `readBackup` → `BackupSupervisor.status()` → `#readDestination` per
   destination, `apps/server/src/box-status.ts:68-72`, `backup-supervisor.ts:304-346`) **(read)** —
   a cost the page would pay every 15 s. `GET /api/box/health` reads memory, a few rows, the staff
   notices, a `statfs` and the leftovers' listing on every call; the venue, log and local backup
   folder walks and the `timedatectl` call it caches for 60 s (decision 22). `/api/box/status` is not
   edited.
2. **"Rojo" says "something can't be saved", not "nothing can be saved".** Picture 4's legend reads
   "rojo: no se puede guardar nada". The page also draws red for a clock before 28-10-2024, which
   refuses sales while orders still save (`clock.unusable`, slice 3). The legend reads "red: something
   can't be saved" / "rojo: algo no se puede guardar"; the full-disk lines keep the design's words.
3. **Hacienda: no "Reintentar ahora", no "Último aceptado", and no "los envíos fallan desde" of its
   own.** Reintentar ahora is 7b (build plan decision 11). The last accepted record's time is the
   module's to read; it comes with 7b's module row (decision 1). A failing send shows as the unsent
   count ("12 registros sin enviar · el equipo reintenta solo"), and how long sends have failed only
   as a submission alert's own sentence when the bell has one (`fiscal.submission_delayed` from 4 h,
   `packages/fiscal-verifactu/src/submission-alerts.ts:12-13`).
4. **The card readers row does not say a reader is online, and a battery warning turns it amber.**
   Picture 4: "Lector 1 y Lector 2 en línea", green, with "Batería Lector 2: 34 %" as a detail.
   Nothing surfaces a reader's connection today (the battery check gets an offline answer and ignores
   it, design §2.4); `reader.offline` is slice 10 (design §8 item 10). The row names the readers set
   up; a bell reader alert (`reader.battery_low`, `reader.status_unavailable`) makes it amber with the
   alert's sentence, as decision 4 does for every row. With the payments module off, the row is left
   out (decision 13).
5. **The printers row names every printer set up, not the ones printing.** Picture 4: "Barra y
   Facturas imprimen". The page knows a printer's trouble only from the bell's printing alerts; it
   cannot say a printer prints. Its detail is the names of the active printers.
6. **The disk line says "rest of the disk", not "fuera de Waitron".** The remainder counts the state
   folder's other files (keys, settings, cloud snapshots) as well as whatever is not Waitron's
   (decision 12).
7. **Times carry their date.** Picture 4 shows "Última venta 21:43". The page writes every time with
   `formatIsoMinute` ("2026-10-22 21:43", `packages/dashboard-kit/src/date-format.ts:5-9`), so a
   last sale from yesterday does not read as today's.
8. **The Reloj row has no dialog and no restart** (slice 9's, design §8 item 9), and it says nothing
   about internet time on a box that cannot tell (decision 14; M8).

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **The Hacienda row reads the staff notices; slice 7 adds no seat to the module contract.** The
   backlog leaves slice 7 to decide whether the row is "an optional member of `StaffNoticeSource` or
   a seat of its own" and "whether the page reads the staff notices at all"
   (`docs/backlog/box.md:733-739`). DEFAULT: the page reads the staff notices — the same sources
   (`deviceNoticeSources`, `apps/server/src/box-staff-notices.ts:41-49`), through the same reader
   (`readStaffNoticesInTurns`, `apps/server/src/staff-notices.ts:52-70`), with the same `filing`
   fact (`device-api.ts:404-418`, `boot.ts:1835`) — and the bell's `fiscal` alerts. The Hacienda row
   shows the unsent count (`fiscal.records_unsent`, `packages/fiscal-verifactu/src/staff-notices.ts:22-50`)
   and the submission alerts. Why: everything the row can show without Reintentar ahora is already
   there, and a new seat is a cross-package contract this slice would add only to carry one time. 7b
   adds the module's own row (the last accepted record, Reintentar ahora) when it adds the module's
   route; Task 17 moves the backlog entry to 7b.
2. **A new read, `GET /api/box/health`** (Departure 1). It answers `BoxHealth` (Task 4). `/api/box/status`
   stays as it is.
3. **Both routes check the session in the usual transaction and, only when that is refused
   `storage.disk_full`, once more outside any transaction without touching the session.** M1 and M2.
   The same shape slice 6 gave `requireSession` (`apps/server/src/till-session.ts:128-134`). Every
   other error is thrown as before; the fallback runs the same lookup, status and permission checks
   (`resolveManagementSession`, `management-session.ts:47-93`), so an ended, expired or suspended
   session and a person without `system.manage` are refused on a full disk too (Task 6 cases).
   A passive read never touches the session anyway (boot's middleware, `boot.ts:987-991`).
4. **A row's colour comes from the staff notices and the bell's alerts; its words from the read.**
   Red ("stopped") for a staff notice of severity `error` (`storage.disk_full`, `clock.unusable`);
   amber ("attention") for any other notice and for any bell alert on that row, whatever the
   alert's own severity (design §4.3: amber is "needs attention, everything still works", and a
   printer's `printer.jobs_waiting` is an `error` in the bell, `alert-sources.ts:434-442`, while sales go
   on); green otherwise. Which row an alert belongs to is a fixed table in the dashboard
   (`partOfAlert`, Task 10): area `printing` → Printers; `card_reader` → Card readers; a code starting
   `backup.stream_` → Bucket copy; `fiscal.clock_drift` or any `clock.*` code → Clock; any other
   `fiscal` alert → Hacienda; area `box` → Disk. Every other alert is counted on one line under the
   rows, "{n} other alerts", with the bell's "See all alerts" (decision 19). Why the bell's alerts
   and not new checks: the page and the bell then never disagree, and the page reuses their words
   (`alertMessage`) and their Go-to.
5. **Notices map to rows by code** (`partsOfNotice`, Task 10): `storage.disk_full` → Sales and Disk;
   `storage.space_low` → Disk; `clock.unusable` → Sales and Clock; `fiscal.records_unsent` →
   Hacienda. A code the table does not name is counted on decision 19's line. On the Sales row the
   disk's red shows before the clock's (design §4.2, "Two reds at once").
6. **Liberar deletes exactly the start's forced clean-up set, minus symbolic links.** The set the
   start deletes on a full disk (`freeSpaceAtStart` with `force`, `apps/server/src/start-space.ts:106-144`),
   read through the same name rules, which Task 2a exports unchanged (`ROTATED_LOG`, `CRASH_REPORT`,
   `STAGED_DUMP`, `start-space.ts:14-18`):
   - in `<stateDir>/backup-staging`: a regular file whose name matches `STAGED_DUMP` (a staged
     dump, `waitron-<stamp>.dump`, or its `.partial`), and a real folder whose name starts
     `backup-encrypt-` (`BACKUP_ENCRYPT_DIR_PREFIX`, `backup-keys.ts:16`), removed recursively —
     only inside the staging turn (decision 7);
   - in `<logDir>`: a regular file `waitron.log.<n>` with `n ≥ 2`, so the current log and the newest
     rotated one stay (design: "rotated log files except the newest");
   - in `<logDir>/crash-reports`: a regular file `holder-frozen-*.json` last modified more than
     `CRASH_REPORT_KEEP_MS` (7 days, `start-space.ts:11`) ago.
   Order: staging first (design: "Liberar deletes that dump first"), then logs, highest number
   first, then crash reports, oldest first. A folder that is a symbolic link is skipped, as the start
   skips it (`start-space.ts:156-176`); **an entry that is a symbolic link is skipped too**, which
   the start does not do — M4 shows `rm` would remove only the link, but a link's "size" is its own,
   so counting it would claim space that is not freed. Every path is built with `join`, never with a
   trailing separator, and the path `lstat` judges is the path `rm` removes (M4's trap). Nothing
   outside those three folders is ever
   listed; `venue.db`, its `-wal` and `-shm`, `node.db`, `venue.lock`, `recovery.lock`,
   `recovery.json`, Litestream's `.venue.db-litestream/` and `<state>/stream/`, the restore's staging,
   cloud snapshots, keys and settings match no rule and sit in no folder Liberar lists (Task 2b's
   refusing cases). `config.logDir` and `config.stateDir` are the ones the running server uses
   (`apps/server/src/config.ts:528-532`). A deletion that fails is logged and counted, never thrown;
   one already gone (`ENOENT`) counts as neither deleted nor failed. Not covered: a `local-fs`
   backup destination configured INSIDE `backup-staging` under a `backup-encrypt-*` name would be
   deleted, as the start already deletes it today (`start-space.ts:79-80`; the destination folder is
   free text, `backup-config.ts:149-152, 175-176`) **(read)**; the claim check judged it exotic, and
   so does this plan. Changed at finish review, 2026-10-22: Free now skips a configured `local-fs`
   destination folder and any folder holding one; every start's clean-up still deletes it (backlog,
   `docs/backlog/box.md`). A destination folder that is the log folder or `backup-staging` itself keeps its
   archives (`waitron-<stamp>-<uuid>.backup.enc`, `backup-keys.ts:25-26`, match no rule; Task 2b
   case 14).
7. **Backup staging is touched only while no backup run is under way in this process.** A new
   in-process staging turn with two kinds of holder (Task 1):
   - **a backup run** holds it from its first step to the end of its own clean-up (`tick` wraps
     `runOnce`, `backup-sweep.ts:303-310`), after any Liberar deletion that holds it;
   - **a Liberar deletion** takes it at once unless a backup run holds it or waits for it, and then
     skips staging and says `backupRunning: true` (a run is under way or about to start); it never
     waits for a run. A run that starts while a deletion holds
     the turn waits for it (a deletion of at most a few files). A run that was told to stop while it
     waited does nothing once it gets the turn (Task 1 case 7; the round-1 review's M5).
   - **A page refresh never takes it.** The survey measures staging without the turn — a best-effort
     size, since a run may be writing there — and reports `backupRunning: true` only while a backup
     run holds the turn, in which case it leaves staging out of the figure, as a press would. So a
     refresh, another tab or another manager can never keep a press out of staging (M11), and
     "a backup is running" is shown only while one is.
   Why the turn: M3 — deleting a dump a run reads frees nothing until the run closes it, and could
   make the run fail; and M5 — no other product code writes backup staging, and a start cleans it
   unless another process holds the venue folder (A978). The venue lock (CLAUDE.md §3, "One process
   owns a venue folder at a time") is not taken: Liberar changes no file in the venue folder, and this
   process already holds it. Task 15 records the turn as a CLAUDE.md §3 rule with its guard.
8. **The figure comes before the press, and there is no confirmation dialog.** `GET /api/box/health`
   carries `disk.reclaimable.bytes`, summed by the same rules with `lstat` sizes (a folder: the sum
   of the regular files under it, links not followed); the button reads "Free 45 MB" /
   "Liberar 45 MB" (design: "The button shows the figure before it runs"). It is enabled from
   500,000 bytes of leftovers, the least the shared size writer (`formatBytes`,
   `packages/dashboard-kit/src/alert-messages.ts:55-70`) writes as "1 MB" rather than "0 MB" (M7);
   below that it is quiet, disabled, and reads "Nothing to free" / "Nada que liberar", so it never
   offers to free "0 MB". Nothing it deletes is something
   the box cannot make again, so a second step adds a press and protects nothing. The press deletes
   what matches at that moment, which may differ a little from the figure; the answer says what was
   freed.
9. **After deleting, the box takes a fresh free-space reading and lets the stop lift at once.**
   `space.record(await freeBytes(venueDir), now())` (`free-space-watch.ts:19-23`), then, only while
   the stop is noted, `disk.full()` — the same call the minute watch makes (slice 5 decision 2), so
   a stop lifts as soon as 16 MiB is free instead of up to a minute later. `disk-full-state.ts` and
   `free-space-watch.ts` are not edited.
10. **Two presses at once share one deletion.** `createSpaceFreer` keeps the deletion under way; a
    second call while it runs answers the same result. No new error code.
11. **On a mirror or a fenced node Liberar is drawn quiet and disabled, with the reason.** The
    read-only gate refuses every `POST` there (`boot.ts:1522-1538`; safe methods only,
    `apps/server/src/read-only-gate.ts:28-39`) **(read)**, and is not changed. `BoxHealth.canFree` is
    `false` under the gate's own condition (`holders.mode.current === "mirror" || fenced`, read per
    request as the gate does); the button is then `secondary` and disabled, with "This box only
    keeps a read-only copy, so it can't free space here." / "Este equipo solo guarda una copia de
    lectura, así que aquí no puede liberar espacio." (the button rule's A427 case: a row's own state
    rules the action out, `design-system.md:2712-2714`).
12. **What fills the disk** (design: "the database, backups kept on this box, and … the rest of the
    disk"): `databaseBytes` is the venue folder's files; `backupsBytes` the folders of the
    `local-fs` backup destinations (`BackupSupervisor.current().destinations`, `backup-supervisor.ts:40-58`);
    `logBytes` the log folder; `otherBytes` the disk's used space (`(blocks − bfree) × frsize`) less
    those three, never below 0. A folder is counted only when it is on the venue folder's device
    (`stat().dev`), and a folder inside one already counted is not counted again; links are not
    followed. `freeBytes` is `bavail × frsize` as everywhere else (`free-bytes.ts:6-15`), `totalBytes`
    is `blocks × frsize`. Any part the box cannot read is `null` and left out of the line.
13. **Printers and card readers rows list what is set up; their problems come from the bell.**
    Active, undeleted printers (`printers`, `packages/db/src/schema/printers.ts:36-84`); active,
    undeleted card readers, the demo reader left out as the battery source does
    (`cardReaders`, `DEMO_READER_ID`, `alert-sources.ts:780-791`). **The card readers are read only when the payments module
    is enabled** — boot's own test for it, `setsToMigrate.some((module) => module.name === "payments")`
    (`boot.ts:1649`) — because without it the table does not exist (M9). With it off, `readers` is
    `null` and the row is left out: the design's rows describe the parts a box has, and a box with card
    payments off has no card reader. No provider is called by the page's read.
    13b. **"Last sale" is the latest sale, correction or substitution** (M6): each is a recorded
    invoice, so the time says when the box last recorded one. Not filtered.
14. **The Clock row** shows the AEAT comparison the box already keeps (`createAuthorityClockStatus`,
    `apps/server/src/time-health.ts:48-100`). It says whether the system keeps time over the internet
    only when `checkTimeHealth` (`:34-43`, a 2-second `timedatectl` call) answers
    `source: "timedatectl"`. With `source: "unavailable"` — on every box built from this commit, whose
    image has no `timedatectl` (M8) — the row says nothing about internet time. Red only for
    `clock.unusable`; amber for `fiscal.clock_drift`.
15. **The page refreshes every 15 seconds, passively after its first read** (the shared query
    controller's `dashboardQuery`, `apps/dashboard/src/api/live-queries.ts:569-591`: first read on
    `api`, later ones on `api.background`, whose GETs are passive). 15 s is the till's equipment-read
    cadence (design §4.2). The bell's alerts are the shared `listAlerts` query (60 s, the default in
    `live-queries.ts:584-591`), shared by key with the bell (`packages/dashboard-kit/src/live-data.ts:67-109`),
    so the page adds no alert request while the bell is open. **After a press** the page calls
    `api.liveData.refresh()` (`live-data.ts:111-116`), which marks every query the open dashboard
    holds as due and reads each once — this page's two and the shell's bell — because `getBoxHealth`
    has no dependency a change event could reach and `invalidate` matches only dependencies
    (`:131-148`). The bell's `storage.disk_full` comes from `storageAlertSource`, which reads the stop
    live (`alert-sources.ts:310-342`), so after a press that lifts the stop the alert is gone at that
    read; on a dashboard where nobody pressed, the bell catches up at its next 60 s poll. No push is
    built.
16. **Where it sits.** Sidebar group Settings ("Ajustes", `nav.group.configuration`,
    `apps/dashboard/src/i18n/strings.ts:957`, `:4107`), after "Device profiles" and before
    "Diagnostics" (picture 4), `requiresPermission: "system.manage"` (design §4.3: "for people with
    `system.manage`"), screen id `box-status`, tag `dashboard-box-status-screen`, labels "Box status" /
    "Estado del equipo" (`nav.box_status`, which the bell's `goToLabel` already finds,
    `apps/dashboard/src/widgets/alert-format.ts:70-81`). The page holds no staged input: no draft
    scope and no `*.unsaved.test.ts`.
17. **The two disk alerts point at the page.** `storage.space_low` and `storage.disk_full` gain
    `screen: "box-status"` (the bell's Go to), and `storage.space_low` gets back the sentence slice 5
    left out, word for word from design §4.3: "See what is using it on the Box status page." / "Mira qué
    ocupa espacio en Estado del equipo." (slice 5 plan, decision 4).
18. **A notice check that failed is said on the page.** `noticesUnavailable` (slice 6) is shown under
    the rows: "Some checks could not be made, so this page may not show every problem." / "Algunas
    comprobaciones no se han podido hacer, así que esta página puede no mostrar todos los
    problemas." The backlog entry asking for a bell alert stays open, narrowed (Task 17).
19. **One line for everything else**: "{n} other alerts" / "{n} avisos más" and the bell's "See all
    alerts" (`alerts.see_all`), which opens the Alerts screen; drawn only when `n > 0`, counting the
    bell alerts and notices no row takes.
20. **No new error code.** The routes throw only codes already registered (`management_session.*`,
    `person.suspended`, `authorization.not_permitted`, `storage.disk_full`); every deletion failure is
    a log line. Log events are names, never on the wire: `storage.space_freed` (info,
    `{ freedBytes, deleted, failed, backupRunning, personId }`), `storage.free_space_failed`
    (warn, `{ errno }`), once per failed item, and `storage.free_space_skipped` (warn, `{ folder }`),
    once per folder that is a symbolic link, per deletion (a survey logs nothing).
21. **Lands itself**, as the build plan's row 7 says, with one correction to the row (below).
22. **The slow parts of the read are cached for 60 s; the figure is not.** The `timedatectl` call
    and the disk usage walk (venue, log and local backup folders) go through
    `createTtlCache({ ttlMs: 60_000, now })` (`apps/server/src/ttl-cache.ts:10`), as boot already
    caches the backup status (`boot.ts:2141-2145`), so several open tabs polling every 15 s start at
    most one `timedatectl` and one walk a minute. The free space (`statfs`) and the leftovers' figure
    are read on every call, so the button's figure is current. The round-1 review's M11. **A press
    starts a fresh walk:** the usage cache's key carries a generation number that `createSpaceFreer`
    bumps after each deletion (its `onFreed` callback), so the first read after a press walks again
    and the disk line no longer counts what was deleted (the round-3 check's m6). `createTtlCache`
    has no delete (`ttl-cache.ts:10-25`), so each press leaves one small finished entry under its old
    key in the cache's map.

**The build plan's row 7, corrected.** Its risk triggers say "auth (`system.manage`)". This slice
also touches **concurrency**: the staging turn is shared by the backup sweep and Liberar, and Liberar
deletes rotated logs that the in-process log sink renames (`apps/server/src/log-file.ts:42-53`). The
path stays FULL. It adds no cross-package contract (decision 1), and no fiscal invariant moves.

## Behaviour this slice changes

1. A new page, Settings ("Ajustes") → Box status, for `system.manage`.
2. Two new routes: `GET /api/box/health` and `POST /api/box/free-space`.
3. The bell's two disk alerts gain a Go to button to the page, and the low-space sentence its last
   sentence.
4. A backup run waits for Liberar if Liberar is deleting leftovers when the run starts, and does
   nothing if its sweep was stopped while it waited; a run that holds the staging turn keeps Liberar
   out of staging.
5. A stop can lift the moment Liberar frees 16 MiB, rather than at the next till write or minute
   watch reading.
6. New log lines `storage.space_freed`, `storage.free_space_failed` and `storage.free_space_skipped`.
7. Removed: the two-sentence `storage.space_low` (declared assertion change 1).

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths; never `git add -A`.
- **No migration.** No change to `packages/fiscal-verifactu`, `packages/fiscal`, `packages/core`,
  `packages/module`, `packages/composition`, invoice series or numbering, or filing. If a task finds
  it needs one, STOP and report.
- **Not edited:** `apps/server/src/box-status.ts`, `disk-full-state.ts`, `free-space-watch.ts`,
  `staff-notices.ts`, `box-staff-notices.ts`, `device-api.ts`, `alerts.ts`, `till-session.ts`, and
  `start-space.ts` beyond Task 2a's `export` keywords (its tests pass unedited). `backup-sweep.ts` and
  `backup-supervisor.ts` change only as Task 1 says.
- **Module seams:** no file under `apps/server/src` imports `@waitron/fiscal-verifactu`
  (`scripts/module-seams.test.ts`); the read reaches the module only through `deviceNoticeSources`.
- **Transactions:** the read's own database reads are in one turn (`db.withWriteLock`, no drain),
  awaited in turn, never `Promise.all` (CLAUDE.md §3); the staff notices in turns of their own through
  `readStaffNoticesInTurns`. This is the stated exception to one `withTransaction` per route that the
  equipment read already makes (CLAUDE.md §3, "A housekeeping write on a read path…"). Neither
  route writes a row, except the session's last-seen time on a non-passive call that has room and
  the change-log drain at the end of the first session check's `withTransaction`
  (`packages/db/src/tenancy.ts:35-38`), which delivers changes others left waiting.
- **Auth:** both routes `system.manage`; each gains a refusing case for no session, an expired
  session, a suspended person and a person without the permission (a supervisor), with room and on
  a full disk (Task 6).
- **Files:** Liberar deletes only decision 6's set. Its tests make every other file named there and
  check it survives.
- **UI:** every colour, spacing, radius and font reads a declared `--wt-*` token
  (`--wt-color-success`, `--wt-color-warning`, `--wt-color-danger` for the dots, already used across
  `packages/ui`); no brand-colour text; no native `<select>`, `<textarea>` or text `<input>`;
  buttons are `wt-button`; the help tooltip carries `mode="help-mode"`. Liberar follows the button rule
  (`docs/developers/design-system.md:2700-2735`): drawn `secondary` and disabled while the read has not
  loaded, while there is under 500,000 bytes to free (decision 8), and while `canFree` is false
  (decision 11); `primary` once it can act, keeping `primary` while its own press is being sent.
- **Words:** general code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/i18n/alert-messages.ts`,
  `apps/server/src/guide/es/` and the guide title file `apps/server/src/i18n/box-status-guide.ts`. A
  dashboard test of Spanish text reads its expected text from `strings.ts`.
- **Tests:** database tests use `useVenueDb` (CLAUDE.md §4), except the real-disk cases, which go in
  `apps/server/src/start-full-disk.e2e.test.ts` beside its own disk handling; CI runs that file on a
  tmpfs (`.github/workflows/ci.yml:1041-1066`). A write before the fill does `unfill()`, the write, a
  WAL checkpoint, `fill(0)`, as M1's probe does. File tests use a `mkdtemp` folder per case.
- Coverage stays at 98/98/98/95 in `apps/server`, `apps/dashboard` and `packages/dashboard-kit`. No
  exclude, no ignore comment.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`; root guards
  `pnpm exec vitest run scripts/<guard>.test.ts`. Read the `Tests` count every time; a run with no
  count proved nothing. Vitest hides a passing test's console output under this agent; unset
  `AI_AGENT` and `CLAUDECODE` to see it. Every task runs `pnpm exec prettier --check` on the files it
  touched (for a file under `docs/`, `pnpm exec prettier --file-info <file>` prints
  `"ignored": true` instead). CI runs the package suites and coverage.
- `apps/dashboard` runs in real headless Chromium; check `memory_pressure | grep free` before its
  runs and run beside another session's browser run only when free memory is well above 15%. A
  dialog-close wait, a push check and a click follow CLAUDE.md §4's browser rules.

## Review focus

1. **What Liberar can delete (decision 6).** Only the three folders, only the three name rules, no
   link, nothing younger than a week among crash reports, never `waitron.log` or `waitron.log.1`.
   Task 2b's refusing cases put every file decision 6 names as untouchable where a careless rule would
   reach it — including in the log folder when the log folder IS the venue folder or the state folder,
   behind a folder that is itself a link, and a configured backup's archives in the log folder or in
   backup staging (Task 2b) — and check each survives. The survey's figure equals what a deletion frees when nothing changes in
   between (Task 2a case 10).
2. **The staging turn (decision 7, concurrency).** A run holds it from before the database copy to
   after its own clean-up; Liberar never deletes or counts staging while a run holds it; a run waits
   for Liberar, never the reverse; a page refresh never takes it, so it never keeps a press out of
   staging (Task 2a case 15) and never reports a backup that is not running (Task 1 cases 3–5); a
   failed run releases it, and a run whose sweep was stopped while it waited copies nothing (Task 1
   case 7). **For the Codex run-it
   seat:** start a real `BackupSupervisor` against a `local-fs` destination with a slow `archive`
   (a stand-in that resolves on a signal), press `POST /api/box/free-space` while the copy is
   half-written, and check the staged file and the run both survive and the run uploads; then plant
   a `waitron-<stamp>.dump` with no run going and check one press deletes it.
3. **Auth on a full disk (decision 3).** The fallback runs only on `storage.disk_full`, never writes,
   and refuses everything the normal path refuses (Task 6, room and full). A passive GET still never
   moves `last_seen_at` (Task 6 case 4).
4. **The page and the bell agree (decisions 4, 5, 19).** Every alert the bell shows is either on a
   row or counted on the "other" line; the page never draws red for anything but a staff notice of
   severity `error`.
5. **Nothing fiscal moves.** `git diff main --stat -- packages/fiscal-verifactu packages/fiscal packages/core packages/module packages/composition`
   prints nothing.
6. **Log rotation beside Liberar.** The sink rotates synchronously in-process (`log-file.ts:42-53`);
   a rotation between Liberar's listing and its deletion can make it delete a file that was
   `waitron.log.1` when listed and became `.2`. That file is still a rotated log the box no longer
   writes, so this plan accepts it; the current log is never named `waitron.log.<n>`.
7. **Paths and links.** What keeps a link's target safe is the link check: an `lstat` of the entry's
   own path, which skips a link. A trailing separator is dangerous because it defeats that check —
   `lstat("link/")` describes the target folder — so one path builder makes the path both `lstat`
   and `rm` use, never with a trailing separator (M4's trap). Task 2b case 7 and its proof by
   deletion pin it.

## Review path

**FULL** (build plan row 7, auth; plus concurrency, above): per-task reviews, the full
`/finish-branch` wave, and two Codex run-it reviews side by side, the second told to set this plan's
checklist aside. The fresh-context plan-against-spec read runs before implementers start. Review
focus 2 names the first Codex seat's experiment; a second suggestion: boot a server on a small
filesystem (`WAITRON_FULL_DISK_DIR`, or the hdiutil image of `apps/server/src/testing/full-disk.ts`),
put a 1 MiB `waitron.log.3` in its log folder, fill the disk, write a till change so the stop is
noted, then sign in to the dashboard and read `GET /api/box/health` (expect 200, `disk.stoppedSince`
set, `reclaimable.bytes` ≥ 1048576), press `POST /api/box/free-space` (expect 200,
`freedBytes` ≥ 1048576) and read again (expect `stoppedSince: null` once 16 MiB is free; with a
smaller filler give back enough first).

---

### Task 1: The staging turn, held by every backup run

**Files:**
- Create: `apps/server/src/backup-staging-turn.ts`, `apps/server/src/backup-staging-turn.test.ts`
- Modify: `apps/server/src/backup-sweep.ts` (`BackupSweepDeps` gains `stagingTurn?`; `tick`,
  `:303-310`)
- Modify: `apps/server/src/backup-supervisor.ts` (`BackupSupervisorDeps` gains `stagingTurn?`,
  `:116-147`; passed to `runBackupSweep`, `:241-249`)
- Modify (gains cases): `apps/server/src/backup-sweep.test.ts`, the supervisor's test file
  (`apps/server/src/backup-supervisor.test.ts`)

**Interfaces:**
- Produces, in `backup-staging-turn.ts`:
  ```ts
  /** One holder at a time over `<state>/backup-staging` in this process: backup runs, and Liberar's
   * deletions. A page's survey never takes it. */
  export interface StagingTurn {
    /** A backup run: waits for the holder before it (a deletion or an earlier run), then holds the
     * turn until `work` settles. Runs go in the order they asked. */
    runBackup<T>(work: () => Promise<T>): Promise<T>;
    /** A Liberar deletion: never waits for a backup run. When a backup run holds the turn or is
     * waiting for it, answers `{ ran: false }` at once, without running `work`; otherwise holds the
     * turn for `work` (after a deletion already holding it, if any), so no run starts meanwhile. */
    ifNoBackup<T>(work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
    /** True only while a backup run holds the turn — not while one waits. */
    backupRunning(): boolean;
  }
  export function createStagingTurn(): StagingTurn;
  ```
- `BackupSweepDeps.stagingTurn?: StagingTurn` and `BackupSupervisorDeps.stagingTurn?: StagingTurn`:
  when given, `tick` runs
  `stagingTurn.runBackup(async () => { if (deps.signal.aborted) return; await runOnce(deps); })`;
  absent, `runOnce(deps)` as today. The aborted check is the round-1 review's M5: `runBackupSweep`
  checks the signal only before the first tick and between ticks (`backup-sweep.ts:267-296`), and
  `runOnce` copies the database before it reads the signal (`:119-156`, the copy at `:156`) **(read)**, so a tick that
  waited behind Liberar while its sweep was stopped (`reload()`, `stop()`; `#teardown` aborts it and awaits it,
  `backup-supervisor.ts:382-385`) would otherwise copy the whole database for nothing.

- [ ] **Step 1: Write the failing tests.**
  - `backup-staging-turn.test.ts`:
    1. `runBackup` answers its work's value; a throwing work rethrows and frees the turn (a later
       `ifNoBackup` runs);
    2. two `runBackup`s run one after the other, in the order asked (record starts and ends);
    3. while a `runBackup` holds the turn, `ifNoBackup` answers `{ ran: false }` without running its
       work and without waiting (it settles before the held run is released), and `backupRunning()`
       is `true`;
    4. while an `ifNoBackup` holds the turn, a `runBackup` waits; while it waits `backupRunning()` is
       `false`; once the deletion settles the run starts and `backupRunning()` is `true`;
    5. two overlapping `ifNoBackup`s with no run asked both run (the second after the first), neither
       answers `ran: false`, and `backupRunning()` stays `false` throughout;
    5b. "a deletion asked while a run waits is skipped, not queued": deletion D1 holds, a run R asks
       (it waits), deletion D2 asks → D2 answers `{ ran: false }` at once, its work never run, before
       D1 is released; then R runs after D1 (the round-3 check's `turn-probe.log` showed revision 2's
       recipe queueing D2 behind R);
    6. with nobody holding, `ifNoBackup` runs and answers `{ ran: true, value }`.
  - `backup-sweep.test.ts`, one new `describe("the staging turn")`, using the file's existing
    harness for one tick and a stand-in `archive`:
    7. "a run whose sweep is stopped while it waits copies nothing": an `ifNoBackup` held open, the
       sweep started (its first tick waits), the sweep's `AbortController` aborted, the deletion
       released → `archive` never called, nothing written to staging, the turn free;
    8. while `archive` runs, `backupRunning()` is `true` and `ifNoBackup` from inside the stand-in
       answers `ran: false`; after the tick's own clean-up, `false` and free;
    9. a tick that fails (its `archive` throws) frees the turn and is logged `backup.failed` as today;
    10. with no `stagingTurn`, a tick runs as before (an existing case already covers this; add none
        if one does — name it in the report).
  - The supervisor's test: 11. the `stagingTurn` it is given reaches the sweep (a `reload()` with a
    `local-fs` destination and a stand-in `openVenue` whose `archiveTo` is held, as the file's existing
    cases build; `backupRunning()` is `true` while it is held).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/backup-staging-turn.test.ts src/backup-sweep.test.ts src/backup-supervisor.test.ts`.
  Expected: the first file fails to resolve `./backup-staging-turn.js`; cases 7–9 and 11 fail (no
  turn is taken); every existing case passes.
- [ ] **Step 3: Implement.** One promise chain both kinds join; a count of runs that hold or wait
  (incremented when `runBackup` is asked, decremented when its work settles), and a flag set only
  while a run's work is running, which `backupRunning()` reads. `ifNoBackup` reads the count first
  and answers `ran: false` when it is above 0; otherwise it joins the chain, behind at most another
  deletion. `tick` keeps its own `catch` around the held work, so a failed run still frees the turn
  and is still logged `backup.failed`.
- [ ] **Step 4: Run and watch them pass; typecheck; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/server typecheck` exits 0. `pnpm exec prettier --check` on the touched files
  exits 0.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS before the next: make
  `ifNoBackup` wait for a run → case 3 FAILS; set the flag while a run waits → case 4 FAILS; make a
  second `ifNoBackup` answer `ran: false` → case 5 FAILS; let `ifNoBackup` check only the running
  flag, not the count → case 5b FAILS (D2 runs after R); drop the aborted check → case 7 FAILS; call
  `runOnce` outside `runBackup` in `tick` → case 8 FAILS; drop the release on a throw → case 1 or 9
  FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/backup-staging-turn.ts apps/server/src/backup-staging-turn.test.ts apps/server/src/backup-sweep.ts apps/server/src/backup-sweep.test.ts apps/server/src/backup-supervisor.ts apps/server/src/backup-supervisor.test.ts
  git commit -s -m "Every backup run holds a turn over backup staging, so nothing else touches its files while it runs"
  ```

### Task 2a: Liberar's rules — what may be deleted, and how much it frees

**Files:**
- Modify: `apps/server/src/start-space.ts` (`export` on `ROTATED_LOG`, `CRASH_REPORT`, `STAGED_DUMP`,
  `:14-18`; nothing else)
- Create: `apps/server/src/free-space-now.ts`, `apps/server/src/free-space-now.test.ts`

**Interfaces:**
- Produces, in `free-space-now.ts`:
  ```ts
  export interface LeftoverDeps {
    logDir: string;
    stateDir: string;
    now: () => Date;
    staging: Pick<StagingTurn, "ifNoBackup" | "backupRunning">;
    log: Logger;
    /** Defaults to `node:fs/promises`' `rm`; tests inject a refusal. */
    remove?: (path: string, options: { recursive: boolean }) => Promise<void>;
    /** Defaults to `node:fs/promises`' `lstat`; tests hold one to overlap a survey with a deletion. */
    lstat?: typeof import("node:fs/promises").lstat;
    /** Defaults to `node:fs/promises`' `readdir`; tests make a folder vanish. */
    readdir?: (path: string) => Promise<string[]>;
  }
  /** What a deletion would free now. Takes no turn: staging's size is best-effort while a run may
   * be writing there, and is left out while a backup run holds the turn. */
  export interface LeftoverSurvey {
    bytes: number;
    backupRunning: boolean;
  }
  export async function surveyLeftovers(deps: LeftoverDeps): Promise<LeftoverSurvey>;
  export interface LeftoverRemoval {
    freedBytes: number;
    deleted: number;
    failed: number;
    backupRunning: boolean;
  }
  /** Deletes decision 6's set, staging first, staging inside `ifNoBackup`; never throws for a file. */
  export async function deleteLeftovers(deps: LeftoverDeps): Promise<LeftoverRemoval>;
  ```
  Both walk the same list (one internal `leftovers(deps)` that answers `{ path, bytes, recursive }[]`
  per folder), so the survey and the deletion cannot drift apart. The survey's `backupRunning` is
  `staging.backupRunning()` (a run holds the turn); the deletion's is `true` exactly when
  `ifNoBackup` answered `ran: false` (a run holds it or waits for it).

- [ ] **Step 1: Write the failing tests** in `free-space-now.test.ts` (case numbers are kept from
  revision 2 across Tasks 2a and 2b; 2b holds 4–9 and 14, and 16 is dropped as the round-3 check's m4
  found it cannot fail through this file — Task 1 case 5 pins what it meant), each in its own `mkdtemp`
  folder with `stateDir`, `logDir = <stateDir>/logs` and `venueDir = <stateDir>/venue`, a fixed `now`,
  and `createStagingTurn()` unless the case says otherwise. Sizes are written with distinct byte
  counts so a sum shows which files were counted.
  1. "counts and deletes a staged dump, its partial and an encrypt folder": `waitron-20261020T000000Z.dump`
     (3000 B), `waitron-20261020T000000Z.dump.partial` (500 B), `backup-encrypt-abc/artifact` (2000 B)
     → survey `{ bytes: 5500, backupRunning: false }`; deletion `{ freedBytes: 5500, deleted: 3,
     failed: 0 }`; all three gone.
  2. "keeps the current log and the newest rotated one": `waitron.log` (100), `waitron.log.1` (200),
     `waitron.log.2` (300), `waitron.log.5` (400) → survey 700; after deletion only `waitron.log`
     and `waitron.log.1` remain.
  3. "deletes crash reports only once a week old": two `holder-frozen-*.json` with `utimes` 8 days
     and 6 days before `now` → only the 8-day one counted and deleted.
  10. "the survey's figure is what the deletion frees": case 1, 2 and 3's files together → survey
      bytes equals deletion `freedBytes`.
  11. "leaves staging alone while a backup run holds the turn": case 1's staging files plus case 2's
      logs; a `runBackup` on the turn kept open while survey and deletion run → survey
      `{ bytes: 700, backupRunning: true }`, deletion `{ freedBytes: 700, backupRunning: true }`,
      staging files all present; released, a second deletion frees 5500.
  12. "a file that cannot be deleted is counted as failed and logged": `waitron.log.2` and
      `waitron.log.3`, a `remove` that throws an `EACCES` error for `.3` and calls the real `rm`
      otherwise → `{ deleted: 1, failed: 1, freedBytes: <.2's size> }`, one
      `storage.free_space_failed` line with `errno: "EACCES"`, `.3` still there.
  13. "a file gone before its deletion is neither deleted nor failed": a `remove` that throws an
      `ENOENT` error → `{ deleted: 0, failed: 0, freedBytes: 0 }`, no log line.
  15. "a press during a refresh still deletes staging leftovers": case 1's staging files; a survey
      whose injected `lstat` is held on its first call; while it is held, a deletion with the real
      `lstat` → `{ freedBytes: 5500, backupRunning: false }`, files gone; then the held survey is
      released and **resolves** with `typeof bytes === "number"` (its figure may be stale), never
      rejects.
  17. "missing folders count as nothing": no `backup-staging`, no `logs` → `{ bytes: 0 }`, no log line.
  18. "a file that vanishes during the survey counts as gone": a survey whose injected `lstat`
      throws an `ENOENT` error for `waitron.log.2` (and answers the real `lstat` otherwise), beside
      `waitron.log.3` (400 B) → resolves `{ bytes: 400 }`, no log line, no rejection; the same with
      `readdir`'s folder gone between the folder's `lstat` and its listing (an injected `readdir`
      throwing `ENOENT`) → `{ bytes: 0 }`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/free-space-now.test.ts src/start-space.test.ts`.
  Expected: the first file fails to resolve `./free-space-now.js`; `start-space.test.ts` passes
  unedited.
- [ ] **Step 3: Implement** with `lstat` for every entry (decision 6), `readdir` per folder, sizes of
  a folder's regular files summed with `lstat` and no link followed, deletion order staging → logs
  (highest number first) → crash reports (oldest first), `rm(path, { recursive })` without `force`
  so a failure is seen, `ENOENT` from `rm` treated as already gone, `errnoOf`
  (`apps/server/src/errno.js`) for the log field. The survey counts an entry or folder that
  vanishes during its walk — `ENOENT` from `readdir` or `lstat` — as 0 bytes, never as an error
  (it takes no turn, so a press can delete under it). The deletion's staging part runs inside
  `deps.staging.ifNoBackup`; the survey takes no turn. **One path builder,
  `join(folder, name)`, makes every path, and the path `lstat` judges is the path `rm` removes;
  never append a separator to it. A trailing separator defeats the link check: `lstat("link/")`
  describes the folder the link points to, not the link, and `rm("link/", { recursive: true })`
  then deletes that folder (M4's trap, Task 2b case 7).** Add `readdir` beside `lstat` and `remove`
  as an injectable dependency, defaulting to `node:fs/promises`.
- [ ] **Step 4: Run and watch them pass; format.** The Step 2 command → PASS.
  `pnpm exec prettier --check` on the three files exits 0.
- [ ] **Step 5: Proofs by deletion:** allow `n ≥ 1` in the log rule → case 2 FAILS; drop the
  week check → case 3 FAILS; take staging outside `ifNoBackup` → case 11 FAILS; treat every
  refusal as already gone → case 12 FAILS; let the survey's `ENOENT` throw → case 18 FAILS; run the
  survey inside `ifNoBackup` → case 15 FAILS by timing out (the deletion waits while the held survey
  holds the turn), not by an assertion — say so in the report.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/start-space.ts apps/server/src/free-space-now.ts apps/server/src/free-space-now.test.ts
  git commit -s -m "The box can say how much of its disk it could free, and free only what it can make again"
  ```

### Task 2b: Liberar's refusing cases — what it must never delete

**Files:**
- Modify (gains cases): `apps/server/src/free-space-now.test.ts`
- Modify: `apps/server/src/free-space-now.ts` only if a case finds a hole

Every case here is a refusing case; most pass at once against Task 2a's code, and each is made to
fail by its proof by deletion in Step 3. The folders and helpers are Task 2a's.

- [ ] **Step 1: Write the cases.**
  4. **Refusing, the venue folder:** `venue/venue.db`, `venue.db-wal`, `venue.db-shm`, `node.db`,
     `venue.lock`, `.venue.db-litestream/generations/x` → all survive, survey 0.
  5. **Refusing, the state folder:** `recovery.lock`, `recovery.json`, `secrets.env`, `modules.json`,
     `stream/litestream.yml`, `tls/ca.crt`, `cloud-snapshots/staging/venue.db`,
     `restore-staging/waitron-20261020T000000Z.dump`, and a top-level
     `waitron-20261020T000000Z.dump` in the state folder itself → all survive.
  6. **Refusing, look-alikes:** in `backup-staging`, `archive-validate-x/` and `restore-admission-x/`
     and `waitron-20261020T000000Z.dump.bak`, `other.dump` and `notes.txt`; in `logs`, `waitron.log.0`,
     `waitron.log.1`, `waitron.log.x`, `other.log.3`; in `crash-reports`, an 8-day-old `other.json`
     → all survive.
  7. **Refusing, links (M4, and its trailing-separator trap):** a link
     `backup-staging/backup-encrypt-link` → `venue/` (holding `venue.db`), a link
     `backup-staging/waitron-20261020T000000Z.dump` → `venue/venue.db`, a link `logs/waitron.log.3` →
     `venue/venue.db`, and a link `logs/crash-reports/holder-frozen-a.json` → `venue/venue.db`,
     the link itself aged 8 days with `lutimes` (`utimes` would age the target, and an
     `lstat`-based age check would then see a new link and keep it whatever the link rule says —
     the round-3 check's `lutimes-probe.log`) → every link and every target survive
     (`venue/venue.db` still readable), survey 0 for them. The link rule is what protects each target. If the shared path builder appended a
     separator, the `lstat` would read `backup-encrypt-link/` — the folder it points to — and the
     `rm` would delete `venue/` (M4; the round-3 check's `sep-probe.log` printed `venue.db survives:
     false` that way), so this case fails then.
  8. **Refusing, a folder that is a link:** each in its own case — `backup-staging` itself a link to
     `venue/` holding a file named `waitron-20261020T000000Z.dump`; `logs` a link to `venue/` holding
     `waitron.log.4`; `logs/crash-reports` a link to `venue/` holding an 8-day-old
     `holder-frozen-b.json` → nothing in `venue/` is deleted or counted, and each deletion logs one
     `storage.free_space_skipped` `{ folder }` (`backup-staging`, `logs`, `crash-reports`); the survey
     logs nothing.
  9. **Refusing, a log folder that is the venue or state folder:** `logDir = venueDir` holding
     `venue.db` and `waitron.log.2`; `logDir = stateDir` holding `recovery.json` and `waitron.log.2` →
     only `waitron.log.2` deleted each time.
  14. **Refusing, a configured backup folder inside the log folder or backup staging:** a `local-fs`
      destination's archive, `waitron-20261020T000000Z-8c1d….backup.enc` (`backupArchiveKey`'s
      shape, `backup-keys.ts:25-26`), placed (a) in `logs/` and (b) in `backup-staging/` → survives,
      not counted.
- [ ] **Step 2: Run.** `pnpm --filter @waitron/server exec vitest run src/free-space-now.test.ts`.
  Expected: PASS. A case that fails shows a hole in Task 2a's code: fix it there, and say so in the
  report.
- [ ] **Step 3: Proofs by deletion**, each restored and re-run to PASS before the next: follow links
  (`stat` instead of `lstat`) → case 7 FAILS; make the shared path builder append `path.sep`, so
  `lstat` and `rm` both read `link/` → case 7 FAILS (the round-3 check's `sep-probe.log`: `venue.db
  survives: false`); if it does not fail, leave this proof out and say so; drop the folder-link
  skip → case 8 FAILS; match any `.dump` name in staging → case 6 FAILS; list the state folder
  instead of `backup-staging` → case 5 FAILS.
- [ ] **Step 4: Format and commit.**
  ```bash
  git add apps/server/src/free-space-now.test.ts
  git commit -s -m "Liberar's refusing cases: the venue, the state folder, look-alikes, links and configured backups survive"
  ```
  (Add `apps/server/src/free-space-now.ts` only if Step 2 changed it.)

### Task 3: What fills the disk

**Files:**
- Create: `apps/server/src/disk-usage.ts`, `apps/server/src/disk-usage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DiskStatfs = (
    path: string,
  ) => Promise<{ bavail: number; bfree: number; blocks: number; frsize: number }>;
  export interface DiskUsage {
    freeBytes: number | null;
    totalBytes: number | null;
    databaseBytes: number | null;
    backupsBytes: number | null;
    logBytes: number | null;
    otherBytes: number | null;
  }
  /** The venue folder's disk, and how much of it Waitron's folders take (decision 12). */
  export async function readDiskUsage(deps: {
    venueDir: string;
    logDir: string;
    backupDirs: readonly string[];
    statfs?: DiskStatfs;
  }): Promise<DiskUsage>;
  ```
  Default `statfs` is `node:fs/promises`' `statfs` (Node 26 returns `frsize`, `blocks`, `bfree` and
  `bavail`; `node -e 'require("fs/promises").statfs("/tmp").then(s=>console.log(JSON.stringify(s)))'`
  printed all four on 2026-10-22).

- [ ] **Step 1: Write the failing tests** (a `mkdtemp` folder per case; a stub `statfs` with
  `frsize: 1` so byte counts are exact):
  1. venue files 1000 B, logs 300 B, one backup folder 5000 B, `blocks 100000, bfree 40000,
     bavail 30000` → `{ freeBytes: 30000, totalBytes: 100000, databaseBytes: 1000, backupsBytes: 5000,
     logBytes: 300, otherBytes: 60000 - 6300 }`;
  2. a backup folder inside the venue folder → counted once, in `databaseBytes`; `backupsBytes` 0;
  3. two backup folders → summed; a missing one counts 0;
  4. a link inside the venue folder to a 9000 B file elsewhere → not counted;
  5. `statfs` throws → every field `null`;
  6. counted folders larger than the used space (a stub with `bfree = blocks`) → `otherBytes: 0`;
  7. a folder on another device: inject `stat` (or a `deviceOf(path)` seam) so the log folder
     reports another `dev` → `logBytes: null`, and it is not subtracted.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/disk-usage.test.ts`. Expected: cannot resolve
  `./disk-usage.js`.
- [ ] **Step 3: Implement** a walk with `lstat`, regular files only, no link followed, staying on the
  venue folder's device.
- [ ] **Step 4: Run and watch them pass; format.**
- [ ] **Step 5: Proofs by deletion:** follow links → case 4 FAILS; drop the nested-folder rule → case 2
  FAILS; drop the floor → case 6 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/disk-usage.ts apps/server/src/disk-usage.test.ts
  git commit -s -m "The box can say what fills its disk: the database, backups kept on it, logs and the rest"
  ```

### Task 4: The read's content

**Files:**
- Create: `apps/server/src/box-health.ts`, `apps/server/src/box-health.test.ts`,
  `apps/server/src/box-health.payments-off.test.ts` (its own `useVenueDb`, migrated without the
  payments set)

**Interfaces:**
- Produces:
  ```ts
  export interface BoxHealth {
    /** The box's clock when the read was made. */
    at: string;
    sales: { lastAt: string | null };
    notices: OwnedStaffNotice[];
    noticesUnavailable: string[];
    /** Whether this box files records with the tax agency. */
    filing: boolean;
    stream: StreamView;
    clock: { authority: AuthorityClockStatus; sync: TimeHealth };
    printers: { id: string; name: string }[];
    /** Null when the payments module is off: its table does not exist (M9). */
    readers: { id: string; name: string }[] | null;
    /** False on a mirror or fenced node, whose read-only gate refuses Liberar (decision 11). */
    canFree: boolean;
    disk: DiskUsage & {
      stoppedSince: string | null;
      lowSince: string | null;
      reclaimable: LeftoverSurvey;
    };
  }
  export interface BoxHealthReaders {
    now: () => Date;
    notices: {
      sources: readonly OwnedStaffNoticeSource[];
      clock: Pick<TrustedClock, "now">;
      filing: () => boolean;
      log: StaffNoticeLog;
    };
    stream: () => StreamView;
    authorityClock: () => AuthorityClockStatus;
    timeHealth: () => Promise<TimeHealth>;
    disk: Pick<DiskFullState, "since">;
    space: Pick<FreeSpaceState, "current">;
    /** May be cached (decision 22); its `freeBytes` is replaced by `free()`'s. */
    usage: () => Promise<DiskUsage>;
    /** The venue folder's free space, read on every call. */
    free: () => Promise<number | null>;
    leftovers: () => Promise<LeftoverSurvey>;
    /** Boot's own test, `setsToMigrate.some((module) => module.name === "payments")` (`boot.ts:1649`). */
    paymentsEnabled: boolean;
    canFree: () => boolean;
  }
  export async function collectBoxHealth(db: Database, readers: BoxHealthReaders): Promise<BoxHealth>;
  ```
  Its database reads — the last sale (`select issued_at from sales order by issued_at desc limit 1`,
  M6), the printers (`active` and `deleted_at is null`, ordered by name), and, only when
  `paymentsEnabled`, the card readers (`active`, `deleted_at is null`, `id <> DEMO_READER_ID`, ordered
  by name) — run in one `db.withWriteLock` turn, each awaited in turn. The notices go through `readStaffNoticesInTurns`, each source wrapped to pass
  `filing: { enabled: readers.notices.filing() }`, with `readers.notices.log` begun and settled as
  `device-api.ts:408-418` does.

- [ ] **Step 1: Write the failing tests** with `useVenueDb` (the file's migrations as
  `apps/server/src/alert-sources.test.ts` sets them up) and stub readers:
  1. an empty venue → `sales.lastAt: null`, `printers: []`, `readers: []`, `notices: []`, `filing`
     as the stub says, the stub values passed through for `stream`, `clock`, `disk`;
  2. three sales seeded with `issued_at` 2026-10-20, -22 and -21 → `lastAt` is the 22nd's;
  3. printers: an active one, a disabled one, a deleted one → only the active one;
  4. card readers: an active one, a disabled one, a deleted one and the demo reader → only the
     active one;
  5. `disk.since()` set and `space.current().lowSince` set → `stoppedSince` and `lowSince` as ISO;
  6. the notices: a source answering `storage.disk_full` and one that throws → `notices` holds the
     first with its owner, `noticesUnavailable` the second's owner;
  7. a notice source that writes a row → it is in `noticesUnavailable` and its row is gone (the
     reader's own rule, checked here through `collectBoxHealth`);
  8. `filing` reaches the sources: a source that answers a notice only when `ctx.filing?.enabled` →
     present with `filing: () => true`, absent with `false`;
  9. the turn: while another `db.withWriteLock` holds the lock, `collectBoxHealth` does not finish;
     released, it does (a held promise, then `vi.waitFor`);
  10. `canFree` passes through (`true` and `false`); `disk.freeBytes` is `free()`'s answer, not the
      usage's.
  And in `box-health.payments-off.test.ts`, a venue migrated with
  `migrationOptionsFor(manifestSets().filter((set) => set.name !== "payments"), null)` (M9's shape):
  11. "a box with card payments off answers, with no readers": `paymentsEnabled: false` → resolves,
      `readers: null`, printers and sales read as usual;
  12. control: `paymentsEnabled: true` on that venue → rejects with `no such table: card_readers`
      (so case 11 is seen to avoid the table, not to find it empty).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-health.test.ts`. Expected: cannot resolve
  `./box-health.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; typecheck; format.**
  `pnpm exec vitest run scripts/module-seams.test.ts` passes.
- [ ] **Step 5: Proofs by deletion:** order the sales by `id` → case 2 FAILS (seed ids so it does);
  drop the `deleted_at` check on printers → case 3 FAILS; drop the demo-reader filter → case 4 FAILS;
  read outside the turn → case 9 FAILS; read the readers whatever `paymentsEnabled` says → case 11
  FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-health.ts apps/server/src/box-health.test.ts apps/server/src/box-health.payments-off.test.ts
  git commit -s -m "The box can answer, in one read, how each of its parts is doing"
  ```

### Task 5: One deletion at a time, then a fresh reading

**Files:**
- Modify: `apps/server/src/free-space-now.ts` (a new export)
- Modify (gains cases): `apps/server/src/free-space-now.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FreedSpace extends LeftoverRemoval {
    /** The venue folder's free space after the deletion; null where it cannot be read. */
    freeBytes: number | null;
  }
  export function createSpaceFreer(deps: LeftoverDeps & {
    venueDir: string;
    space: Pick<FreeSpaceState, "record">;
    disk: Pick<DiskFullState, "noted" | "full">;
    statfs?: Statfs;
    /** Called once after each deletion settles, so boot can start a fresh disk usage walk. */
    onFreed?: () => void;
  }): (personId: string) => Promise<FreedSpace>;
  ```
  Runs `deleteLeftovers`, then `freeBytes(venueDir)`, records it with `space.record(free, now())`,
  then, only if `disk.noted()`, awaits `disk.full()`; logs `storage.space_freed` (decision 20). A
  call while one is under way answers that one's promise (decision 10).

- [ ] **Step 1: Write the failing tests:**
  1. it deletes, records the reading (a spy `space.record` called once with the stub's free bytes),
     and answers `{ …removal, freeBytes }`;
  2. with the stop noted it calls `disk.full()` once, after the deletion (record the order); not
     noted, never;
  3. two calls while the first's deletion is held (a held `remove`, or a held stub `statfs`)
     → one deletion, both answer the same object; a call after it settles runs a new deletion;
  4. one `storage.space_freed` info line with the five fields, `personId` the first caller's;
  5. an unreadable reading (`statfs` throws) → `freeBytes: null`, `space.record(null, …)` called (the
     state's own rule logs it once), `disk.full()` still called when noted;
  6. `onFreed` is called once per deletion, after it settles, and once for two shared calls.
- [ ] **Step 2: Run and watch them fail.** `pnpm --filter @waitron/server exec vitest run src/free-space-now.test.ts`.
  Expected: the new cases fail (`createSpaceFreer` is not exported); Tasks 2a and 2b's pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; format.**
- [ ] **Step 5: Proofs by deletion:** drop the shared promise → case 3 FAILS; call `disk.full()`
  always → case 2 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/free-space-now.ts apps/server/src/free-space-now.test.ts
  git commit -s -m "Freeing space runs once at a time, then reads the disk again so a full-disk stop can lift at once"
  ```

### Task 6: The routes

**Files:**
- Create: `apps/server/src/box-health-api.ts`, `apps/server/src/box-health-api.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BoxHealthApiDeps {
    db: Database;
    readHealth: () => Promise<BoxHealth>;
    freeSpace: (personId: string) => Promise<FreedSpace>;
  }
  /** `GET /api/box/health` and `POST /api/box/free-space`, both `system.manage`. */
  export function mountBoxHealthApi(app: Hono, deps: BoxHealthApiDeps, log: Logger): void;
  ```
  Both start with one helper:
  ```ts
  async function authorizeSystemManager(db: Database, c: Context): Promise<string> {
    const sessionId = requireManagementSession(c);
    const check = (tx: Database | Transaction, touch: false | undefined) =>
      authorizeManager(tx, { managementSessionId: sessionId, permission: "system.manage", touch });
    try {
      return (await withTransaction(db, (tx) => check(tx, undefined))).authorizedBy;
    } catch (error) {
      if (!diskFullIn(error)) throw error;
      return (await check(db, false)).authorizedBy;
    }
  }
  ```
  `createErrorBoundary` with `box-status.ts`'s status table (`:103-108`; `storage.disk_full` → 507
  comes from the boundary itself, `packages/server-kit/src/error-boundary.ts:35-38`) under the event names
  `box-health.failed` and `box-free-space.failed`. The GET answers `200` with `readHealth()`; the
  POST answers `200` with `freeSpace(personId)`. Neither reads a body.

- [ ] **Step 1: Write the failing tests** with `useVenueDb` and the file's own Hono app, the boot
  middleware for `x-waitron-live` copied into the test (as M1's probe does), stub `readHealth` and
  `freeSpace` spies, and sessions made with `startManagementSession` for an admin, a manager and a
  supervisor (`seedPerson`-style helpers the identity tests use):
  1. GET as a manager → 200, the stub's body; POST as a manager → 200, `freeSpace` called once with
     the manager's person id;
  2. **refusing, no cookie** → 401 `management_session.required` on both, neither stub called;
  3. **refusing, a supervisor** (no `system.manage`) → 403 `authorization.not_permitted` on both,
     neither stub called;
  4. with `management_sessions.last_seen_at` set a minute in the past before each call (so two
     stamps cannot fall in one millisecond): a passive GET (`x-waitron-live: 1`) leaves it unchanged;
     a non-passive GET and the POST each leave it later than the seeded time;
  5. **refusing, an ended session** and **an expired one** (`last_seen_at` 31 minutes ago) → 401 on
     both routes; **a suspended person** → 403 `person.suspended`;
  6. **on a full disk, through a stand-in**: a `db` wrapper whose `withWriteLock` throws an
     `AppError("storage.disk_full")` after running nothing (the drain or touch refused), the rest
     delegating to the real database → GET and POST answer 200 as a manager, `last_seen_at`
     unchanged; cases 2, 3 and 5's refusals answer the same codes through the stand-in;
  7. any other error from the first check is thrown as it is: a stand-in whose `withWriteLock`
     throws a plain `Error("boom")` → 500 `server.internal`, no fallback (`freeSpace` not called);
  8. a `readHealth` that throws `storage.disk_full` → 507 (the boundary's existing mapping).
- [ ] **Step 2: Run and watch them fail.** `pnpm --filter @waitron/server exec vitest run src/box-health-api.test.ts`.
  Expected: cannot resolve `./box-health-api.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; typecheck; format.**
  `pnpm exec vitest run scripts/errors-reachable.test.ts` passes (no code added).
- [ ] **Step 5: Proofs by deletion:** drop the fallback → case 6 FAILS; catch every error in the
  fallback → case 7 FAILS; drop `touch: false` from the fallback → case 6 FAILS (`last_seen_at`
  moves, or the stand-in refuses); ask for `venue.view` (which a supervisor holds,
  `packages/identity/src/permissions.ts:46-55`) instead of `system.manage` → case 3 FAILS. Asking for
  another permission held by managers and admins but not supervisors (such as `printer.manage`)
  fails no case, so only that much of the permission's name is checked by review alone. Say so in the
  report.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-health-api.ts apps/server/src/box-health-api.test.ts
  git commit -s -m "Managers can read the box's health and free its disk, also when the disk is full"
  ```

### Task 7: Boot wires the page's read and Liberar

**Files:**
- Modify: `apps/server/src/boot.ts` (a staging turn before the backup supervisor, `:2070`; passed to
  it; `mountBoxHealthApi` beside `mountBoxStatusApi`, `:2206`)
- Create: `apps/server/src/boot.box-health.test.ts`

**Interfaces:** none new. Boot builds:
- `const stagingTurn = createStagingTurn();` before `new BackupSupervisor({ …, stagingTurn })`;
- a `createStaffNoticeLog(log)` of the page's own (so its failures are logged once per spell
  separately from the equipment read's);
- two 60-second caches (decision 22), `const timeHealthCache = createTtlCache<TimeHealth>({ ttlMs: 60_000, now })`
  and `const diskUsageCache = createTtlCache<DiskUsage>({ ttlMs: 60_000, now })`, as boot's
  `backupCache` (`boot.ts:2141-2145`);
- `readHealth: () => collectBoxHealth(db, { now, notices: { sources: deviceNoticeSources({ disk: diskFull, space: freeSpace }, setsToMigrate), clock: tillClock, filing: filesRecords, log: pageNoticeLog }, stream: () => streamHost.status(), authorityClock: authorityClock.read, timeHealth: () => timeHealthCache.get("sync", () => checkTimeHealth()), disk: diskFull, space: freeSpace, usage: () => diskUsageCache.get(`usage:${usageGeneration}`, () => readDiskUsage({ venueDir: config.venueDir, logDir: config.logDir, backupDirs: backupSupervisor.current().destinations.flatMap((d) => d.kind === "local-fs" ? [d.dir] : []) })), free: () => freeBytes(config.venueDir), leftovers: () => surveyLeftovers(leftoverDeps), paymentsEnabled: setsToMigrate.some((module) => module.name === "payments"), canFree: () => !(holders.mode.current === "mirror" || fenced) })`
  — `canFree` reads the read-only gate's own condition (`boot.ts:1522-1527`) per call, so a live
  promotion lifts it as the gate does; `free` reads the free space on every call while the folder
  walk is cached; `let usageGeneration = 0` is bumped by the freer's `onFreed` (decision 22);
- `freeSpace: createSpaceFreer({ ...leftoverDeps, venueDir: config.venueDir, space: freeSpace, disk: diskFull, onFreed: () => { usageGeneration += 1; } })`,
  where `leftoverDeps = { logDir: config.logDir, stateDir: config.stateDir, now, staging: stagingTurn, log }`.
  Mounted only where `mountBoxStatusApi` is (setup and adoption-pending starts return before it,
  `boot.ts:1018-1420` **(read)**: setup returns at `:1339`, adoption-pending at `:1400`).

- [ ] **Step 1: Write the failing test**, shaped like `apps/server/src/boot.free-space.test.ts:51-84`
  (a real `startServer` on a free port, `setupVenue`, its `managerCookie`), with `WAITRON_LOG_DIR`
  set to a scratch `logs` folder holding `waitron.log.3` (1500 B) and `waitron.log.1` (100 B):
  1. `GET /api/box/health` → 200; `disk.reclaimable.bytes` ≥ 1500; `printers` an array; `readers`
     an array (the test's venue enables every set — check, and say so); `filing` a boolean;
     `canFree: true`; `notices` an array; `disk.freeBytes` a number;
  2. `POST /api/box/free-space` → 200, `freedBytes` ≥ 1500, `waitron.log.3` gone, `waitron.log.1`
     still there;
  3. a second GET → `reclaimable.bytes` 0 (nothing else planted);
  4. the staging turn reaches the supervisor and Liberar alike: `vi.mock("./backup-supervisor.js")`
     with a subclass of the real `BackupSupervisor` that keeps its constructor's deps in a hoisted
     holder (the way `boot.free-space.test.ts:17-41` keeps the watch's); then, inside
     `holder.supervisorDeps.stagingTurn.runBackup(async () => …)`, a GET answers
     `disk.reclaimable.backupRunning: true`, and after it `false`;
  5. the slow reads are cached, on **a fresh server of its own** (its own `startServer`, so cases 1–3
     have not filled the cache): with `checkTimeHealth` and `readDiskUsage` spied through `vi.mock`,
     three GETs within a minute call each once; then a POST and one more GET → `readDiskUsage` called
     a second time (a press starts a fresh walk), `checkTimeHealth` still once.
- [ ] **Step 2: Run and watch it fail.** `pnpm --filter @waitron/server exec vitest run src/boot.box-health.test.ts`.
  Expected: 404 on the new routes.
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run and watch it pass; typecheck; format.** Also run
  `pnpm --filter @waitron/server exec vitest run src/boot.free-space.test.ts src/boot.disk-full-wiring.test.ts src/box-status.route.test.ts`
  → PASS unedited.
- [ ] **Step 5: Proofs by deletion:** pass no `stagingTurn` to the supervisor → case 4 FAILS; drop
  either cache → case 5 FAILS; drop the generation from the usage key → case 5 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.box-health.test.ts
  git commit -s -m "The running box serves the Box status read and Liberar, sharing one staging turn with its backups"
  ```

### Task 8: The disk alerts point at the page (declared assertion changes)

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (`storageAlertSource`, `:310-342`)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (`storage.space_low`, `:112-115`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`nav.box_status`: "Box status" / "Estado del
  equipo", beside `nav.diagnostics`, `:973` and `:4123`)
- Modify (declared changes): `apps/server/src/alert-sources.test.ts:158-166`, `:174-182`,
  `:189-197`; `apps/server/src/boot.free-space.test.ts:96-104`, `:113-121`;
  `apps/dashboard/src/i18n/alerts.test.ts:273-275`, `:287-292`

- [ ] **Step 0: The declared assertion changes, in their own commit, first.** Add
  `screen: "box-status"` to the five objects; change `alerts.test.ts:274`'s expected English to
  `"The box has 1.8 GB of disk space left. Everything still works, but if it fills up nothing can be saved. See what is using it on the Box status page."`;
  delete `:287-292` and put in its place a case "points the disk warning at the Box status page,
  in three sentences, in both languages" (the round-1 review's I4) that asserts, with every expected
  value a literal in the test or read from a file other than the one under test
  (`alert-messages.ts`):
  - `en` and `es` each split into **3** sentences with the deleted test's own splitter,
    `text.split(/(?<=\.)\s+/)` (`alerts.test.ts:290`);
  - `en` ends with the literal `"See what is using it on the Box status page."`;
  - `es` contains the Spanish sidebar label, read through `t("nav.box_status", "es-ES")` — `t` takes
    the language as its second argument (`apps/dashboard/src/i18n/t.test.ts:68`), so the page's
    language is not changed — from `strings.ts`, not from the file under test, so a Spanish sentence
    that dropped the page's name fails. The key does not exist until Step 1, so the file does not
    typecheck in between; Vitest does not typecheck, and Step 2's typecheck covers it.
  The Spanish label is not written as a literal: CLAUDE.md §3 keeps Spanish out of a general app's
  tests ("General code is English only … not in a literal … or test"), and its rule for a test of
  non-English text is to read it from the strings file; this is the runner's ruling 4 met within that
  rule. Run
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/boot.free-space.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` and watch exactly
  those cases fail (5 objects, 1 sentence, 1 new case).
  ```bash
  git add apps/server/src/alert-sources.test.ts apps/server/src/boot.free-space.test.ts apps/dashboard/src/i18n/alerts.test.ts
  git commit -s -m "Changed test checks (A798 slice 7): the disk alerts gain a Go to the Box status page" -m "apps/server/src/alert-sources.test.ts:158-166, :174-182, :189-197 and apps/server/src/boot.free-space.test.ts:96-104, :113-121: each expected alert gains screen: \"box-status\", every other value unchanged (whole-shape exception). apps/dashboard/src/i18n/alerts.test.ts:274: the English warning gains 'See what is using it on the Box status page.'; :287-292 'keeps the disk warning to two sentences while there is no Box status page' is deleted, as slice 5 recorded (docs/backlog.md, 'The disk warning does not point at the Box status page yet'), and replaced by a case asserting three sentences in each language, the English ending with the Box status sentence, and the Spanish containing the page's Spanish sidebar label read from strings.ts."
  ```
- [ ] **Step 1: Implement** `screen: "box-status"` on both alerts, the two sentences word for word
  from design §4.3, and the `nav.box_status` label the new case reads.
- [ ] **Step 2: Run and watch them pass.** The Step 0 commands → PASS.
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts` → PASS.
- [ ] **Step 3: Format and commit.**
  ```bash
  git add apps/server/src/alert-sources.ts apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/strings.ts
  git commit -s -m "The bell's disk alerts open the Box status page, and the low-space warning says to look there"
  ```
  The Go to button reads "Go to Box status" from this task on, and the bell
  offers it only when `canOpen("box-status")` is true (`alert-format.ts:15-20`), which it is not
  before Task 12 adds the screen. Nothing in between ships.

### Task 9: The dashboard can ask: client, query and words

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (a `BoxHealth` copy beside `AlertView`, `:1696-1716`;
  `getBoxHealth()`, `freeBoxSpace()`)
- Modify: `apps/dashboard/src/api/live-queries.ts` (`getBoxHealth: []` in `QUERY_DEPENDENCIES`,
  `:528-533`; `refreshMs` 15 000 for it, `:584-591`)
- Modify: `packages/dashboard-kit/src/alert-messages.ts` (export `formatBytes`, `:55-70`, unchanged)
- Modify: `apps/dashboard/src/i18n/strings.ts` (English and Spanish keys below)
- Modify (gains cases): `apps/dashboard/src/api/client.test.ts`, `packages/dashboard-kit/src/alert-messages.test.ts`,
  the live-queries test file

**Interfaces:**
- `getBoxHealth(): Promise<BoxHealth>` → `GET /api/box/health`; `freeBoxSpace(): Promise<FreedSpaceView>`
  → `POST /api/box/free-space` with `{}`. The `BoxHealth` copy is commented "LOCAL copy of the
  server's `BoxHealth` (`apps/server/src/box-health.ts`)", as `AlertView` is.
- `export function formatBytes(value: unknown, locale: string): string;` from `@waitron/dashboard-kit`.
- Strings (English / Spanish). `{…}` are filled with `fill` (`apps/dashboard/src/i18n/t.ts:12`):

  | Key | English | Spanish |
  | --- | --- | --- |
  | `nav.box_status` | (added by Task 8) Box status | Estado del equipo |
  | `box_status.title` | Box status | Estado del equipo |
  | `box_status.legend` | Updated {time} · amber: needs attention, everything still works · red: something can't be saved | Actualizado {time} · ámbar: necesita atención, todo sigue funcionando · rojo: algo no se puede guardar |
  | `box_status.part.sales` | Sales | Ventas |
  | `box_status.part.tax` | Tax agency | Hacienda |
  | `box_status.part.bucket` | Bucket copy | Copia en el bucket |
  | `box_status.part.printers` | Printers | Impresoras |
  | `box_status.part.readers` | Card readers | Lectores de tarjeta |
  | `box_status.part.clock` | Clock | Reloj |
  | `box_status.part.disk` | Disk space | Espacio en disco |
  | `box_status.state.ok` | Fine | Bien |
  | `box_status.state.attention` | Needs attention | Necesita atención |
  | `box_status.state.stopped` | Something can't be saved | Algo no se puede guardar |
  | `box_status.sales.ok` | Recorded normally | Se registran con normalidad |
  | `box_status.sales.last` | Last sale {time} | Última venta {time} |
  | `box_status.sales.none` | No sales yet | Aún no hay ventas |
  | `box_status.notice.disk_full` | Nothing can be saved: the box is out of disk space | No se puede guardar nada: el equipo no tiene espacio en disco |
  | `box_status.notice.clock_unusable` | Sales can't be recorded: the box's clock is wrong | No se pueden registrar ventas: la hora del equipo es incorrecta |
  | `box_status.tax.ok` | Sent normally | Se envían con normalidad |
  | `box_status.tax.not_filing` | This box does not send records to the tax agency | Este equipo no envía registros a Hacienda |
  | `box_status.tax.unsent` | {count} records not yet sent · the box retries by itself | {count} registros sin enviar · el equipo reintenta solo |
  | `box_status.tax.unsent_one` | 1 record not yet sent · the box retries by itself | 1 registro sin enviar · el equipo reintenta solo |
  | `box_status.bucket.off` | Not set up | No configurada |
  | `box_status.bucket.starting` | Starting | Arrancando |
  | `box_status.bucket.ok` | Up to date | Al día |
  | `box_status.bucket.behind` | {minutes} min behind | {minutes} min de retraso |
  | `box_status.bucket.not_copying` | Not copying | No se está copiando |
  | `box_status.bucket.last` | Last confirmed upload {time} | Último envío confirmado {time} |
  | `box_status.printers.none` | No printers set up | No hay impresoras configuradas |
  | `box_status.readers.none` | No card readers set up | No hay lectores configurados |
  | `box_status.no_problems` | No problems reported | Sin problemas |
  | `box_status.clock.ok` | Correct | Correcto |
  | `box_status.clock.unknown` | Not yet compared with the tax agency | Aún no se ha comparado con Hacienda |
  | `box_status.clock.compared` | Compared with the tax agency at {time} · {seconds} s apart | Comparado con Hacienda a las {time} · diferencia {seconds} s |
  | `box_status.clock.synced` | Kept in time over the internet | Se pone en hora por internet |
  | `box_status.clock.not_synced` | Not kept in time over the internet | No se pone en hora por internet |
  | `box_status.disk.free` | {free} free of {total} | Quedan {free} libres de {total} |
  | `box_status.disk.unreadable` | The box can't measure its disk | El equipo no puede medir su disco |
  | `box_status.disk.database` | Database {size} | Base de datos {size} |
  | `box_status.disk.backups` | backups on this box {size} | copias en este equipo {size} |
  | `box_status.disk.logs` | logs {size} | registros de actividad {size} |
  | `box_status.disk.other` | rest of the disk {size} | resto del disco {size} |
  | `box_status.free` | Free {size} | Liberar {size} |
  | `box_status.free_nothing` | Nothing to free | Nada que liberar |
  | `box_status.free_read_only` | This box only keeps a read-only copy, so it can't free space here. | Este equipo solo guarda una copia de lectura, así que aquí no puede liberar espacio. |
  | `box_status.free_backup_running` | A backup is running, so its working files are not counted. | Hay una copia en curso, así que sus archivos de trabajo no se cuentan. |
  | `box_status.freed` | Freed {size}. | Liberados {size}. |
  | `box_status.free_help_label` | What Free deletes | Qué borra Liberar |
  | `box_status.free_help` | Free deletes only files the box can make again: crash reports older than a week, log files older than the two newest, and what a backup that was cut off left behind. Sales, settings and your backups are never touched. | Liberar solo borra archivos que el equipo puede volver a crear: informes de fallos de hace más de una semana, registros de actividad anteriores a los dos más recientes y lo que dejó una copia de seguridad interrumpida. Nunca toca las ventas, los ajustes ni tus copias. |
  | `box_status.free_help_guide` | More about freeing space | Más sobre liberar espacio |
  | `box_status.fillers` | To free more space: keep fewer backups on this box (on Backups), or ask whoever installed the box to remove old versions of Waitron or fit a bigger disk. | Para ganar más espacio: guarda menos copias en este equipo (en Copias de seguridad), o pide a quien instaló el equipo que borre versiones anteriores de Waitron o ponga un disco mayor. |
  | `box_status.checks_unavailable` | Some checks could not be made, so this page may not show every problem. | Algunas comprobaciones no se han podido hacer, así que esta página puede no mostrar todos los problemas. |
  | `box_status.other_alerts` | {count} other alerts | {count} avisos más |
  | `box_status.other_alerts_one` | 1 other alert | 1 aviso más |
  | `box_status.read_error` | The box's status could not be read. | No se ha podido leer el estado del equipo. |

  `box_status.fillers`' "keep fewer backups … (on Backups)" rests on the Backups screen's retention
  settings (`apps/dashboard/src/screens/backup-screen.ts:65-66`, `:359-363`, checked by the claim
  check). `box_status.clock.synced` and `not_synced` are drawn only when the sync check could tell
  (decision 14); there is no string for "unavailable", because the row then says nothing.

- [ ] **Step 1: Write the failing tests:** the client sends `GET /api/box/health` and
  `POST /api/box/free-space` (the file's existing fetch stub); `dashboardQuery(api, "getBoxHealth", [])`
  has `refreshMs` 15 000 and no dependencies, and its second read goes to `api.background`;
  `formatBytes(1_800_000_000, "es")` → `"1,8 GB"`; every new key exists in both languages (the
  strings file's own parity check, if one exists — name it; else a case here).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts` and
  `pnpm --filter @waitron/dashboard exec vitest run src/api/client.test.ts src/api/live-queries.test.ts src/i18n`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; typecheck both packages; format.**
  `pnpm exec vitest run scripts/english-only.test.ts scripts/live-subscriptions.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/api/client.ts apps/dashboard/src/api/client.test.ts apps/dashboard/src/api/live-queries.ts apps/dashboard/src/api/live-queries.test.ts packages/dashboard-kit/src/alert-messages.ts packages/dashboard-kit/src/alert-messages.test.ts apps/dashboard/src/i18n/strings.ts
  git commit -s -m "The dashboard can read the box's health and free its disk, with the page's words in English and Spanish"
  ```
  (Stage the live-queries test file by its real name.)

### Task 10: The rows, worked out

**Files:**
- Create: `apps/dashboard/src/screens/box-status-rows.ts`, `apps/dashboard/src/screens/box-status-rows.test.ts`

**Interfaces:**
```ts
export type PartId = "sales" | "tax" | "bucket" | "printers" | "readers" | "clock" | "disk";
export type PartState = "ok" | "attention" | "stopped";
export interface PartRow {
  id: PartId;
  state: PartState;
  /** The row's headline, worded. */
  line: string;
  /** Facts under the headline, worded; empty when there are none. */
  details: string[];
  /** The bell's alerts on this row, in the bell's order. */
  alerts: AlertView[];
  /** The screen the row's action opens; null when the row has none. */
  screen: string | null;
}
export function partOfAlert(alert: Pick<AlertView, "area" | "code">): PartId | null;
export function partsOfNotice(code: string): readonly PartId[];
export function boxStatusRows(
  health: BoxHealth,
  alerts: readonly AlertView[],
): { rows: PartRow[]; other: number; checksUnavailable: boolean };
```
Rows in the order Sales, Tax agency, Bucket copy, Printers, Card readers, Clock, Disk; the Card
readers row is left out when `health.readers` is `null` (decision 13), and its alerts then count on
the "other" line. `screen`:
bucket `backup`, printers `printers`, readers `payments`, others `null` (the Disk row's action is
Liberar, drawn by the screen). A row's `line`: on Sales, the disk notice's words, else the clock
notice's, else `sales.ok`; on any other row, the first stopped notice's words, else the row's own
fact line (Task 9's keys), with `alertMessage(code, params, lang)` of the first alert as the line when
the row has an alert and no notice (the alerts are also listed). Times through `formatIsoMinute`
(`packages/dashboard-kit/src/date-format.ts:5-9`), sizes through `formatBytes`. The bucket's
`behind` when `lagMs ≥ 60 000`, minutes rounded down. The printers' and readers' details are the
names set up, joined by ", " (Departures 4–5). The Clock's details: the comparison when the
authority state is `ok` or `warning`; then `clock.synced` or `clock.not_synced` only when
`health.clock.sync.source === "timedatectl"` — nothing about internet time when it is
`"unavailable"` (decision 14, M8).

- [ ] **Step 1: Write the failing tests** (they run in Chromium with the rest of the package; no DOM
  needed), with English and Spanish read from `strings.ts` via `t`/`fill`, restoring the language
  after each case (CLAUDE.md §4):
  1. `partOfAlert` for one alert of each mapped kind and three unmapped ones (`kitchen` area,
     `backup.destination_failed`, `invoice_delivery.failed`);
  2. `partsOfNotice` for the four codes and an unknown one;
  3. a quiet box (no notices, no alerts, filing, one printer, one reader, streaming lag 0, authority
     ok) → every row `ok`, Sales `Last sale …`, Tax `Sent normally`, Clock `Correct` with the
     comparison detail;
  4. `storage.disk_full` notice → Sales and Disk `stopped`, both lines the disk words;
  5. both reds → Sales shows the disk's words (design §4.2); Clock `stopped` with the clock words;
  6. `storage.space_low` → Disk `attention`, line `{free} free of {total}`;
  7. `fiscal.records_unsent` `{ count: 12 }` → Tax `attention`, "12 records not yet sent · …"; count 1
     → the singular;
  8. a `printer.jobs_waiting` alert (severity `error`) → Printers `attention`, never `stopped`, its
     line the bell's sentence, the alert listed;
  9. `fiscal.clock_drift` → Clock `attention`; `fiscal.submission_delayed` → Tax `attention`;
     `backup.stream_behind` → Bucket `attention`;
  10. two unmapped alerts and one unknown notice → `other: 3`;
  11. `noticesUnavailable: ["x"]` → `checksUnavailable: true`;
  12. not filing → Tax `ok` with `tax.not_filing`; no printers → `printers.none`; `readers: []` →
      `readers.none`; `readers: null` → no Card readers row, and a `reader.battery_low` alert then
      counts in `other`; stream `{ state: "off" }` → `bucket.off`;
  13. disk usage all `null` → `disk.unreadable`, no details;
  14. Spanish: case 3 and case 7 in `es` read the Spanish strings;
  15. the Clock and internet time: `sync: { source: "timedatectl", synced: true }` → a
      `clock.synced` detail; `synced: false` → `clock.not_synced`; `sync: { source: "unavailable",
      synced: false, warn: false }` → no detail mentions internet time (neither string appears in
      `details`);
  16. a `reader.battery_low` alert → Card readers `attention` with the alert's sentence (Departure 4).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; format.**
- [ ] **Step 5: Proofs by deletion:** draw an `error` alert as `stopped` → case 8 FAILS; show the
  clock's words first on Sales → case 5 FAILS; drop the "other" count for unknown notices → case 10
  FAILS; map `source: "unavailable"` to `clock.not_synced` → case 15 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/dashboard/src/screens/box-status-rows.ts apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "The Box status page works out each part's row from the box's read and the bell's alerts"
  ```

### Task 11: The page

**Files:**
- Create: `apps/dashboard/src/screens/box-status-screen.ts`, `box-status-screen.test.ts`,
  `box-status-screen.a11y.test.ts`

**Interfaces:** `dashboard-box-status-screen` (`BoxStatusScreen`) with
`@property({ attribute: false }) api!: DashboardApi` and
`@property({ attribute: false }) canOpen: (screen: string) => boolean = () => false`. It emits
`wt-alert-go-to` `{ screen }` (bubbles, composed) for a row's Go to, the bell's alert Go to and "See
all alerts" (`screen: "alerts"`), as the Alerts screen does (`dashboard-app.ts:2611-2618`). It watches
`getBoxHealth` and `listAlerts` through a `QueryController` (decision 15). Layout as picture 4: an
`h1`, the legend, a list (`ul`) of rows — each a dot (`--wt-color-success` / `-warning` /
`-danger`, with the state's words for screen readers, `box_status.state.*`), the part's name, the
line, the details joined by " · ", the alerts' sentences, and the action — then the checks note, the
"other" line and the fillers paragraph. Row actions: a `secondary` `wt-button` "Go to …"
(`goToLabel`, `alert-format.ts:79-81`) shown only when `canOpen(screen)`; on the Disk row, Liberar
with a `wt-help-tooltip mode="help-mode"` (`aria-label` `box_status.free_help_label`, text
`box_status.free_help`; Task 13 adds its guide link). When `health.canFree` is false, Liberar is
`secondary` and disabled whatever the figure, with `box_status.free_read_only` beside it
(decision 11). After a press: a `role="status"` line "Freed {size}." and
`this.api.liveData.refresh()` (decision 15), so this page's read and the shell's bell read again
at once — no change event reaches `getBoxHealth`. Errors: one
`role="alert"` line; a read failure and Liberar's failure are kept apart as
`diagnostics-screen.ts:143-151` does (a read's failure never replaces an action's; a later
successful read clears only a read's).

- [ ] **Step 1: Write the failing tests** in `box-status-screen.test.ts` (mount with
  `mountWidget`, a stub api answering a `BoxHealth` builder and `{ visible: true, alerts }`):
  1. seven rows in order, each `data-test="row-<id>"` with `data-state`; the title is `h1`
     `box_status.title`;
  2. a stopped Disk row's dot reads `--wt-color-danger` (computed style) and its words `stopped`;
     attention reads `--wt-color-warning`; ok `--wt-color-success`;
  3. Liberar reads "Free 45 MB" for `reclaimable.bytes: 45_000_000`, is `primary` and enabled; for
     `500_000` it reads "Free 1 MB" and is enabled; for `499_999` it is `secondary`, disabled and
     reads "Nothing to free"; before the first read resolves it is `secondary` and disabled;
  4. pressing Liberar calls `freeBoxSpace` once, keeps `primary` and disabled while sent, then shows
     "Freed 45 MB." and reads `getBoxHealth` and `listAlerts` again at once (each stub's call count
     goes up by one before any 15 s or 60 s timer could fire, with a real `LiveData`); a second press
     while the first is sent does not call it twice;
  5. `backupRunning: true` → the backup-running sentence under the Disk row;
  6. a refused press (`freeBoxSpace` rejects `{ code: "authorization.not_permitted" }`) → the alert
     line with `codeMessage`, the button enabled again; a later successful read does NOT clear it;
  7. a failed read shows `box_status.read_error`, and a later successful read clears it;
  8. Go to on the Printers row emits `wt-alert-go-to` `{ screen: "printers" }`; absent when
     `canOpen` says no; "See all alerts" emits `{ screen: "alerts" }` and shows only when `other > 0`;
  9. the help tooltip carries `mode="help-mode"` (its guide link is Task 13's);
  10. the read after the first goes through `api.background` (the stub counts calls on each);
  11. `checksUnavailable` → the note is shown;
  12. `canFree: false` with 45 MB to free → Liberar `secondary`, disabled, and the read-only sentence
      shown; pressing it calls nothing.
  And `box-status-screen.a11y.test.ts`, light and dark (as `diagnostics-screen.a11y.test.ts`): a
  quiet box; a box with a stopped disk, a stopped clock, the unsent count and two printer alerts; and
  a read failure — each with `expectNoA11yViolations`.
- [ ] **Step 2: Run and watch them fail.** `memory_pressure | grep free` first, then
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch them pass; format.** `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts` → PASS.
- [ ] **Step 5: Proofs by deletion:** clear the error line on every successful read → case 6 FAILS;
  enable Liberar from 1 byte → case 3 FAILS; send every read on `api` → case 10 FAILS; drop the
  `refresh()` after a press → case 4 FAILS; ignore `canFree` → case 12 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/dashboard/src/screens/box-status-screen.ts apps/dashboard/src/screens/box-status-screen.test.ts apps/dashboard/src/screens/box-status-screen.a11y.test.ts
  git commit -s -m "The Box status page shows each part of the box and frees the space the box can make again"
  ```

### Task 12: The page in the sidebar

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (`CORE_SCREENS`, `:121-153`; the configuration group,
  `:280-294`; `#renderScreen`'s cases, beside `"diagnostics"` at `:2581-2582`)
- Modify (gains cases): `apps/dashboard/src/dashboard-app.test.ts`

- [ ] **Step 1: Write the failing tests**, as new cases beside the diagnostics ones:
  1. a manager (whose session permissions hold `system.manage`, as the file's `meResponse` builder
     sets them — check, and pass them explicitly if it does not) sees `nav-box-status` in the
     Settings group (`nav-group-configuration`), directly before `nav-diagnostics`, labelled
     `t("nav.box_status")`;
  2. a supervisor does not see it, and `/manage/box-status` opens `overview` instead (a new row in the
     `it.each` at `:4628-4632` — a new case, the existing rows unedited);
  3. `/manage/box-status` as a manager mounts `dashboard-box-status-screen` with the shell's `api`
     (a new row in the `it.each` at `:6622-6631`, with `getBoxHealth: pending()` added to `faceApi`'s
     stubs — a mock, not an assertion);
  4. the page's `wt-alert-go-to` `{ screen: "printers" }` opens Printers; and the bell's
     `storage.space_low` alert with `screen: "box-status"` shows "Go to Box status" for a manager and
     opens the page;
  5. the sidebar search finds it: "box" in English and "ESTADO" in Spanish → `["nav-box-status"]`
     (if another Spanish label holds "estado", use "estado del" and say so).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts` — the new cases fail,
  every existing one passes.
- [ ] **Step 3: Implement**: `"box-status"` in `CORE_SCREENS`;
  `{ screen: "box-status", labelKey: "nav.box_status", requiresPermission: "system.manage" }` before
  the diagnostics item; the render case passing `.api` and `.canOpen=${this.#canOpenScreen}` and
  handling `wt-alert-go-to` as the Alerts screen's does.
- [ ] **Step 4: Run the whole file and watch it pass.**
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts` — every existing case
  passes unedited (the search cases at `:6900-7015` match no label this adds: checked "print",
  "PRINT", "book", "DIAGNOSTICO", "impresoras", "team", "device", "menus", "venue", "Menus",
  "Diagnostics", "Bookings", "profiles device", "units products", "&", "zzz" and "Units" against "Box
  status" and "Estado del equipo"; the claim check added the last five). Format.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.test.ts
  git commit -s -m "Settings gains Box status, before Diagnostics, for people who manage the system"
  ```

### Task 13: The guides

**Files:**
- Create: `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md`,
  `apps/server/src/i18n/box-status-guide.ts`
- Modify: `apps/server/src/guide-catalogue.ts` (`GUIDE_PAGES`, `:6-17`), `apps/server/src/guide-pages.ts`
  (`:79`, `:98`), `apps/server/src/guide/en/till-notices.md` and `es/till-notices.md` (the disk
  notices' paragraphs)
- Modify: `apps/dashboard/src/help-guide.ts` (`GUIDE_LINKS`, `:3-7`, gains
  `"box-status.free-space": { page: "box-status", section: "free-space" }`) and
  `apps/dashboard/src/screens/box-status-screen.ts` (the Liberar tooltip's `guide-href` from
  `guideHref("box-status.free-space")` and `guide-label` `box_status.free_help_guide`)
- Modify (gains cases): `apps/server/src/guide-content.test.ts`,
  `apps/dashboard/src/screens/box-status-screen.test.ts`

- [ ] **Step 1: Write the failing tests**: `it.each(GUIDE_LANGUAGES)` "the Box status guide in %s
  registers its sections" → `["open", "rows", "free-space", "out-of-space"]`, as the purchases case
  does (`guide-content.test.ts:32-44`); and in `box-status-screen.test.ts`, "the help tooltip links
  to the guide's free-space section" → its `guide-href` is `guideHref("box-status.free-space")` in
  English and in Spanish.
- [ ] **Step 2: Run and watch them fail.** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts`.
- [ ] **Step 3: Write the guides**, following `~/.claude/docs-writing-style.md` and the existing
  guides' voice (second person, plain words, no code names). English first, then a Spanish twin with
  the same `{#id}`s in the same order. Sections:
  - `# Box status` — what the page is for; who can open it (people who manage the system); where
    (Settings → Box status, beside Diagnostics). Diagnostics is for reading the log.
  - `## Open the page {#open}` — and that it updates itself every few seconds without keeping you
    signed in; on a box that only keeps a read-only copy, Free cannot be pressed, and the page says
    why.
  - `## Read the rows {#rows}` — the seven parts; green, amber ("needs attention, everything still
    works") and red ("something can't be saved"); that a row's problem is the same one the bell
    shows, and its Go to button; what each row's normal line means; that the card readers row lists
    the readers set up and does not check whether each is switched on, and is not there when card
    payments are off; that the clock row says whether the box keeps time over the internet only when
    the box can tell.
  - `## Free space on the box {#free-space}` — the Free button shows how much it can free before you
    press it; exactly what it deletes (crash reports older than a week, log files older than the
    newest two, and what a backup that was cut off left behind); what it never touches; that while a
    backup is running it leaves that backup's files alone and says so; the line naming what fills
    the disk; what to do when that is not enough.
  - `## When the box is out of space {#out-of-space}` — what red means on tills and here; free space,
    and once enough is free the tills can save again by themselves; that after Free this page and
    the bell update at once, while a bell open elsewhere shows the change within a minute (its 60 s
    poll, decision 15); if Free is not enough, the fillers line.
  - In both `till-notices.md` twins, the full and nearly-full notices' sentences gain "A manager can
    free space on the [Box status page](box-status.md#free-space)." / its Spanish — the
    `page.md#section` form every link between guide pages uses (`grep -o "\](\[^)]*)"
    apps/server/src/guide/en/*.md`, e.g. `](products.md#table-allergies)`).
  Every sentence about what the box does must be one this plan's tests pin; read
  `docs/developers/writing-claims.md` §1 before writing.
- [ ] **Step 4: Run and watch them pass.** The Step 2 commands → PASS, and
  `pnpm exec vitest run scripts/guide-links.test.ts scripts/guide-page-tokens.test.ts scripts/english-only.test.ts`
  → PASS. Open `/help/en/box-status` and `/help/es/box-status` in the dev server or render
  `renderGuide` to a file and open it in Chromium, and LOOK (CLAUDE.md §4, "A page asserted as a
  STRING…").
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md apps/server/src/i18n/box-status-guide.ts apps/server/src/guide-catalogue.ts apps/server/src/guide-pages.ts apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md apps/server/src/guide-content.test.ts apps/dashboard/src/help-guide.ts apps/dashboard/src/screens/box-status-screen.ts apps/dashboard/src/screens/box-status-screen.test.ts
  git commit -s -m "A guide to the Box status page in English and Spanish; the till notices guide points managers at it"
  ```

### Task 14: The page answers on a real full disk

**Files:**
- Modify (gains cases): `apps/server/src/start-full-disk.e2e.test.ts`

**Where it runs, and its room (M10).** The file opens one small disk for all its cases in a
top-level `beforeAll` (`start-full-disk.e2e.test.ts:54-60`), unfills it after each case, and its
existing cases keep their folders: after its 11 cases the macOS image had `18,116,608` bytes free,
against `32,755,712` on the empty image. Case 2 needs a migrated venue (`3,576,456` bytes measured),
a 1 MiB and a 17 MiB log, about 22 MiB. So:
- the new `describe("the Box status read and Liberar on a real full disk")` goes **first in the
  file**, before `describe("a start on a real full disk")` (`:142`), so it runs on the empty disk;
- it removes every folder it made in its own `afterAll` (`rm(path, { recursive: true, force: true })`
  after `disk.unfill()`), so the cases after it find the room they had before;
- case 2 asserts `disk.free() >= 22 * 1024 * 1024` before writing its 17 MiB file, with a message
  naming the shortfall, so a lack of room fails clearly instead of as an `ENOSPC` mid-write.
CI's small filesystem is a 32 MiB tmpfs (`.github/workflows/ci.yml:1046`); the room there was not
measured.

- [ ] **Step 1: Write the failing cases.** One venue for the `describe`, migrated and provisioned as
  the file's slice 6 cases do, a manager session and a supervisor session, and a Hono app with
  `mountBoxHealthApi` whose `readHealth` and `freeSpace` are built from the real `collectBoxHealth`
  and `createSpaceFreer` over folders on the small disk (`logs` holding a 1 MiB `waitron.log.3`,
  written before the fill). The `describe`'s `beforeAll` uses the file's `disk` directly and returns
  early when it is `undefined` (a hook has no `ctx.skip`, which `needDisk` needs,
  `start-full-disk.e2e.test.ts:63-69`); each case starts with `needDisk(ctx)`, so it skips or fails
  as the file's other cases do. Folders come from `disk.folder(<unique name>)`:
  1. "the box health read answers on a full disk with a change waiting, passive and not" — control
     first, with room: both 200 and the non-passive one moves `last_seen_at` (seeded a minute back);
     then a `change_log` row, the disk filled → passive GET 200 and non-passive GET 200,
     `last_seen_at` unchanged;
  2. "Liberar frees a rotated log on a full disk, and the stop lifts" — the free-space assertion
     above, then a 17 MiB `waitron.log.4` written (more than the stop's 16 MiB, `FULL_DISK_BYTES`,
     `apps/server/src/boot-failure.ts:47`), a WAL checkpoint, the disk filled, the stop noted
     (`noteRefused()`) → POST 200, `freedBytes` ≥ 17 MiB, `waitron.log.4` gone, the stop no longer
     noted, and a GET's `disk.stoppedSince` null;
  3. "a supervisor is refused on a full disk" → 403 on both routes.
- [ ] **Step 2: Run and watch them fail** (they need Tasks 6–7; watch case 1 fail by reverting
  decision 3's fallback locally, then restore it):
  `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "Box status read and Liberar"`.
  On macOS this mounts an `hdiutil` image; read the `Tests` count (a skip prints `skipped`).
- [ ] **Step 3: Run the whole file and watch it pass**: the new cases and the file's 11 existing ones,
  unedited. Add a temporary `console.log(disk.free())` at the end of the new `describe`'s `afterAll`
  (unset `AI_AGENT` and `CLAUDECODE` to see it), write the figure in the report, and remove the line.
  Format.
- [ ] **Step 4: Commit.**
  ```bash
  git add apps/server/src/start-full-disk.e2e.test.ts
  git commit -s -m "On a real full disk the Box status read answers and Liberar frees space and lifts the stop"
  ```

### Task 15: Developer docs

**Files:**
- Modify: `docs/developers/conventions-data.md` ("A read on a full disk must not fail on its own
  housekeeping write", `:2538-2617`; "Not gated", `:2493-2495`)
- Modify: `docs/developers/design-system.md` (an entry for the page in its screens list, as other
  screens have; the button-rule list, `:2700-2735`, gains Liberar under A416's rule)
- Modify: `docs/developers/testing-guide.md` only if Task 14 found something about the small disk
  worth recording
- Modify: `CLAUDE.md` (§3, Data, modules and migrations: one rule, below)
- Create: `scripts/backup-staging-touchers.test.ts` (a root guard)

- [ ] **Step 1:** In conventions-data's section, add the two routes to "what now answers", with the
  fallback (decision 3) and the receipt (this plan's M1 and M2, and Task 14's case names), and a
  short "What Liberar deletes" paragraph naming decision 6's set, the staging turn (decision 7) and
  the tests that pin both (`free-space-now.test.ts`, `backup-staging-turn.test.ts`). Weaker-than-name
  notes: the refusing cases name the files they plant, not every file a box could hold; the staging
  turn is in-process only (M5's grep).
- [ ] **Step 2:** In design-system.md, the page's entry: rows, dot tokens, red/amber meaning
  (decision 4), Liberar's states, including quiet and disabled on a read-only node (decision 11).
- [ ] **Step 3: The staging-turn guard, test first.** `scripts/backup-staging-touchers.test.ts`
  lists every `.ts` file under `apps/*/src` and `packages/*/src`, not a test, whose text names
  `BACKUP_STAGING_DIR` or the literal `"backup-staging"`, and expects exactly:
  `apps/server/src/start-space.ts` (declares it; the start's clean-up runs before any backup run
  exists), `apps/server/src/backup-supervisor.ts` (hands it to the sweep, whose `tick` takes the
  turn) and `apps/server/src/free-space-now.ts` (Liberar, inside `ifNoBackup`). Header comment:
  weaker than its name — it reads text, so a path built another way escapes it, and it never checks
  that a listed file takes the turn. Prove it by deletion: add a throwaway file naming
  `BACKUP_STAGING_DIR` under `apps/server/src/` → the guard FAILS naming it; remove it. Run
  `pnpm exec vitest run scripts/backup-staging-touchers.test.ts`.
- [ ] **Step 4: The CLAUDE.md §3 rule**, in the data section beside "One process owns a venue folder
  at a time", one to three lines (the round-1 review's M12):
  "**Anything that writes or deletes in `<state>/backup-staging` does it inside the staging turn**
  (`apps/server/src/backup-staging-turn.ts`), **except the start's clean-up (`freeSpaceAtStart`),
  which runs before the backup supervisor exists**: a backup run through `runBackup`, Liberar
  through `ifNoBackup`; a page's read takes none. Cost: deleting a dump a run reads frees nothing until the
  run closes it and can fail the run (A798-B slice 7 plan, M3). Guard:
  `scripts/backup-staging-touchers.test.ts`, weaker than its name — it reads text and never checks
  that a file takes the turn; the turn is in-process only."
  The receipt goes in conventions-data.md's paragraph from Step 1, which also names
  `apps/server/scripts/cloud-backup-fixture.ts`: a development fixture that calls `runOnce` outside
  any turn on its own scratch root (the round-3 check's I1), outside the guard's `apps/*/src` scan.
  Check before committing that the guard's allow-list is exactly the rule's: `start-space.ts` (the
  exception), `backup-supervisor.ts` (runs, through the sweep's `runBackup`) and `free-space-now.ts`
  (Liberar, through `ifNoBackup`).
- [ ] **Step 5: Check and commit.** `pnpm exec prettier --file-info docs/developers/conventions-data.md`
  prints `"ignored": true`; `pnpm exec prettier --check CLAUDE.md scripts/backup-staging-touchers.test.ts`
  exits 0. `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/backup-staging-touchers.test.ts`
  → PASS.
  ```bash
  git add docs/developers/conventions-data.md docs/developers/design-system.md CLAUDE.md scripts/backup-staging-touchers.test.ts
  git commit -s -m "Developer docs: the Box status read and Liberar on a full disk, the page's design, and the rule that backup staging is touched only inside its turn"
  ```

### Task 16a: LOOK in English

**Files:** a throwaway `apps/dashboard/src/zz-box-status.look.test.ts`, never committed; screenshots
to `~/waitron-campaign-b/a798-7-shots/`. A fix it leads to is committed with the file it touches.

- [ ] **Step 1: Write the throwaway look test**, shaped like
  `apps/dashboard/src/dashboard-app.search-modules.test.ts:140-160` and `:290-320` (`page.viewport`,
  `page.screenshot` to a gitignored `__screenshots__/a798-7/` path), taking the language as a
  parameter: `light`/`dark` × 1280/390, the whole `dashboard-app` as a manager opened at
  `/manage/box-status`, its `getBoxHealth` and `listAlerts` answering in turn: (a) a quiet box;
  (b) picture 4's box — 12 unsent, the bucket 47 min behind with its alert, the kitchen printer's
  alert, two readers, the clock compared 2 s apart with the sync check `unavailable` (as on every
  box, M8), the disk at 1.8 GB of 32 GB with the warning and 45 MB to free; (c) a full disk with the
  stop and a clock before 28-10-2024; (d) a read failure; (e) after a press, "Freed 45 MB.";
  (f) a read-only node (`canFree: false`) with 45 MB to free; (g) card payments off
  (`readers: null`). Compose each theme-and-width set into one contact sheet with
  `sharp`, and copy shots and sheets to `~/waitron-campaign-b/a798-7-shots/`.
- [ ] **Step 2: Run English and LOOK.** `pnpm --filter @waitron/dashboard exec vitest run src/zz-box-status.look.test.ts -t en`.
  Open the sheets beside `docs/backlog/mockups/a798-degraded-trading/4-box-status-page.png` and
  check: the item under Settings before Diagnostics, highlighted; one row per part, the dot, name, line
  and details aligned at 1280 and stacked readably at 390; the actions at the row's end at 1280 and
  below the words at 390, never overlapping; Liberar's quiet and blue states; the tones clear in both
  themes; the read-only sentence beside a quiet Liberar; no Card readers row in (g); the "other"
  line, the checks note and the fillers paragraph under the rows. Write what you
  saw, sheet by sheet, in the report.
- [ ] **Step 3: Fix and re-run** anything wrong, each fix with a test that would have caught it where
  one can. Leave the throwaway for 16b.

### Task 16b: LOOK in Spanish

- [ ] **Step 1: Run Spanish and LOOK** (`-t es`), as 16a, and that the longer Spanish words fit at
  1280 and wrap cleanly at 390 ("Lectores de tarjeta", "Liberar 45 MB", "Ir a Copias de seguridad",
  and the read-only sentence), and that the item sits under Ajustes.
- [ ] **Step 2: Fix and re-run** as 16a, then `-t en` once to see the fixes changed nothing there.
- [ ] **Step 3: Remove the throwaway**; `git status --short` shows no such file.

### Task 17: Backlog

**Files:** `docs/backlog.md` (A798-B, `:5539-5557`; `:5559-5563`; `:5570-5573`; `:5588-5590`),
`docs/backlog/box.md` (`:733-739`; the first-setup workspace entry after it)

- [ ] **Step 1: The A798-B entry.** Replace "slice 7 is next" with: slice 7 (the Box status page under
  Settings for people who manage the system, showing each part of the box with what to do, and
  Liberar, which frees only what the box can make again and works on a full disk) landed in
  #<this pull request>; slice 7b (Reintentar ahora, parked for the owner) and slice 8 are next.
- [ ] **Step 2: Delete** "The disk warning does not point at the Box status page yet" (Task 8 did it).
- [ ] **Step 3: Replace** "The Box status page's rows from a module are not in the staff-notice seat"
  (both files) with a 7b entry: "**Slice 7b: Reintentar ahora, and the Hacienda row's last accepted
  record.** The page's Hacienda row reads the staff notices and the bell (slice 7 decision 1); 7b
  adds the Veri\*Factu module's own route for Reintentar ahora — which changes when records reach
  AEAT, so it is parked for the owner — and, with it, the last accepted record's time. Left open by
  A798-B slice 7 (#…)."
- [ ] **Step 4: Narrow** "A failed staff-notice check is seen only in the log" to "…is seen in the log
  and as a note on the Box status page; the bell does not show it." (decision 18).
- [ ] **Step 5: Short open entries in A798-B's area,** each "Left open by A798-B slice 7 (#…)":
  - "**The card readers row does not say whether a reader is switched on.** It lists the readers set
    up and shows the bell's reader alerts; `reader.offline` is slice 10's."
  - "**Liberar cannot be pressed on a mirror or a fenced node.** The read-only gate refuses every
    POST there, so the page draws it quiet and says why; a mirror's disk can fill too."
  - "**On a box with card payments off, the card-reader battery check may raise
    `alert.source_unavailable` on every bell read.** `batteryAlertSource` is registered whatever the
    module (`apps/server/src/boot.ts:2179-2183`) and reads `card_readers`, which does not exist then
    (A798-B slice 7 plan, M9); the registry turns a failing source into that alert (design §5). Read,
    not run on a booted box."
  - "**The disk line's remainder is 'the rest of the disk', not 'outside Waitron'.** It includes the
    state folder's other files; measuring them separately would let the page name what is not
    Waitron's."
  - In `box.md`'s first-setup-workspace entry, one sentence: since slice 7, Liberar deletes a
    cut-off backup's leftovers in the running server's own state folder, which for a box whose first
    setup was retired into a workspace is that workspace's (M5) — check this against
    `config.stateDir` for that case before writing it, and leave it out if it does not hold.
- [ ] **Step 6: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`.
  ```bash
  git add docs/backlog.md docs/backlog/box.md
  git commit -s -m "Backlog: A798-B slice 7 adds the Box status page and Liberar; what it leaves open, and 7b"
  ```
  The pull request number is filled in once `/finish-branch` has opened it.

---

## Self-review against the spec

- §4.1 "the operator acts in the dashboard: the bell … points at a new Box status page": Task 8 (Go
  to), Tasks 11–12. The recovery page is untouched (§6 default 11).
- §4.3 "under Ajustes beside Diagnóstico, for people with `system.manage`": decision 16, Task 12
  (the English group label is "Settings").
  "Diagnóstico stays the log tail": not edited. "One row per part: Ventas, Hacienda, Copia en el
  bucket, Impresoras, Lectores de tarjeta, Reloj, Espacio en disco": Task 10. "a dot (green fine;
  amber needs attention and everything still works; red nothing can be saved)": decision 4,
  Departure 2. "a line of state, a line of detail and one action": Task 10's `line`, `details`,
  `screen`, and Liberar. "reads … plus the printer, reader and disk checks, and the module seat":
  Departure 1, decisions 1, 4, 13. "Its automatic reads are passive": decision 15, Task 11 case 10,
  Task 6 case 4. "Reintentar ahora": 7b (build plan decision 11). "Liberar deletes only what the box
  can make again … and says how much it can free before it does": decisions 6–8, Tasks 1, 2a, 2b and 11.
  "Below the rows the page names what really fills the disk and who can clear it": decision 12,
  Tasks 3 and 9 (`box_status.fillers`).
- §4.3 the bell's new alerts: `storage.*` existed (slice 5); this slice adds their Go to and the
  sentence slice 5 left out (decision 17).
- §4.4 bucket stream "The Box status row shows its lag and links to Copias de seguridad": Task 10.
  Outbox "the unsent count, the last accepted record and Reintentar ahora": the count here; the
  rest 7b (Departure 3). Printers, readers: decisions 4 and 13; Departures 4 and 5 (the readers row
  is left out with payments off).
- §4.6 item 6: every clause — crash reports older than a week, rotated logs except the newest,
  backup staging leftovers, the dump first, the figure first, no fold-back of the side file (nothing
  here calls `checkpointTruncate`), never a configured backup, rows or anything fiscal, the fillers
  line, Docker images left to slice 10 — decisions 6–8 and 12; Task 2b's refusing cases.
- §5: decision 1 decides the backlog's open question; no seat change.
- §6 default 2 (no terminal): every action is on the page. Default 15: decision 16.
- §7: no table; nothing new is stored.
- §8 item 7's risks: auth (Review focus 3, Task 6); fiscal invariants (nudging the drain) are 7b's;
  concurrency added (the corrected row).
- §11 item 5 (the cut-off backup's plaintext dump): Liberar deletes it when no run holds staging
  (decision 7), beside A978's start-time clean-up.
