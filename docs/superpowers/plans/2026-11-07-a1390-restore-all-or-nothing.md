# A1390: a restore is all or nothing, and its key always opens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

> 2026-11-07, after the fresh-context plan review of `4078b771c3` (1 critical, 5 important, 4
> minor): the database put-back after placement is dropped. The restore's fiscal step committing is
> the point of no return, as `restore-emergency-crash.e2e.test.ts` already pins, so Tasks 6–8 of
> the first draft became Tasks 6–7 here. Every finding and how it was folded is listed under
> "Review fold" at the end.

**Goal:** A restore that fails before it replaces the venue database leaves the box's database,
its identity file (`trading.env`) and its other secrets as they were. One that fails after the
restore's fiscal step has committed keeps the restored database, and a staged restore's next start
finishes it, as today. The bucket copy code in a recovery pack opens whatever recovery key the box
itself accepts, and the bucket rebuild's loose ends from SQLite slice 2 Task 9b are closed.

**What stays outside "as they were"** (the README and comments say this, not more): a process that
is killed; a folder created to hold a secret (for example `tls/`) when the box had none; the backup
room note (`backup-room-note.json`), deleted before anything changes and written again by the backup
supervisor (`apps/server/src/backup-supervisor.ts:359`); a failure after the database is placed but
before the fiscal step commits (a migration or a hook), which keeps today's behaviour (owner
question 3); a placement that fails after it removed the replaced database's `.venue.db-litestream/`
folder (`apps/server/src/restore.ts:656`), which puts the old database back without it, as today;
and, reported by the plan review and to be confirmed in Task 7 before any sentence names it, an
installation name a staged restore's preparation already recorded in
`<state>/module-preparation-state.json`.

**Architecture:** In `placeValidated` (`apps/server/src/restore.ts`), the secrets are written first,
beside their targets under a staged name, so a full disk or a write error is met before anything is
replaced; publishing them at the end is renames only. If the database placement then fails, the
identity file set aside a moment earlier is put back and the staged secrets are removed. Once the
hooks' transaction has committed, a failed publish puts back only the secret files it had renamed,
keeps the placed database and leaves the identity set aside, so the staged restore's resume can
publish. A staged restore whose failure changed nothing gets its marker back, as an admission
refusal does. Around that: the kit parser drops a rule the box's own key rules do not have, the
bucket rebuild's damage check moves onto its own thread, the restore command holds the venue
folder for its whole run, and every server start removes the restore's leftover working folders.

**Tech Stack:** TypeScript 7 in `apps/server` and `packages/stream`, Node v26.13.0 (`node
--version`, 2026-11-07), `node:sqlite`, Vitest 4.1.12.

**Spec:** `docs/backlog/box.md`, "## Bundle A1390: A restore is all or nothing, and its key always
opens" (line 1367 on `59be31e3b7`) and the three detail sections it links: "## A recovery kit can
carry a recovery key its own restore refuses" (line 1813), "## A restore that fails while writing
the secrets has already replaced the venue database" (line 1822), and "## Loose ends left by SQLite
slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`)." (line 385). Index lines:
`docs/backlog.md:115` and `docs/backlog.md:1806`.

**Branch:** `fix/a1390-restore-all-or-nothing`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-fix-a1390-restore-all-or-nothing`, off main
`59be31e3b7`. The executing session keeps the ledger
`docs/handoffs/2026-11-07-a1390-restore-all-or-nothing.md`.

## Global Constraints

- **A1308 hold:** no migration, no schema file change, no new or changed table, column, index or
  trigger. Nothing below needs one; if a step turns out to, stop and report.
