# A1308 file layout fl3: one durable write for every state file

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** No file the box keeps is written without being flushed to disk: the helper that renames
without flushing (`writeFileAtomic`) is deleted, its callers use `writeFileDurable`, and a guard stops
a new hand-made write-then-rename in a file that uses the file system. The install script's
`compose.yml` download becomes atomic too.

**Architecture:** `packages/provisioning/src/fs-atomic.ts` already has `writeFileDurable` (write a
temporary file, flush it, rename, flush the folder; `:109-129`). Every caller of `writeFileAtomic`
moves to it; the one caller that must not flush (the backup verifier's thrown-away copy, which runs
where every flush is refused, `state-secrets.ts:106-108`) writes plainly instead, because a copy
that is thrown away needs no rename either. A root guard lists the files still allowed to call
`rename`, each with its reason. `writeDurableHostJson` (`durable-host-json.ts:76-115`) stays: it
already flushes (see "What it leaves out").

**Tech Stack:** TypeScript 7, Vitest 4.1.12, POSIX shell.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 "One durable write,
everywhere" and its A1329 note, §3 rows 7, 10, 18, 20, 62, 63, 71, 73, 84, §4 "Power cuts", §5
T8 (T1 moved out, What it builds 7). Also 4b's hand-over: "Renaming `recovery.bundle_invalid` and `unpackBundleToDir` … Batch 3,
the file layout slice (it rewrites `state-secrets.ts`)"
([`2026-11-08-a1308-4b-dropped-payment-and-box-features.md`](2026-11-08-a1308-4b-dropped-payment-and-box-features.md),
"What it leaves out"). Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).
Lines at `649b7576e0`; the cites the 2026-11-08 review touched were re-read at `9c66ef0356`.

**Blocked on the owner, through fl1.** fl1 waits for A1379 pull request 2, which waits for the
owner's answers to Questions 1-3 of
[`2026-11-06-a1379-setup-start-again.md`](2026-11-06-a1379-setup-start-again.md). The build-cache
step also waits for an owner answer (Owner questions, Q1); the rest of this plan does not.

**Who lands:** the lane. `trading.env` (node id, environment, intent) gains a flush; what it holds
and who reads it do not change, so nothing in rules §6 changes.

**First line of the pull request:** "Boxes keep working across this change."

## Global Constraints

- Rules §1, §4, §5, §8, §9. No table changes. `git commit -s`; never `--no-verify`.
- The venue holder heartbeat (`packages/store/src/venue-holder.ts:94-95`, every 5 s) stays
  unflushed on purpose (files.md row 38).
- Agents never run `docker builder prune` or any prune on the development machine (global rule,
  2026-10-23); if the owner keeps the build-cache step (Owner questions, Q1), it is tested only under
  `scripts/waitron-sh.test.mjs` stubs.

## What it builds

1. Every `writeFileAtomic` call becomes `writeFileDurable` (sites in Task 1). `writeFileAtomic` and
   `stageFile` are deleted from `fs-atomic.ts` and `apps/server/src/fs-atomic.ts`.
2. Hand-made writes that do not flush, in the state folder or a backup destination, use the
   helper: `backup-room-note.ts:108-109`, `local-fs-backend.ts:37-40`, `packages/provisioning/src/bin.ts:98`
   (`modules.json` from `waitron-provision`).
3. `unpackBundleToDir` → `unpackStateFiles`; `recovery.bundle_invalid` → `recovery.archive_path_unsafe`
   (params `{}`; its only remaining reason after 4b is `unsafe_path`, `state-secrets.ts:113,126`).
   With `durable: false` it writes with plain `writeFile`.
4. Guard `scripts/durable-writes.test.ts`.
5. `deploy/waitron.sh`: `compose.yml` is downloaded to a temporary name and moved into place
   (row 73); `.env.example` is no longer put on the box, and an old copy is removed (row 73).
   Row 84 (clear the build cache after a branch install) only if the owner keeps it (Owner
   questions, Q1).
