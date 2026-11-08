# A1308 file layout fl8a: a first setup's files in `<state>/flows/setup/`; Start again deletes the folder's listed files, then the folder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Everything a first setup writes in the state folder lives under `<state>/flows/setup/`,
and Start again removes it as one more listed part of its deletion, so nothing a setup wrote is
left at the top of the state folder, a cut deletion still finishes at the next start, and Start
again still never deletes a file its crash record does not name.

**Architecture:** Path move plus one deletion change. The record `first-setup.json` becomes
`flows/setup/record.json`; the setup's other files move beside it under short names
(`node-key.json`, `public-evidence.json`, `readiness.json`, `operation.json`, `documents/`,
`import/`, `start-again-guesses.json`). fl8b folds the four small mutable ones into the record.
Start again's deletion (`first-setup-start-again-deletion.ts:247-298`) still deletes the venue
databases and the state files outside the flow one by one under its crash record, and treats the
flow folder exactly as it treats `first-fiscal-documents/` today: every file inside is listed and
fingerprinted in the crash record, deleted by name, and the folders are then removed with `rmdir`,
which refuses a folder that still holds anything (`folder-sync.ts:17-21`). Test paths are rewritten
by a committed, idempotent script.

**Where this departs from the design, and why.** The design ends every flow "with one rename of its
folder into scratch, then a delete" (files.md §1 "One record per flow"; README §7). For Start
again that delete would be recursive, so a file the crash record does not name — one the person
never saw on the "files found" page — would be deleted without a word. Today it cannot be: only
named files are unlinked, and an unnamed one makes the folder's `rmdir` fail, which stops the
deletion as `setup.start_again_incomplete` (`deleteMarkedAttempt`, `:535-559`), and the next
start shows it on the "files found" page (`collectStartAgainFindings`, `:608-614`, reports it as
`unlisted`). This plan keeps that behaviour (CLAUDE.md §3: Start again leaves what it did not
create, and only `waitron.sh reset --all` removes its records and the set-aside folder). The
crash-safety the rename was for is already given by the crash record, which finishes a cut
deletion at the next start (`:633-641`).

**Tech Stack:** TypeScript 7, Vitest 4.1.12, Node script under `scripts/a1308/`.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("What a first setup keeps",
"One record per flow"), §2 row `state/flows/setup/`, §3 rows 30, 31, 49-53, 61. Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md) (§1 on rename scripts). Lines at
`649b7576e0`.

**Who lands:** the lane. The fiscal module supplies content the server stores
(`packages/fiscal-verifactu/src/initial-hour-setup.ts:259,263`); no fiscal package names these
files: `git grep -n -E 'first-setup\.json|first-setup-node-key|fiscal-readiness\.json|module-operation-public|first-fiscal-documents|configuration-import|setup-operation\.json|start-again-guesses' -- packages/fiscal-verifactu/src packages/fiscal/src packages/fiscal-none/src ':!*.test.ts'`
printed nothing at `5338b917a2`, and the same pattern over `packages/provisioning/src` printed 56
lines (the control). Eight fiscal-verifactu files do use `node:fs` (among them
`allocation-paper-source.ts`, `cloud-preparation.ts`, `emergency-attempt.ts`), for the module's own
paper and Cloud files, none of them these. Name the folders explicitly: a `packages/fiscal*/src`
wildcard pathspec matched nothing under `git grep <revision>`. No restore or promotion reads these
files.

**Blocked on A1379 part 2, and so on the owner.** This slice needs fl7, which needs A1379 pull
request 2 (removing Continue), and also needs part 2 itself (Needs). Part 2 waits for the owner's
answers to the three questions in `docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md`
(`docs/backlog/setup.md:575`). fl8b and fl10 need this slice, so they wait too.

**First line of the pull request:** "A box part way through a first setup when this lands must use
Start again; other boxes keep working."

## Decisions made in this plan

