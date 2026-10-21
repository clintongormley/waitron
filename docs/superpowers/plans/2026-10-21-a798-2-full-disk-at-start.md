# A798-B slice 2 — a full disk at start

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour this slice removes"), and only in a separate commit
> whose message begins `Changed test checks (A798 slice 2):` and lists each `file:line` with its
> before and after. This plan expects NO existing assertion to change: every test it touches gains
> cases. Any assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `f17a43ad5` on 2026-10-21 (the worktree
> `waitron-feat-a798-2-full-disk-at-start`, branch `feat/a798-2-full-disk-at-start`). Every claim
> about how the engine, the filesystem or the start behaves cites a probe in "Measured for this
> plan", run that day from scratch files under `~/waitron-campaign-b/a798-2-plan-probe/`, outside
> the repository.

**Goal:** a box whose disk is full never restarts forever and never shows the wrong page at start.
Its first step deletes what it can make again; if the start still cannot write its failure count,
it serves the recovery page at once under `storage.disk_full`, saying the box already deleted what
it could; and a database that cannot be opened because the disk is full is named as a full disk.

**Architecture:** a new module, `apps/server/src/start-space.ts`, measures free space in the state
and venue folders and, below a floor (256 MiB unless a test sets another), deletes three kinds of
leftovers that need no database. `runEntry` (`apps/server/src/node-entry.ts`) calls it first, before
first-setup resolution opens anything. After resolution, still below the floor, `runEntry` writes
`recovery.json` back unchanged through `updateRecoveryState` — the count's own write path — and if
that write fails in the way a full disk makes it fail, serves `recoveryApp` at once with an
in-memory state coded `storage.disk_full`; any other failure fails the start as today. A start that
fails later is classified `storage.disk_full`, instead of `provisioning.database_unreachable` or
`unknown`, when its failure is the engine's "cannot open" or I/O family or the operating system's
`ENOSPC` AND free space is below 16 MiB — a second, much lower threshold than the clean-up floor:
every full-disk failure measured happened with at most 48 KiB free on HFS+, tmpfs and ext4, and
with about 1.2 MB reported free on APFS. The
recovery page gains the design's sentence and a free-space line. A real-full-disk test file runs
on a small filesystem: on macOS it makes its own with `hdiutil`; in CI on Linux a workflow step
mounts one and names it in `WAITRON_FULL_DISK_DIR`.

**Tech stack:** TypeScript, Node v26.11.1, `node:sqlite`, Hono, Vitest 4.1.11, GitHub Actions.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §2.6 ("At start, the recovery page is never reached"), §4.6 item 6, §4.7, §8 slice 2.
Build plan: [2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md)
Part 1 (slice 2: FULL review path, no migration, lands itself, depends on slice 1, landed as #1936)
and Part 2 decisions 1 and 12. Backlog: A798-B (`docs/backlog.md`).

**Lane note:** another lane's open branch (`feat/a739-payment-window`) changes
`apps/server/src/boot.ts`. **This slice does not touch `boot.ts`.** Every change is in
`node-entry.ts`, new modules beside it, `recovery-surface.ts`, `boot-failure.ts`, one line of
`backup-supervisor.ts`, `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs`, test files and
docs.

---

## Measured for this plan

Platforms: macOS 26.6.2 (build 25G83) on this machine, Node v26.11.1; Linux probes in Docker 29.3.0
(Docker Desktop's machine, kernel `6.12.76-linuxkit`), image `node:26.11.1-slim`, run as its
unprivileged `node` user inside a `--privileged` container that mounted the filesystem. The `.mjs`
probes ran as `node <script> <mounted dir> …`; the Vitest probes as
`env -u AI_AGENT -u CLAUDECODE NO_COLOR=1 apps/server/node_modules/.bin/vitest run --root <probe dir> <name>`
from the worktree, importing the worktree's own `apps/server/src` and `packages/*/src`, so they ran
slice 1's landed store. Before each probe, the failing case is stated; it is repeated beside each
result.

- **F1 — a small real filesystem, as an ordinary user.** `hdiutil create -size 16m -fs HFS+
  -volname <n> -layout NONE <file>.dmg -quiet` then `hdiutil attach <file>.dmg -mountpoint <dir>
  -nobrowse -noautoopen -quiet`, as uid 503 with no `sudo`: both exited 0; the same with
  `-fs APFS`. A 64 MiB HFS+ image took 1.3 s to create and attach. `statfs` on the empty images:
  HFS+ `bavail 3996, frsize 4096` (`freeBytes` 16,367,616); APFS `bavail 4002`. Filling a file in
  64 KiB, then 512-byte, then 1-byte writes until the system refused printed `ENOSPC` on every
  filesystem tried, and then `freeBytes`: **HFS+ 0; APFS 1,228,800** (it refused writes while
  reporting about 1.2 MB free); **Linux tmpfs 0; Linux ext4 0**. Linux: `mount -t tmpfs -o size=16m`,
  and a 16 MiB ext4 image (`mkfs.ext4 -F -q -m 0`, made in `debian:12` because `node:26.11.1-slim`
  has no `mkfs.ext4`) mounted with `mount -o loop`; the ext4 one reported `bsize 1024`,
  `bavail 13732` below `bfree 14059` even with `-m 0`. Failing case: a mount refused without root
  on macOS, or `freeBytes` above zero on a disk that refuses writes — the second is APFS's case.
- **F2 — the start's failure count on a full disk** (`engine-start.mjs`; `st/start.test.ts`, P1,
  through the real `updateRecoveryState` with the real `withRecoveryLock` and
  `writeRecoveryState`). A state folder holding `recovery.lock` and `recovery.json` from an earlier
  start, then the disk filled. Failing case for "the count cannot be written on a full disk": the
  count `ok`.
  - HFS+: `count: unable to open database file | errcode=14`, failing at `begin immediate` on the
    existing `recovery.lock` (`engine-start.mjs`: `open recovery.lock (exists): ok`,
    `begin immediate on recovery.lock: errcode=14`); writing a new 150-byte `recovery.json.tmp`:
    `ENOSPC`.
  - APFS: the lock `ok`, the new tmp file `ok`, then `rename onto recovery.json: ENOSPC`, leaving a
    148-byte `recovery.json.tmp`. In a fresh state folder with no `recovery.json` (P1b) the count
    printed `ok 1`: renaming onto a name that does not exist yet succeeded.
  - Linux tmpfs and ext4 (engine only): `begin immediate on recovery.lock: errcode=13 | database or
    disk is full`; the tmp write `ENOSPC … write`.
  - Overwriting `recovery.json` in place succeeded on all four; nothing in the product writes it
    that way (`writeFileAtomic` stages a new file and renames it,
    `packages/provisioning/src/fs-atomic.ts:16-37`).
- **F3 — today's start on a full disk** (`st/today.test.ts`; the real `runEntry` with the real
  `readRecoveryState`, `writeRecoveryState`, `loadBoxEnv` and recovery lock, HFS+, a
  `recovery.json` holding `FRESH`). Four starts in a row each printed `rejected: unable to open
  database file | errcode=14 | serveRecovery calls 0`, and `recovery.json` still read
  `{"failures":0,…}`. Failing case for design §2.6's claim: a start serving the page, or the count
  rising. It is the measured restart loop: `bootThisProcess` exits 1 on a rejection
  (`node-entry.ts:525-528`) and the services are `restart: unless-stopped` (`deploy/README.md:166`).
- **F4 — a box whose first setup finished, on a full disk** (`fs/claimed.test.ts`, HFS+ 64 MiB,
  `firstFiscalFixture` made on the image with `TMPDIR` pointing at it, its state moved to `complete`
  as `first-setup-resolution.boot.test.ts:339-346` does, and a WAL `venue.db` holding one `tenants`
  row and one `locations` row, closed cleanly). `resolveFirstSetupEntry` returned
  **`resolution`** on the full disk, with the venue folder still holding only
  `["first-setup-claim.json","venue.db"]`; after deleting the filler, `normal`, and its `run` body
  was reached. Control in the other direction (the first run of the same probe): when an
  inspection had run once with room, leaving its `-wal` and `-shm` files, the same full disk
  returned `normal`. So the first-setup inspection's read-only open (`first-setup-resolution-inspection.ts:87`)
  fails on a full disk when the database was closed cleanly, its catch returns
  `database: "unknown"` (`:111-122`), and a finished setup with a database that is not
  `"occupied"` is unresolved (`first-setup-entry.ts:28-41`): **such a box serves the first-setup
  resolution app, not the recovery page, and never reaches its count.** Every box set up through
  first setup is in this case while its venue folder keeps `first-setup-claim.json`; a grep for a
  removal of that file (`first-setup-claim.json|markerPath` in `packages/provisioning/src` and
  `apps/server/src`) found none (read, not run). Even when the inspection passes, `admission.run`
  takes the venue lock before `runAdmittedEntry` writes the count (`first-setup-entry.ts:94-107`),
  and F5 shows that lock failing on a full disk.