6. No Mailpit change. Row 71 ("cap it") is already met: `deploy/compose.yml:85` pins
   `axllent/mailpit:v1.33.0` (#2601, `20a989ca11`), and that version's `config/config.go:66-67`
   reads `// MaxMessages is the maximum number of messages a mailbox can have (auto-pruned every
   minute)` / `MaxMessages = 500`; `cmd/root.go:93` uses that value as the `--max` flag's default
   and `:220-221` lets `MP_MAX_MESSAGES` override it (both fetched raw from GitHub at tag `v1.33.0`
   on 2026-11-08). The PR adds a dated note to files.md row 71 saying so.
7. T8 recorded as not run (Task 5). T1 is not this plan's: it measures what logging costs a sale,
   which no durable-write change affects, and it needs a sale rung up by hand; the driver gives it
   a home.

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| `writeDurableHostJson` merged into `writeFileDurable` (files.md row 62 says "replace") | It already flushes; its exclusive random temporary name and its refusal of a linked parent protect the setup records, while `writeFileDurable` deliberately follows a linked `tls/` (`fs-atomic.ts:43-54`). Merging would weaken one or the other. **Open question for the owner**; this PR keeps both | owner |
| Waitron Cloud's writers | They already flush; they move with their folder | fl4 |
| The leaf certificate's two renames and the TLS repair's writer | fl6 rewrites both | fl6 |
| The restore flow's files (`restore-request.ts:249-257`) | fl5 rewrites them into one folder; Task 1 still converts them so nothing unflushed remains in between | fl5 |
| `setup-operation.lock` (plain `open("wx")`) | Deleted with the lock | fl7 |
| Print agent files, Litestream's config, logs, crash reports | Another program; rewritten at every start; logs (files.md rows 0, 39, 43, 65-67) | — |
| The fiscal emergency folders (`emergency-attempt.ts`) | Already flush; deleted as item 64 by the fiscal environment PR | environment plan, owner lands |

## Files

- Modify: `packages/provisioning/src/fs-atomic.ts:6-39`, `packages/provisioning/src/index.ts:118`,
  `apps/server/src/fs-atomic.ts`, and the sites: `apps/server/src/recovery-state.ts:134`,
  `module-config.ts:35`, `trading-config.ts:40`, `finish-adoption.ts:49`, `reset-request.ts:27`,
  `restore.ts:540`, `restore-request.ts:251-257,671`, `state-secrets.ts:104-141`,
  `packages/provisioning/src/first-setup-command-deployment.ts:189,253`, `fiscal-readiness.ts:122`,
  `setup-operation.ts:184,195`, `configuration-import.ts:83-85`, `bin.ts:90-99`,
  `apps/server/src/backup-room-note.ts:100-112`, `packages/provisioning/src/backup-room-note-file.ts`
  (the temporary-name helpers fl1 moved there), `apps/server/src/local-fs-backend.ts:35-41`,
  `restore-secrets.ts:8,91`, `restore.ts:79,843,864`, `apps/server/src/errors.ts:1369`,
  `apps/server/scripts/dev-setup.ts:334` (comment), `deploy/waitron.sh:40-47,195-204` (and
  `:428-438` plus `deploy/README.md:222-225` only if Q1 keeps the build-cache step),
  `deploy/README.md:50,694`, `scripts/waitron-sh.test.mjs`,
  `docs/superpowers/specs/2026-11-02-rationalisation/files.md` (dated notes on rows 71 and, if Q1
  drops the step, 84).
- Create: `scripts/durable-writes.test.ts`.

## Size

Estimated (inventory at `649b7576e0`), not measured:
- Code: ~20 one-line swaps ~25; `backup-room-note.ts` ~15; `local-fs-backend.ts` ~5; `bin.ts` ~8;
  `state-secrets.ts` rename and plain branch ~15; `copyAtomic`'s flush ~10; `waitron.sh` ~15
  (~25 if Q1 keeps the build-cache step). **~95.**
- Tests: guard ~120; `fs-atomic.test.ts` loses its `writeFileAtomic` cases (deletion);
  `backup-room-note.test.ts` temporary-name cases ~25; six test files asserting the renamed code
  ~20; `waitron-sh.test.mjs` two cases ~60 (a third, ~30, if Q1 keeps the build-cache step);
  flush-order cases for `recovery.json` and `trading.env` ~60. **~285.**
- Docs ~30. **Total counted ~410** (~440 with the build-cache step).

## Finish line

- `git grep -n -w -E "writeFileAtomic|stageFile|unpackBundleToDir|recovery\.bundle_invalid" -- apps packages scripts`
  prints nothing.
- `pnpm exec vitest run scripts/durable-writes.test.ts scripts/waitron-sh.test.mjs scripts/errors-reachable.test.ts scripts/spare-space.test.ts scripts/backup-room-note.test.ts scripts/state-layout.test.ts`.
- `pnpm --filter @waitron/provisioning exec vitest run src/fs-atomic.test.ts src/configuration-import src/fiscal-readiness src/setup-operation`;
  `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/trading-config src/module-config src/backup-room-note src/local-fs-backend src/state-secrets src/restore-secrets src/restore.test.ts src/backup-data-placement`.
- Typecheck provisioning and server; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus:
- Two writers of `backup-room-note.json` can run at once in one process (read every caller of
  `writeBackupRoomNote` before Task 2): stop, because the fixed temporary name of `writeFileDurable`
  would let them collide where today's random name does not.

## Needs

- fl1 landed, which itself waits for A1379 pull request 2 and so for the owner's answers to that
  plan's Questions 1-3 (fl1, Needs); 4b landed (its recovery bundle code, `recovery-bundle.ts` and
  `recovery-unpack-command.ts`, gone). Independent of fl2.