- **No fiscal-core change:** `computeHuella`, chaining, invoice numbers, `registros_facturacion`
  and the alta builders are not touched; the golden huella test and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts` stay unedited. The restore hooks
  (`runRestoreHooks`) keep their code.
- **Risk triggers hit: concurrency** (Task 4 widens the restore command's hold on the venue folder;
  Task 5 deletes folders other flows create, under that hold; Task 7 orders an undo across files and
  changes when a staged restore's marker is rewritten) **and the box's fiscal identity** (Task 7
  changes how `trading.env` is set aside and put back, and the post-commit failure path). So the
  branch takes the FULL ceremony: a per-task reviewer on every task, the full `/finish-branch`
  wave, and the Codex run-it seat as two reviews side by side, the second told to set this plan's
  checklist aside.
- No new error code. Reused: `restore.identity_unknown` (Task 2), `restore.unsafe_entry_path`
  (Task 6). Run `scripts/errors-reachable.test.ts` and `scripts/alert-codes.test.ts` once in Task 9.
- New log events (free-form names; no registry): `restore.identity.put_back_failed { errno }`,
  `restore.secrets.put_back_failed { file, errno }`, `restore.secrets.previous_kept { file, errno }`,
  `restore.leftover_removed { folder }`, `restore.leftover_kept { folder, errno }`. `file` and
  `folder` are base or relative names (`tls/server.key`), never a full path.
- English only in code, comments, identifiers and tests (CLAUDE.md §3). Comments only for an
  invariant or a non-obvious why; when you touch a comment this plan retires, delete or replace it.
- Every commit `git commit -s`, message in plain English.
- Each implementer runs `pnpm format:check` and `pnpm --filter @waitron/server typecheck` (plus
  `pnpm --filter @waitron/stream typecheck` in Task 1) before committing, and the focused tests its
  task names. CI owns the package suites and coverage (`98/98/98/95`): a branch that no test
  reaches fails CI, so each task's tests cover every branch it adds.
- **Changed assertions are listed in the PR description** with the reason, task by task (Tasks 3,
  5, 7). Every other existing assertion stays as it is.
- Under an AI agent Vitest hides passing tests' output; read the `Tests` count line, not the exit
  status of a pipe (CLAUDE.md §4).

## Review Focus

1. **A secret whose folder is a link.** A box's `tls` folder may be a symbolic link
   (`syncFolderHolding`, `packages/provisioning/src/fs-atomic.ts:43-54`). Staged files sit beside
   their targets, so every rename stays inside one folder and one filesystem. Expected: a restore
   onto a box whose `tls` is a link succeeds and leaves the link in place. Task 6 tests it.
2. **A staged restore that changed nothing.** Expected: the marker returns to its original text,
   so the next start runs it afresh instead of refusing a resume that has no committed fiscal step
   to resume (`restore-request.ts:616-629`). Task 7 tests it.
3. **A publish that fails after the fiscal step committed.** Expected: the placed database and the
   committed activation stay, the box's secrets are back to the ones it had, `trading.env` is
   absent, the marker says `placementStarted: true`, and the next start resumes and finishes.
   `restore-emergency-crash.e2e.test.ts:93-134` pins this; Task 7 moves its injection point and
   keeps its assertions.
4. **A restore that runs while the server is up.** Expected: refused
   `provisioning.database_in_use` before it downloads or decrypts anything, with no working folder
   left. Task 4 tests it with a real second process.
5. **Where a full disk is met.** The rebuild marker (`writeValidated`, `restore.ts:493-501`) is
   written before the staged secrets, so a nearly full disk can refuse it first. Task 8 asserts the
   failure came from staging.

## Decisions, with receipts

Each point was checked against `59be31e3b7` before it was planned. "Ran" means a throwaway test
copied into `apps/server/src/` for one run and deleted after (`git status --short` clean after
each).

### Point 1: the kit's key rule — still open

- `parseRecoveryKit` refuses a `recoveryKey` matching `CONTROL_CHARACTER = /[\x00-\x1f\x7f]/`
  (`packages/stream/src/kit.ts:27-29`, `:47-50`; `packages/stream/src/bucket-config.ts:6`).
  `checkedRecoveryKey` checks only length (`apps/server/src/backup-config.ts:224-230`), and the
  dashboard's `assertStorableKey` refuses C0 controls and surrounding spaces but not DEL
  (`apps/server/src/backup-api.ts:119-129`).
- **Ran:** a key of 24 `a` plus DEL passed `assertStorableKey`, round-tripped through
  `writeRecoveryKey` and `loadRecoveryKey` unchanged; `checkedRecoveryKey` accepted it and a key
  with a tab; `parseRecoveryKit(encodeRecoveryKit(...))` refused both
  (`backup.stream_kit_invalid {"reason":"shape"}`) and parsed a plain 25-character key (the
  control).
- **Decision:** the kit takes any non-empty string as the key. The control-character rule stays for
  `venueId` and `pointerSignerPublicKey`. A key shorter than the box's minimum still parses and then
  fails to open the locked row with the existing "does not open" words (`packages/stream` cannot
  import `apps/server`'s length rule).
- **Bench:** `bench/sqlite-failover/src/probes/restore-time.ts:105-106` multiplies `bavail` by
  `bsize`. **Ran:** `fs.statfsSync('/tmp')` on this Mac prints `bsize: 4096, frsize: 4096`, so a
  test here cannot tell the two apart. The fix is the one-word change to `frsize`, matching
  `apps/server/src/free-bytes.ts:11`, with no test.

### Point 2: the half-done restore — still open, and the post-commit path is deliberate

- Order today in `placeValidated` (`restore.ts:389-444`): set the identity aside (`:405`), place
  the database (`:406-413`), migrate (`:417-420`), run the hooks (`:425-440`), write the secrets
  (`:443`).
- **Ran:** with `restore.test.ts`'s own helpers, an old `venue.db`, an old `trading.env` and a folder
  at `tls/server.key`, then a restore: `EISDIR`; `venue.db` was the archive's, `trading.env` absent,
  `trading.env.replaced` present, the archive's `secrets.env` already written.
- **Ran:** `restore.test.ts -t "a pre-existing VALID identity is set aside BEFORE"` passes: an
  injected placement failure leaves `trading.env` gone and `trading.env.replaced` holding the box's
  identity (`restore.test.ts:1070-1102`).
- **Deliberate and kept (plan review, Critical 1):** after the fiscal activation commits, a failed
  secrets write keeps the placed database; `restore-request.json` keeps `placementStarted: true`
  (`restore-request.ts:616-629` resets it only for a snapshot or admission refusal or
  `provisioning.database_in_use`), and the next start resumes (`resumeOperation`,
  `restore-request.ts:568`) after checking the committed activation
  (`packages/fiscal-verifactu/src/restore-committed.ts:13-25`). Pinned by
  `restore-emergency-crash.e2e.test.ts:93-134` and `:157-240`; the reviewer ran that file: 6 passed.
  Putting the old database back there would leave a marker that says placement started over a
  database with no committed activation, refused on every later start.
- **Decision (the backlog's first remedy, plus the identity half):** write every secret to its
  staged name before anything is replaced (Task 6); if the database placement fails, put the
  identity back and remove the staged secrets; after the commit, a failed publish puts back only
  what it renamed (Task 7). This closes both measured defects: the secrets write now fails before
  the database is replaced, and the identity no longer stays aside when the database move fails.
- **Why the identity is put back only when the placement itself fails:** every way `restoreDatabase`
  throws leaves the archive's file away from `venue.db` (its first block removes the incoming files,
  `restore.ts:645-662`; its second puts the moved files back, main last, `:684-698`). After it
  returns, the archive's database is in place, and the set-aside exists so that no identity can
  start beside it (`setAsideExistingIdentity`'s comment, `restore.ts:822-828`). So a migration or
  hook failure keeps the identity aside, as today (owner question 3).
- **Existing tests that change:** `restore.test.ts:1005` (a folder at a secret's target now fails at
  staging, before anything changes) and `:1070` (the identity comes back when placement fails). Its
  ordering half — set aside before the venue file is replaced — is kept as an observation from
  inside an injected placement step. `:1123` (a failed hook leaves no `trading.env` and the
  archive's database) is unchanged: that is the kept behaviour.
- **Crash-test injection points that move** (behavioural assertions kept):
  `restore-emergency-crash.e2e.test.ts:104-108` injects a failure on opening `trading.env.tmp` or
  `credentials.key.tmp` — today the post-commit secret writes. Staging now writes those files
  before placement, as `trading.env.incoming.tmp` and `credentials.key.incoming.tmp`, so failing them
  would test a pre-placement failure instead. The injection moves to the publish rename onto
  `<state>/trading.env` or `<state>/credentials.key` (a `nativeFs.rename` spy, the pattern at
  `restore.test.ts:1077-1094`). The kill gate at `:337` ("before-publication", waiting on the open
  of `trading.env.tmp`) moves to the child script's `nativeFs.rename` of `trading.env.incoming` onto
  `trading.env`. `stagedPath` (`packages/provisioning/src/fs-atomic.ts:7-9`, `.tmp`) is unchanged;
  `restoreSecrets` keeps using it, so `backup-data-placement.test.ts:361` is unaffected.

### Point 3a: the integrity check and the watchdog — still open, in both processes

- The restore command and the setup wizard both reach `readRestoredCopy`
  (`apps/server/src/restore-stream.ts:236-263`) through `prepareStreamRestore`. It opens the
  downloaded copy with `openVenueDatabase` (`:244`), which takes the copy's folder lock
  (`packages/store/src/index.ts:240-241`), whose first take starts the watchdog thread
  (`packages/store/src/venue-lock.ts:85-88`, `packages/store/src/venue-liveness.ts:279-292`). The
  check is one synchronous `pragma integrity_check` (`restore-stream.ts:85-96`). The watchdog kills
  after 120 s with no timer turn (`venue-liveness.ts:22`).
- **Ran:** a 60,000-row, ~240 MB file: no watchdog before `openVenueDatabase`, a watchdog after it;
  `checkIntegrity` took 635 ms during which a 10 ms interval fired 0 times. The reviewer measured
  `isCopyIntact` at 6 ticks in 63 ms on a 60 MB write-ahead-mode file, and the main-thread check at 0.
- **Decision:** run the check on its own thread with the existing `isCopyIntact`
  (`apps/server/src/handover-integrity.ts:46-82`), before the copy is opened. It also runs
  `pragma foreign_key_check`, so a copy whose rows name a missing parent is now refused as damaged,
  as archive verification (`apps/server/src/backup-verification.ts:79-90`) and the handover's
  compare already do. The check's read-only open can leave `-wal`/`-shm` files beside the copy
  (reviewer's run); they sit in the scratch folder, which is removed whole, and the
  `openVenueDatabase` that follows opens the same file.

### Point 3b: a copy with no taxpayer — still open

- `readRestoredVenue` reads the `tenants` row optionally and falls back to `""`
  (`restore-stream.ts:210-232`); `confirmsVenue` never accepts `""` (`:49-51`). The archive preview
  already refuses that case as `restore.identity_unknown`
  (`apps/server/src/recovery-backup-preview.ts:60-61`), whose registry text names it
  (`apps/server/src/errors.ts:1719-1721`). `restore-stream.test.ts:1334-1351` pins today's
  `restore.stream_venue_unconfirmed` with an empty tax id.
- **Decision:** the bucket path throws `restore.identity_unknown` too. The command line prints
  `restore failed: restore.identity_unknown` for it (`apps/server/src/restore-command.ts:404`).

### Point 3c: leftover working folders — still open, and one more kind found

- Creators: `stream-restore-` in the state folder (`restore-stream.ts:56`, `:204-207`),
  `restore-entry-` in the state folder (`apps/server/src/restore-request.ts:509`, not named by the
  backlog, same class), and inside `restore-staging`: `archive-download-`
  (`apps/server/src/archive-download.ts:66`), `archive-validate-` (`restore.ts:273`, `:1044`),
  `restore-admission-` (`restore.ts:471`).
- Cleared today: only `restore-staging/staged-recovery`, at boot once the process holds the venue
  folder (`apps/server/src/boot.ts:1200-1202`), and at the box's entry's free-space step
  (`apps/server/src/start-space.ts:96-99`). Commit `db4e0a6bf1` left the rest of `restore-staging`
  alone on purpose: "Other entries in restore-staging (the restore command's downloads) are left
  alone", because the restore command does not hold the venue folder while it downloads — it takes
  the hold only when it places (`writeValidated`, `restore.ts:456`).
- **Decision:** the restore command holds the venue folder from resolving its target until it
  exits (Task 4). Then every folder of these kinds was made by a process that held the venue folder
  or by the starting process itself, and the start's clean-up (already under the hold) can remove
  them (Task 5). This reverses `db4e0a6bf1`'s tested choice; the assertions that change are listed
  in Task 5.

### Point 3d: `.venue.db-replaced-` folders outside the box's entry — default: document

- `clearReplacedDatabases` runs only in the box's entry (`apps/server/src/node-entry.ts:650-652`);
  the image always starts through it (`deploy/Dockerfile:286`). The dev stack starts `src/bin.ts`
  (`apps/server/scripts/dev-server.mjs:65`), which skips the entry's whole start sequence. Moving
  the call into `startServer` would break its "no `venue.db` beside a non-empty folder" refusal
  (`restore.ts:769-801`), because boot's first venue open (`boot.ts:1180`) creates `venue.db`.
- **Default (owner question 1):** no code change; a line at the function and an entry under
  "Decisions and deliberate limits".

### Point 3e: 15 seconds and 60 seconds — default: document at the sites

- `POINTER_READ_TIMEOUT_MS = 15_000` bounds one pointer read that holds a restored box's first
  trading start; on the bound it throws the log-only `restore.pointer_unreadable`, and the start
  fails and is tried again at the next start (`apps/server/src/rebuild-first-start.ts:198-240`;
  commit `7dd33ee508`). `BUCKET_CALL_TIMEOUT_MS = 60_000` bounds each call of an operator-run
  rebuild, added because the S3 client has no time limit of its own
  (`apps/server/src/bounded-store.ts:9`; commit `1421665e6a`). Neither number was measured.
- **Default (owner question 2):** no behaviour change; one line at each constant.

## Owner questions (build proceeds with each default)

1. **Should a server started outside the box's entry (the dev stack) also clear
   `.venue.db-replaced-` folders?** Default: no; document that only the box's entry does.
2. **Should the first start's 15-second pointer read and the rebuild's 60-second calls share one
   limit or one code?** Default: no; one line at each constant says what it bounds.
3. **Should a migration or hook failure after the database is placed, before the fiscal step
   commits, put the old database back?** Default: no; keep today's behaviour (the restored database
   stays, the identity stays aside, the box does not start until the restore is run again). Doing
   it needs a database put-back that coordinates with the staged restore's marker; this branch
   closes the two measured defects without one.

## File structure

| File                                                  | Change                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/stream/src/kit.ts`                          | Task 1                                                              |
| `bench/sqlite-failover/src/probes/restore-time.ts`    | Task 1                                                              |
| `apps/server/src/restore-stream.ts`                   | Tasks 2–3                                                           |
| `apps/server/src/restore-command.ts`                  | Task 4: holds the venue folder; Task 5: left-download words; Task 7: comment |
| `apps/server/src/restore-staging-dirs.ts`             | Task 5: leftover prefixes, `restoreLeftovers`, `clearRestoreLeftovers` |
| `apps/server/src/boot.ts`, `start-space.ts`           | Task 5                                                              |
| `apps/server/src/state-secrets.ts`                    | Task 6: `unpackBundleToDir` gains a `suffix` option                 |
| `apps/server/src/restore-secrets.ts` (new)            | Task 6: `stageSecrets`                                              |
| `apps/server/src/restore.ts`                          | Task 7: `placeValidated`, identity put-back, `placementLeftNothingChanged` |
| `apps/server/src/restore-request.ts`                  | Task 7: marker rewritten when nothing changed                       |
| `apps/server/src/restore-full-disk.e2e.test.ts` (new) | Task 8                                                              |
| `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs` | Task 8                                                         |
| `deploy/README.md`, `docs/developers/*.md`, `docs/backlog*.md` | Tasks 4, 5, 7, 9                                           |