- **F5 — the venue lock and the database on a full disk** (`engine-start.mjs`; `st/start.test.ts`
  P2–P4). Failing case for "a full disk shows as one error code": the same code everywhere.
  - HFS+: `begin immediate` on the existing `venue.lock` → `errcode 14`; `openVenueDatabase` →
    `errcode 14` (it takes the lock first, `packages/store/src/index.ts:216-217`); a plain read of
    `venue.db` → 14. `classifyBootFailure` → `provisioning.database_unreachable`.
  - APFS: the lock `ok`; `openVenueDatabase` and a read-only read → `errcode 4874 | disk I/O
    error` (SQLite's `SQLITE_IOERR_SHMSIZE`, primary code 10), leaving `venue.db-shm` and
    `venue.db-wal` behind. `classifyBootFailure` → `unknown`.
  - Linux tmpfs and ext4 (engine only): the lock → `errcode 13` (slice 1's `diskFullIn` already
    names it); a read of `venue.db` → `errcode 4874`.
- **F6 — a disk with a few KiB left, engine only, nothing opening the database first**
  (`engine-leave.mjs`: fill, then shorten the filler by the given bytes). With 8 KiB free, on HFS+,
  Linux tmpfs and Linux ext4 alike: the venue lock `ok`, opening and reading `venue.db` →
  `errcode 4874`, and free space then 0. With 32 KiB free: both `ok`. Re-run for the review at 16
  and 24 KiB: tmpfs still `4874` at both; ext4 (1 KiB blocks) `ok` at both. Failing case for "the
  open, not the lock, fails first with a little room": the lock line not `ok`. **This is not the
  start's order**: F11 and F14 are.
- **F7 — deleting leftovers** (`st/start.test.ts` P5, HFS+ and APFS). With four 512 KiB rotated
  logs (`waitron.log.2` to `.5`) and a 2 MiB file in `backup-staging` deleted after the fill, free
  space went from 0 to 4,194,304 (HFS+; APFS 1,212,416 to 5,406,720), the count printed `ok`,
  `openVenueDatabase` printed `ok`, and `recovery.lock` and `venue.lock` were still present.
  Failing case: the count or the open still refused.
- **F8 — a commit on a real full disk.** Failing case for "the disk can fill at commit": the
  statement refused, or the commit `ok`.
  - Through slice 1's landed store (`st/commit.test.ts`, `openVenueStore` on the image, a body
    inserting a 64 KiB row under `withWriteLock`, defaults for every pragma): on HFS+ with 16 KiB
    left and with 0, and on APFS: `statement: ok | transaction rejected: AppError:
    storage.disk_full | diskFullIn: true`, rows `["committed before"]`; after deleting the
    filler, the next transaction `ok`. On HFS+ with 0 left, a small transaction before freeing was
    also refused `storage.disk_full`; with 16 KiB left it committed.
  - Linux tmpfs and ext4, engine only (slice 1's `disk-commit.mjs`, copied): `statement: ok (dirty
    pages held in cache)`, `commit: errcode 13 | database or disk is full`,
    `isTransaction after commit attempt: false`, `rows on reopen: ["committed before"]`. Control,
    no filler: `commit: ok`, both rows on reopen.
  - Slice 1's plan found no way to reach "at commit" with a page limit (its E3, E3b); a real disk
    reaches it with an ordinary insert.
- **F9 — the recovery page on a full disk** (`st/serve.test.ts`, HFS+). `ensureBoxSecrets` on the
  image, then the disk filled, then the real `serveRecovery` on port 0: it logged
  `recovery.listening {"tls":true}`, and an HTTPS `GET /` trusting the box's own CA answered `200`
  with the full-disk title. Failing case: the listener refused, or served the connection bootstrap
  instead of the page.
- **F10 — sudo on the CI runners.** In-repo receipt, not a run: `test-server-stream` already runs
  `sudo ip link set dev lo mtu 1500` (`.github/workflows/ci.yml:1036-1037`), and
  `scripts/ci-workflow.test.mjs:2054-2061` requires it.
- **F11 — the order a finished-setup box meets on a nearly full disk** (the plan review's
  `window.mjs`, copied and re-run here: fill, give back the given bytes, then the inspection's
  read-only open, then the count's lock, tmp write and rename, then the venue lock, in that order).
  Failing case for "a failure at start only happens with almost nothing free": a failure with more
  than a few tens of KiB free.
  - HFS+: with 0 free, all three fail with 14; with 4, 8 and 16 KiB the inspection fails with 4874
    (leaving `venue.db-shm` and `venue.db-wal`), and then the count and the venue lock fail with
    14; with 32 KiB the inspection is `ok` and the count and lock fail with 14; with 64 and 128 KiB
    all `ok`.
  - Linux tmpfs: the same, with 13 where HFS+ printed 14. Linux ext4: failures up to 8 KiB, all
    `ok` from 16 KiB.
  - So once the inspection's open has run, the venue lock fails too: F6's "lock ok" does not
    happen in that order.
- **F12 — the count's write path refused for reasons other than space** (`perm.mjs`, macOS and
  Linux tmpfs alike, with GBs free). A state folder this user cannot write, already holding
  `recovery.lock`: `begin immediate` → `errcode 1544 | attempt to write a readonly database`, the
  tmp write → `EACCES`. The same folder with no `recovery.lock`: opening it → `errcode 14`. A
  missing state folder: opening `recovery.lock` → `errcode 14`. The recovery lock's own wait
  rejects with the engine's busy error (`recovery-lock.ts:30-36`; SQLite's `SQLITE_BUSY` is 5,
  `packages/store/src/venue-lock.ts:12-13`; read, not run). Failing case for "only a full disk
  makes the count fail with 14": no 14 here — and there is one, so errcode 14 alone cannot name a
  full disk.
- **F13 — a running server's heartbeat on a full disk** (`st/holder.test.ts`, HFS+, the real
  `writeVenueHolder`). After the fill: `heartbeat: ENOSPC … open '…/venue.holder.json.partial'`,
  and the holder file still read the earlier `heartbeatAt`. Failing case for "a live server's
  heartbeat survives a full disk": `ok`. A start reading that file more than
  `VENUE_HOLDER_STALE_MS` (30 s, `packages/store/src/venue-holder.ts:36`) later sees it stale.
- **F14 — today's start, unclaimed, with the venue folder nearly full and the state folder
  elsewhere** (`st/open8k.test.ts`, HFS+, the real `runEntry` and real venue lock; the ahead check
  replaced by `openVenueDatabase`). With 8 KiB left: rejected `ENOSPC … venue.holder.json.partial`
  (the lock's holder file), free afterwards 4,096. With 16, 24, 32 and 48 KiB left: rejected
  `errcode 4874 | disk I/O error`, free afterwards 8,192 (40,960 for 48 KiB). Every one recorded
  `lastErrorCode: "unknown"`. Failing case for "today names these a full disk": `storage.disk_full`.
  - Contrary, 2026-10-21, macOS 26.6.2 on HFS+ (Task 5b's real-disk file, its 8 KiB row through
    the branch's `runEntry`, read by a temporary log): the start failed with errcode 14 (`unable to
    open database file`), not `ENOSPC` on the holder file; the 16 KiB row failed with 4874 as above.
    So no real-disk row drives the `ENOSPC` branch; it rests on the unit tests.

**Not measured, and how the plan makes CI measure it:**

- No probe ran the repository's own TypeScript on Linux. The Linux results (F1, F2, F5, F6, F8, F11, F12)
  are engine-and-filesystem probes in `.mjs`, on Docker Desktop's kernel, not on a GitHub runner
  and not on a box. Task 6 runs Task 5's real-disk file in CI on a runner's tmpfs; with `CI=true`
  a missing filesystem FAILS it rather than skipping it. Its first CI run is the Linux measurement;
  the pull request records which cases ran there.
- A tmpfs mount on a GitHub runner, the runner's kernel, a Docker volume on a box's ext4 disk, and
  the image's own user (uid 10001, `deploy/Dockerfile:183`, `:278`) were not tried.
- The connection-bootstrap path (`needsConnectionBootstrap`, `node-entry.ts:300-303`) on a full
  disk was not run; F9 ran `serveRecovery` with freshly minted certificates only.
- A real box's Docker images, Litestream folder and backup folder filling the disk (design §2.6)
  were not reproduced; every fill here was one filler file.

---

## Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan. Each has the DEFAULT to build.

1. **Where "the very first step" goes.** Design §4.7 item 1: before the count and before anything
   opens the database. The first thing that opens the database is first-setup resolution's
   read-only inspection (F4; `node-entry.ts:278-283`), which runs before the count. DEFAULT: the
   deletion step runs in `runEntry` straight after the argument refusal (`:273-276`; a mistyped
   command is not a start and deletes nothing) and before `resolveFirstSetupEntry`, measuring the
   folders the process was given (`deps.stateDir`, `deps.venueDir`).
2. **How "the count still cannot be written" is decided** (design §4.7 item 2). F4 shows that a
   box whose first setup finished never reaches its count on a full disk: it serves the first-setup
   resolution app, or fails taking the venue lock in `admission.run`. The design did not know this.
   DEFAULT: after resolution and the connection-bootstrap check, and only when free space is still
   below the floor, `runEntry` writes `recovery.json` back unchanged through `updateRecoveryState`
   (the count's own lock, read and staged write). If that write fails AND decision 6's test says the
   failure is a full disk (re-reading free space after the failure), it serves the recovery page at
   once, whatever resolution decided; any other failure — a permission refusal (F12: 1544 or
   `EACCES`), the lock's busy wait running out (errcode 5), a 14 with 16 MiB or more free — fails the
   start as today; if the write succeeds, the start goes on as today. The count in
   `runAdmittedEntry` is unchanged: if space runs out between the two writes, that start fails as
   today and the next one serves the page. Alternative not built: catching the count's own failure
   in `runAdmittedEntry`, which a finished-setup box never reaches (F4).
3. **The floor is 256 MiB and injectable.** A 32 MiB test image can never have 256 MiB free.
   DEFAULT: `START_FREE_SPACE_FLOOR = 256 * 1024 * 1024` in `start-space.ts`, and an optional
   `freeSpaceFloor` on `EntryDeps`; unit tests pin the default at its boundary, the real-disk file
   sets 8 MiB.
4. **What "free space" means.** DEFAULT: the lower of `freeBytes(stateDir)` and
   `freeBytes(venueDir)` (the count lives in one, the database in the other; on a box both are on
   the `state` volume, `deploy/compose.yml:42-45`). A folder whose filesystem cannot report
   (`freeBytes` → `null`) is left out; when neither reports, nothing is deleted and nothing is
   decided — the backup sweep's precedent (`backup-sweep.ts:102-111`). Below the floor means
   strictly less than it.
5. **Exactly what the start deletes** (design §4.6 item 6, "those that need no database"):
   - in `<logDir>/crash-reports`, files named `holder-frozen-*.json` whose modification time is
     more than 7 days before now (the watchdog's names, `packages/store/src/venue-liveness.ts:184`;
     the folder, `packages/db/src/venue-holder-identity.ts:48-50`);
   - in `<logDir>`, `waitron.log.<N>` for every whole number `N` of 2 or more (the rotation keeps
     `.1` to `.maxFiles`, `apps/server/src/log-file.ts:42-53`; `WAITRON_LOG_MAX_FILES` can raise
     the count, `config.ts:534`), keeping `waitron.log` and `waitron.log.1`;
   - every entry of `<stateDir>/backup-staging` (the dump and the `backup-encrypt-*` folders,
     `backup-sweep.ts:149-170`), **unless the venue folder's holder file shows a fresh holder**
     (`readVenueHolder` and `isVenueHolderFresh`, as `node-entry.ts:473-474` reads them): a start
     refused beside a running server must not delete that server's backup in progress. **The guard
     is weaker than it looks on a full disk**: a running server's heartbeat is a new file and a
     rename (`packages/store/src/venue-holder.ts:90-104`), refused on a full disk (F13), so 30 s
     after the disk fills its holder reads stale and a second start beside it deletes its staging.
     Accepted, because the cost is that one backup run failing — its dump or ciphertext is gone,
     the run's `finally` deletes what is left (`backup-sweep.ts:215-218`), the database and every
     archive already at a destination are untouched — and a run that is still writing a
     database-sized dump to a disk too full for the small heartbeat file is failing already (read,
     not run). Between full and 256 MiB free, where the heartbeat still writes, the guard holds.
     All of this assumes the two folders share one disk, the box's default (`venue` inside the
     `state` volume, `deploy/compose.yml:42-45`; `node-entry.ts:497`). When `WAITRON_VENUE_DIR`
     puts them on different disks (read, not run): a full STATE disk with room on the venue disk
     leaves the heartbeat writing, so the guard holds and the staging is kept; a full VENUE disk
     with room on the state disk makes the start delete (it acts on the lower of the two, decision
     4) while the heartbeat goes stale, so a running server's backup whose own disk had room loses
     its staging and that run fails — the same cost as above.
   Nothing else: never `venue.lock`, `recovery.lock`, `recovery.json`, the databases,
   `restore-staging` (`restore.ts:85`; a staged restore runs after this step and reads it), a
   configured backup folder, or any file whose name is not listed above. `<logDir>` is
   `deps.logDir ?? join(stateDir, "logs")`, as `runAdmittedEntry` resolves it (`node-entry.ts:340`).
   A deletion that fails is logged by its `errno` alone and the rest go on: a start must never fail
   because tidying did. The design's Liberar deletes the dump first; at start everything listed is
   deleted in one pass, so the order is not specified.
6. **What counts as a failure caused by a full disk** (design §4.7 item 4, and decision 2). The
   design measured code 14 at open; F5, F11 and F14 show 14 on macOS, 4874 (primary code 10) on
   APFS and Linux and at the start's own open, `ENOSPC` from the holder file, and 13 on Linux,
   which slice 1 already names. F12 shows 14 also comes from a missing or unwritable folder with
   plenty of room. So the clean-up floor (256 MiB) cannot be the test. DEFAULT: one function,
   `fullDiskFailure(error, freeBytes)` in `boot-failure.ts`, true when `diskFullIn(error)` (slice
   1: 13 or the domain code, whatever the free space), or when free space is below
   **`FULL_DISK_BYTES = 16 MiB`** and the cause chain carries an engine result code whose primary
   code (`errcode & 0xff`) is 10 or 14, or an `ENOSPC` error. 16 MiB because every full-disk
   failure measured happened with at most 48 KiB free on HFS+, tmpfs and ext4 (F6, F11, F14) and
   with about 1.2 MB reported free on APFS (F1, F2, F5): it is more than 300 times the first and
   more than 13 times the second, and 1/16 of the clean-up floor. The start's
   classifier, `classifyStartFailure(error, freeBytes)`, returns `storage.disk_full` when
   `classifyBootFailure` gives `provisioning.database_unreachable` or `unknown` and
   `fullDiskFailure` holds; a known `AppError` code keeps its own code. **Accepted risk, named:** a
   missing or unmounted venue folder, an unwritable folder (both 14, F12), or a failing disk
   (the I/O family) on a disk that ALSO has under 16 MiB free is reported as a full disk. Freeing
   space then does not fix it, and the next start reports it by its own code once free space is
   above 16 MiB. `ENOSPC` is NOT added to `diskFullIn` in `@waitron/shared`: that would change
   every route's answer, which is not this slice's.
7. **A start whose failure is classified `storage.disk_full` deletes the leftovers even above the
   floor**, before it records the failure. The page's new sentence ("the box has deleted what it
   could make again") is then true however the page was reached, including a disk that filled
   during a migration after the first step measured room.
8. **The free-space line.** DEFAULT: every recovery page shows it in the installer section, below
   the status line, read again on every `GET /` from the lower of the two folders: `Free space on
   the box's disk: 1.2 MB.` / `Espacio libre en el disco del equipo: 1,2 MB.`, in decimal
   megabytes (`bytes / 1_000_000`) with at most one decimal, formatted for the page's language
   with `Intl.NumberFormat`; when unknown, `unknown` / `desconocido`. `/recovery-api/status` does
   not gain it. Anyone on the venue's network can now read the box's free space; the page already
   shows them the log tail.
