# A1308 file layout fl9: one fiscal hour history file per module, `<state>/module-records/<module>.json` — OWNER LANDS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Each module's preparation history (today one shared `module-preparation-state.json`) and
the history a restore placed for it (today `module-evidence/<module>/<source>.json`) live in one
file per module with two sections, `prepared` and `retained`, which Start again treats differently,
as today; and the module setup seat's two hooks that nothing calls any more are removed.

**Architecture:** A new module `packages/provisioning/src/module-records.ts` is the only reader and
writer of `module-records/<module>.json`: `{ version: 1, prepared: Revision[], retained: Record<source, unknown> }`.
`module-preparation-state.ts` keeps its public functions and its validation of a revision but stores
each module's revisions in that module's file. Backups build the same archive entries as today
(`secrets/module-evidence/<module>/<source>.json`, `apps/server/src/backup-sources.ts:57-63`), so
the fiscal package's backup verification is untouched. A restore no longer writes those entries as
loose files: it stages each module's new record (the box's own `prepared` plus the archive's
`retained`) as one secret file through the existing staged secret swap (`restore-secrets.ts:58-182`).

**Tech Stack:** TypeScript 7, Vitest 4.1.12.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §3 rows 32 and 54, §5 T7; the
brief's rule that a change to which fiscal state file a restore or promotion reads is owner-landed
(slice rules §6). Files.md §1's `waitron-provision` bullet for the seat hooks. Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md). Lines at `649b7576e0`.

**Who lands: the owner.** Restore, promotion (`node-operation-preparation.ts:114,224`), handover
(`handover-place-copy.ts:278-285`) and the recovery pack (`recovery-document-evidence.ts`) read the
fiscal hour history; the seat hooks are in `packages/fiscal-verifactu`. The PR header says so.

**Waits for A1379 part 2 to land.** This slice needs A1379 pull request 2 (the seat hooks it
deletes lose their last caller there, and fl8a needs it too). The owner answered part 2's three
questions on 2026-11-09 (`docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md`), so it
waits only to land.

**First line of the pull request:** "Every venue is reset: a box's kept series names and restored
hour history move to a new file; backups made before this change restore as before (their archive
format is unchanged), but a box set up before it must be reset."

## T7 — answered (git log, read, not run)

`git log -S module-evidence -- packages/provisioning/src/first-setup-start-again-deletion.ts` prints
nothing: Start again never named the folder. The A1131bc design records why it is absent:
"first setup does not write it, so beside a failed setup it exists only on a box restored earlier
and not reset since" (`docs/superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md:252-254`),
and its amendment line (`:8`) calls the check moot; A1042 (`e2a9571385`) deletes the preparation
file on purpose. That record makes the absence an accident of where the file was written, not a
decision to keep it. The reason this plan keeps `retained` anyway is safety: the restored history
lists minute names an earlier box used, and a name in it can only make a later box refuse a
minute, never pick one twice (CLAUDE.md §5, never reuse an installation name), so keeping it can
never cause a reused name and deleting it could. So by files.md T7's rule the file keeps two
sections: Start again empties `prepared` and keeps `retained`.

## Global Constraints

- Rules §1, §4, §5, §8, §9; §6 owner landing. `git commit -s`; never `--no-verify`.
- Restore and promotion behaviour does not change; every hour-recovery, handover and promotion
  behaviour test keeps its assertions (rules §4). Restore and promotion start a new chain under a
  new installation name (CLAUDE.md §5): the history that decides which names are taken must read
  exactly what it read before.
- Records are written with `writeDurableHostJson` (as `module-preparation-state.ts:156,210` does
  today), inside the in-process turn the preparation store already uses, and only while the venue
  folder is held.

## What it builds

1. Layout: `MODULE_RECORDS_DIR = "module-records"` (reset: deleted); `MODULE_PREPARATION_STATE_FILE`
   and `MODULE_EVIDENCE_DIR` leave the table.
2. `module-records.ts`: `readModuleRecord(stateDir, module)`, `updateModulePrepared(stateDir,
   module, change)`, `replaceModuleRetained(stateDir, module, retained)`, `clearModulePrepared(stateDir)`
   (every module), `moduleRecordBytes(stateDir, module, retained)` (the bytes a restore stages).
   Module names checked against `/^[a-z][a-z0-9-]*$/` (as `backup-sources.ts:54-55`).
3. `module-preparation-state.ts` (`:28`, `:149-157`, `:174`, `:210`) and
   `readModulePreparationHistory` read and write `prepared` through it; the 1 MiB limit applies per
   file.
4. `recovery-document-evidence.ts:26-29` and `archive-entries.ts:39-45` read `retained` from the
   record; `backup-sources.ts` is unchanged except its `readRetained` source.