---

### Task 1: The kit opens any key the box accepts

**Files:**

- Modify: `packages/stream/src/kit.ts:27-50`
- Test: `packages/stream/src/kit.test.ts`
- Modify: `bench/sqlite-failover/src/probes/restore-time.ts:106`

- [ ] **Step 1: Write the failing tests** in `kit.test.ts`:
  - `it("carries a recovery key holding a tab or DEL, as the box's own key rules allow")` — for
    each of `"a".repeat(12) + "\t" + "a".repeat(12)` and `"a".repeat(24) + "\x7f"`:
    `expect(parseRecoveryKit(encodeRecoveryKit({ ...KIT, recoveryKey: key })).recoveryKey).toBe(key)`
    (`KIT` is the file's existing valid kit fixture).
  - `it("still refuses an empty recovery key")` — rejects
    `{ code: "backup.stream_kit_invalid", params: { reason: "shape" } }`.
  - `it("still refuses a control character in the venue id or the signer's key")`.
- [ ] **Step 2: Run, watch the first fail**:
  `pnpm --filter @waitron/stream exec vitest run src/kit.test.ts` — the tab/DEL case FAILS with
  `backup.stream_kit_invalid`; the other two pass (they pin what must not change).
- [ ] **Step 3: Implement.** In `parseRecoveryKit`, check `recoveryKey` with
  `typeof k.recoveryKey === "string" && k.recoveryKey !== ""`; keep `text` for the other two
  fields. One comment line: the box's key rules (`checkedRecoveryKey`) allow any character, and a
  kit must open the key it was made with.
- [ ] **Step 4:** `restore-time.ts:106`: `disk.bavail * disk.frsize`.
- [ ] **Step 5: Run** the kit tests, then
  `pnpm --filter @waitron/stream typecheck && pnpm --filter @waitron/bench-sqlite-failover typecheck`.
- [ ] **Step 6: Commit** — "The bucket copy code opens a recovery key holding any character the box accepts".

### Task 2: A bucket copy with no taxpayer is refused as an unknown identity

**Files:**

- Modify: `apps/server/src/restore-stream.ts:210-232`
- Test: `apps/server/src/restore-stream.test.ts:1334-1351`

- [ ] **Step 1: Change the pinning test** into
  `it("refuses a copy with no taxpayer as an unknown identity, staging nothing")`: same fixture
  (`delete from tenants`), now `rejects.toMatchObject({ code: "restore.identity_unknown" })`, and
  keep `await expectStateUntouched(deps.stateDir)`. (Changed assertion, for the PR list.)
- [ ] **Step 2: Run, watch it fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts -t "no taxpayer"` —
  received `restore.stream_venue_unconfirmed`.
- [ ] **Step 3: Implement.** In `readRestoredVenue`, a missing `tenant` throws
  `new AppError("restore.identity_unknown", { nodeId })`. Leave `confirmsVenue`'s `taxId !== ""`
  guard: a row holding an empty tax id is storable (`tax_id` is a plain `text` column,
  `packages/db/src/schema/tenants.ts:43`, `columns.ts:162`).
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts`.
- [ ] **Step 5: Commit** — "A bucket copy with no taxpayer row is refused as an unknown identity".

### Task 3: The bucket rebuild checks the copy on its own thread

**Files:**

- Modify: `apps/server/src/restore-stream.ts:66,85-100,236-263`
- Test: `apps/server/src/restore-stream.test.ts:385-396,885-935,1043-1050`

**Interfaces:**

- Produces: `export function checkIntegrity(databasePath: string): Promise<boolean>` (the answer of
  `isCopyIntact`) and `PrepareStreamDeps.checkIntegrity?: (databasePath: string) => Promise<boolean>`.

- [ ] **Step 1: Write the failing test**
  `it("keeps the main thread's timers turning while it checks a large copy, where a check on the main thread stops them")`:
  build a plain SQLite file in a fresh folder (`create table t(x blob)`, 15,000 rows of
  `randomblob(4000)`, about 60 MB, one transaction). Control first: count a 10 ms interval's ticks
  while `new DatabaseSync(file).prepare("pragma integrity_check").all()` runs on the main thread —
  expect 0. Then count while awaiting `checkIntegrity(file)` — expect the answer `true` and more than
  0 ticks.
- [ ] **Step 2: Run it**:
  `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts -t "timers turning"`.
  On today's code it fails before reaching the tick count (the old `checkIntegrity` takes an open
  store, not a path); the control is what shows the file is large enough for the property to be
  measured. Record both counts in the commit message.