9. **The English of the design's new sentence.** DEFAULT: "The box has deleted what it could make
   again, and that was not enough." placed first in the action, as the Spanish is.
10. **The state the page served at once shows.** Nothing is written. DEFAULT: the recorded state
    with `lastErrorCode: "storage.disk_full"`, `lastFailureAt` now and `level: "recovery"`;
    `failures`, `clears`, `refused` and the trigger names as recorded. Its status line would read
    "Level: recovery. Failed 0 times." (`recovery-surface.ts:157`) on a box that never counted, so
    `recoveryApp` takes `uncounted: true` from this path and shows instead, in `PAGE_TEXT`:
    `en-GB` `Level: ${level}. This start was not counted: the disk is full.`; `es-ES`
    `Nivel: ${level}. Este arranque no se ha contado: el disco está lleno.` A box the append-only
    check stopped whose disk then filled keeps its "Stopped while running." status, its "Waitron
    stopped" heading and its trigger lines, above the full-disk title; that mix is accepted.
11. **The real-disk test runs on HFS+ on macOS and on tmpfs in CI.** HFS+, not APFS: APFS reported
    1.2 MB free while refusing writes and let a fresh `recovery.json` through (F1, F2), while HFS+
    reported 0 like both Linux filesystems. tmpfs, not a loop-mounted ext4: F2, F5 and F8 printed
    the same results on both, and tmpfs needs no `mkfs.ext4` and no loop device. They differ in how
    little room is enough: ext4 (1 KiB blocks) opened the database with 16 KiB free where tmpfs
    refused it at 24 KiB (F6, F11). So a case that leaves a few KiB is written for tmpfs and HFS+,
    the two filesystems the tests run on, and says so. DEFAULT: `apps/server/src/testing/full-disk.ts` uses `WAITRON_FULL_DISK_DIR` when set,
    and refuses it when its filesystem holds more than 64 MiB (so a mistake cannot fill a real
    disk); otherwise on macOS it creates and attaches a 32 MiB HFS+ image under a fresh `mkdtemp`
    folder; otherwise it reports itself unavailable. Unavailable: the file's cases are SKIPPED with
    the reason printed, unless `CI=true` or `WAITRON_REQUIRE_FULL_DISK=1`, where they FAIL — the
    stream loop test's precedent (`apps/server/src/stream-loop.e2e.test.ts:1-6`, `:33`, `:93-103`),
    and its trap: a local Linux run without the folder reports a skip that reads as a pass.
12. **Where the real-disk file runs in CI.** DEFAULT: in `test-server-stream`, which already runs
    `sudo` (F10) and feeds the server's coverage merge: one new step mounts a 32 MiB tmpfs under
    `$RUNNER_TEMP` before the tests, the run step names the new file and sets
    `WAITRON_FULL_DISK_DIR`, and every `test-server` shard excludes it. Renamed for what it now
    runs: the run step becomes "Run the tests that need Litestream, versitygw or a small
    filesystem".
13. **The at-commit case slice 1 deferred** (its decision 1) goes in the same real-disk file,
    through `openVenueStore` from `@waitron/store` (a dependency of `@waitron/server`,
    `apps/server/package.json:70`).
14. **`backup-staging` gets one name.** The folder is a literal at `backup-supervisor.ts:248`.
    DEFAULT: `start-space.ts` exports `BACKUP_STAGING_DIR = "backup-staging"` and
    `backup-supervisor.ts` imports it — a one-line change outside `boot.ts`.
15. **A box whose first setup was retired into a workspace** (`binding` not null; only after a
    first-setup resolution chose a new workspace, `first-setup-resolution.boot.test.ts:42-87`): the
    first step reads the folders the process was given, so a `backup-staging` inside the
    workspace's state folder is not deleted. DEFAULT: accepted for this slice; a backlog line
    (Task 7). The count check of decision 2 uses the resolved roots (`admission.roots`), so it
    holds for such a box too.
16. **The cut-off backup's plaintext dump** (backlog, "A backup run that is cut off leaves a
    plaintext copy…"). The start now deletes it, but only below the floor, as the design scopes it.
    DEFAULT: keep the design's scope; the backlog entry says so. Owner question below.

**Question for the owner (the default is built if unanswered):** when a backup run is cut off, it
leaves behind a plaintext copy of the whole venue database (readable by the box's own user only,
`backup-sweep.ts:157`) and its encrypted copy. Should every start delete those leftovers, whatever
the free space? A start beside a running server would still keep them while that server's
heartbeat is fresh (decision 5). **DEFAULT: follow the design — the start deletes them only when
the disk has under 256 MiB free** (design §4.7 item 1).

---

## Behaviour this slice removes

- A start on a full disk rejecting before its count, so the box restarts forever and the page
  never appears (F3).
- A box whose first setup finished serving the first-setup resolution app on a full disk (F4) —
  only where the count check of decision 2 fails.
- A database the engine cannot open on a full disk recorded as
  `provisioning.database_unreachable` (errcode 14, F5) or `unknown` (errcode 4874 or `ENOSPC`,
  F5, F14), when under 16 MiB is free.
- The full-disk page's action without the sentence slice 1 left out (build plan decision 12).
- (Added 2026-10-21, after the pre-merge review.) A start sent to first-setup resolution never
  touched the recovery count before; below 256 MiB free it now writes the count back first
  (`countWritable`, `apps/server/src/node-entry.ts:353`, before the resolution branch at `:373`).
  That write always writes (`updateRecoveryState`, `apps/server/src/recovery-state.ts:231`), and a
  missing `recovery.json` reads as `FRESH` (`:87`), so it creates `recovery.json`, and the lock it
  takes creates `recovery.lock` (`apps/server/src/recovery-lock.ts:26`). A failure of that write
  that is not a full disk is rethrown (`node-entry.ts:410`), so the start fails where it used to
  serve the resolution screen. Run in a scratch Vitest probe on a claimed folder with no first-setup
  record and 10 bytes free (floor 1000): with the real reader and writer the start served
  resolution and left `recovery.json` and `recovery.lock` in the state folder; with a writer
  refusing `EACCES` it rejected with that error, served nothing, and left `recovery.lock`; with
  room, it served resolution and the state folder stayed empty.

`/usr/bin/grep -rnE "4874|errcode: 14|ENOSPC|serveRecovery\).not" apps/server/src --include='*.test.ts'`
at `f17a43ad5` found no assertion that runs through `runEntry` with a full disk: its hits are
`archive-download`, `restore-command`, `box-secrets`, `backup-sweep*`, `restore-file-placement`
and `local-fs-backend` cases, which do not call `runEntry`, and three `node-entry.test.ts` cases
(`:176`, `:207`, `:247`: arguments refused, a live holder) whose folders (`/state`, `/venue`) do not
exist, so `freeBytes` reads `null` there and nothing in this slice acts. The existing
`"names a full disk in both languages"` case (`recovery-surface.test.ts:451-469`) checks the old
action with `toContain`, and the new action contains it whole, so it keeps passing unchanged.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work in this worktree only. **Do not edit
  `apps/server/src/boot.ts`.**
- No migration. Nothing under `packages/fiscal*`, `packages/core`, `packages/store` or
  `packages/shared` changes.
- `storage.disk_full` is slice 1's code (`packages/shared/src/errors.ts`); no new error code. New
  log events are plain names (`storage.start_space_low`, `storage.start_cleanup_failed`,
  `recovery.serving_disk_full`); none is an `AppError` code.
- General code is English only (CLAUDE.md §3). The page's Spanish goes only in
  `recovery-surface.ts`'s existing tables (`PAGE_TEXT`, `:129-182`; `OPERATOR_TEXT`, `:234-423`),
  which already hold both languages, as slice 1 did.
