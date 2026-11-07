# A1390: a restore is all or nothing, and its key always opens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A restore either finishes or leaves the box exactly as it was — its database, its
identity file (`trading.env`) and its other secrets — whichever step fails; the bucket copy code in
a recovery pack opens whatever recovery key the box itself accepts; and the bucket rebuild's loose
ends from SQLite slice 2 Task 9b are closed.

**Architecture:** The restore's last step, `placeValidated` (`apps/server/src/restore.ts`), changes
from "replace, then write" to "stage, replace with a way back, publish, then let go". The secrets
are written first, beside their targets under a staged name, so a full disk or a write error is
met before anything is replaced. The database placement keeps the replaced files in its set-aside
folder until the caller releases them, and can put them back. Any failure after the first change
runs the recorded undo steps in reverse. Around that: the kit parser drops a rule the box's own key
rules do not have, the bucket rebuild's damage check moves onto its own thread, the restore command
holds the venue folder for its whole run, and every server start removes the restore's leftover
working folders.

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
  (`runRestoreHooks`) keep their code; only what happens around them on failure changes.
- **Risk triggers hit: concurrency** (Task 4 widens the restore command's hold on the venue folder;
  Task 5 deletes folders other flows create, under that hold; Tasks 6–8 order an undo across files)
  **and the box's fiscal identity** (Task 8 changes how `trading.env` and the node's `node.db` are
  replaced and put back). So the branch takes the FULL ceremony: a per-task reviewer on every task,
  the full `/finish-branch` wave, and the Codex run-it seat as two reviews side by side, the second
  told to set this plan's checklist aside.
- No new error code. Reused codes: `restore.identity_unknown` (Task 2), `restore.unsafe_entry_path`
  (Task 7), `restore.placement_failed` (Task 8). So `scripts/errors-reachable.test.ts` and
  `scripts/alert-codes.test.ts` gain nothing; run them once in Task 10 anyway.
- New log events (free-form names; no registry): `restore.identity.put_back_failed { errno }`,
  `restore.secrets.put_back_failed { file, errno }`, `restore.secrets.previous_kept { file, errno }`,
  `restore.leftover_removed { folder }`, `restore.leftover_kept { folder, errno }`. `file` and
  `folder` are base names (a secret's relative name such as `tls/server.key`), never a full path.
- English only in code, comments, identifiers and tests (CLAUDE.md §3). Comments only for an
  invariant or a non-obvious why; when you touch a comment this plan retires, delete or replace it.
- Every commit `git commit -s`, message in plain English.
- Each implementer runs `pnpm format:check` and `pnpm --filter @waitron/server typecheck` (plus
  `pnpm --filter @waitron/stream typecheck` in Task 1) before committing, and the focused tests its
  task names. CI owns the package suites and coverage (`98/98/98/95`): a new branch that no test
  reaches fails CI, so each task's tests cover every branch it adds.
- Under an AI agent Vitest hides passing tests' output; read the `Tests` count line, not the exit
  status of a pipe (CLAUDE.md §4).

## Review Focus

1. **A secret whose folder is a link.** A box's `tls` folder may be a symbolic link
   (`syncFolderHolding`, `packages/provisioning/src/fs-atomic.ts:43-54`). Staged files sit beside
   their targets, so every rename stays inside one folder and one filesystem. Expected: a restore
   onto a box whose `tls` is a link succeeds and leaves the link in place. Task 7 tests it.
2. **A box with no database yet (a fresh box).** The undo must leave the venue folder with no
   `venue.db`, not with the archive's. Expected: after a failed restore onto an empty venue folder,
   no `venue.db`, no `node.db`, no `.venue.db-replaced-*` folder. Task 6 tests it.
3. **A failure while the undo itself fails.** The database put back only in part is reported as
   today (`restore.placement_failed`, `kept: "set_aside"`, naming the folder). An identity or secret
   that cannot be put back is logged and the original error is thrown. Expected: the command never
   prints "unchanged" when something was not put back. Task 8 tests the database case; the log
   cases are tested in Tasks 7 and 8.
4. **A restore that runs while the server is up.** Expected: refused
   `provisioning.database_in_use` before it downloads or decrypts anything, with no working folder
   left. Task 4 tests it with a real second process.
5. **The undo after the hooks ran.** The hooks commit inside the placed `venue.db` and `node.db`
   (`withRecoveryModuleOperation` writes only through the two handles,
   `apps/server/src/recovery-module-operation.ts:138-180`). Putting both files back undoes them.
   Expected: after a failure at publish, the box's own `node.db` bytes are back as well as its
   `venue.db`. Task 8 tests it.

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
  control). So a dashboard-set key holding DEL, or an operator's environment key holding a tab,
  produces a bucket copy code its own restore calls damaged.
- **Decision:** the kit takes the key the box takes: any non-empty string. The control-character
  rule stays for `venueId` and `pointerSignerPublicKey`. A key shorter than the box's minimum still
  parses and then fails to open the locked row with the existing "does not open" words; the kit is
  not the place for the box's length rule (`packages/stream` cannot import `apps/server`).
- **Bench:** `bench/sqlite-failover/src/probes/restore-time.ts:105-106` still multiplies `bavail`
  by `bsize`. **Ran:** `fs.statfsSync('/tmp')` on this Mac prints `bsize: 4096, frsize: 4096`, so a
  test here cannot tell the two apart (a probe where both answers look alike measures nothing). The
  fix is the one-word change to `frsize`, matching `apps/server/src/free-bytes.ts:11`, with no test.

