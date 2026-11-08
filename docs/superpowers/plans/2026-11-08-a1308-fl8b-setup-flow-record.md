# A1308 file layout fl8b: one record for a first setup; T9; nothing undeclared in the state folder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** A first setup's small mutable files that only exist beside a setup record (the node key's
verifier, the published evidence and each module's recovery-document manifest) become sections of
`flows/setup/record.json`, so a setup is one record plus attachments; a test cuts a setup
at every stage, presses Start again and proves nothing is left (T9); and a full setup leaves no
state-folder entry the layout module does not declare.

**Architecture:** A small module in `@waitron/provisioning`, `setup-flow-record.ts`, owns the record
file: one read, and one read-modify-write per named section, taken in the in-process turn for that
state folder (`attempt-turns.ts`, as `first-setup-start-again-choose.ts:99` uses it) and written with
`writeDurableHostJson`. Cross-process safety is the venue lock (fl7's T3). The first-setup store's
own state becomes the `attempt` section; each other writer writes its own section through the module
and validates it with the parser it uses today.

**The fiscal readiness result stays a file,** `flows/setup/readiness.json` (fl8a's path), against
files.md row 50. In development mode the setup wizard skips the claim
(`apps/setup/src/setup-app.ts:1052`) and still runs the fiscal test (`:1978`), whose route
(`apps/server/src/setup-api.ts:805-831`) writes the readiness result through `runFiscalTest`
(`apps/server/src/boot.ts:1520-1545`) with no setup record on disk. As a section it would be
refused `setup.attempt_invalid` there. It stays an attachment that Start again deletes by name
(fl8a).

**Tech Stack:** TypeScript 7, Vitest 4.1.12.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("One record per flow": "the
crash-safety arguments … support splitting attachments from the record, not splitting the record
into several files"), §3 rows 31, 50, 52, 53, §5 T9. Slice rules:
[`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md). Lines at `649b7576e0` (paths
as fl8a left them).

**Who lands:** the lane (same reasoning as fl8a: no fiscal package and no restore or promotion
reads these files).

**Blocked on A1379 part 2, through fl8a.** This slice needs fl8a, which needs fl7 and A1379 pull
request 2; part 2 waits for the owner's answers to the three questions in
`docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md` (`docs/backlog/setup.md:575`).

**First line of the pull request:** "A box part way through a first setup when this lands must use
Start again; other boxes keep working."

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- The record stays under `STATE_LIMIT` (1 MiB, `first-setup-state.ts:161`); the documents' chunks
  stay attachments in `documents/` with their manifest written last (files.md row 30).
- `flows/setup/operation.json` is not folded (fl8a's decision).

## What it builds

1. `packages/provisioning/src/setup-flow-record.ts`:

   ```ts
   export interface SetupFlowRecord {
     readonly version: 1;
     readonly attempt: FirstSetupState;
     readonly nodeKey?: unknown;          // today's first-setup-node-key.json body
     readonly publicEvidence?: unknown;   // today's module-operation-public.json body
     readonly recoveryManifests?: Readonly<Record<string, unknown>>; // today's documents/<module>.recovery.json
   }
   export type SetupFlowSection = "attempt" | "nodeKey" | "publicEvidence" | "recoveryManifests";
   export async function readSetupFlowRecord(stateDir: string): Promise<SetupFlowRecord | null>;
   export async function updateSetupFlowSection<K extends SetupFlowSection>(
     stateDir: string, section: K,
     change: (current: SetupFlowRecord[K] | undefined) => SetupFlowRecord[K],
   ): Promise<void>;
   ```

   A section other than `attempt` written while the record has no `attempt` is refused
   `setup.attempt_invalid` (no setup to attach it to). Each section's body is validated by the
   function that validates that file today, so a malformed section reads as today's malformed file
   did.
2. Writers and readers use it: the first-setup store (`first-setup-state.ts` `persist`, `readPair`,
   `readForRepair`), `first-setup-node-key.ts:72-106`, `apps/server/src/first-fiscal-evidence.ts:85-184`,
   `first-setup-recovery-delivery.ts:193-286`, and the readers
   `apps/server/src/first-fiscal-delivery.ts:395-398`, `first-setup-resolution-inspection.ts:220-310`,
   `apps/server/src/first-setup-unused-assignment.ts:45-154`, `apps/server/src/first-setup-resolution.ts:130`.
3. Layout: `FIRST_SETUP_NODE_KEY_FILE` and `MODULE_OPERATION_PUBLIC_FILE` are deleted;
   `FISCAL_READINESS_FILE` stays at `flows/setup/readiness.json`.
4. T9 as a test (Task 3) and the "nothing undeclared" check (Task 4).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| `operation.json` | fl8a's decision | — |
| `readiness.json` | Written with no setup record in development mode (Architecture) | — |
| `documents/<module>.json` and its chunks | Immutable attachments with manifest last | — |
| `first-setup-deleting.json` | Start again's own crash record in the venue folder | — |

## Files

- Create: `packages/provisioning/src/setup-flow-record.ts`, its test,
  `apps/server/src/first-setup-start-again.leftovers.test.ts` (T9), and a case in
  `apps/server/src/first-fiscal-setup.e2e.test.ts` (Task 4).
- Modify: the files in What it builds 2, `packages/store/src/state-layout.ts`,
  `packages/provisioning/src/index.ts`.
- Test: tests that read or write the folded files directly (from fl8a's rewrite: `node-key.json` in
  about 18 files, `public-evidence.json` in about 10, `readiness.json` in 4, `.recovery.json` in 8;
  counts are fl8a's inventory of the old names) move to the module's functions. The readiness
  tests do not move.

## Size

Estimated: code ~340 counted (module ~120, writers and readers ~220 net); tests ~420 (module ~110,
re-pointed fixtures ~165, T9 ~105, undeclared check ~40); docs ~10; Task 5 (the ending) ~150 (code
~50, tests ~100). **Total counted ~920.** If it passes ~1,050, Task 5 becomes its own pull request.

## Finish line

- `git grep -n -E '(node-key|public-evidence)\.json|\.recovery\.json' -- apps packages`
  prints nothing outside `setup-flow-record.ts`'s tests.
- `pnpm --filter @waitron/provisioning exec vitest run src/setup-flow-record src/first-setup src/fiscal-readiness src/cli-`;
  `pnpm --filter @waitron/server exec vitest run src/first-fiscal src/first-setup src/setup-first-fiscal src/boot.setup-routes`.
- `pnpm exec vitest run scripts/state-layout.test.ts`. Typecheck provisioning, server, store;
  `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus:
- a section writer runs when no setup record exists (a test hits `setup.attempt_invalid` on a path
  that worked before): stop — the section cannot live in the setup record;
- **T9 finds a leftover** outside the allowed list in Task 3: add it to Start again's deletion list
  (by name, fingerprinted, as fl8a's rules require) if the setup wrote it; otherwise stop.

## Needs

fl8a landed (and through it fl7 and A1379 pull request 2; header). fl9 need not land first (Task 3,
"Order with fl9").

## Review Focus

1. Two writers updating different sections at once in one process both land (Task 1).
2. A crash during a section update leaves the record whole, old or new (`writeDurableHostJson`
   renames whole files; Task 1's fault case).
3. A record whose `nodeKey` section is malformed reads as the malformed node-key file did
   (Task 2).
4. Start again at every stage leaves only the box's own files (Task 3).
5. A full first setup leaves only declared entries in the state folder (Task 4).
6. In development mode, the fiscal test with no setup record still writes `readiness.json` (existing
   readiness route cases, unchanged).

---

### Task 1: The record module

- [ ] **Step 1:** Tests: `"updating one section keeps the others"`; `"two updates started together
  both land"` (no `await` between the calls); `"a section with no attempt is refused"`; `"a failed
  write leaves the previous record"` (inject a write failure through `writeDurableHostJson`'s I/O
  seam, `durable-host-json.ts:12`).
- [ ] **Step 2:** Run; fail. Implement. Run; pass. Commit.

### Task 2: Writers and readers use sections

- [ ] **Step 1:** Re-point the tests that wrote or read the three folded files to the module (fixtures:
  `updateSetupFlowSection`; assertions: `readSetupFlowRecord(...).nodeKey` and so on). Run red.
- [ ] **Step 2:** Change each writer and reader in What it builds 2. Delete the two layout
  constants named in What it builds 3.
- [ ] **Step 3:** Run the Finish line. Commit.

### Task 3: T9 — Start again at every stage

- [ ] **Step 1:** `apps/server/src/first-setup-start-again.leftovers.test.ts`, one case per record
  status from `claimed` through `publication` in the order `first-setup-state.ts` declares them,
  built with the A1379 fixtures (`apps/server/test/held-setup-database.ts` for the stages that hold
  a database). Each presses Start again through the same function the repair page calls and
  expects: the state folder's entries are a subset of `["backup.env", "flows", "module-records",
  "records", "recovery.json", "recovery.lock", "scratch", "secrets.env", "spare-space",
  "spare-space.released", "tls", "venue"]` (`flows` only as an empty folder; `module-records` only
  if fl9 has landed, holding at most each module's `retained` section, which Start again keeps on
  purpose, fl9 T7), `scratch/` is empty after `emptyScratch`, and the venue folder holds only the
  box's own lock files, the set the leftovers survey already treats as the box's
  (`first-setup-start-again-leftovers.ts:51-57`: `venue.lock`, `venue.lock-journal`,
  `venue.holder.json`, `migrations.lock`, `recovery.lock`). `migrations.lock` is kept on purpose:
  unlinking a held lock file lets a second opener take a new one beside it (`apps/server/src/db-wipe.ts:10-15`).
  **Order with fl9:** this slice and fl9 may land in either order; the list above holds for both,
  and the builder of whichever lands second re-runs T9.
- [ ] **Step 2:** Run. A leftover is handled per the stop point above. Commit.

### Task 4: Nothing undeclared

- [ ] **Step 1:** In `apps/server/src/first-fiscal-setup.e2e.test.ts`, after its full setup and the
  first trading start, add `"the state folder holds only declared entries"`: every name in
  `readdir(stateDir)` matches a `STATE_LAYOUT` entry (a `prefix` entry matches by `startsWith`).
  Control: write an undeclared `stray.json` in a scratch copy of the folder and see the case's
  helper report it.
- [ ] **Step 2:** Run; fix any undeclared name by declaring it (if files.md keeps it) or stop.
  Commit.

### Task 5: A finished setup's folder ends

Owner decision, 2026-11-08 ("remove"; fl8a, "Decisions made in this plan"). The folder holds the
setup administrator's name, email and password verifier, which nothing needs once the box trades.

- [ ] **Step 1: Failing cases** (in the suite that covers `node-entry.ts`'s 120-second hook, beside
  fl6's repair clean-up case): `"a finished setup's folder is removed once a trading start stays
  up"` — a finished record and the box trading for the hook's delay → `flows/setup/` is gone, and the
  next boot treats no record as nothing to check (`first-fiscal-mode.ts:11-12`); `"a start that ends
  before the hook keeps the folder"`; `"an unlisted file in the folder is kept"` — the ending deletes
  only the files fl8a's Start again lists, by name, then `rmdir`s the folder, which refuses because
  the unlisted file is still there; the failure is logged as `setup.finished_cleanup_failed` and the
  start goes on. The failing case for the first test prints the folder still present.
- [ ] **Step 2:** Implement: in the hook at `node-entry.ts:689`, beside fl6's repair clean-up, call
  one function in the setup flow's module that reads the record, does nothing unless it says
  finished, and removes the folder with fl8a's listed-files-by-name method (never a recursive
  delete). Run the Finish line. Commit.

## After the tasks

`/finish-branch` with this plan as its note. Delete the backlog bundle entries this finishes, if any
name the setup's side files (`git grep -n -E "fiscal-readiness|configuration-import|first-setup-node-key" docs/backlog`).