- The unauthenticated page's title and action stay fixed strings chosen by the code; everything else
  on it that comes from outside stays HTML-escaped; the log tail stays behind `redactSecrets`
  (`recovery-surface.ts:219-232`, `:464-510`). The page never suggests wiping (`:230-232`).
- **Never unlink `venue.lock` or `recovery.lock`; every change to `recovery.json` goes through
  `updateRecoveryState`** (CLAUDE.md §3). The real-disk test checks both locks keep their inode.
- `apps/server` holds 98/98/98/95 coverage. `src/testing/**` is outside coverage
  (`apps/server/vitest.config.ts`), so the real-disk HARNESS may live there, but every product
  line is covered by the unit tests of Tasks 1 to 4, never by the real-disk file alone (that file
  is skipped on Linux machines without the folder). No exclude, no ignore comment.
- Comments only for an invariant or a non-obvious why; no history. Fix every doc comment the slice
  makes false in the same task — in particular `runEntry`'s ordering list (`node-entry.ts:240-267`)
  and `persistState`'s "a box whose count cannot be written can never escalate" (`:138-143`).
- Focused tests while implementing: `pnpm --filter @waitron/server exec vitest run <files>`. Read
  the `Tests` count every time; a run with no count proved nothing (CLAUDE.md §4). Under this
  agent Vitest hides a passing test's console output; unset `AI_AGENT` and `CLAUDECODE` to see it.
- `TESTCONTAINERS_RYUK_DISABLED` is not needed: nothing here starts a container.

## Review focus

1. **The order of the start.** The deletion runs before anything reads `recovery.json`, before
   first-setup resolution, and never for a refused argument; the count check runs only below the
   floor, after resolution, before the resolution app or the page is served (Tasks 1, 4a).
2. **The page at once is served only when the write fails like a full disk.** Below the floor, a
   write failure that `fullDiskFailure` does not name (a permission refusal, the lock's busy wait,
   a 14 with 16 MiB or more free) still fails the start as today; a full disk whose write succeeds
   still boots (Task 4a, the controls).
3. **Auth: no new action reaches the network.** The page served at once is the same `recoveryApp`
   (`recovery-surface.ts:517-547`: `GET /`, `GET /recovery-api/status`, `POST
   /recovery-api/retry`) behind the same `serveRecovery` (`recovery-listener.ts:107-182`: the app
   is mounted only on healthy box TLS, `:152`). Its Retry is today's: `persistState(cleared)` and
   exit 0 (`node-entry.ts:355-358`), and the restart it causes is the one the box performed by
   itself in a loop before this slice (F3). A press can make the next start delete leftovers, which
   that start deletes anyway below the floor. On a finished-setup box the page REPLACES the
   first-setup resolution app (`first-setup-entry.ts:116-177`, which mounts that flow's actions,
   `:163-174`; whether they authenticate was not read) — a smaller surface, not a larger one. New
   information on the page: the free space (decision 8).
4. **The classifier only replaces two codes, and only under 16 MiB free.**
   `provisioning.database_unreachable` and `unknown` become `storage.disk_full` below
   `FULL_DISK_BYTES`; at or above it — including between 16 and 256 MiB, where the clean-up runs —
   with `null` free space, or for any `AppError` code, nothing changes (Task 3). A missing folder
   with 100 MiB free stays `provisioning.database_unreachable`.
5. **Concurrency.** A second start refused beside a running server: it may delete rotated logs while
   the server's sink rotates (a missing number is a gap the rotation tolerates,
   `log-file.ts:45-51`), keeps `backup-staging` while the holder is fresh — weaker than it looks on
   a full disk, where the heartbeat cannot be written (F13; decision 5 states the cost) — and its
   write-back runs under the recovery lock. The real-disk file checks that `venue.lock` and `recovery.lock` keep
   their inodes (Task 5a).
6. **The real disk.** The harness cannot fill a big filesystem; a skip is visible and CI fails
   rather than skips; the at-commit case reaches the commit (statement ok, commit refused).

---

### Task 1: Measuring free space and deleting what a start can make again

**Files:**
- Create: `apps/server/src/start-space.ts`
- Create: `apps/server/src/start-space.test.ts`
- Modify: `apps/server/src/backup-supervisor.ts:248` (use `BACKUP_STAGING_DIR`)

**Interfaces:**
- Consumes: `freeBytes`, `Statfs` (`apps/server/src/free-bytes.ts:3-15`); `LOG_FILE_NAME`,
  `isVenueHolderFresh`, `type VenueHolder` (`@waitron/db`); `Logger` (`./logger.js`); `errnoOf`
  (`./errno.js`).
- Produces:
  ```ts
  export const START_FREE_SPACE_FLOOR = 256 * 1024 * 1024;
  export const CRASH_REPORT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  export const BACKUP_STAGING_DIR = "backup-staging";
  /** The lowest free space among `dirs` that can report; null when none can. */
  export function lowestFreeBytes(dirs: readonly string[], statfs?: Statfs): Promise<number | null>;
  export interface StartSpaceDeps {
    stateDir: string; venueDir: string; logDir: string;
    floor: number;
    /** Delete whatever the free space: a start whose failure was a full disk. */
    force?: boolean;
    now: () => Date;
    statfs?: Statfs;
    readVenueHolder: (venueDir: string) => VenueHolder | null;
    log: Logger;
  }
  export function freeSpaceAtStart(deps: StartSpaceDeps): Promise<{ freeBytes: number | null; belowFloor: boolean }>;
  ```
  `freeSpaceAtStart` reads `lowestFreeBytes([stateDir, venueDir])`; returns at once, deleting
  nothing, when that is `null` or not below `floor` and `force` is not set; otherwise deletes the
  list of decision 5, reads free space again, logs `("warn", "storage.start_space_low",
  { freeBytesBefore, freeBytesAfter, deleted, floor })` (`deleted` a count of entries), and returns
  `{ freeBytes: after, belowFloor: after !== null && after < floor }`. Each failed deletion logs
  `("warn", "storage.start_cleanup_failed", { errno: errnoOf(error) ?? null })` and the rest go on;
  a folder that does not exist is not a failure. It never throws.