- **A finished setup keeps its folder — until the owner answers otherwise.** Boot checks the
  finished record against `trading.env` at every start (`apps/server/src/first-fiscal-mode.ts:11-27`;
  `first-setup-entry.ts:31-48`), so this slice ends a setup flow only by Start again, as today's
  `first-setup.json` is kept today. That departs from README §7 ("One folder per flow … ended with
  one rename") and keeps the record — the setup administrator's name, email and password verifier
  (`first-setup-start-again-choose.ts:106` and `:123-127` read them) — on the box for good. **Owner
  question:** should a finished setup's folder end? **Recommended default:** yes, after the first
  trading start that stays up (the same 120-second hook fl6 uses, `node-entry.ts:689`): by then
  boot's check has nothing left to protect, and boot already reads no record as nothing to check
  (`first-fiscal-mode.ts:11-12`, `readResumable` null returns). **Until it is answered:** this slice
  keeps the folder (no behaviour change), and the ending, if approved, is its own small pull request
  after fl8b.
- **`setup-operation.json` becomes `flows/setup/operation.json` and is never folded into the
  record**: the setup server writes it for adopt and restore too (`setup-api.ts:994,1100,1239`), when
  no first setup exists, and a record present for those would read as a claimed setup.
- **`configuration-import.*` keeps its marker-last pair** as `import/artifact`, `import/key`,
  `import/marker.json` (files.md row 49).

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- The setup files keep their writers: `writeDurableHostJson` for the record and its siblings,
  `writeFileDurable` for the import (fl3).
- Start again's refusals stay exactly: `assertNoKeptRecords`, and the refused-file list
  (`first-setup-start-again-deletion.ts:53-74`) with paths changed.
- **Start again never deletes a file its crash record does not name.** No recursive delete of
  `flows/setup` anywhere in Start again; folders go with `removeAndSync(…, "folder")`, an `rmdir`.
  The flow folder never holds Start again's choice records or the set-aside folder: those live in
  `records/` (fl1), which only `waitron.sh reset --all` removes (CLAUDE.md §3; guard
  `scripts/start-again-records-writers.test.ts`).
- A rename script lives at `scripts/a1308/fl8a-setup-flow-paths.mjs`, rewrites only `*.test.ts`
  files and the test helpers listed under Files, and running it twice changes nothing (rules §1).

## What it builds

1. Layout: `SETUP_FLOW_DIR = "flows/setup"`; `FIRST_SETUP_FILE` → `"flows/setup/record.json"`,
   `FIRST_SETUP_NODE_KEY_FILE` → `"flows/setup/node-key.json"`, `MODULE_OPERATION_PUBLIC_FILE` →
   `"flows/setup/public-evidence.json"`, `FISCAL_READINESS_FILE` → `"flows/setup/readiness.json"`,
   `SETUP_OPERATION_FILE` → `"flows/setup/operation.json"`, `FIRST_FISCAL_DOCUMENTS_DIR` →
   `"flows/setup/documents"`, `CONFIGURATION_IMPORT_FILE`/`_ARTIFACT`/`_KEY` →
   `"flows/setup/import/marker.json"`/`"…/artifact"`/`"…/key"`, `START_AGAIN_GUESSES_FILE` →
   `"flows/setup/start-again-guesses.json"`. The old top-level entries leave the table.
2. Writers create `flows/setup/` with `mkdirDurable(…, 0o700)` before their first write
   (`writeDurableHostJson` already makes its parent 0700, `durable-host-json.ts:76-115`).
3. Start again: `listed()` (`first-setup-start-again-deletion.ts:127-146`) and `itemsOnDisk`
   (`:247-298`) list the venue databases and side files, `module-preparation-state.json`,
   `modules.json` (when held) and `trading.env` (when held, A1322) individually, then the flow
   folder the way `first-fiscal-documents/` is handled today (`:273-274`):
   - every regular file in `flows/setup/`, `flows/setup/documents/` and `flows/setup/import/` is a
     `file` item, so the crash record names it with its size and SHA-256 when Start again is
     pressed (`startAgainMarkerFor`, `:319`), and the finisher reports a file it does not name as
     `unlisted` and a changed one as `changed` (`:608-614`), showing the "files found" page and
     deleting nothing, exactly as for `first-fiscal-documents/extra.json` today;
   - any other folder, link or special file anywhere in `flows/setup/` is refused as `layout
     unexpected` (as `filesIn`, `:256-265`, refuses `first-fiscal-documents/inner` today, and
     `entries`, `:238-240`, a link or special file);
   - `flows/setup/operation.json` stays on the refused list (Start again is refused while it
     exists), path changed;
   - `flows/setup/start-again-guesses.json` is the one exception: the "files found" page writes it
     AFTER the crash record (`first-setup-start-again-choose.ts:105`, behind a survey that needs the
     record), so it is never fingerprinted, never reported as `unlisted`, and so never changes the
     list the page shows. It is a `side` item, deleted by its fixed name after the checks pass, the
     way the venue's `-wal`/`-shm` files are today (`:268-271`);
   - the deletion order is the documents' files, `rmdir` `documents/`, the import's files, `rmdir`
     `import/`, the other files with `record.json` last (as `first-setup.json` is last today,
     `:296`), the guesses file, then `rmdir` `flows/setup`. Each `rmdir` fails on a folder that is
     not empty, so a file that appears after the checks stops the deletion as
     `setup.start_again_incomplete` instead of being deleted.
   `fiscal-readiness`, the import and the guesses, which Start again left before (files.md rows 49,
   50, 61), now go, each by name.
4. `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:141-157`) becomes `[FLOWS_DIR, RECORDS_DIR,
   "first-setup-deleting.json"]`, so a restore still refuses an archive entry under any of them.
