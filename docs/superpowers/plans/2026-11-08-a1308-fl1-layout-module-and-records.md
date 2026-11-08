# A1308 file layout fl1: one layout module, and the Start-again records in `records/`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Every name in the box's state folder is declared once, in one module, with what a plain
`waitron.sh reset` does to it; the Start-again choice records and the set-aside folder move into
`<state>/records/`; Start-again confirmations stop being written; a plain reset keeps exactly `tls/`
and `records/`.

**Architecture:** A new module in `@waitron/store` (the package that already names the venue
folder's files, `packages/store/src/index.ts:47-55`, and depends only on `@waitron/shared`) holds a
table of every top-level entry of the state folder and one named constant per entry. Every
production module that today defines a state-folder name (a constant, or a `join` from the state
folder) reads it from there. A root guard checks that no other non-test source defines a declared
name that way, and that `deploy/waitron.sh`'s reset keep-list equals the table's "kept" entries.
Names that are part of a file format another box or another version reads (backup archive entry
names and handover manifest items) keep their own literals, so a later layout change cannot alter
those formats without anyone noticing. Later file-layout pull requests (fl2 to fl10) change entries
in this table; this one changes only the records.

**Tech Stack:** TypeScript 7 per package, Vitest 4.1.12, POSIX shell (`deploy/waitron.sh`).

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("One state-folder layout",
"The Start-again records move into `records/`", "The resulting layout"), §3 rows 58-60;
[README §7 Files](../specs/2026-11-02-rationalisation/README.md). Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md) (cited as "rules §n"; not
repeated). Line numbers are at `649b7576e0`; the cites the 2026-11-08 review touched were re-read
at `9c66ef0356`.

**Who lands:** the lane (rules §6: it changes no sales, invoice numbering, fiscal record, fiscal
identity, AEAT sending or value that feeds a fiscal hash).