- [ ] **Step 1: Write the failing tests** in `start-space.test.ts`, each on its own
  `mkdtemp(join(tmpdir(), "wt-start-space-"))` folder with `state/`, `state/venue/` and
  `state/logs/` (removed in `afterEach`), a `statfs` stub `(dir) => ({ bavail, frsize: 1 })`
  answering per folder, `now` fixed at `2026-10-21T12:00:00Z`, and a `log` spy:
  - `"deletes rotated logs but the newest, week-old crash reports and backup staging below the floor"`:
    create `logs/waitron.log`, `.1`, `.2`, `.5`, `.12`, `logs/waitron.logs.2` (not a rotation),
    `logs/crash-reports/holder-frozen-a.json` with mtime 8 days ago (`utimes`),
    `holder-frozen-b.json` 6 days ago, `logs/crash-reports/notes.txt` 30 days ago,
    `state/backup-staging/waitron-20261020T000000Z.dump`, `state/backup-staging/backup-encrypt-x/artifact`;
    also `state/recovery.json`, `state/recovery.lock`, `state/venue/venue.lock`,
    `state/venue/venue.db`, `state/restore-staging/x`. Free space 100 < floor 1000. Expect gone:
    `.2`, `.5`, `.12`, `holder-frozen-a.json`, both staging entries; kept: everything else
    listed (assert each by `existsSync`); `backup-staging` itself may stay, empty. The result
    `{ freeBytes: <second reading>, belowFloor: … }` from a stub whose second answer differs from
    its first, and the log line's four fields.
  - `"deletes nothing when free space is exactly the floor"` (1000 at 1000) and
    `"deletes when it is one byte under"` (999): the boundary, both ways.
  - `"decides by the folder with less room"`: state 5000, venue 10 → deletes; and
    `"leaves out a folder that cannot report"`: state throws, venue 10 → deletes; both throw →
    deletes nothing, returns `{ freeBytes: null, belowFloor: false }`.
  - `"keeps backup staging while a live process holds the venue folder"`: `readVenueHolder`
    returns a holder whose `heartbeatAt` is 5 s before `now` → staging kept, logs still deleted;
    with a heartbeat 60 s old → staging deleted.
  - `"deletes when told to, whatever the free space"`: free 5000 ≥ 1000 with `force: true` →
    deletes.
  - `"goes on past a deletion that fails, and names only its errno"`: make
    `logs/waitron.log.3` a non-empty directory (so a non-recursive `rm` refuses it; use whichever
    removal call the implementation uses, and make that one fail); `.4` still deleted; one
    `storage.start_cleanup_failed` line whose fields are exactly `{ errno: <a code> }`.
  - `"does nothing to folders that do not exist"`: no `logs`, no `backup-staging` → resolves, no
    `start_cleanup_failed` line.
  - `"lowestFreeBytes multiplies blocks by fragment size"`: stub `{ bavail: 3, frsize: 4096 }` →
    `12288`.
  - `"uses 256 MiB as the default floor"`: `expect(START_FREE_SPACE_FLOOR).toBe(268_435_456)`
    and `CRASH_REPORT_KEEP_MS` `604_800_000` — Task 4a proves `runEntry` uses them.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/start-space.test.ts`
  Expected: FAIL at import — `start-space.ts` does not exist.

- [ ] **Step 3: Implement** `start-space.ts` as above (`readdir`, `stat`, `rm` from
  `node:fs/promises`; rotated logs matched by `/^waitron\.log\.(\d+)$/` built from
  `LOG_FILE_NAME`, `N >= 2`; crash reports by `/^holder-frozen-.*\.json$/`), and in
  `backup-supervisor.ts:248` use `join(this.#deps.stateDir, BACKUP_STAGING_DIR)`.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/server exec vitest run src/start-space.test.ts src/backup-supervisor.test.ts`
  Expected: PASS, with `Tests` counts. Then `pnpm --filter @waitron/server typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/start-space.ts apps/server/src/start-space.test.ts apps/server/src/backup-supervisor.ts
  git commit -s -m "A start below 256 MiB free deletes the leftovers it can make again"
  ```

### Task 2: The recovery page says the box already deleted what it could, and shows free space

**Files:**
- Modify: `apps/server/src/recovery-surface.ts` (`RecoveryDeps` `:14-19`, `PAGE_TEXT` `:129-182`,
  `OPERATOR_TEXT["storage.disk_full"]` `:274-285`, `renderPage` `:464-510`, `recoveryApp`
  `:517-527`)
- Test: `apps/server/src/recovery-surface.test.ts`

**Interfaces:**
- Produces: `RecoveryDeps.freeSpace?: () => Promise<number | null>`. When given, `GET /` calls it
  once per request and renders `<p>${escapeHtml(page.freeSpace(amount))}</p>` directly after the
  status line; a rejection renders the unknown wording. When absent, no line (so every existing
  page test is unchanged).
- Produces: `PAGE_TEXT[locale].freeSpace: (amount: string) => string` and `unknownSpace: string`:
  `en-GB` `Free space on the box's disk: ${amount}.` and `unknown`; `es-ES`
  `Espacio libre en el disco del equipo: ${amount}.` and `desconocido`; the amount is
  `new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000) + " MB"`
  (checked with Node v26.11.1: 1,228,800 bytes → `1.2` / `1,2`; 0 and 10 → `0`; 300,000,000 → `300`).
- Produces: `RecoveryDeps.uncounted?: true` (decision 10) and `PAGE_TEXT[locale].uncountedStatus:
  (level: string) => string`: `en-GB` `Level: ${level}. This start was not counted: the disk is full.`;
  `es-ES` `Nivel: ${level}. Este arranque no se ha contado: el disco está lleno.` When `uncounted`
  and not `refused`, it replaces `status(level, failures)`; a `refused` state keeps
  `stoppedStatus`.
- Produces, `OPERATOR_TEXT["storage.disk_full"]` actions exactly:
  - `en-GB`: `The box has deleted what it could make again, and that was not enough. Ask whoever installed this box to free some space (old backups, earlier versions of Waitron) or fit a bigger disk. Your sales are not touched.`
  - `es-ES`: `El equipo ha quitado lo que podía volver a crear, y no ha bastado. Pide a quien instaló este equipo que libere espacio (copias antiguas, versiones anteriores de Waitron) o ponga un disco mayor. Tus ventas no se tocan.`
    Changed from the design's «ha borrado» to «ha quitado»: the page's never-wipe check (NEVER_WIPE_ES, recovery-surface.test.ts:182) refuses any word starting «borra», and the check stays as it is.
  Titles unchanged. The retry button stays `Reintentar un arranque normal` / `Retry a normal boot`.

- [ ] **Step 1: Write the failing tests**, written as literals passed through `escapeHtml`, as the
  file's fixed-string cases do (`:450-469`):
  - `"says the box has already deleted what it could, in both languages"`: `pageFor("storage.disk_full")`
    contains the English sentence `The box has deleted what it could make again, and that was not enough.`;
    with `SPANISH`, `El equipo ha quitado lo que podía volver a crear, y no ha bastado.`; and
    neither page contains `borra`/`wipe`/`reset` advice beyond that sentence — check instead that
    the action still names whoever installed the box (`Pide a quien instaló este equipo`).
  - `"shows the free space on the box's disk in each language"`: build `recoveryApp` directly
    (as `pageResponse` does, `:186-205`) with `freeSpace: async () => 1_228_800`: English contains
    `<p>Free space on the box&#39;s disk: 1.2 MB.</p>`, Spanish
    `<p>Espacio libre en el disco del equipo: 1,2 MB.</p>`; with `0` → `0 MB`; with
    `300_000_000` → `300 MB`; with `null` → `unknown` / `desconocido`.
  - `"reads free space again on every request"`: a `vi.fn` answering `5_000_000` then `9_000_000`;
    two `GET /` show `5 MB` then `9 MB`; called twice.
  - `"still serves the page when reading free space fails"`: `freeSpace` rejects → `200`, the
    unknown wording.
  - `"shows no free-space line when none is given"`: `pageFor("storage.disk_full")` contains
    neither `Free space` nor `Espacio libre` (the control that the line comes from `freeSpace`).
  - `"keeps /recovery-api/status to its named fields"`: with `freeSpace` given and a state carrying
    `holderKind: "server"` (Hono's `c.json` drops a key whose value is `undefined`, so without a
    holder kind the JSON has five keys — the plan review ran it), the status JSON's keys are exactly
    `failures, holderKind, lastErrorCode, lastFailureAt, level, refused` (sorted compare).
  - `"says a start that could not be counted was not counted, in both languages"`: `recoveryApp`
    with `uncounted: true`, state `{ ...FRESH, level: "recovery", lastErrorCode: "storage.disk_full" }`:
    English contains `<p>Level: recovery. This start was not counted: the disk is full.</p>` and not
    `Failed 0 times`; Spanish `<p>Nivel: recovery. Este arranque no se ha contado: el disco está lleno.</p>`.
    With `refused: true` as well, the page shows `Stopped while running.` instead.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts`
  Expected: the sentence cases FAIL (the action lacks it); the free-space and uncounted cases FAIL
  (no line; `Failed 0 times`); the no-line and status cases PASS already (controls). Typecheck fails on `freeSpace` until Step 3.

- [ ] **Step 3: Implement** the two deps fields, the three `PAGE_TEXT` entries, the formatter, the line in
  `renderPage` (pass the resolved amount in; `renderPage` stays synchronous), and the new actions.

- [ ] **Step 4: Run them and watch them pass**

  Run the Step 2 command. Expected: PASS with a `Tests` count; the existing
  `"names a full disk in both languages"` case passes unchanged.

- [ ] **Step 5: Look at the page** (CLAUDE.md §4: a page asserted as a string has nothing checking
  that it renders). Write the rendered full-disk page, English and Spanish, with
  `freeSpace: async () => 1_228_800`, to two files in a `mktemp -d` folder outside the repository,
  and screenshot each with the workspace's Playwright Chromium at 390 × 844 and at 1280 × 800
  (`pnpm --filter @waitron/server exec playwright screenshot --viewport-size=390,844 file://<path> <png>`).
  Look at all four: the sentence reads first in the action, the free-space line sits under the
  status line, nothing overflows. The page has no theme to switch. Name the screenshots in the
  commit message.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts
  git commit -s -m "The recovery page says a full box already deleted what it could, and shows its free space"
  ```

### Task 3: Telling a failure caused by a full disk from any other

**Files:**
- Modify: `apps/server/src/boot-failure.ts`
- Test: `apps/server/src/boot-failure.test.ts`

**Interfaces:**
- Consumes: `diskFullIn`, `sqliteFailureOf`, `MAX_CAUSE_DEPTH` (`@waitron/shared`); Task 1's
  `lowestFreeBytes`; the `Statfs` type from `apps/server/src/free-bytes.ts:3`.
- Produces (decision 6):
  ```ts
  /** Below this, an engine "cannot open" or I/O failure, or ENOSPC, is taken for a full disk (plan F1, F11, F14). */
  export const FULL_DISK_BYTES = 16 * 1024 * 1024;
  /** The engine's "cannot open" (14) and I/O (10) families, which a full disk also raises. */
  export const FULL_DISK_PRIMARY_CODES: readonly number[] = [10, 14];
  export function fullDiskFailure(error: unknown, freeBytes: number | null): boolean;
  export function classifyStartFailure(error: unknown, freeBytes: number | null): string;
  /** `classifyStartFailure` with free space read now from `dirs`; for callers that have only the error. */
  export function startFailureCode(error: unknown, dirs: readonly string[], statfs?: Statfs): Promise<string>;
  ```
  `fullDiskFailure` is true when `diskFullIn(error)`; otherwise when `freeBytes !== null`,
  `freeBytes < FULL_DISK_BYTES`, and either `sqliteFailureOf(error)` has `(errcode & 0xff)` in
  `FULL_DISK_PRIMARY_CODES` or some layer of the cause chain (to `MAX_CAUSE_DEPTH`, stopping at a
  self-cause) has `code === "ENOSPC"`. `classifyStartFailure` returns `classifyBootFailure(error)`,
  except `"storage.disk_full"` when that is `"provisioning.database_unreachable"` or `"unknown"` and
  `fullDiskFailure(error, freeBytes)`. `startFailureCode` is
  `classifyStartFailure(error, await lowestFreeBytes(dirs, statfs))`.

- [ ] **Step 1: Write the failing tests** in `boot-failure.test.ts`:
  - `describe("fullDiskFailure")`:
    - `"takes the engine's own full-disk code whatever the free space"`: errcode 13, free
      `1_000_000_000` → `true`; `new AppError("storage.disk_full", {})`, free `null` → `true`.
    - `"takes 14, the I/O family and ENOSPC only under 16 MiB"`: a REAL errcode-14 error from the
      file's `realSqliteError` (`:14-25`, the `missing/venue.db` open of `:28-31`) at free
      `16_777_215` → `true` and at `16_777_216` → `false`; the 4874 shape
      `Object.assign(new Error("disk I/O error"), { errcode: 4874, code: "ERR_SQLITE_ERROR" })`
      (F5, F14 printed it) under a wrapper at `0` → `true`, at `100 * 1024 * 1024` → `false`;
      `Object.assign(new Error("ENOSPC: no space left on device, open"), { code: "ENOSPC" })` two
      layers down at `0` → `true`, at `null` → `false`.
    - `"does not take a permission refusal or a busy lock for a full disk"` (F12): errcode 1544
      (`attempt to write a readonly database`) at `0` → `false`; `{ code: "EACCES" }` at `0` →
      `false`; errcode 5 at `0` → `false`; errcode 26 at `0` → `false`.
    - `"stops at a self-referencing cause"`: an error whose `cause` is itself, no code, free `0` →
      `false`, and returns.
  - `describe("classifyStartFailure")`:
    - `"names a missing folder by its own code when there is room"` (the review's case): the real
      errcode-14 error with free `100 * 1024 * 1024` → `"provisioning.database_unreachable"`; with
      `null` → the same.
    - `"names a database refused on a nearly full disk a full disk"`: the same error at `4096` →
      `"storage.disk_full"` (the accepted risk of decision 6, pinned so it is visible); the 4874
      shape at `8192` → `"storage.disk_full"`; at `100 * 1024 * 1024` → `"unknown"`.
    - `"leaves every other failure as it was"`: errcode 1 `no such table: x` (real, `:35-39`) at
      `0` → `"provisioning.schema_mismatch"`; `new AppError("migrations.apply_failed", …)` whose
      cause is the 4874 shape, at `0` → `"migrations.apply_failed"`; a plain `Error("boom")` at `0`
      → `"unknown"`.
    - `"keeps a full disk the engine already named"`: errcode 13 at `1_000_000_000` →
      `"storage.disk_full"` (slice 1's path).
  - `"startFailureCode reads the free space of the lowest folder"`: two `mkdtemp` folders and a
    stub `statfs` answering `100 MiB` for one and `4096` for the other, the 4874 shape →
    `"storage.disk_full"`; both `100 MiB` → `"unknown"`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/boot-failure.test.ts`
  Expected: FAIL — the three functions are not exported; the file's existing cases pass.

- [ ] **Step 3: Implement** the exports beside `classifyBootFailure`, without changing it.

- [ ] **Step 4: Run them and watch them pass** — the Step 2 command; PASS with a `Tests` count.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/boot-failure.ts apps/server/src/boot-failure.test.ts
  git commit -s -m "Tell a start failure caused by a full disk from a missing folder or a refused permission"
  ```

### Task 4a: The start deletes first, and serves the page at once when the count cannot be written

**Files:**
- Modify: `apps/server/src/node-entry.ts` (`EntryDeps` `:62-113`, `persistState`'s comment
  `:138-143`, `runEntry`'s ordering comment `:240-267`, `runEntry` `:268-334`)
- Modify: `apps/server/src/recovery-state.ts` (one builder)
- Create: `apps/server/src/node-entry.full-disk.test.ts`
- Modify: `apps/server/src/node-entry.test.ts` (one case added to the describe at `:1229`)
- Modify: `apps/server/test/first-fiscal.ts:46-47` (an optional parent folder, default `tmpdir()`)

**Interfaces:**
- Consumes: Task 1's `freeSpaceAtStart`, `lowestFreeBytes`, `START_FREE_SPACE_FLOOR`; Task 2's
  `freeSpace` and `uncounted`; Task 3's `fullDiskFailure`.
- Produces, on `EntryDeps`: `freeSpaceFloor?: number` (default `START_FREE_SPACE_FLOOR`) and
  `statfs?: Statfs` (default the real one).
- Produces, in `recovery-state.ts`:
  `export function fullDiskAtStart(current: RecoveryState, at: Date): RecoveryState` →
  `{ ...withFailureCode(current, "storage.disk_full", at), level: "recovery" }` (decision 10).
- Produces, `runEntry`'s new order:
  1. the argument refusal (unchanged);
  2. `const space = await freeSpaceAtStart({ stateDir: deps.stateDir, venueDir: deps.venueDir, logDir: deps.logDir ?? join(deps.stateDir, "logs"), floor, now, statfs: deps.statfs, readVenueHolder: deps.readVenueHolder ?? readVenueHolder, log: deps.log })`;
  3. `resolveFirstSetupEntry`, `loadBoxEnv`, `transport`, the bootstrap check (unchanged, `:278-303`);
  4. **new:** a write-back check (below), where `rooted` is `deps`
     with `stateDir`, `venueDir` and `baseEnv` taken from `admission.roots` as `selected` is built
     (`:320-332`) →
     serve `recoveryApp({ state: fullDiskAtStart(await deps.readRecoveryState(stateDir), now()), uncounted: true, logDir, onRetry: async () => { await persistState(…, cleared); exit(0); }, freeSpace: () => lowestFreeBytes([stateDir, venueDir], deps.statfs) })`
     through `deps.serveRecovery(app, transport)`, log `("warn", "recovery.serving_disk_full", { freeBytes: check.freeBytes })`, and return.
     `countWritable(rooted)` returns `check: { written: true } | { written: false; freeBytes: number | null }`.
     It is `changeState(deps, (current) => current)` (`:123-136`) in a `try`: `{ written: true }`
     on success. On failure it logs `("warn", "recovery.state_write_failed", { errorCode: codeOf(error), errno: errnoOf(error) ?? null })`,
     reads `freeBytes = await lowestFreeBytes([stateDir, venueDir], deps.statfs)` again, and
     returns `{ written: false, freeBytes }` only when `fullDiskFailure(error, freeBytes)`
     (decision 6); otherwise it rethrows the error, so the start fails as it does today when its
     count cannot be written. The condition reads `if (space.belowFloor && !(check = await countWritable(rooted)).written)`.
     `stateDir`, `venueDir` and `logDir` here are `admission.roots`' (decision 15);
  5. the resolution branch and `runAdmittedEntry` (unchanged here; Task 4b changes its catch).
  The recovery-level page (`:350-370`) also passes `freeSpace` (decision 8).

- [ ] **Step 1: Write the failing tests** in `node-entry.full-disk.test.ts`. Copy the `deps()`
  helper of `node-entry.test.ts:40-62` (it is not exported), adding a `statfs` stub
  `(dir) => ({ bavail: free(dir), frsize: 1 })` and `freeSpaceFloor: 1000`. Real folders from
  `mkdtemp` where files are checked.
  - `"deletes the leftovers before it reads the count"`: `logs/waitron.log.2` exists; free `10`;
    `readRecoveryState` is a `vi.fn` that records `existsSync(<that file>)` on each call. Expect its
    first recorded value `false`, the start to boot (`startServer` called once), and the count
    written as `failures: 1`.
  - `"deletes nothing for a refused argument"`: `args: ["x"]`, free `10` → rejects
    `server.entry_arguments_refused`, `waitron.log.2` still there, `statfs` never called.
  - `"uses 256 MiB when no floor is given"`: no `freeSpaceFloor`; free `268_435_455` → the file
    deleted; free `268_435_456` → kept.
  - `"serves the recovery page at once when the count cannot be written on a full disk"`: free `10`;
    `withRecoveryLock` rejects with `Object.assign(new Error("database or disk is full"), { errcode: 13 })`.
    Expect: resolves; `serveRecovery` called once; `startServer` and `writeRecoveryState` never;
    `exit` not called; the served app's `GET /` contains `escapeHtml("The box's disk is full, so Waitron cannot save anything.")`,
    the new English sentence, and `Free space on the box&#39;s disk: 0 MB.` (free `10` bytes rounds
    to 0); `GET /recovery-api/status` JSON has `lastErrorCode: "storage.disk_full"` and
    `level: "recovery"`.
  - `"logs the free space it read after the write failed"`: the `statfs` stub answers `10` until
    the failing lock stub has run (the stub sets a flag, then rejects), and `20` after; the
    `recovery.serving_disk_full` line carries `freeBytes: 20`, not the first step's `10`.
  - `"serves it too when the lock cannot be opened on a nearly full disk"`: free `10`, the lock
    rejects with a real-shaped errcode 14 (`unable to open database file`, F2's HFS+ line) → the page
    is served; and the uncounted status line `Level: recovery. This start was not counted: the disk is full.`
    is on it, with no `Failed 0 times`.
  - `"still fails the start as today when the count cannot be written and there is room"`: free
    `5000` (above the injected floor, so no write-back), the same rejecting lock → `runEntry`
    rejects with that error; `serveRecovery` not called.
  - `"fails as today when the write fails with 14 between 16 and 256 MiB free"` (decision 6's
    other threshold): no `freeSpaceFloor` (256 MiB default), free `100 * 1024 * 1024`, the lock
    rejects with errcode 14 → `runEntry` rejects with that error; `serveRecovery` not called; the
    write-back was attempted (the lock stub was called).
  - `"fails as today when the count is refused for permission or a busy lock, even on a nearly full disk"`
    (F12): free `10`, in turn: the lock rejects `Object.assign(new Error("attempt to write a readonly database"), { errcode: 1544 })`;
    the lock rejects with errcode 5; `writeRecoveryState` rejects `Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })`.
    Each: `runEntry` rejects with that error and `serveRecovery` is not called.
  - `"boots on a nearly full disk whose count can still be written"`: free `10`, writes succeed →
    `startServer` called; `writeRecoveryState` called with the state it read first (the write-back,
    `toEqual(FRESH)`), then with `failures: 1`.
  - `"writes nothing back when there is room"`: free `5000` → `writeRecoveryState` called once
    before the boot (the count).
  - `"serves the full-disk page, not first-setup resolution, to a box whose first setup finished"`:
    a `firstFiscalFixture()` moved to `complete` (as `first-setup-resolution.boot.test.ts:339-346`)
    with NO `venue.db`, which resolution reads as unresolved (`:335-365` of that file shows it
    serving resolution). `stateDir`/`venueDir` the fixture's; free `10`; failing lock. Expect the
    served app's `GET /` to contain the full-disk title and `GET /setup-api/status` → `404`.
    Control in the same case: the same fixture with writes succeeding → the served app answers
    `GET /setup-api/status` `200` (today's resolution app). Dispose the fixture in `finally`.
  - `"the page's Retry clears the count and exits, and exits even when the clear cannot be written"`:
    from the at-once page, `POST /recovery-api/retry` → `exit(0)`; with every write failing, a
    `recovery.state_write_failed` line and still `exit(0)`.
  - `"shows free space on the page a box at the recovery level serves"`: a recorded state of three
    failures, free `2_000_000` (above the floor of 1000) → the page contains `2 MB`.
  In `node-entry.test.ts`, in `describe("every change to recovery.json happens inside the recovery lock")`
  (`:1229`), add `"the start's write-back on a nearly full disk"`: `lockedVolume(FRESH)` plus
  `statfs: async () => ({ bavail: 0, frsize: 4096 })` → `writeRecoveryState` called 3 times
  (write-back, count, classified failure when `startServer` rejects), `outside` `[]`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/node-entry.full-disk.test.ts src/node-entry.test.ts`
  Expected: the deletion cases FAIL (the file is still there; `statfs` is not a dependency yet);
  the two at-once cases FAIL by REJECTING with the lock's error and `serveRecovery` uncalled
  (F3's shape); the finished-setup case FAILS with the resolution app (`/setup-api/status` 200);
  the "room", "between 16 and 256 MiB", permission and "writes nothing back" controls PASS already
  (today every count failure rejects). Every existing `node-entry.test.ts`
  case passes.

- [ ] **Step 3: Implement** the order above, `fullDiskAtStart`, the `first-fiscal.ts` parameter,
  and the two comments: `runEntry`'s list gains "6. Below the floor, the start deletes what it can
  make again before first-setup resolution, whose inspection opens the database" and "7. Still below
  it, the start writes the count back unchanged before resolution's app or the page is served: a
  finished setup's inspection fails on a full disk and would serve resolution (plan F4), and its
  admission takes the venue lock before the count"; `persistState`'s last sentence names the full
  disk as the case `runEntry` checks first.

- [ ] **Step 4: Run them and watch them pass** — the Step 2 command, then
  `pnpm --filter @waitron/server exec vitest run src/recovery-race.test.ts src/first-setup-resolution.boot.test.ts src/first-setup-entry.test.ts`
  (they call `runEntry` or the fixture). PASS, with `Tests` counts; typecheck exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/node-entry.ts apps/server/src/recovery-state.ts apps/server/src/node-entry.full-disk.test.ts apps/server/src/node-entry.test.ts apps/server/test/first-fiscal.ts
  git commit -s -m "A start on a full disk deletes what it can, and serves the recovery page at once when it cannot count itself"
  ```

### Task 4b: A failed start on a full disk records storage.disk_full and deletes first

**Files:**
- Modify: `apps/server/src/node-entry.ts` (`runAdmittedEntry`'s catch, `:437-451`)
- Test: `apps/server/src/node-entry.full-disk.test.ts`

**Interfaces:**
- Consumes: Task 3's `startFailureCode`; Task 1's `freeSpaceAtStart` (`force: true`).
- Produces: in the catch, `const code = await startFailureCode(error, [deps.stateDir, deps.venueDir], deps.statfs)`
  in place of `classifyBootFailure(error)` (`:441`); `deps` there is `runAdmittedEntry`'s, so the
  folders are the resolved ones (decision 15). When `code === "storage.disk_full"`,
  `await freeSpaceAtStart({ …, force: true })` before the state is persisted (decision 7).
  `failureDetail`, the page log line and the installer's channel are unchanged and still come
  first.
- Produces: the catch keeps the code it recorded beside the error it rethrows, in a module-level
  `WeakMap<object, string>` (not a property on the error: the error is the caller's object, and a
  thrown value need not be an object), read through
  `export function recordedStartFailureCode(error: unknown): string | undefined`.
- Produces: `bootThisProcess`'s `.catch` (`:525-528`) becomes `async` and logs
  `recordedStartFailureCode(error) ?? (await startFailureCode(error, [stateDir, venueDir]))` in
  place of `classifyBootFailure(error)`. So for a failed attempt the container's output names the
  code `recovery.json` got, without reading free space a second time — after decision 7's deletion
  a second reading can be above 16 MiB and would name a 4874 failure `unknown` (the claim check of
  `8609c30d2` found it). For a failure outside an attempt (before the count), nothing was
  recorded, and `startFailureCode` reads the folders the process was given. That block is the
  process wiring under `v8 ignore` (`:487-490`); the two functions it calls are tested here and in
  Task 3.

- [ ] **Step 1: Write the failing tests**, in the new file, `describe("a start that fails on a full disk")`:
  - `"records storage.disk_full for a database the engine cannot open below the floor"`:
    `startServer` rejects with the 4874 shape of Task 3; free `10`; a real `recoveryVolume`-style
    store (copy `node-entry.test.ts:79-91`) → rejects with that error; the last persisted state's
    `lastErrorCode` is `"storage.disk_full"`, `failures` 1; the `server.boot_failed` line in the page
    log carries `errorCode: "storage.disk_full"`.
  - `"keeps database_unreachable when there is room"`: the same with a real errcode-14 error and
    free `100 * 1024 * 1024` (above `FULL_DISK_BYTES`) → `"provisioning.database_unreachable"`.
  - `"deletes the leftovers when the failure was a full disk, even with room"`: `startServer`
    rejects `Object.assign(new Error("database or disk is full"), { errcode: 13 })`; free
    `100 * 1024 * 1024`;
    `logs/waitron.log.2` deleted, and deleted before the failure was persisted (record
    `existsSync` inside `writeRecoveryState`'s second call: `false`).
  - `"deletes nothing for any other failure"`: `startServer` rejects
    `AppError("migrations.set_missing", …)` with free `100 * 1024 * 1024` → `waitron.log.2` still
    there.
  - `"hands on the code it recorded, even when deleting freed more than 16 MiB"`: `startServer`
    rejects with the 4874 shape; a 20 MiB `logs/waitron.log.2`; the `statfs` stub answers `10`
    while that file exists and `100 * 1024 * 1024` once it is gone. Catch the rejection: the last
    persisted `lastErrorCode` is `"storage.disk_full"`, and `recordedStartFailureCode(error)`
    equals it. The control that shows why: `await startFailureCode(error, [stateDir, venueDir], statfs)`
    at that point returns `"unknown"`. And `recordedStartFailureCode` of an error `runEntry` never
    recorded (a refused argument) is `undefined`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server exec vitest run src/node-entry.full-disk.test.ts`
  Expected: the first case FAILS with `lastErrorCode` `"unknown"`; the deletion case FAILS (file
  still there); the hand-on case FAILS (`recordedStartFailureCode` is not exported); the two
  controls PASS.

- [ ] **Step 3: Implement** the catch change.

- [ ] **Step 4: Run them and watch them pass** — the Step 2 command plus `src/node-entry.test.ts`;
  PASS with `Tests` counts.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/node-entry.ts apps/server/src/node-entry.full-disk.test.ts
  git commit -s -m "A start that fails on a full disk records storage.disk_full, after deleting what it can"
  ```

### Task 5a: The real-disk harness, and a start on a real full disk

**Files:**
- Create: `apps/server/src/testing/full-disk.ts`
- Create: `apps/server/src/start-full-disk.e2e.test.ts`

**Interfaces:**
- Produces, in `full-disk.ts`:
  ```ts
  export const REQUIRE_FULL_DISK = process.env.CI === "true" || process.env.WAITRON_REQUIRE_FULL_DISK === "1";
  export interface SmallDisk {
    /** A fresh folder on the small filesystem, for one case. */
    folder(name: string): string;
    /** Writes a filler until the system refuses (64 KiB, then 512 B, then 1 B writes), then gives `leave` bytes back. */
    fill(leave?: number): void;
    unfill(): void;
    free(): number;
    close(): void;
  }
  export function openSmallDisk(): { ok: true; disk: SmallDisk } | { ok: false; reason: string };
  ```
  `WAITRON_FULL_DISK_DIR` set: use a `mkdtemp` folder inside it, after checking that
  `statfs` `blocks * frsize` is at most 64 MiB (else `{ ok: false, reason: "… holds N bytes; the full-disk tests fill only a filesystem of 64 MiB or less" }`).
  Unset on `darwin`: `hdiutil create -size 32m -fs HFS+ -volname wt-full-disk -layout NONE <mkdtemp>/disk.dmg -quiet`
  and `hdiutil attach … -mountpoint <mkdtemp>/mnt -nobrowse -noautoopen -quiet` (F1), each
  `execFileSync` with a 60 s `timeout`; `close` runs `hdiutil detach <mnt> -force -quiet` and
  removes the folder. Otherwise `{ ok: false, reason: "no small filesystem: set WAITRON_FULL_DISK_DIR to one of 64 MiB or less" }`.
  `fill` throws if the last refusal was not `ENOSPC`, so a fill that stopped for another reason
  fails loudly.

- [ ] **Step 1: Write the tests.** The file opens the disk in `beforeAll`; when unavailable it
  `console.warn`s `start-full-disk tests SKIPPED: <reason>` and each case calls
  `ctx.skip(reason)`, or throws `full-disk tests cannot run: <reason>` when `REQUIRE_FULL_DISK`
  (the shape of `stream-loop.e2e.test.ts:58-61`, `:93-103`). `afterEach` unfills; `afterAll`
  closes. Every case passes `freeSpaceFloor: 8 * 1024 * 1024`, real `readRecoveryState`,
  `writeRecoveryState` and recovery lock, real `loadBoxEnv`, `baseEnv: { WAITRON_HTTP_LANDING_PORT: "0" }`,
  `assertNotAhead: (venueDir) => openVenueDatabase(venueDir).then((s) => s.close())` (it opens the
  database as the real one does, `node-entry.ts:232`), and a `startServer` that opens the venue
  database, inserts a row into a table it creates, and closes it (proof the database is usable).
  - `"a start whose leftovers free enough counts itself and boots"`: in `folder("leftovers")`, a
    `recovery.json` from an earlier start (`writeRecoveryState(FRESH)` then one real `runEntry`
    boot with room), `logs/waitron.log.1` to `.5` of 512 KiB each, an 8-day-old
    `logs/crash-reports/holder-frozen-old.json`, a 2 MiB `backup-staging/waitron-20261020T000000Z.dump`; record the inodes
    of `recovery.lock` and `venue/venue.lock`; `fill()`. Assert `free()` < 65 536 first (the fill
    worked). Run `runEntry`: resolves, `startServer` called once, `serveRecovery` never; the
    leftovers gone and `waitron.log.1` kept; `recovery.json` `failures: 2` (the setup boot counted
    one, and its stayed-up clear is a stub that never fires); both lock files present with the same
    inode.
  - `"a start with nothing to delete serves the recovery page at once"`: `folder("nothing")` with
    an earlier start's files and `ensureBoxSecrets({ stateDir, hostnames: ["waitron.local", "localhost"], now })`
    (as `node-entry.test.ts:2018-2027`), then `fill()`. Record `recovery.json`'s bytes. Run
    `runEntry` with `baseEnv.WAITRON_HTTP_PORT` from `freePorts(1)` and `deps.serveRecovery`
    wrapping the REAL `serveRecovery` to keep the server it returns. Expect: resolves;
    `startServer` never called; an HTTPS `GET /` trusting the box's CA (as `pageStatusOver`,
    `node-entry.test.ts:2038-2045`) answers `200` with the full-disk title, the new sentence and
    `Free space on the box&#39;s disk: 0 MB.`; `recovery.json`'s bytes unchanged; both lock inodes
    unchanged. Close the server in `finally`.
  - `"…and the same folder boots once there is room"` (control): `unfill()`, `runEntry` again →
    `startServer` called.

- [ ] **Step 2: Watch them fail by deletion.** On the macOS machine the plan was measured on:
  `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts` with Tasks 1–4b
  in → PASS, `Tests 3 passed`. Then delete Task 4a's at-once branch in `runEntry` (step 4 of its
  order) and run again: the page case must FAIL by rejecting with `unable to open database file`
  (errcode 14, F2 and F3); restore the file with `git checkout -- apps/server/src/node-entry.ts`
  and record both runs in the commit message. On Linux without `WAITRON_FULL_DISK_DIR`, the run
  reports the three cases skipped with the reason — say so if that is where you ran it, and do not
  call it a pass.

- [ ] **Step 3: No production change is expected.** A case failing after Tasks 1–4b is a defect in
  them: stop, find which step answered what (log the raw errors and `free()` at each step), and fix
  it in its task with a unit test there first.

- [ ] **Step 4: Run it once more and watch it pass** — the Step 2 command, restored.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/testing/full-disk.ts apps/server/src/start-full-disk.e2e.test.ts
  git commit -s -m "Prove a start on a real full disk deletes what it can, or serves the recovery page at once"
  ```

### Task 5b: A finished setup, a refused open and a commit, on a real full disk

**Files:**
- Modify: `apps/server/src/start-full-disk.e2e.test.ts`

- [ ] **Step 1: Add the cases**, with Task 5a's disk:
  - `"a box whose first setup finished gets the full-disk page, not first-setup resolution"`:
    `firstFiscalFixture(<disk folder>)` (Task 4a's parameter), moved to `complete`; a WAL
    `venue.db` with one `tenants (country, tax_id)` row and one `locations (id)` row, closed (F4's
    shape); `fill()`; `runEntry` with the fixture's folders and a capturing `serveRecovery` stub.
    Expect: the served app's `GET /` has the full-disk title; `GET /setup-api/status` `404`;
    `startServer` never called. Control: `unfill()`, `runEntry` → `startServer` called (the
    finished setup boots).
  - `"a database refused on a nearly full disk is recorded as a full disk"`, once with
    `fill(8192)` and once with `fill(16384)` (`it.each`): `stateDir` and `logDir` on
    `mkdtemp(tmpdir())` (room), `venueDir` on the disk holding a venue folder an earlier
    `openVenueDatabase` made and closed; `runEntry` with the real venue lock. It rejects; the
    persisted `lastErrorCode` is `"storage.disk_full"`. The case also asserts what the raw
    rejection was, so it cannot pass through slice 1's path instead of this one's: its cause chain
    carries `code: "ENOSPC"` or an `errcode` whose primary code (`& 0xff`) is 10 or 14 — and no
    `errcode` 13. On HFS+ F14 measured this exact start rejecting with `ENOSPC` on the lock's holder
    file at 8 KiB and with `errcode 4874` at 16 KiB, both recorded `unknown` today. On Linux the
    start itself was not run: from the engine-only F6 (tmpfs passed the lock and refused the open
    with 4874 at 8 and 16 KiB; ext4 opened it at 16 KiB), both variants are EXPECTED to reject that
    way on the CI tmpfs; the first CI run measures it, and a 13 there fails the case rather than
    passing quietly. Control: `unfill()`, `runEntry` boots.
  - `"a commit on a real full disk is refused whole, and the next one is served once there is room"`
    (slice 1's deferred case, build plan decision 1): `openVenueStore({ directory, venueSchema: {}, nodeSchema: {} })`
    on the disk, a `sale (id integer primary key, body text, pad blob)` table, one committed
    `committed before` row, `pragma wal_checkpoint(truncate)`, `fill(16384)`; a `withWriteLock`
    body inserting `zeroblob(65536)` records that its statement returned, then the transaction
    rejects with `{ code: "storage.disk_full" }`; rows are `["committed before"]`; `unfill()`; the
    next transaction commits. Close the store in `finally`.

- [ ] **Step 2: Watch them fail by deletion.** Run the file (expected PASS, `Tests 7 passed` on
  macOS: Task 5a's three, the finished-setup case, the refused open's two rows and the commit). Then: delete Task 4a's at-once branch → the finished-setup case FAILS with the resolution
  app (`/setup-api/status` `200`); restore. Replace Task 4b's `startFailureCode(…)` in
  `runAdmittedEntry`'s catch with `classifyBootFailure(error)` → both refused-open cases FAIL with
  `"unknown"` (F14) or `"provisioning.database_unreachable"`; restore. The
  commit case needs no deletion: its red run is slice 1's E8 K on `main` before #1936; check that
  its statement line ran before the rejection (the failure is at commit). Record each run in the
  commit message, and restore with `git checkout -- apps/server/src/node-entry.ts`.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/server/src/start-full-disk.e2e.test.ts
  git commit -s -m "Prove on a real full disk: a finished setup gets the page, a refused open is a full disk, a commit is refused whole"
  ```

### Task 6: CI runs the real-disk file on a small filesystem

**Files:**
- Modify: `.github/workflows/ci.yml` (`test-server`'s shard step `:959-971`; `test-server-stream`
  `:993-1065`)
- Modify: `scripts/ci-workflow.test.mjs` (`STREAM_TEST_FILES` `:62-70`, the step-name pattern
  `:1606`, the describe `:2012-2081`)

- [ ] **Step 1: Write the failing guard cases** in the describe at `:2018` (renamed
  `"the job of the tests that need Litestream, versitygw or a small filesystem"`), reading
  `ci.yml` as text like its siblings:
  - add `"src/start-full-disk.e2e.test.ts"` to `STREAM_TEST_FILES` (the existing "names test files
    that exist", "runs exactly those files" and "takes those files out of every apps/server shard"
    cases then require it in the run step and in the shards' excludes);
  - `"mounts a small filesystem before it runs them, and names it to the tests"`: a non-comment
    line matching `/^\s*sudo mount -t tmpfs -o size=32m tmpfs "\$RUNNER_TEMP\/full-disk"\s*$/`
    comes before the `test:shard` line; the run step's `env` holds
    `WAITRON_FULL_DISK_DIR: ${{ runner.temp }}/full-disk`.
  - change the pattern at `:1606` to the new step name.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm exec vitest run scripts/ci-workflow.test.mjs`
  Expected: the three list cases FAIL naming `src/start-full-disk.e2e.test.ts`; the mount case
  FAILS (`no step mounts …`); the reporter case FAILS on the step name.

- [ ] **Step 3: Change the workflow.** In `test-server-stream`, before the run step:

  ```yaml
      # Why: testing-guide.md, "The full-disk start tests run on a small filesystem".
      - name: Mount a small filesystem for the full-disk tests
        run: |
          set -euo pipefail
          mkdir -p "$RUNNER_TEMP/full-disk"
          sudo mount -t tmpfs -o size=32m tmpfs "$RUNNER_TEMP/full-disk"
          sudo chown "$(id -u):$(id -g)" "$RUNNER_TEMP/full-disk"
  ```

  Rename the run step to "Run the tests that need Litestream, versitygw or a small filesystem",
  add `WAITRON_FULL_DISK_DIR: ${{ runner.temp }}/full-disk` beside its `TMPDIR`, and add
  `src/start-full-disk.e2e.test.ts` to its file list. Add `--exclude src/start-full-disk.e2e.test.ts`
  to `test-server`'s shard step. Update the two comments (the shard step's, `:952-958`, and the stream job's, `:984-992`) to say the
  job also runs the full-disk tests on a tmpfs it mounts. The job keeps `timeout-minutes: 10`.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/vitest-duration-sequencer.test.mjs`
  Expected: PASS with `Tests` counts.

- [ ] **Step 5: Commit**

  ```bash
  git add .github/workflows/ci.yml scripts/ci-workflow.test.mjs
  git commit -s -m "CI runs the full-disk start tests on a 32 MiB tmpfs it mounts"
  ```

  After the branch is pushed (by `/finish-branch`), read `test-server-stream`'s log on the current
  head: the full-disk file must show `7 passed`, not skipped. That run is this slice's Linux
  measurement; put its numbers in the pull request.

### Task 7: Docs, the backlog, and the rule

**Files:**
- Modify: `docs/developers/testing-guide.md` (a new section after `:1084-1122`)
- Modify: `docs/developers/conventions-data.md` (the `recovery.json` lock paragraph `:2553-2565`;
  a subsection after `### A full disk sometimes ends the whole transaction`, `:2238`)
- Modify: `docs/developers/conventions-ui.md` (the recovery page section `:1037-1065`)
- Modify: `deploy/README.md` (`### When the app will not boot`, `:168-190`)
- Modify: `CLAUDE.md` (§3 and §4, one line each)
- Modify: `docs/backlog.md` (`:5162-5165`, the A798-B entry `:5341-5361`, new short entries)

- [ ] **Step 1: testing-guide.md** — `## The full-disk start tests run on a small filesystem`:
  what `apps/server/src/testing/full-disk.ts` mounts and where (decision 11), the 64 MiB refusal,
  that a Linux run without `WAITRON_FULL_DISK_DIR` reports SKIPPED and that reads as a pass, that
  CI mounts a tmpfs in `test-server-stream`, how to find and detach an image a killed run left
  attached (`hdiutil info`, then `hdiutil detach <mount> -force`), and the receipts F1, F2, F5,
  F8, F11 and F14 with their commands, platforms and versions. F6 goes in only as what it is — the
  engine alone, with nothing opening the database first — never as what the start does; F11 and F14
  are the start's order. Weaker than its name, said there: tmpfs in
  CI and HFS+ on macOS, never the box's ext4 under Docker; one filler file, never the real fillers.
- [ ] **Step 2: conventions-data.md** — add "the start's write-back of an unchanged count below the
  floor" to the list of `recovery.json` writes at `:2553-2556`; add
  `### A full disk is not one error code` after `:2238`'s subsection: F2, F5, F11, F12 and F14 (13,
  14, 4874 and `ENOSPC`, by filesystem and step; APFS's 1.2 MB that is not free; 14 also from a
  missing or unwritable folder), and that the start names one with `fullDiskFailure`
  (`apps/server/src/boot-failure.ts`): 13 always, 14, the I/O family and `ENOSPC` only under
  16 MiB free — with decision 6's accepted risk stated. Add the backup-staging guard's weakness on
  a full disk (F13, decision 5) to the "One process per venue folder" section's holder-file
  paragraph.
- [ ] **Step 3: conventions-ui.md** — the recovery page section gains: served at once, with no
  count, when the start cannot write its count below the floor; the free-space line; the full-disk
  action's first sentence.
- [ ] **Step 4: deploy/README.md** — `#### When the page names storage.disk_full`: below 256 MiB
  free, every start deletes rotated logs but the newest, crash reports older than a week and a
  cut-off backup's staging files; if the start still cannot write, the page appears at once and
  shows the free space; free space on the disk and press Retry. Name no command to free space that
  was not run for this plan.
- [ ] **Step 5: CLAUDE.md** — §3, beside the refusal rule: "**A full disk is not one error code**:
  measured 13, 14, 4874 and the system's `ENOSPC`, by filesystem and by step, and 14 also comes from
  a missing folder; the start names one with `fullDiskFailure` — 13 always, the others only under
  16 MiB free. Receipt: [conventions-data.md](docs/developers/conventions-data.md#a-full-disk-is-not-one-error-code)."
  §4, after the stream-loop rule: "**The full-disk start tests need a small real filesystem**: on
  macOS they make one with `hdiutil`; on Linux they read `WAITRON_FULL_DISK_DIR`, are SKIPPED
  locally without it, and FAIL in CI. Receipt: [testing-guide.md](docs/developers/testing-guide.md#the-full-disk-start-tests-run-on-a-small-filesystem)."
  Then `pnpm exec vitest run scripts/claude-md-pointers.test.ts` — PASS with a count.
- [ ] **Step 6: backlog.md** — in the A798-B entry, nothing about slice 2 landing (the landing
  session writes that); reword the cut-off backup entry (`:5162-5165`): "the start deletes them
  only when its disk has under 256 MiB free (A798-B slice 2)", with the owner question; add short
  entries, each its own: (a) a box retired into a first-setup workspace keeps that workspace's
  backup staging at start (decision 15); (b) the connection-bootstrap path on a full disk was not
  run; (c) a route answering a full disk the system reports as `ENOSPC` still answers
  `server.internal` (decision 6; slice 5's watch is the natural home); (d) the page served at once
  does not notice freed space by itself — Retry restarts.
- [ ] **Step 7: Commit**

  ```bash
  git add docs/developers/testing-guide.md docs/developers/conventions-data.md docs/developers/conventions-ui.md deploy/README.md CLAUDE.md docs/backlog.md
  git commit -s -m "Docs: a full disk at start, its real-disk tests, and the follow-ups slice 2 leaves"
  ```

  `CLAUDE.md` is format-checked: let the pre-push hook run `prettier` on it once, at push.

---

## Probe scripts

All under `~/waitron-campaign-b/a798-2-plan-probe/`: `engine-start.mjs` (F2, F5), `engine-leave.mjs`
(F6), `window.mjs` (F11, copied from the plan review's `~/waitron-campaign-b/a798-2-plan-review/`),
`perm.mjs` (F12), `st/holder.test.ts` (F13), `st/open8k.test.ts` (F14, run with `LEAVE=<bytes>`),
`disk-commit.mjs` (F8, copied from slice 1's `a798-plan-probe`), `st/start.test.ts` (F1, F2,
F5, F7), `st/commit.test.ts` (F8), `st/serve.test.ts` (F9), `st/today.test.ts` (F3),
`fs/claimed.test.ts` (F4), `st/disk.ts` (the fill helper), and `linux/ext4.img` (the empty 16 MiB
ext4 image). The Linux runs: `docker run --rm --privileged -v $PWD:/probe:ro -v $PWD/linux:/img
node:26.11.1-slim sh -c 'mount …; chown node:node <dir>; su node -s /bin/sh -c "node /probe/<script> <dir> …"'`.