### Point 2: the half-done restore — still open

- Order today in `placeValidated` (`apps/server/src/restore.ts:389-444`): set the identity aside
  (`:405`), place the database (`:406-413`), migrate (`:417-420`), run the hooks (`:425-440`),
  write the secrets (`:443`).
- **Ran:** a case using `restore.test.ts`'s own helpers seeded an old `venue.db`, an old
  `trading.env`, and a folder at `tls/server.key`, then restored. Result: `EISDIR`; `venue.db` was
  the archive's (the failing case), not the old bytes; `trading.env` absent;
  `trading.env.replaced` present; `secrets.env` present (the archive's, written before the failure).
  The backlog's claim holds.
- **Ran:** `restore.test.ts -t "a pre-existing VALID identity is set aside BEFORE"` passes today.
  That case injects a placement failure and asserts `trading.env` is gone and
  `trading.env.replaced` holds the box's identity (`restore.test.ts:1070-1102`): the second half of
  the backlog's claim is pinned by a passing test.
- **Decision (both of the backlog's remedies, because each covers what the other misses):** stage
  the secrets before anything changes (Task 7), and keep a way back for the database and the
  identity until the very end (Tasks 6 and 8). Staging alone would still leave a failed hook or a
  failed rename with the archive's database in place; a way back alone would leave the old
  `secrets.env` overwritten.
- **Existing tests that pin the defect, and change:** `restore.test.ts:1005` ("leaves no
  trading.env when a later TLS secret write fails with EISDIR"), `:1070` (the set-aside case
  above), `:1123` ("a failed hook leaves NO trading.env, neither the target's nor the artifact's").
  Their failure-code assertions are kept; their after-state assertions are reversed, because that
  state is this bundle's defect. `:1070`'s ordering half ("set aside BEFORE the venue file is
  replaced") is kept, moved into an observation from inside `migrate` (Task 8).

### Point 3a: the integrity check and the watchdog — still open, in both processes

- The restore command and the setup wizard both reach `readRestoredCopy`
  (`apps/server/src/restore-stream.ts:236-263`) through `prepareStreamRestore`. It opens the
  downloaded copy with `openVenueDatabase` (`:244`), which takes the copy's folder lock
  (`packages/store/src/index.ts:240-241`), whose first take starts the watchdog thread
  (`packages/store/src/venue-lock.ts:85-88`, `packages/store/src/venue-liveness.ts:279-292`). The
  check is then one synchronous `pragma integrity_check` (`restore-stream.ts:85-96`). The watchdog
  kills after 120 s with no timer turn (`venue-liveness.ts:22`).
- **Ran:** a 60,000-row, ~240 MB file in a temporary folder: no watchdog before
  `openVenueDatabase`, a watchdog after it; `checkIntegrity` took 635 ms during which a 10 ms
  interval fired 0 times. So "the restore command does not run the watchdog" is false: it runs it
  for the copy it checks.
- **Decision:** run the check on its own thread with the existing `isCopyIntact`
  (`apps/server/src/handover-integrity.ts:46-82`), before the copy is opened. That function also
  runs `pragma foreign_key_check`, so a copy whose rows name a missing parent is now refused as
  damaged. Archive verification already refuses that (`apps/server/src/backup-verification.ts:79-90`),
  and so does the handover's compare, so the bucket rebuild now agrees with both.

### Point 3b: a copy with no taxpayer — still open

- `readRestoredVenue` reads the `tenants` row optionally and falls back to `""`
  (`restore-stream.ts:210-232`); `confirmsVenue` never accepts `""` (`:49-51`). The archive
  preview already refuses a copy with no taxpayer as `restore.identity_unknown`
  (`apps/server/src/recovery-backup-preview.ts:60-61`), and that code's registry text already says
  "or the restored copy holds no taxpayer row" (`apps/server/src/errors.ts:1719-1721`). Today's
  bucket behaviour is pinned by `restore-stream.test.ts:1334-1351`, which expects
  `restore.stream_venue_unconfirmed` with an empty tax id.
- **Decision:** the bucket path throws `restore.identity_unknown` too. No new code, so no new
  wording: the command line already prints `restore failed: restore.identity_unknown` for the
  no-venue case (`apps/server/src/restore-command.ts:404`).

### Point 3c: leftover working folders — still open, and one more kind found

- What creates them, with the folder each sits in: `stream-restore-` in the state folder
  (`restore-stream.ts:56`, `:204-207`), `restore-entry-` in the state folder
  (`apps/server/src/restore-request.ts:509`, not named by the backlog, same class: a copy of the
  venue database), and inside `restore-staging`: `archive-download-`
  (`apps/server/src/archive-download.ts:66`), `archive-validate-` (`restore.ts:273`, `:1044`) and
  `restore-admission-` (`restore.ts:471`). Each removes its own folder on every handled failure; a
  killed process leaves it.
- What clears today: only `restore-staging/staged-recovery`, at boot once the process holds the
  venue folder (`apps/server/src/boot.ts:1200-1202`), and at the box's entry's free-space step
  (`apps/server/src/start-space.ts:96-99`). Nothing clears the five kinds above.
- Why a plain clean-up at start is not safe today: the restore command does not hold the venue
  folder while it downloads and checks — it takes the hold only when it places
  (`writeValidated`, `restore.ts:456`). So a server starting meanwhile would delete a running
  command's folder.
- **Decision:** the restore command holds the venue folder from the moment it resolves where it is
  restoring to until it exits (Task 4). Then every folder of these kinds was made either by a
  process that held the venue folder or by the starting process itself, and the start's clean-up
  (already under the hold) removes them (Task 5). Holding earlier changes no outcome — a command run
  beside the server was always refused at placement — it only refuses before a long download
  instead of after it. `deploy/README.md:636-648` (which tells the operator to delete these folders
  by hand, and names an `archive-source-check-` folder no code makes any more:
  `git grep -n "archive-source-check"` finds only the README and a test asserting none appears) is
  rewritten in Task 5.

### Point 3d: `.venue.db-replaced-` folders outside the box's entry — decided, document

- `clearReplacedDatabases` runs only in the box's entry (`apps/server/src/node-entry.ts:650-652`).
  The box image always starts through that entry (`deploy/Dockerfile:286`,
  `ENTRYPOINT ["node", "/app/node-entry.js"]`). The dev stack starts `src/bin.ts`
  (`apps/server/scripts/dev-server.mjs:65`), which skips every step of the entry's start, including
  the free-space clean-up and the staged restore, not only this one.
- Moving the call into `startServer` is not a small fix: it relies on running before anything
  creates `venue.db` (its "no `venue.db` beside a non-empty folder" refusal,
  `restore.ts:769-801`), and boot's first venue open (`boot.ts:1180`) creates one.
- **Decision (owner question 1, default taken):** no code change. Task 10 states at
  `clearReplacedDatabases` that only the box's entry runs it, and records the limit under
  "Decisions and deliberate limits" in `docs/backlog/box.md`.

### Point 3e: 15 seconds and 60 seconds — decided, document at the sites

- First start: `POINTER_READ_TIMEOUT_MS = 15_000` bounds one pointer read that holds a restored
  box's first trading start; on the bound or a failure with no code of its own it throws the
  log-only `restore.pointer_unreadable`, and the start fails and is tried again at the next start
  (`apps/server/src/rebuild-first-start.ts:198-240`; commit `7dd33ee508`'s message: "The first
  start then fails: the marker stays … and the next start tries again").
- Bucket rebuild: `BUCKET_CALL_TIMEOUT_MS = 60_000` bounds each call of an operator-run rebuild,
  added because the S3 client has no time limit of its own (`apps/server/src/bounded-store.ts:9`;
  commit `1421665e6a`'s message: "Every bucket call the command makes is bounded … because
  createS3ObjectStore gives its client no timeout"). A timeout there is
  `backup.stream_request_failed`, the code an unanswered call already carries.
- Neither number was measured; the commit messages give no reason for 15 or 60 themselves.
- **Decision (owner question 2, default taken):** no behaviour change. One line at each constant
  saying what it bounds and that the other exists for a different caller; no invented reason for
  the numbers.

## Owner questions (build proceeds with each default)

1. **Should a server started outside the box's entry (the dev stack) also clear
   `.venue.db-replaced-` folders?** Default: no; document that only the box's entry does, because
   the box always starts through it and the dev stack skips the entry's whole start sequence.
2. **Should the first start's 15-second pointer read and the rebuild's 60-second calls share one
   limit or one code?** Default: no; one line at each constant says what it bounds. They serve
   different callers (a start that retries by itself, an operator who waits), and nothing measured
   either number.

## File structure

| File                                                  | Change                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/stream/src/kit.ts`                          | Task 1: `recoveryKey` checked as non-empty text only                                       |
| `bench/sqlite-failover/src/probes/restore-time.ts`    | Task 1: `frsize`                                                                           |
| `apps/server/src/restore-stream.ts`                   | Tasks 2–3: taxpayer refusal; check on its own thread                                       |
| `apps/server/src/restore-command.ts`                  | Task 4: holds the venue folder for the run; Task 8: disk-full comment                      |
| `apps/server/src/restore-staging-dirs.ts`             | Task 5: the leftover prefixes and `restoreLeftovers`                                       |
| `apps/server/src/boot.ts`, `start-space.ts`           | Task 5: both clean-ups remove every leftover                                               |
| `apps/server/src/restore.ts`                          | Task 6: `placeDatabase`; Task 8: `placeValidated` all or nothing                           |
| `apps/server/src/state-secrets.ts`                    | Task 7: `unpackBundleToDir` gains a `suffix` option                                        |
| `apps/server/src/restore-secrets.ts` (new)            | Task 7: `stageSecrets`                                                                     |
| `apps/server/src/restore-full-disk.e2e.test.ts` (new) | Task 9                                                                                     |
| `.github/workflows/ci.yml`, `scripts/ci-workflow.test.mjs` | Task 9: the new small filesystem                                                      |
| `deploy/README.md`, `docs/developers/conventions-data.md`, `docs/backlog/box.md`, `docs/backlog.md` | Tasks 4, 5, 6, 8, 10                                |

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
    (use the file's existing valid kit fixture as `KIT`).
  - `it("still refuses an empty recovery key")` — `recoveryKey: ""` rejects
    `{ code: "backup.stream_kit_invalid", params: { reason: "shape" } }`.
  - `it("still refuses a control character in the venue id or the signer's key")` — a tab in
    `venueId`, then in `pointerSignerPublicKey`, each rejects `reason: "shape"`.
- [ ] **Step 2: Run, watch the first fail**:
  `pnpm --filter @waitron/stream exec vitest run src/kit.test.ts` — expected: the tab/DEL case
  FAILS with `backup.stream_kit_invalid`; the other two pass (they pin what must not change).
- [ ] **Step 3: Implement.** In `parseRecoveryKit`, check `recoveryKey` with
  `typeof k.recoveryKey === "string" && k.recoveryKey !== ""` instead of `text(...)`. Keep `text`
  for the other two fields. One comment line at the check: the box's rules
  (`checkedRecoveryKey`) allow any characters, and a kit must open the key it was made with.
- [ ] **Step 4:** In `restore-time.ts:106`, `disk.bavail * disk.frsize`.
- [ ] **Step 5: Run** the kit tests (all pass) and
  `pnpm --filter @waitron/stream typecheck && pnpm --filter @waitron/bench-sqlite-failover typecheck`.
- [ ] **Step 6: Commit** — "The bucket copy code opens a recovery key holding any character the box accepts".

### Task 2: A bucket copy with no taxpayer is refused as an unknown identity

**Files:**

- Modify: `apps/server/src/restore-stream.ts:210-232`
- Test: `apps/server/src/restore-stream.test.ts:1334-1351`

- [ ] **Step 1: Change the pinning test** "never confirms a copy that names no tax id, even against
  an empty confirmation" into `it("refuses a copy with no taxpayer as an unknown identity, staging nothing")`:
  same fixture (`delete from tenants`), now
  `rejects.toMatchObject({ code: "restore.identity_unknown" })`, and keep
  `await expectStateUntouched(deps.stateDir)`.
- [ ] **Step 2: Run, watch it fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts -t "no taxpayer"` —
  expected FAIL: received `restore.stream_venue_unconfirmed`.
- [ ] **Step 3: Implement.** In `readRestoredVenue`, a missing `tenant` throws
  `new AppError("restore.identity_unknown", { nodeId })`, as the archive preview does; return
  `tenant.legalName` / `tenant.taxId` directly. Leave `confirmsVenue`'s `taxId !== ""` guard (a row
  holding an empty tax id is still storable: `tax_id` is a plain `text` column,
  `packages/db/src/schema/tenants.ts:43`, `columns.ts:162`).
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts`
  — all pass.
- [ ] **Step 5: Commit** — "A bucket copy with no taxpayer row is refused as an unknown identity".

### Task 3: The bucket rebuild checks the copy on its own thread

**Files:**

- Modify: `apps/server/src/restore-stream.ts:66,85-100,236-263`
- Test: `apps/server/src/restore-stream.test.ts:385-396,885-935,1043-1050`

**Interfaces:**

- Produces: `export function checkIntegrity(databasePath: string): Promise<boolean>` (true when
  `isCopyIntact` says intact) and `PrepareStreamDeps.checkIntegrity?: (databasePath: string) => Promise<boolean>`.

- [ ] **Step 1: Write the failing test** `it("keeps the main thread's timers turning while it checks a large copy")`:
  build a plain SQLite file in a fresh folder (`create table t(x blob)`, 15,000 rows of
  `randomblob(4000)`, about 60 MB, one transaction), start `setInterval(() => ticks++, 10)`, await
  `checkIntegrity(join(dir, "venue.db"))`, clear the interval; expect the answer `true` and
  `ticks` greater than 0. (Measured on today's code at 0 ticks for a larger file; the old signature
  takes a store, so the test opens one in Step 2's run only to see the failure.)
- [ ] **Step 2: Run, watch it fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts -t "timers turning"` —
  expected FAIL (type error or `ticks` 0).
- [ ] **Step 3: Implement.** `checkIntegrity(databasePath)` returns `isCopyIntact(databasePath)`
  (`./handover-integrity.js`). In `readRestoredCopy`, call `args.checkIntegrity(join(args.directory,
  VENUE_FILE))` BEFORE `openVenueDatabase`; `false` → `integrityFailed(args.log)`. `integrityFailed`
  logs `restore.stream_integrity_failed` with `{}` (the problem count no longer exists). A thread
  that fails to answer rejects, and the rejection propagates. Update the doc comment on
  `checkIntegrity` to say it runs on its own thread and also refuses a broken foreign key.
- [ ] **Step 4: Update the other tests**: the injected `checkIntegrity: async () => [...]` (lines
  387, 1046) become `async () => false`; `integrityOf` and the `describe("checkIntegrity")` cases
  call `checkIntegrity(join(dir, "venue.db"))` and expect `true` / `false`; the
  "fails a download that is not a database" case expects `problems` to equal `[{}]`; "reports a
  copy it cannot read" becomes a missing file reading `false`.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/restore-stream.test.ts src/handover-integrity.test.ts src/recovery-backup-preview.test.ts`
  — all pass. If a healthy fixture now fails `foreign_key_check`, stop and report: that is a finding,
  not a test to loosen.
- [ ] **Step 6: Commit** — "The bucket rebuild checks the downloaded copy on its own thread, so the watchdog never sees a stall".

### Task 4: The restore command holds the venue folder for its whole run

**Files:**

- Modify: `apps/server/src/restore-command.ts` (`CommandDeps`, `resolveRestoreTarget` `:287-334`,
  and its three callers at `:136`, `:481` and `:612`)
- Test: `apps/server/src/restore-command.test.ts`
- Docs: `docs/developers/conventions-data.md:3356` (the lock-caller row for `restore-stream.ts`)

**Interfaces:**

- Produces: `CommandDeps.lockVenue?: (venueDir: string) => Promise<VenueLock>`; default makes the
  folder (`mkdir(venueDir, { recursive: true, mode: 0o700 })`, as `lockRestoreTarget` does,
  `restore.ts:525-528`) then `lockVenueDatabase(venueDir)`.
  `resolveRestoreTarget(deps)` returns `{ target: RestoreTarget; hold: VenueLock } | number`.

- [ ] **Step 1: Write the failing tests** in `restore-command.test.ts`:
  - `it("refuses at once while another program holds the venue folder, before reading the bucket")`:
    `lockVenue` throws `new AppError("provisioning.database_in_use", { database: venueDir })`;
    run `restore --from-bucket <kit>`; expect exit 1, the existing in-use words (`restore-command.ts:392`) printed,
    `restoreStream` never called.
  - The same for `restore <artifact>` (`restore` never called) and `restore --from-archive`
    (`openFiles` / download never called).
  - `it("holds the venue folder until it exits")`: a `lockVenue` stub records `release` calls;
    `restoreStream` asserts inside itself that `release` has not been called; after the run,
    exactly one release.
  - `it("is refused by a real second process holding the folder, leaving no working folder")`:
    take the folder in a child process the way `restore.test.ts:314-345` does, run the bucket form
    with the real default `lockVenue`; expect exit 1, the in-use line, and
    `readdirSync(stateDir)` holding no `stream-restore-*` entry.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-command.test.ts -t "venue folder"`.
- [ ] **Step 3: Implement.** In `resolveRestoreTarget`, after `assertNoStartAgainDeletion` and the
  first-setup branch, take `hold = await (deps.lockVenue ?? defaultLock)(venueDir)`; a refusal
  prints `sharedRefusal(err)` (so `provisioning.database_in_use` keeps its words) and returns 1.
  Each caller wraps everything after it in `try { … } finally { hold.release(); }`.
  `writeValidated`'s own take shares this hold (`packages/store/src/venue-lock.ts:78-107`).
- [ ] **Step 4:** Update the conventions-data row: the restore command holds the venue folder from
  resolving its target to exit, so the downloads and checks run under it.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/restore-command.test.ts src/restore-command.archive.test.ts src/restore-command.archive-target.test.ts`
  — all pass.
- [ ] **Step 6: Commit** — "The restore command holds the venue folder from the start, so a running server refuses it before any download".

### Task 5: Every server start removes the restore's leftover working folders

**Files:**

- Modify: `apps/server/src/restore-staging-dirs.ts`, the five creators
  (`restore-stream.ts:56`, `restore-request.ts:509`, `archive-download.ts:66`,
  `restore.ts:273,471,1044`), `apps/server/src/boot.ts:1200-1202`,
  `apps/server/src/start-space.ts:53-99`
- Test: `apps/server/src/restore-staging-dirs.test.ts` (new), `apps/server/src/start-space.test.ts`,
  and the boot test that covers `staged-recovery` today
  (`git grep -n "staged-recovery\|STAGED_RECOVERY" apps/server/src/boot.setup-routes.test.ts`)
- Docs: `deploy/README.md:636-648`

**Interfaces:**

- Produces in `restore-staging-dirs.ts`:
  `export const STATE_SCRATCH_PREFIXES = ["stream-restore-", "restore-entry-"] as const;`
  `export const STAGING_SCRATCH_PREFIXES = ["archive-download-", "archive-validate-", "restore-admission-"] as const;`
  `export async function restoreLeftovers(stateDir: string): Promise<string[]>` — full paths of
  every directory (a symbolic link is skipped: `readdir(..., { withFileTypes: true })` and
  `isDirectory()`) in the state folder whose name starts with a state prefix, and in
  `restore-staging` with a staging prefix or named `staged-recovery`; a missing folder lists nothing.
  `export async function clearRestoreLeftovers(stateDir: string, log: Logger): Promise<void>` —
  removes each (`rm` recursive, force), logging `restore.leftover_removed` or
  `restore.leftover_kept`; never throws.
- Each creator builds its prefix from these constants.

- [ ] **Step 1: Write the failing tests.** In the new file: `restoreLeftovers` lists one folder of
  each of the five kinds plus `staged-recovery`, and does NOT list: a file named
  `stream-restore-x`, a symbolic link named `archive-download-x`, a folder `venue`, a folder
  `backup-staging`, a folder `stream-restore` with no suffix… (the prefix needs its trailing `-`).
  `clearRestoreLeftovers` removes them and logs one `restore.leftover_removed` per folder. In
  `start-space.test.ts`: a start (not below the floor) removes the five kinds, and leaves them when
  another process holds the venue folder (extend the existing staged-recovery cases). In the boot
  test: a start removes a `stream-restore-*` folder in the state folder.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-staging-dirs.test.ts src/start-space.test.ts`.
- [ ] **Step 3: Implement.** `boot.ts:1202` calls `clearRestoreLeftovers(config.stateDir, log)` in
  place of `clearStagedRecoveries(...)`; keep the comment above it. In `freeSpaceAtStart`'s
  `deleteStagingLeftovers`, replace the `STAGED_RECOVERY_DIR` removal with
  `for (const path of await restoreLeftovers(deps.stateDir)) await remove(path, true);`, and update
  the function's doc comment to say "and the restore's working folders". `clearStagedRecoveries`
  stays for `recovery-preparation.ts:573`.
- [ ] **Step 4: Docs.** Rewrite `deploy/README.md:636-648`: a restore is refused while another
  program holds the venue folder, before it downloads or checks anything (Task 4); a run that is
  killed leaves its working folder, and the next server start removes it. Delete the
  hand-deletion instructions and the `archive-source-check-` name.
- [ ] **Step 5: Run** the two files above plus `src/boot.setup-routes.test.ts`,
  `src/start-full-disk.e2e.test.ts` and `src/hour-recovery-staged.test.ts` — all pass.
- [ ] **Step 6: Commit** — "Every server start removes the working folders a killed restore left".

### Task 6: A database placement can be undone until it is let go

**Files:**

- Modify: `apps/server/src/restore.ts:576-708` (`restoreDatabase`, `putBackMoved`)
- Test: `apps/server/src/restore.test.ts` ("restoreDatabase places a REAL venue file" describe,
  `:775-892`)
- Docs: `deploy/README.md:619-621` (what the set-aside folder holds)

**Interfaces:**

- Produces:
  ```ts
  export interface PlacedDatabase {
    readonly target: string;
    /** Removes the placed files and moves the replaced ones back, the main file last. */
    putBack(): Promise<{ kept: "previous" } | { kept: "set_aside"; folder: string }>;
    /** Removes the set-aside folder; a failure is logged as `restore.db.aside_kept`, never thrown. */
    release(): Promise<void>;
  }
  export async function placeDatabase(args: RestoreDatabaseArgs): Promise<PlacedDatabase>;
  export async function restoreDatabase(args: RestoreDatabaseArgs): Promise<string>; // place + release
  ```
  `RestoreDatabaseArgs` is today's parameter type, named. `placeBackupDatabase`
  (`backup-data-placement.ts:31`) keeps calling `restoreDatabase`, unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `it("puts the replaced database back, side files and node.db with it")`: an old venue file
    with a WAL holding a committed row and an old `node.db`; `placeDatabase` with a `nodeDump`;
    open and write the placed files (so they grow side files); close; `putBack()` answers
    `{ kept: "previous" }`; the old row reads back, the old `node.db` bytes are back, no placed side
    file and no `.venue.db-replaced-*` folder remain.
  - `it("leaves a fresh folder empty when it puts back")`: no old files; after `putBack()` neither
    `venue.db` nor `node.db` exists, and no set-aside folder.
  - `it("keeps Litestream's folder with the replaced database and brings it back")`: a
    `.venue.db-litestream/` folder holding a file before placement is absent after placement and
    back with its file after `putBack()`; after `release()` instead, it is gone.
  - `it("reports what it could not put back")`: an injected `fs.rename` failing on the main
    file's move back answers `{ kept: "set_aside", folder }` with the folder still holding it.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore.test.ts -t "puts the replaced|fresh folder empty|Litestream's folder|could not put back"`.
- [ ] **Step 3: Implement.** Split `restoreDatabase`'s body: everything up to and including the
  final rename becomes `placeDatabase`, which no longer removes the set-aside folder. The Litestream
  folder (`litestreamMetaDir(target)`) is renamed into the set-aside folder instead of removed
  (`fs.rm` at `:656`): make the set-aside folder first, then move the Litestream folder into it, so a
  failure in that first block can move it back; record it so `putBack` moves it back first.
  `putBack` removes the placed main and side files (and the placed `node.db` set when a `nodeDump`
  was given), then reuses `putBackMoved`. Its first removal or move that fails stops it with
  `set_aside`, as `putBackMoved` does. The existing placement-failure path (`:684-698`) is
  unchanged.
- [ ] **Step 4: Docs.** `deploy/README.md:619-621`: the folder can also hold the replaced database's
  `.venue.db-litestream` folder.
- [ ] **Step 5: Run** `pnpm --filter @waitron/server exec vitest run src/restore.test.ts src/restore-file-placement.test.ts`
  — all pass.
- [ ] **Step 6: Commit** — "A database placement keeps the replaced files until it is let go, and can put them back".

### Task 7: Secrets staged beside their targets, published last, and put back on failure

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
     * `<target>.previous`; on a failure, puts back what it renamed, then throws the failure. */
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
    `{ name: "secrets/tls/server.key" }` before writing any staged file (no `*.incoming` anywhere);
  - refuses an entry name that escapes the state folder (`secrets/../x`) as `unpackBundleToDir`
    does today;
  - `publish` then `finish`: each target holds the staged bytes, no `.incoming` or `.previous`
    remains; `trading.env` is the last rename (spy on `rename` through `nativeFs` +
    `syncBuiltinESMExports`, the pattern at `restore.test.ts:1077-1094`);
  - a `publish` whose third rename fails puts the first two targets back to their old bytes,
    removes a target that did not exist before, throws the injected error, and leaves no
    `.incoming` or `.previous`; a put-back rename that also fails logs
    `restore.secrets.put_back_failed` with `file`;
  - a `tls` folder that is a symbolic link to another folder: staging, publish and finish succeed,
    the files land through the link, and `tls` is still a link;
  - `discard` removes every staged file and nothing else.
  - In `state-secrets.test.ts`: `suffix: ".incoming"` writes `a.env.incoming` and not `a.env`.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore-secrets.test.ts src/state-secrets.test.ts`.
- [ ] **Step 3: Implement.** `stageSecrets` maps entries to files as `restoreSecrets` does
  (`restore.ts:810-820`), lstat's every target first (the folder refusal), then calls
  `unpackBundleToDir(files, stateDir, { durable: true, suffix: STAGED_SECRET_SUFFIX })`; a failure
  there removes any staged file written and rethrows. `publish` does the renames in the order
  above, then `syncFolderHolding` once per folder it renamed into, then logs
  `restore.secrets.done { count }`. Comment at `PREVIOUS_SECRET_SUFFIX`: a killed restore can leave
  `.incoming` and `.previous` files beside the secrets; the next restore's staging and publish
  replace them.
- [ ] **Step 4: Run** the two files plus `src/recovery-bundle.test.ts` — all pass.
- [ ] **Step 5: Commit** — "A restore's secrets are written beside their targets first and published last, with a way back".

### Task 8: `placeValidated` is all or nothing

**Files:**

- Modify: `apps/server/src/restore.ts:385-444` (`placeValidated`), `:822-843`
  (`setAsideExistingIdentity`), doc comments at `:385-388`, `:445-451`, `:530-533`, `:822-828`
- Modify: `apps/server/src/restore-command.ts:204-209` (the disk-full comment)
- Test: `apps/server/src/restore.test.ts`
- Docs: `deploy/README.md:614-618`

**Interfaces:**

- Consumes: `placeDatabase` / `PlacedDatabase` (Task 6), `stageSecrets` / `StagedSecrets` (Task 7).
- Produces: `setAsideExistingIdentity(stateDir, log): Promise<boolean>` — true when it moved a
  file; `putIdentityBack(stateDir, log): Promise<void>` — renames `trading.env.replaced` back to
  `trading.env` when `trading.env` is absent; a failure logs `restore.identity.put_back_failed`.

- [ ] **Step 1: Write the failing tests** (seed an old `venue.db` with known bytes, an old
  `node.db`, an old `trading.env` and an old `secrets.env` in each):
  - `it("a secrets publish that fails puts the box's own database, node file, identity and secrets back")`:
    inject a `rename` failure onto `tls/server.key`; expect the injected error; `venue.db`,
    `node.db`, `trading.env`, `secrets.env` hold the old bytes; no `trading.env.replaced`; no
    `*.incoming`, `*.previous` or `.venue.db-replaced-*`; no rebuild marker.
  - Rewrite `:1123` as `it("a failed hook puts the box's own database and identity back")`: keep
    the `restore.hook_failed` code and params assertion; then old `venue.db` bytes, `trading.env`
    equal to `existing`, no `trading.env.replaced`.
  - Rewrite `:1070` as `it("sets the identity aside before placing, and puts it back when placement fails")`:
    keep the injected placement refusal and `migrate` not called; now `trading.env` equals
    `existing` and no `trading.env.replaced`. Add a second case where an injected `migrate` asserts,
    from inside, that `trading.env` is absent and `trading.env.replaced` holds `existing` — the
    ordering the old test proved.
  - Rewrite `:1005` as `it("a secret whose target is a folder is refused before anything changes")`:
    `restore.unsafe_entry_path { name: "secrets/tls/server.key" }`, old `venue.db` and
    `trading.env` untouched, `migrate` not called.
  - `it("a placement it cannot fully put back reports the folder")`: make the put-back fail (inject
    a `rename` failure on the move back of the main file after a later hook failure); expect
    `restore.placement_failed { kept: "set_aside", folder }`.
  - `it("a restore that keeps its own identity puts the database back when migration fails")`:
    `skipSecrets: true`, `migrate` throws; old `venue.db` back.
  - `it("a finished restore leaves no staged or previous files")`: the existing success case
    plus `readdir` of the state folder and `tls` holding no `.incoming` / `.previous`.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/restore.test.ts -t "puts the box's own|before anything changes|cannot fully put back|keeps its own identity puts|no staged or previous"`.
- [ ] **Step 3: Implement** in `placeValidated`, in this order: delete the backup room note; on a
  resume, the `assertNotAhead` check as today; stage the secrets unless `skipSecrets`; then inside
  one `try`: set the identity aside (record `putIdentityBack` as an undo step when it moved a file),
  place the database (record `placed.putBack` as an undo step) — neither on a resume — migrate,
  return early under `skipSecrets` after `placed.release()`, run the hooks, `publish`. On a throw:
  `discard` the staged secrets, run the undo steps last-recorded first, then throw
  `restore.placement_failed` with `putBack`'s answer when that answer is `set_aside` (logging
  `restore.db.placement_failed` with the original `errorCode` and `errno`, as `:690-694` does), and
  otherwise the original error. After the `try`: `placed.release()` and `finish()`. Replace the
  doc comments listed above with what is now true (one or two lines each; no history).
- [ ] **Step 4:** `restore-command.ts:204-207`: replace the comment with one line — the words claim
  nothing about what changed, because an identity or secret put-back that fails is only logged.
- [ ] **Step 5: Docs.** `deploy/README.md:614-618`: a restore that fails after it began puts back
  the previous database, the box's identity and its secrets; `restore.placement_failed` with a
  folder named is the case where the database could not all be put back.
- [ ] **Step 6: Run** `pnpm --filter @waitron/server exec vitest run src/restore.test.ts src/restore-artifact-file.test.ts src/restore-file-placement.test.ts src/restore-operation-placement.test.ts src/restore-stream.test.ts src/restore-request.test.ts src/restore-fiscal-e2e.test.ts`
  — all pass. Then grep for prose the change retires:
  `git grep -n -i "secrets last\|written last\|no bootable identity\|set aside" -- apps/server/src/restore*.ts deploy/README.md docs/developers`
  and correct each hit that describes the old order.
- [ ] **Step 7: Commit** — "A restore that fails puts the box's own database, identity and secrets back".

### Task 9: A full disk during a restore changes nothing, on a real small filesystem

**Files:**

- Create: `apps/server/src/restore-full-disk.e2e.test.ts`
- Modify: `.github/workflows/ci.yml:1290-1321` (a `full-disk-restore` tmpfs of 32m and
  `WAITRON_FULL_DISK_DIR_RESTORE`), `scripts/ci-workflow.test.mjs:2741-2750` (its row)

- [ ] **Step 1: Write the tests**, following `handover-placement-full-disk.e2e.test.ts`
  (`openSmallDisk("WAITRON_FULL_DISK_DIR_RESTORE", 32)`; skip locally when unavailable, as that file
  does, and fail in CI). The state and venue folders sit on the small filesystem, the staging folder
  on the normal one (so validation's decrypted copy is not what fills it). Seed an old `venue.db`,
  `trading.env` and `secrets.env`.
  - `it("a disk too full for the secrets refuses before anything is replaced")`: fill until less
    room than the secrets need is left; restore rejects with an `ENOSPC` error; old files untouched;
    no `*.incoming`.
  - `it("a disk with room for the secrets but not the database puts the identity back")`: leave
    room for the secrets but not for the database copy (the rename crosses filesystems, so it
    copies, `restore.ts:648-652`); restore rejects with the `ENOSPC` error itself (a copy that fails inside
    `restoreDatabase`'s first block is rethrown as it is, `restore.ts:643-662`); old `venue.db` bytes, `trading.env` back, no
    `trading.env.replaced`, no `*.incoming`.
- [ ] **Step 2: Run on this Mac**:
  `pnpm --filter @waitron/server exec vitest run src/restore-full-disk.e2e.test.ts` — both pass
  (they would fail on `59be31e3b7`: there the second leaves `trading.env` set aside; check that by
  running the second case in a throwaway worktree at `59be31e3b7`, per CLAUDE.md §4, and say what it
  printed in the commit message).
- [ ] **Step 3:** add the CI mount and variable, and the `ci-workflow.test.mjs` row; run
  `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
- [ ] **Step 4: Commit** — "A full disk during a restore leaves the box as it was, on a real small filesystem".

### Task 10: Notes at the sites, and the backlog

**Files:**

- Modify: `apps/server/src/restore.ts:758-768` (`clearReplacedDatabases` doc),
  `apps/server/src/rebuild-first-start.ts:197`, `apps/server/src/bounded-store.ts:8`
- Modify: `docs/backlog/box.md` (delete "## Bundle A1390" at `:1367-1379` and the three detail
  sections at `:385-410`, `:1813-1820`, `:1822-1832`; add two lines under
  "## Decisions and deliberate limits" at `:1650`), `docs/backlog.md:115` and `:1806` (delete)

- [ ] **Step 1:** At `clearReplacedDatabases`: one line — only the box's entry
  (`node-entry.ts`) calls it, before anything opens `venue.db`; a server started from `bin.ts` (the
  dev stack) does not.
- [ ] **Step 2:** At `POINTER_READ_TIMEOUT_MS`: bounds the one read that holds a restored box's
  first start, which fails and is tried again at the next start; the rebuild's calls have their own
  bound (`BUCKET_CALL_TIMEOUT_MS`). At `BUCKET_CALL_TIMEOUT_MS`: bounds each call of an
  operator-run rebuild; a restored box's first start has its own (`POINTER_READ_TIMEOUT_MS`).
  Neither line gives a reason for the number.
- [ ] **Step 3:** Backlog. Delete the bundle, the three detail sections and both index lines. Grep
  `git grep -n "A1390\|restore-is-all-or-nothing\|loose-ends-left-by-sqlite-slice-2-task-9b\|recovery-kit-can-carry\|fails-while-writing-the-secrets" docs`
  and fix each remaining pointer. Under "Decisions and deliberate limits" add: (1) a server started
  outside the box's entry does not clear `.venue.db-replaced-` folders (owner question 1's default,
  2026-11-07, A1390); (2) the first start's pointer read and the rebuild's bucket calls keep their
  own limits and codes (owner question 2's default, 2026-11-07, A1390).
- [ ] **Step 4: Run** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/claude-md-pointers.test.ts scripts/personal-log-params.test.ts`
  — all pass.
- [ ] **Step 5: Commit** — "A1390 closed: notes at the two time limits and the replaced-database clean-up, and the backlog entries removed".

## After the tasks

Run `/finish-branch` with the worktree path and a note naming this plan: the full wave (risk
triggers: concurrency, the box's fiscal identity), the Codex run-it seat as two reviews, the second
told to set the plan aside. Tell the owner the branch is ready for `finish-branch` once the per-task
reviews are done.