- [ ] **Step 3: Implement.** `checkIntegrity(databasePath)` returns `isCopyIntact(databasePath)`
  (`./handover-integrity.js`). `readRestoredCopy` calls
  `args.checkIntegrity(join(args.directory, VENUE_FILE))` before `openVenueDatabase`; `false` →
  `integrityFailed(args.log)`. `integrityFailed` logs `restore.stream_integrity_failed` with `{}`
  (a yes/no check has no problem count). A thread that fails to answer rejects, and the rejection
  propagates. Its doc comment says it runs on its own thread and also refuses a broken foreign key.
- [ ] **Step 4: Update the other tests.** Changed assertions, for the PR list: the "fails a download
  that is not a database" case expects the logged fields `[{}]` (was `[{ problems: 1 }]`); "reports
  what SQLite's check finds in a database that opens but is damaged" expects `false` (was the
  check's lines); "reports a copy it cannot read" becomes a missing file reading `false`. Mechanical:
  the injected `checkIntegrity: async () => [...]` (lines 387, 1046) become `async () => false`;
  `integrityOf` calls `checkIntegrity(join(dir, "venue.db"))`.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts src/handover-integrity.test.ts src/recovery-backup-preview.test.ts`.
  If a healthy fixture now fails `foreign_key_check`, stop and report: a finding, not a test to
  loosen.
- [ ] **Step 6: Commit** — "The bucket rebuild checks the downloaded copy on its own thread, so the watchdog never sees a stall".

### Task 4: The restore command holds the venue folder for its whole run

**Files:**

- Modify: `apps/server/src/restore-command.ts` (`CommandDeps`, `resolveRestoreTarget` `:287-334`,
  and its three callers at `:136`, `:481` and `:612`)
- Test: `apps/server/src/restore-command.test.ts`
- Docs: `docs/developers/conventions-data.md:3356` (the lock-caller row for `restore-stream.ts`)

**Interfaces:**

- Produces: `CommandDeps.lockVenue?: (venueDir: string) => Promise<VenueLock>`; the default makes the
  folder (`mkdir(venueDir, { recursive: true, mode: 0o700 })`, as `lockRestoreTarget` does,
  `restore.ts:525-528`) then calls `lockVenueDatabase(venueDir)`.
  `resolveRestoreTarget(deps)` returns `{ target: RestoreTarget; hold: VenueLock } | number`.

What this changes besides the refusal's timing (the README and the commit say so): the venue
folder's watchdog now runs for the whole download and check, not only from placement on; a server
cannot start while a restore runs; and a run refused early on a fresh box leaves an empty venue
folder holding `venue.lock` (the lock file is made by the first take,
`packages/store/src/venue-lock.ts:55-67`).

- [ ] **Step 1: Write the failing tests** in `restore-command.test.ts`:
  - `it("refuses at once while another program holds the venue folder, before reading the bucket")`:
    `lockVenue` throws `new AppError("provisioning.database_in_use", { database: venueDir })`; run
    `restore --from-bucket <kit>`; expect exit 1, the in-use words (`restore-command.ts:392`)
    printed, `restoreStream` never called.
  - The same for `restore <artifact>` (`restore` never called) and `restore --from-archive`
    (download never called).
  - `it("holds the venue folder until it exits")`: a `lockVenue` stub records `release`;
    `restoreStream` asserts from inside that `release` has not been called; after the run, exactly
    one release.
  - `it("is refused by a real second process holding the folder, leaving no working folder")`: take
    the folder in a child process as `restore.test.ts:314-345` does; run the bucket form with the
    default `lockVenue`; expect exit 1, the in-use words, and no `stream-restore-*` in the state
    folder.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-command.test.ts -t "venue folder"`.