5. Restore: `restore-secrets.ts` `stageSecrets` (`:58-91`) and `restore.ts` `restoreSecrets`
   (`:850-866`) take the archive's `module-evidence/<module>/<source>.json` entries out of the
   generic file list, group them by module, and stage `module-records/<module>.json` with
   `moduleRecordBytes` — so the record joins the same publish, put-back and discard as every other
   restored secret. `backup-data-placement.ts:77-82` (the verifier's copy) does the same. **What a
   module's new `retained` holds:** the box's existing `retained`, with each source the archive
   carries replaced by the archive's copy; a source the archive does not carry keeps the box's.
   That is today's behaviour, read, not run: both restore paths write only the archive's own
   entries as files and remove nothing under `module-evidence/` (`restore-secrets.ts:58-100`,
   `restore.ts:850-866`), so a box restored from an archive with no history for a module keeps the
   history it had. Keeping it is also the safe direction (T7). A module with neither the box's nor
   the archive's history gets no file.
6. Start again (`first-setup-start-again-deletion.ts:134,272`): `clearModulePrepared` in place of
   deleting `module-preparation-state.json`.
7. Handover: `packages/handover/src/manifest.ts:149-162` becomes two rows,
   `module-records/<module>.json#prepared` (transferred; the indicator carries M1's kept selections)
   and `module-records/<module>.json#retained` (source-only). **How the `prepared` row maps to the
   modules (decided here from the code, not left open):** it stays ONE row whose item is that
   literal string, `<module>` and all, carrying every module's revisions in one `revisions` list,
   exactly as today's one `module-preparation-state.json` row does (`handover-manifest.ts:54-58`);
   each revision already names its module (`binding.module`,
   `packages/module/src/operation-authority.ts:1-7`). The item name is one exported constant in
   `@waitron/handover`, used by every reader and writer of the row: the indicator builder
   (`handover-manifest.ts:25,54-58`), the parser's required fields (`indicator-parse.ts:125-130`),
   the compare (`handover-compare.ts:340-344`) and the placement (`handover-place-copy.ts:278-285`).
   M2's merge (`mergeSelections`, `:177-190`, through `mergeModulePreparationRevisions`) writes each
   revision into the `prepared` section of the file its `binding.module` names. Why this cannot
   silently drop a name M1 picked: `REQUIRED_STATE_FIELDS` (`indicator-parse.ts:125-130`, checked at
   `:140-144`) refuses an
   indicator that lacks the row or its `revisions` (`nodeLocal.<item>`), so two boxes that disagree
   on the name fail the handover loudly instead of placing the copy with nothing merged, which would
   let M2 choose a minute M1 already used (CLAUDE.md §5). The 1 MiB limit applies to all modules'
   `prepared` together, as it does to today's one file, so the indicator's 4 MiB bound and its
   comment (`handover-destination-duty.ts:56-58`) still hold, and `modulePreparationMergeFits`
   (`module-preparation-state.ts:135`) checks the merged total. `indicator-parse.ts:84`'s comment
   and `handover-destination-duty.ts:56-58`'s name the new file. Wording:
   `apps/dashboard/src/i18n/codes.ts:1468-1475` at `5338b917a2` (`:1464-1471` at this plan's base;
   `handover.settings_unreadable` and
   `handover.destination_settings_unreadable`, English and Spanish) name
   `module-preparation-state.json`; it becomes "its kept series names" / "sus nombres de serie
   guardados" (fl10 changes the `modules.json` name in the same sentences).
8. The module setup seat's `commandResume` and `resume` (`packages/module/src/initial-setup.ts:36-40`)
   and fiscal-verifactu's two implementations (`packages/fiscal-verifactu/src/initial-hour-setup.ts:143-156`)
   are deleted: after A1379 pull request 2 nothing calls them (`git grep -n -E "\.commandResume|\.resume\(" -- packages apps ':!*.test.ts'`
   prints no seat call; re-run it).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| The archive's entry names and fiscal-verifactu's backup verification (`backup-verification.ts:17,203`) | Unchanged on purpose: the archive format stays | — |
| `module-operation-public.json` | Setup evidence; folded by fl8b | fl8b |

## Files

As named in What it builds; create `packages/provisioning/src/module-records.ts` and its test.
`scripts/handover-manifest-complete.test.ts:69-72` names both old files for every
preparation-history source; its list becomes `module-records/${module.name}.json#prepared` and
`module-records/${module.name}.json#retained`, and its assertion (every source's files have a row)
does not change. Test: the 12 files naming `module-evidence` and the 40 naming
`module-preparation-state.json` (both re-counted at `5338b917a2` with `git grep -l` over
`*.test.ts` and `*.test.mjs`), and the helpers `apps/server/src/testing/{place-copy-box, staged-hour-crash,
staged-hour-restore, stream-loop-scenario, stream-pause-scenario, boot-harness, backup-verification-fixture}.ts`,
`apps/server/test/{hour-recovery-host, start-again-deleted, start-again-held-fixture}.ts`.

## Size

Estimated: code ~480 counted (module ~150, preparation store ~90, restore staging with the
per-source overlay ~70, handover with the per-module merge ~90, readers ~40, Start again ~15,
layout ~10, seat removal ~15 added with ~40 deleted); tests ~440 (module ~120, new restore and
handover cases ~60, fixtures through a helper `seedModuleRecord` across ~50 files ~260); docs ~15.
**Total counted ~935**, near the cap: past ~1,200 is a stop (rules §5.6).

## Finish line

- `git grep -n -E 'module-preparation-state\.json|"module-evidence"' -- apps packages scripts` prints
  only the archive entry prefix `secrets/module-evidence/` in `backup-sources.ts`,
  `restore-secrets.ts`, `restore.ts`, `backup-data-placement.ts` and fiscal-verifactu.
- `pnpm --filter @waitron/provisioning exec vitest run src/module-records src/module-preparation src/first-setup-start-again src/cli-`;
  `pnpm --filter @waitron/server exec vitest run src/hour- src/handover- src/recovery-document-evidence src/backup-data-placement src/backup-verification-compatibility src/restore src/first-setup-start-again src/backup-recovery-pack-api src/first-fiscal-hour`;
  `pnpm --filter @waitron/handover exec vitest run`; `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification src/initial-hour-setup`.
- `pnpm exec vitest run scripts/handover-manifest-complete.test.ts scripts/state-layout.test.ts`.
- Typecheck provisioning, server, handover, module, fiscal-verifactu; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus: any hour-recovery, promotion or handover behaviour test that needs a changed
assertion; a writer of either old file not listed here; the seat-hook grep finds a caller; a reader
or writer of the handover's `prepared` row that cannot use the one shared item-name constant, or a
revision whose `binding.module` names no module with a preparation-history source (the merge would
have no file to put it in): stop, because either could drop a minute name M1 picked.

## Needs

fl8a landed (it rewrites Start again's deletion list); A1379 pull request 2 landed (header). fl8b
need not land first; whichever of fl8b and fl9 lands second re-runs fl8b's T9.

## Review Focus

1. A restore onto a box that has kept selections keeps them and takes the archive's retained history
   (Task 2); a restore from an archive with no history for a module keeps the box's `retained`
   (Task 2).
2. A restore that fails after staging puts every record back as it was (the swap's put-back,
   Task 2).
3. Start again after a restore keeps `retained` and empties `prepared` (Task 3).
4. A handover places M1's kept selections into M2's `prepared` before the copy (existing
   `handover-place-copy` cases, item names only); with two modules' revisions in the one row, each
   lands in its own module's file, and an indicator without the row is refused (Task 3).
5. A recovery pack made after a restore shows the same evidence as before (existing
   `backup-recovery-pack-api.make` cases).

---

### Task 1: `module-records.ts` and the preparation store

- [ ] **Step 1:** Tests: `"prepared and retained live in one file per module"`; `"updating prepared
  keeps retained"`; `"clearModulePrepared keeps every module's retained"`; `"a module name outside
  the pattern is refused"`.
- [ ] **Step 2:** Run; fail. Implement; move `module-preparation-state.ts` onto it. Re-point its
  tests (paths only). Run. Commit.

### Task 2: Backup, restore and the recovery pack

- [ ] **Step 1:** Failing cases in `restore-secrets.test.ts`: `"an archive's module-evidence entries
  become module-records/<module>.json with the box's prepared kept"`; `"a failed restore puts each
  module record back"`; `"an archive with no history for a module keeps the box's retained"`; `"an
  archive's source replaces only that source of the box's retained"`.
- [ ] **Step 2:** Implement What it builds 4-5. Re-point the fixture writes through a test helper
  `seedModuleRecord(stateDir, module, { prepared?, retained? })` in `apps/server/test/`. Run the
  hour-recovery and backup files. Commit.

### Task 3: Start again, handover, the seat hooks

- [ ] **Step 1:** Failing cases: in `first-setup-start-again-deletion.test.ts`, `"Start again empties
  prepared and keeps retained"`; in `apps/server/src/handover-place-copy.test.ts`, `"the prepared
  row's revisions land in each module's own file"` (two modules in one row; read both files); in
  `packages/handover/src/indicator-parse.test.ts`, `"an indicator whose prepared row is missing is
  refused"` (expect the refusal to name `nodeLocal.module-records/<module>.json#prepared`; control:
  the same indicator with the row parses).
- [ ] **Step 2:** Implement What it builds 6-8. Run the Finish line. Commit.

## After the tasks

`/finish-branch` with this plan as its note; the lane marks the PR "owner lands" and does not merge.