**Blocked on the owner.** This plan cannot start until A1379 pull request 2 has landed, and that
pull request waits for the owner's answers to Questions 1-3 of
[`2026-11-06-a1379-setup-start-again.md`](2026-11-06-a1379-setup-start-again.md) ("Questions for
the owner"; recorded as waiting in `87375f075f`, `docs/backlog/setup.md:575`). fl2 to fl5 need this
plan, so they wait too. See Needs.

**First line of the pull request:** "Boxes keep working across this change; Start-again choice
records and set-aside files written before it are left at their old names, and a plain reset now
deletes them (pre-live, CLAUDE.md §3 last data rule)."

## Global Constraints

- Rules §1, §4, §5, §8, §9 apply. No table or migration changes.
- No backwards-compatibility code: nothing moves files from the old names (CLAUDE.md §3, "No
  backwards-compatibility or data-migration code until Waitron is in production").
- English only; comments only for an invariant or a non-obvious why (CLAUDE.md §1, last rule).
- Never `--no-verify`; `git commit -s`; focused tests locally, CI owns package suites (CLAUDE.md §2).
- An implementer past about 150 tool calls stops at a passing point, commits and hands over.

## What it builds

1. `packages/store/src/state-layout.ts`: the `STATE_LAYOUT` table and one constant per entry,
   exported from `@waitron/store`.
2. Every production definition of a state-folder name becomes an import from it (list in Task 2),
   except the archive and handover format names (Task 2, "Left as their own literals").
3. `<state>/records/choices/` and `<state>/records/set-aside/` replace
   `first-setup-start-again-choices/` and `first-setup-set-aside/` in the state folder.
4. Start-again confirmations are no longer written: `writeStartAgainConfirmation` and its one call
   (`apps/server/src/first-setup-resolution.ts:374`) go (files.md row 58).
5. `deploy/waitron.sh`'s plain reset keeps `tls` and `records` only (`deploy/waitron.sh:813`).
6. Guard `scripts/state-layout.test.ts`; `scripts/start-again-records-writers.test.ts` and
   `scripts/spare-space.test.ts` re-pointed.
7. CLAUDE.md §3's Start-again records rule and its restore-working-folder rule (CLAUDE.md:527-529
   at `9c66ef0356`, which says the names are "listed in `apps/server/src/restore-staging-dirs.ts`";
   after Task 2 the top-level ones are declared in the layout module), `docs/developers/conventions-data.md`
   ("## Start again's records and the set-aside folder", line 5225, and "### Start again records
   retention", line 5829), `deploy/README.md:408-435` (the `reset` usage line at :410 and the list
   of what a plain reset keeps), `docs/developers/conventions-ui.md:1304-1315`,
   `docs/operations/first-live-fiscal-setup.md:135`, `docs/backlog/setup.md:822`, and
   `apps/server/README.md` if it names the folders, changed with the code (rules §9).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| Moving any other entry (scratch, flows, cloud, TLS repair, module records, `modules.json`) | One concern per pull request | fl2-fl10 |
| The set-aside folder's venue-folder variant (`first-setup-start-again-set-aside.ts:93`, used only when the venue folder is on another filesystem) | It goes with the cross-filesystem branch | fl7 |
| The host's B3 files (items 85, 86), Docker, install files | Owned by the host or Docker; files.md keeps them | — |
| Waitron Cloud's files and print-agent files in the table | They are declared when fl4 groups them; the print agent is another program | fl4 |

## Files

- Create: `packages/store/src/state-layout.ts`, `packages/store/src/state-layout.test.ts`,
  `scripts/state-layout.test.ts`.
- Modify: `packages/store/src/index.ts` (export), `packages/provisioning/package.json` (add
  `@waitron/store` as a dependency; no cycle: store depends only on shared),
  `packages/provisioning/src/spare-space-name.ts` (deleted; its names move),
  `packages/provisioning/src/first-setup-start-again-names.ts`,
  `packages/provisioning/src/first-setup-start-again-confirmation.ts`,
  `packages/provisioning/src/first-setup-start-again-choice.ts:9-14,59,194,215`,
  `packages/provisioning/src/first-setup-start-again-set-aside.ts:14,77,93,107,155`,
  `packages/provisioning/src/first-setup-state.ts:11-15,141-157`, `packages/provisioning/src/index.ts:185-217`,
  `apps/server/src/first-setup-resolution.ts:7,374-385`, `apps/server/test/start-again-deleted.ts`,
  `deploy/waitron.sh:806-813`, `scripts/waitron-sh.test.mjs` (four reset cases at `9c66ef0356`:
  the command-shape cases at :1693 and :1931, which match the `find` line's `! -name` words, and the
  sandbox cases at :1705 and :1731), `scripts/start-again-records-writers.test.ts`,
  `scripts/spare-space.test.ts:20-55`, `scripts/backup-staging-touchers.test.ts:16-20`, plus the
  definition sites in Task 2, `CLAUDE.md`, and the docs in What it builds 7.

## Size

Estimated, not measured on a branch. The definition count is the narrowed guard's own hit list
(Task 1 Step 2) run over the docs worktree, whose source equals `4a6211786e`, and over `main` at
`9c66ef0356`: both print 52 files, 95 lines with `cloud-snapshots` declared.
- Code, hand-written: layout module ~140; re-pointed definitions ~150 (95 lines, plus one import
  line in each of 52 files); the list entries the guard does not see (Task 2) ~20; records move
  ~40; confirmation removal ~15 added (the rest deletions); `waitron.sh` ~5. **~370.**
- Tests, hand-written: layout unit test ~60; root guard ~130; records-guard, spare-guard and
  staging-guard edits ~30; the 23 test files (`*.test.ts`/`*.test.mjs`) plus
  `apps/server/test/start-again-deleted.ts` that name the record folders (`git grep -l -E
  "first-setup-start-again-(choices|confirmations)|first-setup-set-aside|START_AGAIN_(CHOICES|SET_ASIDE|CONFIRMATIONS)_DIR"`
  at `9c66ef0356`) ~110; four reset cases ~40. **~370.**
- Docs ~80. Deletions: `spare-space-name.ts`, the confirmation writer and its type (~90 lines).
- **Total counted ~820.** About 3 hours.

## Finish line

- `pnpm exec vitest run scripts/state-layout.test.ts scripts/start-again-records-writers.test.ts scripts/spare-space.test.ts scripts/backup-room-note.test.ts scripts/waitron-sh.test.mjs`
  shows every file passing (read the `Tests` count).
- `pnpm --filter @waitron/store exec vitest run src/state-layout.test.ts` and
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again` and
  `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again src/recovery-start-again`
  pass.
- `pnpm --filter @waitron/store typecheck`, `pnpm --filter @waitron/provisioning typecheck`,
  `pnpm --filter @waitron/server typecheck`, `pnpm format:check`.
- `git grep -n -E "first-setup-start-again-(choices|confirmations)|START_AGAIN_CONFIRMATIONS_DIR|writeStartAgainConfirmation" -- apps packages scripts deploy`
  prints nothing.

## Expected protection-list difference

**EQUAL.** No table, column, index or trigger changes; files are not schema. Run rules §3's two
commands anyway and paste the empty report.

## Stop points

Rules §5, plus:
- A1379 pull request 2 has not landed (`git grep -n withResolutionPassword -- packages` still prints
  a definition): stop; this plan edits the files it rewrites.
- A reader of a confirmation record is found outside tests, the reset list and the host-path list
  (files.md row 58 says none exists): stop.

## Needs

- A1379 pull request 2 (A1322, "Continue" removed) landed:
  [`2026-11-06-a1379-setup-start-again.md`](2026-11-06-a1379-setup-start-again.md). **What waits
  for the owner:** that pull request is not dispatched until the owner answers its Questions 1-3
  (may Start again delete the setup's own certificate record; what a reloaded setup tab does; who
  may stop a setup from another page). Part 1 landed as #2521; part 2's wait is recorded in
  `87375f075f` and `docs/backlog/setup.md:575`. If the owner answers yes to Question 1, the owner
  also lands that pull request. Only after it lands can this plan start.
- Nothing else. This slice changes no table or column, so it does not wait for A1308's table
  slices (rules §8, "Work that changes no table or column goes ahead in any lane").

## Review Focus

1. A plain reset on a box that holds both `records/` and an old-name choice folder: only `tls/` and
   `records/` survive (Task 4's reset case).
2. A Move after this change writes its set-aside files under `records/set-aside/` and its choice
   record under `records/choices/`, and neither is ever deleted by Start again (Task 3).
3. A source file that builds a declared name from pieces escapes the guard; the guard says so in its
   header (Task 1).
4. `tls/venue-ca.*` still go on a plain reset (the `rm -f` at `deploy/waitron.sh:813` stays).
5. An archive entry under `records/` is refused on restore exactly as the old folders were
   (`isFirstSetupHostPath`, `first-setup-state.ts:158-160`).

---

### Task 1: The layout module and its guard

**Files:** create `packages/store/src/state-layout.ts`, `packages/store/src/state-layout.test.ts`,
`scripts/state-layout.test.ts`; modify `packages/store/src/index.ts`.

**Interfaces — Produces:**

```ts
export type ResetFate = "kept" | "deleted";
export interface StateEntry {
  readonly name: string;          // top-level name in the state folder, or a prefix ending "-"
  readonly kind: "file" | "folder" | "prefix";
  readonly reset: ResetFate;      // what a plain `waitron.sh reset` does
  readonly why: string;           // files.md F1 reason, one line
}
export const STATE_LAYOUT: readonly StateEntry[];
export const RESET_KEPT: readonly string[];       // STATE_LAYOUT entries with reset "kept"
export function statePath(stateDir: string, ...parts: string[]): string; // join(stateDir, ...parts)
```

One `export const` per entry, named as today where a name exists (`SPARE_SPACE_FILE`,
`SPARE_SPACE_RELEASED_FILE`, `BACKUP_ROOM_NOTE_FILE`, `BACKUP_ROOM_START_DELETED_FILE`,
`RESTORE_REQUEST_FILE`, `REBUILD_MARKER`, `RESET_REQUEST_FILE`, `PENDING_ADOPTION_FILE`,
`RECOVERY_LOCK_FILE`, `RESTORE_STAGING_DIR`, `BACKUP_STAGING_DIR`, `STREAM_RESTORE_PREFIX`,
`RESTORE_ENTRY_PREFIX`, `START_AGAIN_GUESSES_FILE`), otherwise `<WORDS>_FILE` / `<WORDS>_DIR`
(`SECRETS_ENV_FILE`, `TRADING_ENV_FILE`, `BACKUP_ENV_FILE`, `RECOVERY_STATE_FILE`, `MODULES_FILE`,
`MODULE_PREPARATION_STATE_FILE`, `MODULE_EVIDENCE_DIR`, `MODULE_OPERATION_PUBLIC_FILE`,
`FIRST_FISCAL_DOCUMENTS_DIR`, `FIRST_SETUP_FILE`, `FIRST_SETUP_NODE_KEY_FILE`,
`FISCAL_READINESS_FILE`, `SETUP_OPERATION_FILE`, `SETUP_OPERATION_LOCK_FILE`,
`CONFIGURATION_IMPORT_FILE` / `_ARTIFACT` / `_KEY`, `RESTORE_REQUEST_ARTIFACT` / `_KEY` / `_DB` /
`_ENTRIES` / `_PLACEMENT` / `_NODE_KEY`, `STREAM_DIR` = "stream", `HANDOVER_DIR` = "handover",
`TLS_DIR` = "tls", `VENUE_DIR_NAME` = "venue", `RECORDS_DIR` = "records",
`START_AGAIN_CHOICES_DIR` = "records/choices", `START_AGAIN_SET_ASIDE_DIR` = "records/set-aside",
`CLOUD_SNAPSHOTS_DIR` if `git grep -n cloud-snapshots apps/server/src` still finds it after the
backup service). `TRADING_ENV_REPLACED_SUFFIX` = ".replaced" (`apps/server/src/restore.ts:102`),
with its own table entry `trading.env.replaced` (file); `LOGS_DIR` = "logs" (the log folder's
default under the state folder outside the image, `apps/server/src/config.ts:79`; the image puts
logs on their own volume). Every value is today's spelling; only the two records entries change.
The `reset` of every entry is `"deleted"` except `tls` and `records`. Waitron Cloud's five files are
declared by fl4, not here. A name with a working copy (`<name>.tmp`, `stagedPath`) is matched by its
entry; fl8b's "nothing undeclared" check needs to treat a `.tmp` suffix as its entry's (fl8b's
Task 4 does not say so at the time of writing).

- [ ] **Step 1: Unit test** `state-layout.test.ts`: `"every name is declared once"` (no duplicate
  `name`); `"a plain reset keeps exactly tls and records"`
  (`expect(RESET_KEPT).toEqual(["records", "tls"])` after sort); `"every constant is in the table"`
  (each exported string constant appears as an entry's `name`, or as `name` + "/" + child for the
  two records folders).
- [ ] **Step 2: Root guard** `scripts/state-layout.test.ts`. It matches **definitions only**, in
  code with comments stripped (a scanner that removes `//` and `/* */` comments outside string
  literals, keeping line numbers), in `.ts` files (not `.d.ts`) under `apps/*/src`,
  `apps/*/scripts` and `packages/*/src`. It skips:
  - test code: `*.test.ts`, anything under a `testing/` or `test/` folder, and
    `apps/*/scripts/*-fixture.ts` (Cloud test drivers);
  - `.mjs` files: `apps/server/scripts/dev-server.mjs:60-61` runs under plain `node`, which cannot
    import `@waitron/store`'s TypeScript source (the 2026-11-08 review ran `import('@waitron/store')`
    under plain node and it failed);
  - `apps/print-agent/` (another program, whose development copy reads the box's `tls/ca.crt`,
    `apps/print-agent/src/dev.ts:49-53`) and `packages/print-agent/` (no workspace imports allowed,
    CLAUDE.md §3);
  - `apps/server/src/handover-manifest.ts`: its four constants (`:22-25`) are handover manifest item
    names compared with `row.item`, a format the other box reads, not paths.

  With `NAMES` = every `STATE_LAYOUT` name that contains `.`, `-` or `/`, escaped, joined with `|`,
  and `WORDS` = `stream|handover|tls|venue|records|logs`, the two patterns are:

  ```text
  \bconst\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*["'`](?:NAMES)["'`]
  \bjoin\(\s*[\w$.#]*stateDir\s*,\s*["'`](?:NAMES|WORDS)["'`]        (case-insensitive)
  ```

  The first finds a constant whose whole value is a state name; the second a path built from a
  variable whose name ends in `stateDir` (`stateDir`, `deps.stateDir`, `this.#deps.stateDir`,
  `resolvedStateDir`). **Measured** (a throwaway script applying exactly these rules, run
  2026-11-08 over the docs worktree, whose `apps packages scripts deploy` equal `4a6211786e`, and over `main` at
  `9c66ef0356`, with today's spelling of every name in the Interfaces list plus `cloud-snapshots`):
  **52 files, 95 lines**, none of them a comment, none under `testing/`, no `.mjs`; the first
  version of this guard (quoted literal anywhere, comments and `.mjs` included) printed 87 files,
  272 lines over the same tree, 54 of them lines that start as a comment and 8 files under
  `src/testing/`. That hit list is Task 2's to-do. **Control:** an inline file holding
  `export const NEW_NAME = "spare-space.released";` and `const p = join(deps.stateDir, "tls");` is
  reported on both lines, while `// we write "secrets.env" here`, `/* join(stateDir, "trading.env") */`
  and `{ item: "secrets.env" }` in the same file are not.

  Header, weaker than its name: it reads TEXT; it sees only a `const` whose whole value is a state
  name and a `join` whose first argument's name ends in `stateDir`, so a name in an array or object
  literal, a name built from pieces, a path joined from a differently named variable, and anything
  in shell escape it; it never checks that a file's path is right, only who declares the name.
  Cases:
  - `"only the layout module defines a state name"`: the two patterns match in no file but
    `packages/store/src/state-layout.ts`.
  - `"waitron.sh's plain reset keeps exactly the layout's kept entries"`: parse the `find … -exec rm`
    line in `deploy/waitron.sh` for its `! -name <x>` words and compare to `RESET_KEPT`.
  - A refusal control for each case on an inline fixture (the control text above is reported) and
    an acceptance control (the comment and object-literal lines above, and the layout module's own
    text, pass), per CLAUDE.md §4 "a proof by deletion says nothing about what the guard wrongly
    refuses".
- [ ] **Step 3:** Run both; expect the unit test to fail (module missing) and the guard to fail
  listing today's definition sites. Write the module; export it from `packages/store/src/index.ts`.
- [ ] **Step 4:** Re-run: unit test passes; the guard still fails, listing exactly Task 2's sites
  (that list is Task 2's to-do). Commit (`feat(store): declare the state folder's layout in one module`).

### Task 2: Every definition reads the layout

**Files.** The guard's failure list is the authority. At `9c66ef0356` it is (file: lines):
`apps/server/scripts/dev-setup.ts:49`, `apps/server/scripts/venue-dir.ts:23`,
`apps/server/src/backup-env-writer.ts:35`, `boot.ts:1365`, `box-secrets.ts:47,52,56,78,102,208,223,310`,
`box-tls-repair.ts:42,114`, `break-glass-command.ts:88`, `cloud-recovery.ts:188`,
`cloud-snapshot-archive.ts:29`, `cloud-snapshot-worker.ts:141`, `config.ts:553`,
`finish-adoption.ts:18`, `first-fiscal-delivery.ts:194,396`, `first-fiscal-evidence.ts:85`,
`first-setup-launch.ts:44`, `handover-acceptance.ts:40`, `handover-capture.ts:62`,
`handover-destination-duty.ts:88`, `handover-store.ts:142`, `module-config.ts:15,34`,
`node-entry.ts:340,367,416,444,545,732`, `rebuild-first-start.ts:30`,
`recovery-document-evidence.ts:27`, `recovery-listener.ts:87`, `recovery-lock.ts:9`,
`recovery-state.ts:86,135`, `rejoin-command.ts:80`, `reset-request.ts:15,74`,
`restore-command.ts:316`, `restore-request.ts:78-87`, `restore-secrets.ts:12`,
`restore-staging-dirs.ts:6,9,10`, `restore.ts:100`, `start-space.ts:13`, `stream-host.ts:166`,
`trading-config.ts:31,46` (all under `apps/server/src/` unless named);
`packages/db/src/venue-holder-identity.ts:27`; and in `packages/provisioning/src/`: `bin.ts:98`,
`configuration-import.ts:8-10`, `first-setup-command-deployment.ts:158,190,254`,
`first-setup-node-key.ts:72`, `first-setup-recovery-delivery.ts:193`,
`first-setup-resolution-inspection.ts:220,292`, `first-setup-start-again-deletion.ts:41,84`,
`first-setup-start-again-leftovers.ts:49`, `first-setup-start-again-names.ts:2-4`,
`first-setup-start-again-set-aside.ts:42`, `first-setup-state.ts:409,475,493,550,557`,
`fiscal-readiness.ts:8`, `module-preparation-state.ts:28`, `setup-operation.ts:87-88`,
`spare-space-name.ts:4-13` (delete the file; `backupRoomNoteTemporaryName` and
`isBackupRoomFileName` move into `packages/provisioning/src/backup-room-note-file.ts`).

Also converted, though the guard does not see them (state-folder lists in array literals):
`apps/server/src/box-env.ts:7`, `apps/server/src/reset-request.ts:111-112`,
`apps/server/src/restore.ts:102` (`.replaced`), `apps/server/src/first-setup-resolution.ts:88,151`,
`packages/provisioning/src/first-setup-state.ts:141-157`,
`packages/provisioning/src/first-setup-start-again-deletion.ts:53-75,127-146`,
`packages/provisioning/src/first-setup-start-again-leftovers.ts:48-58`,
`packages/provisioning/src/first-setup-resolution-inspection.ts:276-288`,
`packages/provisioning/src/first-setup-owner.ts:120` if A1379 pull request 2 left it.

**Left as their own literals** (formats another box or another version reads; a layout change must
not change them without a format decision): the backup archive's entry names —
`apps/server/src/state-secrets.ts:16-23` (`RECOVERY_FILES`, read as `secrets/<name>`),
`apps/server/src/backup-optional-state.ts:10-15`, `apps/server/src/backup-data-placement.ts:65-71`,
`apps/server/src/backup-verification-secrets.ts:30-32` — and the handover manifest's item names —
`packages/handover/src/manifest.ts:117-163`, `packages/handover/src/indicator-parse.ts:126-129`,
`apps/server/src/handover-manifest.ts:22-25`, `apps/server/src/handover-compare.ts:333-341`,
`apps/server/src/handover-place-copy.ts:283`. A later slice that moves a file these name changes
the literal on purpose, in the same pull request, with the format's version where it has one.
Venue-folder names (`first-setup-claim.json`, `first-setup-deleting.json`) are not state-folder
entries: leave them.

- [ ] **Step 1:** Replace each local literal with the imported constant. Where a module re-exports a
  name today (`packages/provisioning/src/index.ts`, `first-setup-start-again-choice.ts:14`), keep
  the re-export so callers do not change.
- [ ] **Step 2:** Update `scripts/spare-space.test.ts:20-55`: the allowed files for
  `SPARE_SPACE_FILE` / `SPARE_SPACE_RELEASED_FILE` become `apps/server/src/spare-space.ts`,
  `packages/store/src/index.ts`, `packages/store/src/state-layout.ts`, and
  `packages/provisioning/src/index.ts` only if it still re-exports them; fix its inline fixtures'
  expected paths (lines 120-185) the same way. No other allowance changes.
- [ ] **Step 3:** Run the root guard: the distinctive-name and join cases pass. Run
  `scripts/spare-space.test.ts`, `scripts/backup-room-note.test.ts`,
  `scripts/backup-staging-touchers.test.ts` (it matches `BACKUP_STAGING_DIR`: add
  `packages/store/src/state-layout.ts` to its `ALLOWED`, `scripts/backup-staging-touchers.test.ts:16-20`,
  and say in the commit why: the declaration, not a toucher) and
  `scripts/handover-manifest-complete.test.ts`. Typecheck the three packages.
- [ ] **Step 4:** Commit (`refactor: read every state-folder name from the layout module`).

### Task 3: Records in `records/`; confirmations stop

**Files:** `packages/provisioning/src/first-setup-start-again-names.ts` (re-export the two
records constants from `@waitron/store`; keep `START_AGAIN_GUESSES_FILE` there as a re-export too),
`first-setup-start-again-set-aside.ts`, `first-setup-start-again-choice.ts`,
`first-setup-start-again-confirmation.ts`, `first-setup-state.ts:141-157`, `index.ts`,
`apps/server/src/first-setup-resolution.ts:7,374-385`, `apps/server/test/start-again-deleted.ts`,
the tests that name the folders.

- [ ] **Step 1: Failing tests.** In `packages/provisioning/src/first-setup-start-again-choice.test.ts`
  add `"a Move writes its choice under records/choices and its files under records/set-aside"`:
  after a Move, `readdir(join(stateDir, "records"))` equals `["choices", "set-aside"]`. In
  `apps/server/src/first-setup-start-again.test.ts` change the confirmation assertion that
  `start-again-deleted.ts:45` feeds into `"Start again writes no confirmation record"`:
  `join(stateDir, "first-setup-start-again-confirmations")` does not exist and no file under
  `records/` is written by a Start again that needed no choice. These are the only assertions that
  change meaning; the owner decision is files.md row 58.
- [ ] **Step 2:** Run; both fail.
- [ ] **Step 3:** The set-aside root keeps today's two-root logic, but the state-folder variant uses
  `START_AGAIN_SET_ASIDE_DIR` ("records/set-aside") and the venue-folder variant a local constant
  `VENUE_SET_ASIDE_DIR = "first-setup-set-aside"` (fl7 deletes it). Create `records/` with
  `mkdirDurable(…, 0o700)` before the first write. Delete `writeStartAgainConfirmation`,
  `StartAgainConfirmation`, `START_AGAIN_CONFIRMATIONS_DIR` and the call at
  `first-setup-resolution.ts:374`; move `StartAgainSummary`, `startAgainSummary` and
  `isCanonicalInstant` (imported by `first-setup-start-again-choice.ts:5` and
  `first-setup-start-again-guesses.ts:5`) into `first-setup-start-again-summary.ts` and delete the
  old file. `FIRST_SETUP_HOST_FILES` lists `RECORDS_DIR` instead of the three folders, so a restore
  still refuses an archive entry under it.
- [ ] **Step 4:** Re-point the 23 test files and `apps/server/test/start-again-deleted.ts` that name
  the old folders (count in Size; rule §4: paths only). Run
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again src/first-setup-host-path`
  and `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again src/recovery-start-again src/first-setup-set-aside-lifetime`.
- [ ] **Step 5:** `scripts/start-again-records-writers.test.ts`: `NAMES` becomes
  `\bSTART_AGAIN_CHOICES_DIR\b|\bSTART_AGAIN_SET_ASIDE_DIR\b|\bVENUE_SET_ASIDE_DIR\b|["'\`]records/|first-setup-set-aside`;
  `ALLOWED` drops `first-setup-start-again-confirmation.ts` and gains
  `packages/store/src/state-layout.ts` and `packages/store/src/index.ts`. Keep its header's
  "weaker than its name" sentence and add that it does not see `RECORDS_DIR` joined with a
  sub-name. Run it.
- [ ] **Step 6:** Commit (`feat(setup): Start-again records live in records/ and confirmations stop`).

### Task 4: The plain reset keeps two names; docs

**Files:** `deploy/waitron.sh:806-813`, `scripts/waitron-sh.test.mjs` (cases at :1693, :1705,
:1731 and :1931 at `9c66ef0356`), the docs in What it builds 7, `CLAUDE.md` §3.

- [ ] **Step 1: Failing tests.** Rename the sandbox case at :1705 to `"the reset's state clean-up
  keeps tls/ and records/ and removes the rest"`; seed `records/choices/one.json`,
  `records/set-aside/x/`, `first-setup-start-again-confirmations/one.json`,
  `first-setup-start-again-choices/old.json`, `first-setup.json`, `tls/ca.pem`; expect
  `readdirSync(state).sort()` to equal `["records", "tls"]` and `records/choices` to hold
  `one.json`. The sandbox case at :1731 seeds `records/choices/` and `records/set-aside/` in place of
  the old folders and keeps its guess-counter assertion. The two command-shape cases (:1693, :1931)
  expect `! -name tls ! -name records ` in place of the four old `! -name` words; their names lose
  "the confirmation records". These are the assertions that change, by design (files.md rows
  58-60); every other assertion in the four cases stays.
- [ ] **Step 2:** Run; it fails. Change the `find` line to `! -name tls ! -name records` and the
  comment above it to say that and nothing more. Re-run the case and `scripts/state-layout.test.ts`.
- [ ] **Step 3:** Docs. `deploy/README.md`: the list becomes `tls/` (unchanged text) and
  `records/`, "the record of each Keep or Move choice made at Start again (`records/choices/`) and
  the files a Move set aside (`records/set-aside/`, each Move's folder also holding a copy of
  `secrets.env`…)" keeping today's warning sentence; "keeps four things" becomes "keeps two folders".
  The `reset` usage line (`deploy/README.md:410`) says "keep the certificate and the Start-again
  records" without naming confirmations. `conventions-ui.md:1304-1315`,
  `first-live-fiscal-setup.md:135` and `backlog/setup.md:822` say `records/choices/` and
  `records/set-aside/`, and drop the confirmation record. CLAUDE.md:527-529's restore-working-folder rule keeps its meaning and says
  the top-level names are declared in `packages/store/src/state-layout.ts` and the prefixes listed in
  `apps/server/src/restore-staging-dirs.ts` (fl2 rewrites the rule again).
  CLAUDE.md §3 rule becomes: "**Start again's choice records and the set-aside folder, in
  `<state>/records/`, are removed only by `waitron.sh reset --all`** (A1042, A1098). Guard:
  `scripts/start-again-records-writers.test.ts`, weaker than its name: reads text, never what a
  listed file does. [Cost and detail](…)". Same edit in conventions-data.md's two sections. Add one
  CLAUDE.md §3 line for the new guard: "**Every state-folder name is declared in
  `packages/store/src/state-layout.ts`; a plain reset keeps exactly its `kept` entries.** Guard:
  `scripts/state-layout.test.ts`, weaker than its name: reads text, and sees only a constant or a
  join from the state folder." with its receipt paragraph in conventions-data.md (the measured hit
  counts from Task 1, the skipped files and why, and that archive and handover names keep their own
  literals).
- [ ] **Step 4:** `pnpm format:check` (CLAUDE.md is format-checked); commit
  (`docs: the reset keeps tls/ and records/; the state layout rule`).

## After the tasks

Run the Finish line, then `/finish-branch` with this plan as its note. Delete nothing from the
backlog unless an entry names the confirmation records (`git grep -n confirmation docs/backlog`
and read each hit). The PR description lists the re-pointed test files as "paths only".

## Appendix: where every files.md §3 row lands

The file-layout plans are fl1 (this), fl2 scratch, fl3 durable writes, fl4 Cloud folder, fl5
restore flow, fl6 TLS repair and leaf, fl7 venue folder fixed, fl8a setup flow folder, fl8b setup
flow record, fl9 module records (owner), fl10 module list in settings (owner), each in
`docs/superpowers/plans/2026-11-08-a1308-fl<n>-*.md`.

| Rows | Where |
| --- | --- |
| 0, 2, 4, 6, 11-14, 16, 23, 35-37, 40, 42-45, 47, 57, 65-70, 72, 75-83, 85, 86 | Kept as they are (declared in this plan's table where they are in the state folder) |
| 1 | Kept; `WAITRON_ACCOUNT_KEY`'s removal is the environment plans' |
| 3, 5 | fl6 |
| 7, 18, 20, 62, 71, 73, 84 | fl3 (62: `writeDurableHostJson` kept, open question) |
| 8 | fl3 (flush) and fl5 (`.replaced` deleted at the first start) |
| 9, 63 | fl3 (durable), then fl10; 63's resume went with A1379 pull request 2 |
| 10 | Durable since A1329; its unlocked read-modify-write (`backup-env-writer.ts:31-49`) waits for A1323, which replaces the rotation time |
| 15, 21, 22, 24, 39, 41, 46 | fl2 |
| 17, 19 | fl5 |
| 25-28; 29 | fl4; 29's staging is the one backup service's (jr) |
| 30, 49, 50, 61; 31, 52, 53 | fl8a; fl8b (50, the readiness file, is only moved, by fl8a: fl8b keeps it a file of its own, because development mode writes it without a setup record) |
| 32, 54 | fl9 |
| 33, 56 | Done by A1131bc slice 4 (#2461) |
| 34 | 4b |
| 38 | Kept; the one unflushed write (fl3's guard names it) |
| 48 | fl7 (the lock); fl8a (the record, kept as `operation.json`) |
| 51 | fl7 (the claim); fl8a (the record) |
| 55 | A1379 pull request 2 |
| 58-60 | This plan |
| 64 | The environment plans' fiscal pull request (owner lands) |
| 74 | The environment plans |
| 87 | A1018 |