5. `restore-flow.ts` (fl5) and `reset-request.ts:112` delete `SETUP_OPERATION_FILE` at its new path
   (constant only).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| Folding `node-key.json`, `public-evidence.json`, `readiness.json` and the recovery manifests into `record.json` | Next pull request | fl8b |
| `module-preparation-state.json` | Fiscal hour history, read at every backup and by promotion | fl9 (owner) |
| `modules.json` | Its own move | fl10 (owner) |
| T9 | Run once the record is whole | fl8b |

## Files

- Create: `scripts/a1308/fl8a-setup-flow-paths.mjs`.
- Modify: `packages/store/src/state-layout.ts`, `packages/provisioning/src/first-setup-state.ts`,
  `first-setup-node-key.ts`, `fiscal-readiness.ts`, `setup-operation.ts`, `configuration-import.ts`,
  `first-setup-start-again-guesses.ts`, `first-setup-start-again-names.ts`,
  `first-setup-start-again-deletion.ts`, `first-setup-start-again-leftovers.ts:48-58`,
  `first-setup-resolution-inspection.ts:220-224,278-285,292-310`, `first-setup-recovery-delivery.ts:193`,
  `apps/server/src/first-fiscal-delivery.ts:194,396`, `first-fiscal-evidence.ts:85`,
  `first-setup-resolution.ts:130,151`, `first-setup-unused-assignment.ts:45-154`,
  `restore-flow.ts`, `reset-request.ts:112`, `scripts/start-again-records-writers.test.ts`
  (`ALLOWED` if a listed file stops naming a record folder), `deploy/README.md` if it names the setup
  files.
- Test (script-rewritten, then hand-fixed): the 78 test files and helpers that name these files
  (re-counted at `5338b917a2`: `git grep -l -E 'first-setup\.json|first-setup-node-key\.json|module-operation-public\.json|fiscal-readiness\.json|setup-operation\.json|first-fiscal-documents|first-setup-start-again-guesses\.json|configuration-import\.(json|artifact|key)' -- '*.test.ts' '*.test.mjs' 'apps/*/test/*' 'packages/*/test/*' 'apps/server/src/testing/*'`;
  `apps/server/test/start-again-deleted.ts`, `apps/server/test/start-again-held-fixture.ts`,
  `packages/provisioning/test/start-again-attempt.ts`, `scripts/waitron-sh.test.mjs:1717,1744-1745`
  included). The unlisted-file cases keep their assertions with paths rewritten:
  `packages/provisioning/src/first-setup-start-again-findings.test.ts:84-96`,
  `first-setup-start-again-leftovers.test.ts:376-383`,
  `first-setup-start-again-deletion.test.ts:121-129` (an unexpected folder inside the documents) and
  `apps/server/src/first-setup-start-again.test.ts:1231` (a damaged stray in the documents still
  refuses). A rewrite that makes any of them pass by changing what it expects is a stop (rules §4).

## Size

Estimated: code ~260 counted (paths ~110, Start again's flow items and the guesses exception ~100,
host list and others ~50); script ~60; tests hand-written ~280 (listings and readdir expectations
the script cannot rewrite, ~140; new cases ~140); docs ~10. Script output uncounted. **Total counted
~610.**

## Finish line

- `node scripts/a1308/fl8a-setup-flow-paths.mjs && git diff --quiet` (second run changes nothing).
- `git grep -n -E '"(first-setup\.json|first-setup-node-key\.json|module-operation-public\.json|fiscal-readiness\.json|setup-operation\.json|first-fiscal-documents|first-setup-start-again-guesses\.json|configuration-import\.(json|artifact|key))"' -- apps packages scripts`
  prints nothing. Weaker than its name: quoted literals only, so a name built inside a template
  string is not seen. Control: at `5338b917a2` it printed 455 lines, 60 of them the import's three
  names. The earlier form's bare `configuration-import\.` also matched module imports such as
  `boot.ts:300`'s `from "./configuration-import.js"` (12 such lines), so it could never print
  nothing.
- `git grep -n -P '\brm\(|recursive: true' -- packages/provisioning/src/first-setup-start-again-deletion.ts`
  prints nothing: Start again's deletion still removes no folder recursively.