- Owner questions Q1 answered before Task 4 Step 1 (the rest of the plan does not wait for it).

## Review Focus

1. The backup verifier's run under Node's permission mode still succeeds: its unpack takes the
   plain-write branch (`backup-data-placement.ts:81`; `backup-verification.permission.test.ts`).
2. `recovery.json` written during a failed start is on disk before the process exits: Task 1's
   flush-order case.
3. A cut `compose.yml` download leaves the old `compose.yml` in place (Task 4).
4. A box upgraded from a version that left `.env.example` loses it and keeps `.env`.
5. The guard refuses a new `rename(` in a file that imports `node:fs`, accepts each listed one, and
   accepts a component's own `#rename(` method (`apps/dashboard/src/screens/themes-card.ts:338`).

---

### Task 1: Every `writeFileAtomic` caller flushes

- [ ] **Step 1: Failing tests.** In `apps/server/src/recovery-state.test.ts` add
  `"the failed-start record is flushed and its folder synced"`, mocking `node:fs/promises` the way
  `box-secrets.test.ts:70-86` does to record `sync` and `rename` in order; expect file sync, then
  rename, then folder sync. Same case for `trading-config.ts` (`"trading.env is flushed before it
  is renamed into place"`).
- [ ] **Step 2:** Run; both fail.
- [ ] **Step 3:** Swap every site listed in Files to `writeFileDurable` (same arguments). In
  `state-secrets.ts` rename the function, the code and its type in `errors.ts`, and make
  `durable: false` write with `writeFile(target + suffix, contents, { mode: 0o600 })`. Delete
  `writeFileAtomic` and `stageFile`, and their re-exports; delete their cases in `fs-atomic.test.ts`.
- [ ] **Step 4:** Re-point the six test files asserting `recovery.bundle_invalid` (`git grep -l`)
  to `recovery.archive_path_unsafe` — the only assertion change; list them in the PR.
- [ ] **Step 5:** Run the Finish line's server and provisioning files. Commit.

### Task 2: The hand-made unflushed writers