- [ ] **Step 3: Implement.** In `resolveRestoreTarget`, after `assertNoStartAgainDeletion` and the
  first-setup branch, take the hold; a refusal prints `sharedRefusal(err)` and returns 1. Each caller
  wraps everything after it in `try { … } finally { hold.release(); }`. `writeValidated`'s own take
  shares this hold (`packages/store/src/venue-lock.ts:78-107`).
- [ ] **Step 4:** Update the conventions-data row: the restore command holds the venue folder from
  resolving its target to exit, so its downloads and checks run under it.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/restore-command.test.ts src/restore-command.archive.test.ts src/restore-command.archive-target.test.ts`.
- [ ] **Step 6: Commit** — "The restore command holds the venue folder from the start, so a running server refuses it before any download".

### Task 5: Every server start removes the restore's leftover working folders

**Files:**

- Modify: `apps/server/src/restore-staging-dirs.ts`; the creators (`restore-stream.ts:56`,
  `restore-request.ts:509`, `archive-download.ts:66`, `restore.ts:273,471,1044`);
  `apps/server/src/boot.ts:1200-1202`; `apps/server/src/start-space.ts:53-99`;
  `apps/server/src/restore-command.ts:571-573` (`DOWNLOAD_LEFT_BEHIND`)
- Test: `apps/server/src/restore-staging-dirs.test.ts` (new), `apps/server/src/start-space.test.ts`,
  `apps/server/src/start-full-disk.e2e.test.ts`, `apps/server/src/restore-command.archive.test.ts:74`,
  and the boot test covering `staged-recovery`
  (`git grep -n "staged-recovery\|STAGED_RECOVERY" apps/server/src/boot.setup-routes.test.ts`)
- Docs: `deploy/README.md:636-648`, `docs/developers/testing-guide.md:1604`

**Interfaces:**

- Produces in `restore-staging-dirs.ts`:
  `export const STATE_SCRATCH_PREFIXES = ["stream-restore-", "restore-entry-"] as const;`
  `export const STAGING_SCRATCH_PREFIXES = ["archive-download-", "archive-validate-", "restore-admission-"] as const;`
  `export async function restoreLeftovers(stateDir: string): Promise<string[]>` — full paths of each
  directory (not a symbolic link: `readdir(..., { withFileTypes: true })` and `isDirectory()`) in
  the state folder whose name starts with a state prefix, and in `restore-staging` with a staging
  prefix or named `staged-recovery`. A `restore-staging` that is itself a symbolic link, or missing,
  lists nothing from it, as `start-space.ts` skips it today.
  `export async function clearRestoreLeftovers(stateDir: string, log: Logger): Promise<void>` —
  removes each (`rm` recursive, force), logging `restore.leftover_removed` or
  `restore.leftover_kept`; never throws.
- Each creator builds its prefix from these constants.

- [ ] **Step 1: Write the failing tests.** New file: `restoreLeftovers` lists one folder of each of
  the five kinds plus `staged-recovery`, and does NOT list a file named `stream-restore-x`, a link
  named `archive-download-x`, a folder `venue`, a folder `backup-staging`, a folder
  `stream-restore` (the prefix needs its trailing `-`), or anything when `restore-staging` is a link
  to a folder holding `archive-download-x`. `clearRestoreLeftovers` removes them and logs one
  `restore.leftover_removed` per folder. Boot test: a start removes a `stream-restore-*` folder.
- [ ] **Step 2: Change the assertions that pin the old choice** (for the PR list, reason: Task 4
  makes the restore command hold the venue folder, which is what `db4e0a6bf1` waited for):
  `start-space.test.ts:407-425` — both "deletes the staged folder whole and leaves the rest of
  restore staging" cases now expect `download()` gone and two deletions (`deleted: 2`), and are
  renamed "…and the restore's other working folders"; `start-full-disk.e2e.test.ts:820-833` expects
  the `archive-download-x` folder gone; `restore-command.archive.test.ts:74` carries the new
  `DOWNLOAD_LEFT_BEHIND` words. Keep `start-space.test.ts`'s case that another holder of the venue
  folder leaves everything in place, and extend it to the new kinds.
- [ ] **Step 3: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-staging-dirs.test.ts src/start-space.test.ts`.
- [ ] **Step 4: Implement.** `boot.ts:1202` calls `clearRestoreLeftovers(config.stateDir, log)` in
  place of `clearStagedRecoveries(...)`; keep the comment above it. Wherever `freeSpaceAtStart`
  removes `staged-recovery` today (a first-setup workspace's folders included), remove every path
  `restoreLeftovers` lists through its `remove(path, true)`, and update its doc comment.
  `clearStagedRecoveries` stays for `recovery-preparation.ts:573`. `DOWNLOAD_LEFT_BEHIND` becomes:
  "the downloaded archive could not be removed; the next server start removes it".
- [ ] **Step 5: Docs.** `deploy/README.md:636-648`: a restore is refused while another program holds
  the venue folder, before it downloads or checks anything; a killed run leaves its working folder,
  and the next server start removes it. Delete the hand-deletion instructions and the
  `archive-source-check-` name (`git grep -n "archive-source-check"` finds only the README and a
  test asserting none appears). `testing-guide.md:1604`: `restore-staging` stays, its
  `archive-download-x` folder goes.
- [ ] **Step 6: Run** the files of Steps 1–3 plus `src/boot.setup-routes.test.ts`,
  `src/start-full-disk.e2e.test.ts`, `src/hour-recovery-staged.test.ts` and
  `src/restore-command.archive.test.ts`.
- [ ] **Step 7: Commit** — "Every server start removes the working folders a killed restore left".

### Task 6: Secrets staged beside their targets, published by renames, and put back on failure

**Files:**

- Modify: `apps/server/src/state-secrets.ts:104-145` (`unpackBundleToDir`)
- Create: `apps/server/src/restore-secrets.ts`
- Test: `apps/server/src/restore-secrets.test.ts` (new), `apps/server/src/state-secrets.test.ts`
- Modify: `apps/server/src/errors.ts:1694-1702` (the `restore.unsafe_entry_path` doc gains: "or
  names a destination that already exists as a folder")

**Interfaces:**

- Consumes: `unpackBundleToDir(files, destDir, { durable, suffix })` — `suffix` (default `""`) is
  appended to each written file's path after the path guard; every other guarantee is unchanged.
- Produces in `restore-secrets.ts`:
  ```ts
  export const STAGED_SECRET_SUFFIX = ".incoming";
  export const PREVIOUS_SECRET_SUFFIX = ".previous";
  export interface StagedSecrets {
    /** Renames each staged file over its target, trading.env last, keeping a replaced one as
     * `<target>.previous`; on a failure, puts back what it renamed, removes the staged files, then
     * throws the failure. */
    publish(): Promise<void>;
    /** After publish: removes the `.previous` copies. Logs, never throws. */
    finish(): Promise<void>;
    /** Instead of publish: removes the staged files. Logs, never throws. */
    discard(): Promise<void>;
  }
  export async function stageSecrets(args: {
    entries: readonly ArchiveEntry[];
    stateDir: string;
    log: Logger;
  }): Promise<StagedSecrets>;
  ```

- [ ] **Step 1: Write the failing tests** in `restore-secrets.test.ts`:
  - stages every `secrets/` entry as `<name>.incoming` (mode 0600), and leaves each existing
    target's bytes untouched;
  - refuses a target that exists as a folder with `restore.unsafe_entry_path`
    `{ name: "secrets/tls/server.key" }` before writing any staged file;
  - refuses an entry name that escapes the state folder (`secrets/../x`), as `unpackBundleToDir`
    does today;
  - `publish` then `finish`: each target holds the staged bytes, no `.incoming` or `.previous`
    remains, and `trading.env` is the last rename (spy on `rename` through `nativeFs` +
    `syncBuiltinESMExports`, the pattern at `restore.test.ts:1077-1094`);
  - a `publish` whose third rename fails puts the first two targets back to their old bytes, removes
    a target that did not exist before, throws the injected error, and leaves no `.incoming` or
    `.previous`; a put-back rename that also fails logs `restore.secrets.put_back_failed` with `file`;
  - a `tls` folder that is a symbolic link to another folder: staging, publish and finish succeed,
    the files land through the link, and `tls` is still a link;
  - `discard` removes every staged file and nothing else.
  - In `state-secrets.test.ts`: `suffix: ".incoming"` writes `a.env.incoming` and not `a.env`.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-secrets.test.ts src/state-secrets.test.ts`.
- [ ] **Step 3: Implement.** `stageSecrets` maps entries to files as `restoreSecrets` does
  (`restore.ts:810-820`), lstat's every target first (the folder refusal), then calls
  `unpackBundleToDir(files, stateDir, { durable: true, suffix: STAGED_SECRET_SUFFIX })`; a failure
  there removes any staged file written and rethrows. `publish` renames in the order above, then
  `syncFolderHolding` once per folder it renamed into, then logs `restore.secrets.done { count }`.
  One comment at `PREVIOUS_SECRET_SUFFIX`: a killed restore can leave `.incoming` and `.previous`
  files beside the secrets; the next restore's staging and publish replace them.
- [ ] **Step 4: Run** the two files plus `src/recovery-bundle.test.ts`.
- [ ] **Step 5: Commit** — "A restore's secrets can be written beside their targets first and published last".

### Task 7: The restore writes its secrets before it replaces anything

**Files:**

- Modify: `apps/server/src/restore.ts:385-444` (`placeValidated`), `:822-843`
  (`setAsideExistingIdentity`), and the doc comments at `:385-388`, `:445-451`, `:530-533`,
  `:822-828`
- Modify: `apps/server/src/restore-request.ts:616-629` (the marker after a failure)
- Modify: `apps/server/src/restore-command.ts:204-207` (the disk-full comment)
- Test: `apps/server/src/restore.test.ts`, `apps/server/src/restore-request.node-key.test.ts`,
  `apps/server/src/restore-emergency-crash.e2e.test.ts:104-108,337`
- Docs: `deploy/README.md:614-618`

**Interfaces:**

- Consumes: `stageSecrets` / `StagedSecrets` (Task 6).
- Produces in `restore.ts`:
  `setAsideExistingIdentity(stateDir, log): Promise<boolean>` — true when it moved a file;
  `putIdentityBack(stateDir, log): Promise<boolean>` — renames `trading.env.replaced` back to
  `trading.env` when `trading.env` is absent; false, logging `restore.identity.put_back_failed`, when
  it cannot;
  `export function placementLeftNothingChanged(error: unknown): boolean` — true for an error
  `placeValidated` threw after putting back everything it had changed. Backed by a `WeakSet` of
  error objects, the pattern of `failedAtFolderSync` (`packages/provisioning/src/fs-atomic.ts:74-77`).

`placeValidated`, in order:

1. Delete the backup room note (as today). On a resume, the `assertNotAhead` check (as today).
2. Unless `skipSecrets`, `stageSecrets`. A throw here changed nothing (the note aside): mark it,
   rethrow.
3. Not on a resume: set the identity aside unless `skipSecrets`, then `restoreDatabase`. If either
   throws: `discard` the staged secrets; if the identity was moved, `putIdentityBack`; mark the
   error as nothing changed when the put-back succeeded (or nothing was moved) and the error is not
   `restore.placement_failed` with `kept: "set_aside"`; rethrow.
4. Migrate (as today). Under `skipSecrets`, return (as today).
5. The hooks (as today). On a throw from step 4 or 5: `discard` the staged secrets and rethrow; the
   placed database and the set-aside identity stay (owner question 3).
6. `publish`. On a throw, `publish` has already put back what it renamed; rethrow. The placed
   database and the set-aside identity stay, so a staged restore's resume can publish.
7. `finish`.

- [ ] **Step 1: Write the failing tests** (seed an old `venue.db` with known bytes, an old
  `trading.env` and an old `secrets.env` in each):
  - `it("a disk or write failure while writing the secrets leaves the box's database, identity and secrets")`:
    fail the open of `<state>/secrets.env.incoming.tmp` (spy on `nativeFs.open`); expect the
    injected error; `venue.db`, `trading.env`, `secrets.env` hold the old bytes; no
    `trading.env.replaced`; no `*.incoming`; `migrate` not called; no rebuild marker;
    `placementLeftNothingChanged(error)` is true.
  - Rewrite `:1070` as `it("sets the identity aside before placing, and puts it back when placement fails")`:
    keep the injected placement refusal and `migrate` not called; now `trading.env` equals
    `existing`, no `trading.env.replaced`, and `placementLeftNothingChanged` is true. Keep its
    ordering assertion by observing, from inside the injected `mkdir` refusal, that `trading.env` is
    absent and `trading.env.replaced` holds `existing`. (Changed assertion, for the PR list.)
  - Rewrite `:1005` as `it("a secret whose target is a folder is refused before anything changes")`:
    `restore.unsafe_entry_path { name: "secrets/tls/server.key" }`, old `venue.db` and `trading.env`
    untouched, `migrate` not called. (Changed assertion: was `EISDIR` with `trading.env` gone.)
  - `it("a publish that fails after the hooks keeps the restored database and puts back the secrets it renamed")`:
    fail the rename onto `<state>/tls/server.key`; expect the injected error; `venue.db` is the
    archive's; `secrets.env` holds the old bytes; `trading.env` absent and `trading.env.replaced`
    holds the old identity; no `*.incoming` or `*.previous`; `placementLeftNothingChanged` false.
  - `:1123` ("a failed hook leaves NO trading.env…") stays as it is; add to it: no `*.incoming`.
  - `it("a finished restore leaves no staged or previous files")`: the existing success case plus
    the state folder and `tls` holding no `.incoming` / `.previous`.
  - In `restore-request.node-key.test.ts`:
    `it("a started request whose placement changed nothing gets its marker back")`: a staged
    node-key restore whose secrets staging fails (the same `nativeFs.open` injection); expect the
    error, and `restore-request.json` byte-equal to the text before the run (no `placementStarted`).
- [ ] **Step 2: Move the crash test's injection points**, keeping every behavioural assertion:
  `restore-emergency-crash.e2e.test.ts:104-108` fails the `nativeFs.rename` from
  `<state>/trading.env.incoming` to `<state>/trading.env` (fault `settings`) or from
  `credentials.key.incoming` to `credentials.key` (fault `credentials`) instead of the open of the
  `.tmp` file; the child script at `:335-339` waits on the `nativeFs.rename` onto `trading.env`
  instead of the open of `trading.env.tmp`.
- [ ] **Step 3: Run, watch the new cases fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore.test.ts src/restore-request.node-key.test.ts -t "while writing the secrets|puts it back when placement|folder is refused|publish that fails|no staged or previous|changed nothing"`.
- [ ] **Step 4: Implement** `placeValidated` as listed above, `setAsideExistingIdentity`'s boolean,
  `putIdentityBack` and `placementLeftNothingChanged`. In `runStagedRestore`'s catch, before the
  `!markedStarted` branch: when `!resuming && markedStarted && placementLeftNothingChanged(error)`,
  write `raw` back to the marker, as the admission branch does (`restore-request.ts:621-625`).
  Replace the listed doc comments with what is now true, one or two lines each.
- [ ] **Step 5: Comments and docs, narrowed.** `restore-command.ts:204-207`: the words still claim
  nothing about what changed, because a disk that fills after the database is placed (the migration,
  the hooks) leaves the restored database in place. `deploy/README.md:614-618`: a restore that fails
  while writing the secrets or moving the database leaves the box's database, identity and secrets
  as they were; one that fails later keeps the restored database (a staged restore is finished by
  the next start; otherwise run it again); then the exceptions from this plan's "What stays outside"
  paragraph, except the installation-name one unless Step 6 confirms it.
- [ ] **Step 6: Confirm or drop the installation-name exception.** Find the writer of
  `<state>/module-preparation-state.json` (`git grep -n "module-preparation-state" apps/server/src
  ':!*.test.ts'`) and read whether a staged restore records a chosen name there before placement. If
  it does, keep that exception in the README with the `file:line`; if not, delete it from this plan's
  "What stays outside" paragraph in the same commit.
- [ ] **Step 7: Run** `pnpm --filter @waitron/server exec vitest run src/restore.test.ts src/restore-secrets.test.ts src/restore-artifact-file.test.ts src/restore-file-placement.test.ts src/restore-operation-placement.test.ts src/restore-stream.test.ts src/restore-request.test.ts src/restore-request.node-key.test.ts src/restore-emergency-crash.e2e.test.ts src/hour-recovery-placement-1.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts src/restore-fiscal-e2e.test.ts src/backup-data-placement.test.ts`
  — all pass. Then grep for prose the change retires:
  `git grep -n -i "secrets last\|written last\|no bootable identity\|set aside" -- apps/server/src/restore*.ts deploy/README.md docs/developers`
  and correct each hit that describes the old order.
- [ ] **Step 8: Commit** — "A restore writes its secrets before it replaces anything, and puts the identity back when the database cannot be placed".

### Task 8: A full disk during a restore, on a real small filesystem

**Files:**

- Create: `apps/server/src/restore-full-disk.e2e.test.ts`
- Modify: `.github/workflows/ci.yml` — a 32m tmpfs `full-disk-restore` beside the others
  (`:1290-1310`), `WAITRON_FULL_DISK_DIR_RESTORE` beside the others (`:1316-1321`), the file in the
  small-filesystem job's list (`:1324-1336`), and `--exclude src/restore-full-disk.e2e.test.ts` in
  the apps/server shard step (`:1170-1182`)
- Modify: `scripts/ci-workflow.test.mjs` — the file in `STREAM_TEST_FILES` (`:63-76`) and its mount
  row (`:2741-2750`)

- [ ] **Step 1: Write the tests**, following `handover-placement-full-disk.e2e.test.ts`
  (`openSmallDisk("WAITRON_FULL_DISK_DIR_RESTORE", 32)`; skipped locally when unavailable, as that
  file does, failing in CI). The state and venue folders sit on the small filesystem, the staging
  folder on the normal one, so validation's decrypted copy does not fill it. Seed an old `venue.db`,
  `trading.env` and `secrets.env`.
  - `it("a disk too full for the secrets refuses before anything is replaced")`: give the archive a
    2 MiB `secrets/tls/server.crt` entry and leave between 64 KiB and 1 MiB free, so the small
    rebuild marker fits and the staged secrets do not. Record the paths opened through a
    pass-through `nativeFs.open` spy; expect `ENOSPC`, and the last path opened before the failure
    to be `<state>/tls/server.crt.incoming.tmp`. Had the rebuild marker taken the failure, no staged
    file would have been opened at all; old files untouched; no `*.incoming`.
  - `it("a disk with room for the secrets but not the database puts the identity back")`: give the
    archive's database a 4 MiB filler table, leave room for the secrets but not that copy (the
    rename crosses filesystems, so it copies, `restore.ts:648-652`); expect the `ENOSPC` error itself
    (a copy that fails in `restoreDatabase`'s first block is rethrown as it is, `restore.ts:645-662`);
    old `venue.db` bytes, `trading.env` back, no `trading.env.replaced`, no `*.incoming`.
- [ ] **Step 2: Run on this Mac**:
  `pnpm --filter @waitron/server exec vitest run src/restore-full-disk.e2e.test.ts` — both pass.
  Run the second case in a throwaway worktree at `59be31e3b7` (CLAUDE.md §4) and put what it printed
  in the commit message: there it leaves `trading.env` set aside.
- [ ] **Step 3:** The CI edits listed above; run `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
  If `scripts/vitest-duration-sequencer.test.mjs` or the duration table needs the new file named,
  follow its failure.
- [ ] **Step 4: Commit** — "A full disk during a restore leaves the box as it was, on a real small filesystem".

### Task 9: Notes at the sites, and the backlog

**Files:**

- Modify: `apps/server/src/restore.ts:758-768` (`clearReplacedDatabases` doc),
  `apps/server/src/rebuild-first-start.ts:197`, `apps/server/src/bounded-store.ts:8`
- Modify: `docs/backlog/box.md` (delete "## Bundle A1390" at `:1367-1379` and the three detail
  sections at `:385-410`, `:1813-1820`, `:1822-1832`; add three lines under "## Decisions and
  deliberate limits" at `:1650`), `docs/backlog.md:115` and `:1806` (delete)

- [ ] **Step 1:** At `clearReplacedDatabases`: one line — only the box's entry (`node-entry.ts`)
  calls it, before anything opens `venue.db`; a server started from `bin.ts` (the dev stack) does
  not.
- [ ] **Step 2:** At `POINTER_READ_TIMEOUT_MS`: bounds the one read that holds a restored box's first
  start, which fails and is tried again at the next start; the rebuild's calls have their own bound
  (`BUCKET_CALL_TIMEOUT_MS`). At `BUCKET_CALL_TIMEOUT_MS`: bounds each call of an operator-run
  rebuild; a restored box's first start has its own (`POINTER_READ_TIMEOUT_MS`). No reason given for
  either number.
- [ ] **Step 3:** Backlog. Delete the bundle, its three detail sections and both index lines; grep
  `git grep -n "A1390\|restore-is-all-or-nothing\|loose-ends-left-by-sqlite-slice-2-task-9b\|recovery-kit-can-carry\|fails-while-writing-the-secrets" docs`
  and fix each remaining pointer. Under "Decisions and deliberate limits" add three lines, each
  worded as a default taken pending the owner, not an owner decision: "Default taken pending the
  owner (A1390 question 1, 2026-11-07): …", the same for question 2 and question 3.
- [ ] **Step 4: Run** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/claude-md-pointers.test.ts scripts/personal-log-params.test.ts`.
- [ ] **Step 5: Commit** — "A1390 closed: notes at the two time limits and the replaced-database clean-up, and the backlog entries removed".

## After the tasks

Run `/finish-branch` with the worktree path and a note naming this plan: the full wave (risk
triggers: concurrency, the box's fiscal identity), the Codex run-it seat as two reviews, the second
told to set the plan aside. The PR description lists every changed assertion from Tasks 2, 3, 5 and
7 with its reason.

## Review fold (2026-11-07)

The fresh-context review of `4078b771c3`, and how each finding was folded:

- **Should this exist / Critical 1** (the database put-back after the hook commit breaks the staged
  restore's resume): adopted. The first draft's Task 6 (`placeDatabase`) is gone; Task 7 puts back
  only the identity, and only when the database placement fails; the post-commit path keeps today's
  behaviour; a staged restore that changed nothing gets its marker back, with a
  `restore-request.node-key.test.ts` case. One part of the suggestion was not adopted: putting the
  identity back after a migration or hook failure, because the archive's database is in place then
  and the set-aside exists so that no identity starts beside it (`restore.ts:822-828`). That case is
  owner question 3, default keep today's behaviour.
- **Important 2** (crash-test injection points): listed under Point 2, moved in Task 7 Step 2,
  assertions kept.
- **Important 3** (Task 5 reverses `db4e0a6bf1`): its reason, the changed assertions, the testing
  guide line, `DOWNLOAD_LEFT_BEHIND` and its pinned copy are in Point 3c and Task 5.
- **Important 4** (`clearReplacedDatabases` and a put-back): no database put-back survives the
  redesign, so not applicable.
- **Important 5** (CI lists, where the full disk was met): Task 8's file list and first case.
- **Important 6** (claims too broad): the Goal, "What stays outside", Task 7 Step 5 and Step 6.
  Peak disk use does not grow: the old database is no longer kept longer, and the staged secrets are
  the size of the secrets.
- **Minor 7** (Task 3): the changed assertions are listed; a main-thread control is in the test;
  the side files are noted under Point 3a. The problem count is not kept: a yes/no check has none.
- **Minor 8** (Task 4's claim): narrowed in Task 4.
- **Minor 9** (a linked `restore-staging`): Task 5's `restoreLeftovers` and its test.
- **Minor 10** (decision wording): Task 9 Step 3.
