# A1308 file layout fl4: Waitron Cloud's files in `<state>/cloud/`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** Every file the box keeps for Waitron Cloud lives in one folder, `<state>/cloud/`, written
with the one durable helper. When a Cloud recovery's and a Cloud replacement's records are deleted
is an owner question (Q1); the recommended default keeps both until a reset, as today.

**Architecture:** Five top-level files become `cloud/connection.json`, `cloud/recovery.json`,
`cloud/replacement.json`, `cloud/staff.key` and `cloud/staff.crt` (plus `cloud/snapshots/` if the
one backup service has left a Cloud snapshot state file). The four hand-made flush-and-rename
writers become `writeFileDurable`; the staff key keeps its create-only `link` publish, which
`writeFileDurable` cannot express. The layout module declares `CLOUD_DIR` and its children; backup
verification refuses any archive entry under `secrets/cloud/`.

**Tech Stack:** TypeScript 7, Vitest 4.1.12.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("Waitron Cloud's files are
grouped in `cloud/`"), §2 row `state/cloud/`, §3 rows 25-29. Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md). Lines at `649b7576e0`.

**Blocked on the owner, through fl1.** fl1 waits for A1379 pull request 2, which waits for the
owner's answers to Questions 1-3 of
[`2026-11-06-a1379-setup-start-again.md`](2026-11-06-a1379-setup-start-again.md). Q1 below is also
the owner's.

**Who lands:** the lane. Cloud recovery and replacement run only outside production
(`cloud-recovery.ts:151`, `boot.ts:3256-3257` at `9c66ef0356`); nothing in rules §6 changes.

**First line of the pull request:** "A box paired with Waitron Cloud before this change must pair
again (its link file is no longer read at the old name; pre-live, CLAUDE.md §3 last data rule)."

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- Line numbers at `649b7576e0`; the cites the 2026-11-08 review touched were re-read at
  `9c66ef0356`.
- Cloud keys stay out of backups (`state-secrets.ts:10-14`): `RECOVERY_FILES` is an allowlist and
  gains nothing.
- The staff key is never overwritten once made (`cloud-remote.ts:43-71`).

## What it builds

1. Layout entries `CLOUD_DIR = "cloud"` (reset: deleted) and constants `CLOUD_CONNECTION_FILE`,
   `CLOUD_RECOVERY_FILE`, `CLOUD_REPLACEMENT_FILE`, `CLOUD_STAFF_KEY_FILE`, `CLOUD_STAFF_CERT_FILE`
   (values `"cloud/connection.json"` and so on). If `git grep -n cloud-snapshots apps/server/src`
   still prints a path after the one backup service (at `9c66ef0356` it prints
   `cloud-snapshot-archive.ts:29` and `cloud-snapshot-worker.ts:141`), `CLOUD_SNAPSHOTS_DIR` becomes
   `"cloud/snapshots"`, and its staging moves with it to `cloud/snapshots/staging/`. fl2 does not
   move that staging (fl2, What it leaves out, first row); it joins `scratch/backup/` only when the
   one backup service (jr) takes Cloud snapshots on.
2. Readers and writers re-pointed: `cloud-client.ts:187-247`, `cloud-recovery.ts:30,198-220`,
   `cloud-recovery-v2.ts:139,186`, `cloud-replacement.ts:69,142-162`, `cloud-remote.ts:25-31,43-71,102-121,196-211`,
   `cloud-staff-certificate.ts:29-47,123`, `boot.ts:3580-3586`.
3. `save()` in `cloud-client.ts`, `cloud-recovery.ts`, `cloud-replacement.ts` and the certificate
   install in `cloud-remote.ts` become `writeFileDurable(path, body, 0o600)` after
   `mkdirDurable(statePath(stateDir, CLOUD_DIR), 0o700)`; the read checks (mode 0600 only, size
   limits) stay.
4. **Only if the owner answers Q1 with option B** (the default, A, builds nothing here): when a
   replacement completes — the exchange's view is `complete` and `importInto` succeeded
   (`cloud-replacement.ts:339-354`), or `resume()` re-imported it at start (`:380-386`) — the box
   deletes `cloud/replacement.json` and then `cloud/recovery.json`, each with `removeAndSync`
   (`packages/provisioning/src/folder-sync.ts`). A stop is recorded only for a replacement that
   completed and was imported, because `recordStop`
   (`cloud-replacement.ts:388-403`, called from the revoke route, `cloud-api.ts:191-194`) writes
   only when the connection already holds the replacement's request id (`:399`), which only
   `importInto` puts there. Deleting the record at completion therefore leaves `recordStop` nothing
   to write.
5. `backup-verification-secrets.ts:69` refuses any entry under `secrets/cloud/` in place of the
   named files; `first-setup-start-again-deletion.ts:60` and
   `first-setup-resolution-inspection.ts:285` use `CLOUD_REPLACEMENT_FILE`.
6. `scripts/durable-writes.test.ts` drops the four converted files from its allowed map
   (`cloud-remote.ts` stays, reason "the staff key's create-only link").

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| The tunnel's `peer.json` and `public-key` | On the separate `tunnel_control` volume (`deploy/compose.yml:42,47,208`), not the state folder | — |
| Cloud snapshots becoming a backend of the one backup service | Not a file move | jr |
| Deleting `cloud/recovery.json` when no replacement ever follows a Cloud recovery | `replacementApproval` and `replacementIdentity` need it at phase `restored` or `reported` (`cloud-recovery.ts:497-527`); nothing marks "no replacement wanted" | — (stays until the box is reset, or a completed replacement if Q1 is B) |

## Files

- Modify: the files in What it builds 2 and 5, `packages/store/src/state-layout.ts`,
  `scripts/durable-writes.test.ts`, `apps/server/src/cloud-api.ts:83` (no change expected; it
  reads `hasProposal()`), docs that name the files (`git grep -n -E "cloud-(connection|recovery|replacement|staff)" -- docs deploy apps/server/README.md`).
- Test: the 34 test files naming the five names (`git grep -l` at `649b7576e0`; the heaviest are
  `cloud-client.test.ts`, `cloud-replacement.test.ts`, `cloud-remote.test.ts`,
  `cloud-staff-certificate.test.ts`), plus, only under Q1 option B, new cases in
  `cloud-replacement.test.ts`.
- Docs: `docs/superpowers/specs/2026-11-02-rationalisation/files.md` rows 26-27 (a dated note
  under option A), `docs/backlog/replication-cloud.md:717` (names `cloud-replacement.json`).

## Size

Estimated, under the default (Q1 option A): code ~85 counted (paths ~40, writer swaps ~30 net of
~60 deleted lines, verification refusal ~15); tests ~200 (path edits across 34 files); docs ~15.
**Total counted ~300.** Option B adds about 25 lines of code and about 60 of tests, plus the
assertion changes listed under Q1, and makes this the larger of the two.

## Finish line

- `git grep -n -E '"cloud-(connection|recovery|replacement)\.json"|"cloud-staff\.(key|crt)"' -- apps packages`
  prints nothing.
- `pnpm --filter @waitron/server exec vitest run src/cloud- src/backup-verification-secrets src/backup-data-placement src/boot.failed-start src/boot.mirror src/boot.management-origin src/node-entry.test.ts src/restore-request.verification src/state-secrets src/first-setup-start-again`.
- `pnpm exec vitest run scripts/state-layout.test.ts scripts/durable-writes.test.ts`.
- Typecheck server, store, provisioning; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus: the one backup service is in flight (its branch edits `cloud-snapshot-*`): wait.
A reader of a Cloud file outside the files listed here: stop.

## Needs

fl1 and fl3 landed (fl1 itself waits for A1379 pull request 2 and so for the owner's answers to that
plan's Questions 1-3); the one backup service (jr) landed or not started; Q1 answered.

## Review Focus

1. Under option A: every existing `cloud-replacement.test.ts` case passes with paths changed only,
   including the ones that need the record after completion (`:312` "imports a durable completion
   on boot after the recovery request file is removed", `:353` "sends a stop again … after the
   connection file is deleted", `:428`, `:444`, `:487`, `:517`, at `9c66ef0356`).
2. Under option B only: Task 2's cases, and the assertions Q1 lists as changing, nothing else.
3. An archive carrying `secrets/cloud/connection.json` is refused by verification (Task 1).
4. The staff listener starts only when `cloud/staff.crt` exists (`boot.ts:3580-3586`; re-pointed
   `boot.mirror` cases).

---

### Task 1: The folder and the writers

- [ ] **Step 1:** Failing case in `cloud-client.test.ts`: `"the connection is saved as
  cloud/connection.json, mode 0600, flushed"` (file exists at the new path; the order spy from
  `box-secrets.test.ts:70-86` sees sync, rename, folder sync). Failing case in
  `backup-verification-secrets.test.ts`: `"an entry under secrets/cloud/ is refused"`.
- [ ] **Step 2:** Run; fail. Add the layout entries, re-point every reader and writer, swap the four
  writers to `writeFileDurable`, change the verification refusal.
- [ ] **Step 3:** Re-point the 34 test files (paths only). Under Q1 option A, add the dated note to
  files.md rows 26-27 (Q1's reasons, the owner's answer and its date) and change
  `docs/backlog/replication-cloud.md:717`'s file name. Run the Finish line's tests. Commit.

### Task 2: Records end with the replacement (only under Q1 option B)

Under option A, skip this task; Task 1 adds the dated note to files.md rows 26-27 instead.

- [ ] **Step 1:** Failing cases in `cloud-replacement.test.ts`: `"a completed replacement deletes
  its record and the recovery record"`; `"resume after a crash before the deletes re-imports once,
  then deletes"` (seed both records with view `complete` and the connection already imported);
  and every assertion Q1 lists, changed in the same commit and named in the PR description.
- [ ] **Step 2:** Run; the first two fail. After `importInto` returns in `exchange` and in `resume`,
  call `removeAndSync(replacementPath, "file")` then `removeAndSync(recoveryPath, "file")`,
  ignoring `ENOENT`.
- [ ] **Step 3:** Run; pass. Update the allowed map in `scripts/durable-writes.test.ts`; run it.
  Commit.

## Owner questions

- **Q1. When are `cloud/replacement.json` and `cloud/recovery.json` deleted?** files.md rows 26-27
  say "deleted when the flow ends". Read at `9c66ef0356`, nothing in the code ends that flow while
  the box keeps its Cloud link:
  - every start runs `resume()` (`boot.ts:3266-3270`; `cloud-replacement.ts:380-386`), which
    re-imports a completed replacement into the connection; `importReplacement`
    (`cloud-client.ts:507-560`) rebuilds a deleted connection file from it, carrying any stop;
  - a later Stop access records the stop in the replacement record (`cloud-api.ts:191-194` →
    `recordStop`, `cloud-replacement.ts:388-403`), and only after import (`:399`);
  - `/management-api/cloud/status` (`cloud-api.ts:78-96`) answers `replacement` from the record,
    `replacementPending` from whether it exists, and `replacementEligible` from the recovery
    record.

  **Option A (recommended default):** move the files only; both stay until a reset, as today, and
  the PR adds a dated note to files.md rows 26-27 with the reasons above. Recovery and replacement
  are preproduction only (`cloud-recovery.ts:151`, `boot.ts:3256-3257` at `9c66ef0356`). **Option B:** delete both at
  completion (What it builds 4). Then these assertions change, by design: after a completed
  replacement the status answer has `replacement: null`, `replacementPending: false` and
  `replacementEligible: false`; a Stop access after completion is kept only in
  `cloud/connection.json`; and a deleted connection file is no longer rebuilt at the next start, so
  the existing cases at `cloud-replacement.test.ts:353`, `:371`, `:394`, `:413`, `:428`, `:444`,
  `:487` and `:517` (at `9c66ef0356`) change or go. B is a behaviour change the design did not
  spell out, which is why it is not the default.

## After the tasks

`/finish-branch` with this plan as its note.