- [ ] **Step 1:** `backup-room-note.ts` writes with `writeFileDurable(notePath, body, 0o600)`;
  `isBackupRoomFileName` recognises `stagedPath(BACKUP_ROOM_NOTE_FILE)` and drops the random-name
  pattern and `backupRoomNoteTemporaryName`. Re-point its tests' temporary-name cases (paths only).
- [ ] **Step 2:** `local-fs-backend.ts:37-40`: `writeFileDurable(target, data, mode)` in place of
  `stageFile` + `rename`. `copyAtomic` (`:128-143`, a stream copy) flushes the copied file before
  its rename: `const handle = await open(copied, "r"); try { await handle.sync(); } finally { await
  handle.close(); }` (closed in `finally`, so a failed flush leaves no open handle; CLAUDE.md §3, "An
  open `FileHandle` ends the process when it is collected"), then `syncFolderHolding(target)` after
  the rename.
- [ ] **Step 3:** `packages/provisioning/src/bin.ts:98`: `writeFileDurable`; delete the "Not atomic"
  comment.
- [ ] **Step 4:** Run `backup-room-note`, `local-fs-backend`, `cli-*` tests. Commit.

### Task 3: The guard

**Files:** create `scripts/durable-writes.test.ts`.

- [ ] **Step 1:** Scope: non-test `.ts` files (not under `testing/`) under `apps/*/src` and
  `packages/*/src` **that import `node:fs` or `node:fs/promises`** (`from "node:fs"`,
  `from "node:fs/promises"`, or the same without `node:`), and in them, outside comments, the
  pattern `(?<![#\w$.])rename\(|(?<![#\w$])renameSync\(|\b[\w$]+\.rename\(`. A component's own
  `#rename(` method (`themes-card.ts:338`, `page-printers-panel.ts`, `till-floor-screen.ts`) is
  neither in scope nor matched. **Measured** 2026-11-08 over the docs worktree (source equal to
  `4a6211786e`), with a throwaway script applying exactly this scope and pattern: 29 files, every one
  in the allowed map below (two of them under `src/testing/`, which the guard skips, and two under
  `apps/print-agent/src/`); the first version of the scope (any `rename(` in any non-test file)
  matched 32, the extra three being the three UI files just named. **Control** (same script, same
  day): a file that imports `node:fs/promises` and calls `await rename(a, b)` is reported on that
  line only; `this.#rename(view, menu)` in the same file is not, nor the same `rename` call in a file
  with no `node:fs` import. The guard's own refusal and acceptance controls use these three texts. Header:
  weaker than its name — it reads TEXT, only in files that import `node:fs`, and only sees those
  three spellings; a write that is never renamed, a rename through another name or a re-export,
  and a file that reaches the file system through another module escape it. Case
  `"only the listed files rename a file into place"` with this allowed map, each reason one line:
  `fs-atomic.ts` (the helper), `durable-host-json.ts` (flushes), `box-secrets.ts` and
  `box-tls-repair.ts` (flush; fl6 rewrites), `cloud-client.ts`, `cloud-recovery.ts`,
  `cloud-replacement.ts`, `cloud-remote.ts`, `cloud-snapshot-worker.ts` (flush; fl4 moves),
  `cloud-tunnel.ts` (tunnel volume, outside state), `handover-acceptance.ts`,
  `handover-place-copy.ts`, `handover-source-api.ts`, `mirror-bundle-fetch.ts` (A1018; each flushes
  through `reachDisk`), `local-fs-backend.ts` (flushes after Task 2), `log-file.ts` (log rotation),
  `restore-request.ts`, `restore-secrets.ts`, `restore.ts` (database and secret swaps; fl5 owns the
  first), `first-setup-start-again-set-aside.ts` (moves files aside, flushes),
  `packages/store/src/archive.ts` (VACUUM output into scratch or a caller's folder),
  `packages/store/src/venue-holder.ts` (the heartbeat exception), `packages/stream/src/s3-file-store.ts`
  (a download into scratch), `packages/fiscal-verifactu/src/emergency-attempt.ts` (flushes; item 64),
  and `apps/print-agent/src/*` (another program). Plus `"writeFileAtomic does not exist"`.
  Refusal and acceptance controls on inline text.
- [ ] **Step 2:** Run it; fix any unlisted hit by converting it, not by listing it, unless it is one
  of the categories above. Commit.

### Task 4: The install files

- [ ] **Step 1: Failing cases** in `scripts/waitron-sh.test.mjs`, under its stubs:
  `"a cut compose.yml download leaves the old file"` (stub `curl` writes half then fails; old
  `compose.yml` unchanged, no `compose.yml.tmp` left); `"install removes an old .env.example and
  keeps .env"`. Only if Q1 keeps the step: `"a branch install clears the build cache after
  building; a tag install does not"` (the `docker` stub records the clearing command only on the
  branch path).
- [ ] **Step 2:** Run; they fail. `fetch_box_files` fetches to `$WAITRON_DIR/compose.yml.tmp`, then
  `mv -f` onto `compose.yml`; a failed fetch removes the temporary file and dies. Delete the
  `.env.example` fetch, add `rm -f "$WAITRON_DIR/.env.example"`, and rewrite the comment at `:197`.
  Only if Q1 keeps the step: after the two `docker build` calls succeed (`:430-438`), clear the
  build cache the way the owner chose; a failure only warns; and `deploy/README.md:222-225` changes
  to match in the same commit.
- [ ] **Step 3:** files.md: a dated note on row 71 (the cap is Mailpit's own default, with the cite
  from What it builds 6) and, if Q1 drops the step, on row 84 (owner's answer, date).
- [ ] **Step 4:** `deploy/README.md:50` and `:694`: `.env.example` is read in the repository at the
  installed ref, not on the box. Run the cases and `scripts/deploy-image-env.test.ts`. Commit.

### Task 5: T8, docs

- [ ] **Step 1: T8** is not run: it needs a power cut on box hardware. A1329 already flushes
  `secrets.env` (`box-secrets.ts:230`), and T8's result changes only how urgent the flush is, never
  whether to do it (files.md §5). Say so in the PR.
- [ ] **Step 2:** CLAUDE.md §3 gains: "**Every file the box keeps is written through
  `writeFileDurable` (or `writeDurableHostJson`); only the venue holder heartbeat skips the flush.**
  Guard: `scripts/durable-writes.test.ts`, weaker than its name: reads text, sees only renames in
  files that import `node:fs`." Receipt paragraph (the inventory, the guard's measured scope) in
  conventions-data.md. `pnpm format:check`;
  commit.

## Owner questions

- **Q1. Clear Docker's build cache after a branch install?** files.md row 84 says "clear build cache
  after a branch install", but `deploy/README.md:222-225` says the install leaves "Docker's build
  cache from branch installs", that "`docker image prune` and `docker builder prune` delete those by
  hand, and also delete what other software on the machine left". `docker builder prune --force`
  is that same machine-wide command. **Recommended default:** drop the step from fl3 and keep the
  README as it is (a dated note on row 84 records the answer), because the command deletes cache
  other software on the box made, the kind of shared state the owner's 2026-10-23 rule keeps agents
  from deleting. Other answers: keep the step and change the README to say the install clears
  every build cache on the machine; or clear only Waitron's own cache, for example by building
  with a builder the install creates and removes — not tested here, so that answer comes back as
  a measured step before it is built.
- **Q2. `writeDurableHostJson` merged into `writeFileDurable`?** Already open (What it leaves out,
  first row). **Default:** this PR keeps both.

## After the tasks

`/finish-branch` with this plan as its note. Delete the backlog entry
`docs/backlog/replication-cloud.md:420` ("Power-loss durability and the selling gate") only if, on
reading it, everything it asks for is done; otherwise edit it to what remains.