- `pnpm --filter @waitron/provisioning exec vitest run src/first-setup src/setup-operation src/configuration-import src/fiscal-readiness src/cli-`;
  `pnpm --filter @waitron/server exec vitest run src/first-fiscal src/first-setup src/setup-first-fiscal src/boot.setup-routes src/reset-request src/restore-flow src/recovery-start-again`.
- `pnpm exec vitest run scripts/state-layout.test.ts scripts/start-again-records-writers.test.ts scripts/waitron-sh.test.mjs`.
- Typecheck store, provisioning, server; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus: the "files found" choice can run after Start again has deleted the flow folder
(read `first-setup-start-again-choose.ts` and the leftovers survey, which needs the record,
`first-setup-start-again-leftovers.ts:184-209`): stop, because the guesses would be lost; any file
other than `start-again-guesses.json` found to be written into `flows/setup/` after the crash
record: stop, because it would read as `unlisted` on every finish; a behaviour test that needs a
changed assertion other than a path or a listing.

## Needs

fl5 (its `SETUP_OPERATION_FILE` use) and fl7 landed; A1379 pull request 2 landed (header). fl2's
scratch folder is no longer needed here: Start again renames nothing into it.

## Review Focus

1. Start again cut after the venue databases went but before the flow's files went: the next start
   finishes it, and nothing is left in `flows/` (Task 2).
2. Start again cut half-way through the flow's files: the next start deletes the rest by name and
   clears the crash record (Task 2).
3. A setup with a staged configuration import and a readiness result: Start again leaves neither
   (Task 2).
4. Start again still refuses while `flows/setup/operation.json` says an operation runs
   (`first-setup-start-again-deletion.ts:56`, path only).
5. An archive carrying `secrets/flows/setup/record.json` is refused on restore (Task 1).
6. A file in `flows/setup/` that the crash record does not name is shown on the "files found" page
   and is still on disk; a file that appears after the checks stops the deletion and is still on
   disk (Task 2).
7. A wrong password on the "files found" page writes the guesses file and the next attempt, with the
   same list, still succeeds; the finished deletion removes the guesses file (Task 2).

---

### Task 1: The paths, and the script for the tests

- [ ] **Step 1:** Write `scripts/a1308/fl8a-setup-flow-paths.mjs`: for every tracked `*.test.ts`
  under `apps/` and `packages/` and the helper files under Files, replace the quoted literals of
  What it builds 1's old names with the new values (string literals only; `join(x, "first-setup.json")`
  becomes `join(x, "flows/setup/record.json")`), and print the files it changed. Run it, then run
  it again and check `git diff` shows no change from the second run.
- [ ] **Step 2:** Change the layout values and the writers (What it builds 1-2, 4-5). Add a case to
  `first-setup-host-path.test.ts`: `"an archive entry under flows/ is a host path"`.
- [ ] **Step 3:** Run the Finish line's tests; hand-fix what the script could not reach
  (directory listings, regular expressions such as `start-again-deleted.ts:111`) and list each
  hand-fixed file in the PR description. Commit the script and its output in one commit, the hand
  fixes in the next.

### Task 2: Start again deletes the flow

- [ ] **Step 1:** Failing cases in `packages/provisioning/src/first-setup-start-again-deletion.test.ts`:
  `"Start again removes flows/setup with its import, readiness and guesses"`; `"a deletion cut
  before the flow's files finishes at the next start"`; `"a deletion cut half-way through the
  flow's files finishes at the next start and clears its crash record"`; `"an unlisted file in
  flows/setup is reported and kept"` (write `flows/setup/stray.json` after the crash record, run
  `finishStartAgainDeletion`; expect `setup.start_again_incomplete` with reason `unlisted file:
  state/flows/setup/stray.json`, the stray and `record.json` still on disk); `"a file that appears
  after the checks is never deleted"` (through `deleteMarkedAttempt`'s `remove` seam, `:538`, write
  `flows/setup/late.json` just before the `rmdir` of `flows/setup`; expect
  `setup.start_again_incomplete` and `late.json` still on disk). In
  `first-setup-start-again-choose.test.ts`: `"a wrong guess does not change the list the page
  shows"` (a cut deletion with one stray; a wrong password, then the right one with the same
  `listed` digest; expect the Move to succeed, the stray under `records/set-aside/`, and no
  `flows/setup`). Each new case checks the stray by reading the disk, not by the absence of an
  error.
- [ ] **Step 2:** Run; fail. Implement What it builds 3.
- [ ] **Step 3:** Run the Finish line. Commit.

## After the tasks

`/finish-branch` with this plan as its note.
