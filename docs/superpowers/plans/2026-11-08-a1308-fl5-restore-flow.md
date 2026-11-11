# A1308 file layout fl5: one folder for a restore, `<state>/flows/restore/` — OWNER LANDS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** A restore handed to the next start, and a restore's pending first start, are one folder
with one record; it appears whole or not at all; once the record says the restore finished, no
start reads it as "run the restore again"; and it ends with one rename into scratch. The old
identity copy `trading.env.replaced` is deleted when the restore's first start completes.

**Architecture:** A new module `apps/server/src/restore-flow.ts` owns `<state>/flows/restore/`:
`record.json` (the one mutable file) plus attachments. A staged restore is built in
`<state>/scratch/` with the record written last and the folder renamed into place. The record's
`phase` is `staged`, `placing` (a keyed request only, today's `placementStarted: true`) or
`first-start`; the attachments are removed only after the record says `first-start`, so a crash can
leave extra attachments (deleted at the next start) but never a record that needs a missing one.
`rebuild-first-start.json` becomes the `first-start` phase. The first start's completion ends the
flow. Every decision `runHeld` makes today about keeping, putting back or clearing a request after a
failure (A1390 and A1415, both landed) is kept, phase for phase (Global Constraints).

**Tech Stack:** TypeScript 7, Vitest 4.1.12, `node:fs/promises`.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("One record per flow"),
§3 rows 8, 17, 19, §5 T4. Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).
Lines at `649b7576e0`; `apps/server/src/restore-request.ts`, `restore.ts` and
`rebuild-first-start.ts` are unchanged from there to `9c66ef0356` (`git diff --stat`), where the
cites the 2026-11-08 review touched were re-read; `boot.ts` cites are at `9c66ef0356`.

**Who lands: the owner** (rules §6, "the fiscal identity"). This slice rewrites where `runHeld`
keeps the state that decides whether a restore places the fiscal identity afresh or replays an
activation already committed: A1390's put-back (`restore-request.ts:682-686`, `af36b82132`) and
A1415's restart check (`restartUncommittedPlacement`, `:450-486`, used at `:606-609`, `:625-627`,
`:639`; `6d763da99a`, #2587, whose description says "This fiscal repair is **for the owner to
land**"). A phase moved at the wrong moment re-runs or skips that activation, with its series name.

**Waits for fl1**, which waits for A1379 pull request 2 to land (its questions were answered by
the owner on 2026-11-09, [`2026-11-06-a1379-setup-start-again.md`](2026-11-06-a1379-setup-start-again.md)).

**First line of the pull request:** "A restore staged before this change and not yet run is
forgotten; stage it again (pre-live, CLAUDE.md §3 last data rule)."

**2026-11-11 amendment — cleared by the watcher at 15:46 in Lane H questions.md:**
`firstStart` keeps the old marker's independent meaning in every readable phase. A failed Cloud
completion notice can leave `placing` with a first start owed. Completing that first start clears
only `firstStart` when a staged/placing request remains; it ends the whole flow otherwise. No new
flag, record or flow; unreadable-record Q2 and the requested folder layout stay unchanged.

## T4, by reading — Task 0 runs it on the base by killing the process

`clearStagedRestore` (`restore-request.ts:345-356`) deletes eight files in one `Promise.all`, after
success (`:705`) and after a failure the request does not survive (`:693`). Read against the code
(not run):

- marker gone, payload left: the next start finds no marker, removes only the node key
  (`:366-371`), and nothing ever deletes the plaintext `restore-request.key` or the decrypted
  `restore-request.db`;
- marker left, payload intact, after a successful run: a non-keyed request runs the whole restore
  again (the artifact is never moved), setting the restored `trading.env` aside over the
  pre-restore `.replaced` copy (`restore.ts:877`); a keyed request's marker still says
  `placementStarted`, so it resumes and A1415's check finds the committed activation and replays it;
- marker left, artifact gone, for a keyed request already `placementStarted` (`:669-678`): the
  resuming run reads the artifact for its source check (`:545-555`), fails, and clears nothing,
  because the clearing branch requires `!resuming` (`:687-693`); every later start fails the same
  way.

Task 0 produces the first and third states by killing a real child process, on the base, before
any code changes; Task 3 kills the new code at each step of the flow.

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- A process changes `flows/restore/` only while it holds the venue folder (the staged run already
  does, `restore-request.ts:440`; the setup routes run in a server that holds it, `boot.ts:1230`;
  the restore command from `restore-command.ts:327`).
- The record is written with `writeFileDurable`; a folder is published with `rename` followed by
  `syncFolderHolding` on its parent.
- **Kept, phase for phase, from today's `runHeld` (`restore-request.ts:487-706`).** Today's
  `placementStarted` exists only for a keyed request (`nodeRecoveryKey: true`, validated at `:421`
  and `:513`; written at `:669-678`). A non-keyed request never leaves phase `staged` until it
  succeeds or is ended.

  | Today | After this slice |
  | --- | --- |
  | A keyed run marks the request started before placement (`:669-678`) | phase `staged` → `placing`, record flushed and its folder synced before `run()` |
  | Started, then failed before any module step committed (`markedStarted && (!placed \|\| uncommitted)`): the request is put back as it was saved (`:682-686`, A1390), so the next start places afresh | phase `placing` → `staged`, `firstStart` removed, attachments kept |
  | Failed while resuming, or started and failed after a commit: nothing changes (neither branch at `:682-693` runs) | phase stays `placing`; the next start resumes and A1415's check (`:450-486`) restarts or replays |
  | Not started, not resuming, refused with `provisioning.database_in_use` or `SnapshotPlacementRefused`: kept (`:690-691`) | phase stays `staged`, `firstStart` removed |
  | Not started, not resuming, any other failure: everything cleared (`:687-693`) | `endRestoreFlow` |
  | Succeeded, but the managed-Cloud notice failed after a start or a resume: returns true and keeps the request (`:696-704`) | phase stays `placing`; `firstStart` stays set |
  | Succeeded: everything cleared (`:705`) | phase → `first-start` (dropping `request`), then `dropAttachments`, then `removeAndSync(setup-operation.json)` as `clearStagedRestore` does today (`:348`) |

  A behaviour test that pins any of these keeps its assertions (rules §4); in particular
  `restore-emergency-crash.e2e.test.ts`, `hour-recovery-placement-1.test.ts` and
  `hour-recovery-placement-2.test.ts` change paths only.
- **The window that stays.** A crash after `run()` has placed the restore but before the record
  says `first-start` re-runs it at the next start, exactly as a crash before `clearStagedRestore`
  does today: a non-keyed request is placed again from the same archive, a keyed one resumes into
  A1415's check. The record cannot move to `first-start` before placement finishes, because a crash
  part-way through placement must re-run it.

## What it builds

1. Layout: `RESTORE_FLOW_DIR = "flows/restore"` (reset: deleted, under a new `FLOWS_DIR = "flows"`
   entry); the seven `restore-request.*` entries and `REBUILD_MARKER` leave the table.
2. `restore-flow.ts`:

   ```ts
   export type RestoreFlowPhase = "staged" | "placing" | "first-start";
   export type RestoreAttachment = "artifact" | "key" | "venue.db" | "entries" | "placement.db" | "node-key";
   export interface RestoreFlowRecord {
     readonly version: 1;
     readonly phase: RestoreFlowPhase;
     readonly request?: StagedRequestFields;   // today's marker body, restore-request.ts:257-276
     readonly firstStart?: { readonly source: RebuildSource };
   }
   export async function readRestoreFlow(stateDir: string): Promise<RestoreFlowRecord | null>;
   export async function publishRestoreFlow(
     stateDir: string, record: RestoreFlowRecord, attach: (dir: string) => Promise<void>,
   ): Promise<void>;
   export async function updateRestoreFlow(stateDir: string, record: RestoreFlowRecord): Promise<void>;
   export async function dropAttachments(stateDir: string): Promise<void>;   // keeps record.json
   export async function endRestoreFlow(stateDir: string): Promise<void>;    // rename into scratch, then rm
   export function attachmentPath(stateDir: string, name: RestoreAttachment): string;
   ```

   `publishRestoreFlow` makes `scratch/restore-flow-<uuid>/`, runs `attach`, writes `record.json`
   last, syncs the folder, ends any existing flow (`endRestoreFlow`), then renames the new folder to
   `flows/restore` and syncs `flows/`. Replacing an existing flow is today's behaviour: staging a
   second restore from the setup page overwrites the first request (`boot.ts:1460-1481` →
   `stageRestoreRequest`).

   The phase reader that `packages/provisioning` needs (it cannot import `apps/server`) lives in
   `packages/provisioning/src/restore-flow-phase.ts`:
   `readRestoreFlowPhase(stateDir): Promise<RestoreFlowPhase | "unreadable" | null>`;
   `restore-flow.ts` uses it.

   A record that cannot be parsed: today a malformed staged request is a plain
   `Error("invalid staged restore request")` (`:531`, `:541`; there is no `restore.request_invalid`
   code), caught at `:687-693`, so the request is deleted and that start fails once; an unreadable
   rebuild marker still runs the first start, with source `unknown`
   (`rebuild-first-start.ts`, `sourceOf`, "Only a restore writes the marker, so a body that cannot
   be read still means one happened"). One record cannot keep both answers; the owner chose (2026-11-09,
   Owner decisions Q2): no restore runs, the start logs `restore.flow_unreadable`, and a first start
   is treated as pending with source `unknown`.
3. `stageRestoreRequest` (`:192-283`) publishes a `staged` flow (attachments as today's files,
   `:249-257`). `runHeld` follows the table in Global Constraints through `updateRestoreFlow`.
   `writeValidated` (`restore.ts:535-549`) records the first start through a new dependency
   `recordFirstStart(source): Promise<void>` / `clearFirstStart(): Promise<void>`: inside a staged
   run it sets or removes `firstStart` on the current record, whatever its phase (`staged` for a
   non-keyed request, `placing` for a keyed one); outside one (the restore command) it publishes a
   `first-start` flow with no attachments, and removes it on failure as today's marker is removed
   (`restore.ts:546-549`).
4. `runStagedRestore`: no flow, or phase `first-start` → `dropAttachments` and return `false`;
   phase `staged`/`placing` → today's behaviour.
5. `rebuild-first-start.ts`: every "marker present" check (`:71-93`, `:104-145`, `:185-196`, and
   `boot.ts:1755`, `:1997-2011` at `9c66ef0356`) asks
   `firstStartPending(stateDir): Promise<{ source } | null>` (`firstStart` set in any readable
   phase; the dated amendment above preserves the Cloud-notice retry). `completeRebuild`'s last step (`:143`) becomes: `removeAndSync(trading.env.replaced)`
   ignoring `ENOENT`, then clear `firstStart` if a staged/placing request remains, otherwise
   `endRestoreFlow`. `rejoin-command.ts:136`, which today removes only the
   rebuild marker, ends the flow only when its phase is `first-start`; a `staged` or `placing` flow
   is left as it is.
6. Other readers re-pointed (phase `staged` or `placing` = "a restore is waiting"):
   `start-backup-room.ts:116`, `cloud-recovery.ts:184-196`,
   `packages/provisioning/src/first-setup-owner.ts:117-120` (if A1379 left it),
   `first-setup-resolution-inspection.ts:282` (the repair page's artifact list),
   `first-setup-start-again-deletion.ts:57` and `apps/server/scripts/cloud-recovery-client-fixture.ts:104`.
   Start again refuses while a restore is waiting (phase `staged` or `placing`), as it refuses today
   while `restore-request.json` exists (`REFUSED.state`, `first-setup-start-again-deletion.ts:53-64`);
   a `first-start` flow does not refuse it, as the rebuild marker, absent from that list, does not
   today.
7. One new refusal, in the restore command only: run while a `staged` or `placing` flow waits, it
   refuses with a new code `restore.request_waiting` and changes nothing. By reading, today both
   would run: the command now, then the staged restore at the next start, over the command's
   result. The command's words come from `sharedRefusal` (`restore-command.ts:407-430`), English
   only like its neighbours; proposed: "restore failed: restore.request_waiting — a restore saved
   from the setup page runs the next time the server starts and nothing was changed; start the
   server to run it, or choose this restore on the setup page instead, which replaces the saved
   one". The setup page's own staging is not refused: it replaces the waiting flow (item 2). The
   watcher confirms the wording against the owner's concise-text preference.

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| `setup-operation.json` deleted by the restore's end | It stays a file of its own; fl8a moves it to `flows/setup/operation.json` and is never folded into the setup record (fl8a, What it builds 5), and this slice's success step deletes it wherever `SETUP_OPERATION_FILE` points | fl8a |
| `*.incoming`, `.venue.db-replaced-*`, `.restore-previous` | The database and secret swaps keep their own crash safety (files.md rows 23, 41) | — |
| `reset-request.json`, `pending-adoption.json` | Adoption (U5), kept as files | — |
| `restoreFromArtifact`'s missing production caller (`docs/backlog/setup.md:512`) | Not a file move | its backlog entry |
| A refusal when the setup page stages over a waiting restore | Today's staging replaces it; no decision asks for a change | — |

## Files

- Create: `apps/server/src/restore-flow.ts`, `apps/server/src/restore-flow.test.ts`,
  `packages/provisioning/src/restore-flow-phase.ts` and its test.
- Modify: `packages/store/src/state-layout.ts`, `apps/server/src/restore-request.ts`,
  `apps/server/src/restore.ts:535-549`, `apps/server/src/rebuild-first-start.ts`,
  `apps/server/src/boot.ts:1755,1997-2011`, `apps/server/src/rejoin-command.ts:136`,
  `apps/server/src/restore-command.ts` (the check after the venue lock, `sharedRefusal`),
  `apps/server/src/start-backup-room.ts:116`, `apps/server/src/cloud-recovery.ts:184-196`,
  `apps/server/src/errors.ts`, `packages/provisioning/src/first-setup-owner.ts`,
  `first-setup-resolution-inspection.ts`, `first-setup-start-again-deletion.ts`,
  `apps/server/scripts/cloud-recovery-client-fixture.ts`, `apps/server/src/testing/staged-hour-crash.ts`,
  `apps/server/src/restore-emergency-crash.e2e.test.ts` (Task 0 and Task 3 phases),
  `scripts/backup-room-note.test.ts` (`CO_NAMERS` reason for `restore-request.ts`; add
  `restore-flow.ts` if it matches).
- Docs that name the files or the marker: `docs/developers/emergency-recovery.md:150-185` ("Resume
  an interrupted staged restore": "started-placement marker" becomes the record's `placing`
  phase; the behaviour it describes is the table in Global Constraints and does not change),
  `docs/developers/paper-custodian.md:496` (`restore-request.node-key`),
  `docs/backlog/replication-cloud.md:717` (`restore-request.json`), and `deploy/README.md` /
  `apps/server/README.md` paragraphs if `git grep -n -E "restore-request|rebuild-first-start"`
  finds any (none at `9c66ef0356`).
- Test: the test files naming `restore-request.*`, `rebuild-first-start.json` or `REBUILD_MARKER`
  (`git grep -l -E 'restore-request\.(json|artifact|key|db|entries|placement\.db|node-key)\b|rebuild-first-start\.json|REBUILD_MARKER' -- '*.test.ts'`).

## Size

Estimated: code ~430 (restore-flow.ts ~150, restore-flow-phase.ts ~25, restore-request.ts ~130 net,
rebuild-first-start ~35, restore.ts ~30, readers ~40, refusal ~20); tests ~470 (restore-flow.test.ts
~150, Task 0's two kill phases ~50, Task 3's four kill phases ~100, re-pointed paths ~170). Docs ~30.
**Total counted ~930**, inside the cap but near it; if Task 3's harness grows past about 150 lines,
stop and ask (rules §5.6) rather than trimming a kill point.

## Finish line

- `git grep -n -E 'restore-request\.(json|artifact|key|db|entries|placement\.db|node-key)\b|rebuild-first-start\.json|REBUILD_MARKER' -- apps packages scripts`
  prints nothing. (Not a bare `restore-request\.`, which also matches every import of
  `./restore-request.js`: 319 lines at `9c66ef0356` against 75 for this pattern, none an import.)
- `pnpm --filter @waitron/server exec vitest run src/restore-flow.test.ts src/restore-request src/rebuild-first-start src/restore.test.ts src/restore-command src/restore-emergency-crash.e2e src/restore-full-disk.e2e src/hour-recovery-placement src/boot.restore src/boot.reconcile src/rejoin-command src/start-backup-room src/cloud-recovery src/backup-data-placement src/first-setup-entry`
  (full-disk cases need `hdiutil`).
- `pnpm --filter @waitron/provisioning exec vitest run src/restore-flow-phase src/first-setup-start-again src/first-setup-resolution-inspection`.
- `pnpm exec vitest run scripts/state-layout.test.ts scripts/durable-writes.test.ts scripts/backup-room-note.test.ts scripts/errors-reachable.test.ts`.
- Typecheck server, provisioning, store; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus:
- A restore behaviour test that needs a changed assertion other than a path or the new kill cases.
- A reader of the old files not listed in What it builds 6.
- Task 0's base run does not print what "T4, by reading" predicts (say which state differs): the
  plan's reading is wrong somewhere, and the watcher re-reads it before Task 1.
- `runHeld` at the base no longer has the branches the Global Constraints table cites.

## Needs

- fl1 (which itself waits for A1379 pull request 2 to land), fl2 (scratch, for the publish and the ending) and fl3 (durable writes) landed.
- A1415 has landed (`6d763da99a`, #2587) and is already in this plan's base; so has A1390
  (`af36b82132`, #2540). Nothing to wait for; both are kept (Global Constraints).

## Review Focus

1. Every row of the Global Constraints table, by test: A1390's put-back returns the record to
   `staged` with its attachments; A1415's restart and replay still run from `placing`; the two kept
   refusals keep `staged` (existing cases, paths only).
2. Crash after the record says `first-start`, at each kill point of Task 3: the next start does not
   restore again, and no plaintext key or decrypted database is left.
3. Crash while staging: nothing appears in `flows/`; the next start empties the half-built folder
   from `scratch/`.
4. The restore command run while a staged restore waits is refused with `restore.request_waiting`,
   and the waiting restore is untouched; the setup page's staging still replaces it.
5. After the first start completes, `trading.env.replaced` and `flows/restore` are gone; a first
   start that fails leaves both (existing `rebuild-first-start` failure cases, paths only).
6. Rejoin leaves a waiting staged restore alone and ends only a `first-start` flow.

---

### Task 0: T4 on the base, by killing the process

In a throwaway worktree of the base (`git worktree add --detach <dir> <base-sha>`, `pnpm install`,
removed after; CLAUDE.md §4 "Measure the old version in a throwaway worktree"):

- [ ] **Step 1:** Add two phases to `killRestore` (`restore-emergency-crash.e2e.test.ts:796-903` at
  `9c66ef0356`), which builds a child from `runStagedRestore`, patches `node:fs/promises` in it (as
  it patches `rename` at `:839-843`) and stops it with `SIGSTOP` at a gate (as `before-commit` does
  at `:846`) before the parent sends `SIGKILL`. Each gate waits for the completion it needs, never
  for time:
  - `marker-without-artifact`: after a successful run, the patched `rm` lets the artifact's removal
    finish and stops before the marker's;
  - `artifact-without-marker`: the patched `rm` lets the marker's removal finish and stops before
    `restore-request.key`'s.

  Then call `f.run()` (the next start) twice. What the reading predicts, and so the failing case for
  the new code: for `marker-without-artifact` on the keyed fixture, both runs reject (the resuming
  run's source check cannot read the artifact) and the marker is still there; for
  `artifact-without-marker`, both runs resolve `false` and `restore-request.key` still exists.
- [ ] **Step 2:** Paste both outputs in the PR. If either differs from the prediction, stop (Stop
  points). Nothing from the throwaway worktree is committed; the two phases are re-added on the
  branch in Task 3, where they must now pass.

### Task 1: `restore-flow.ts` and the provisioning phase reader

- [ ] **Step 1:** Tests in `restore-flow.test.ts`: `"publish makes the folder appear whole"` (a
  failing `attach` leaves no `flows/restore` and a folder under `scratch/`); `"publish replaces an
  existing flow"`; `"update rewrites only record.json"`; `"dropAttachments keeps the record"`; `"end
  leaves nothing in flows/"`; `"an unparseable record runs no restore, logs restore.flow_unreadable and leaves a first start
  pending with source unknown"` (Q2). In
  `restore-flow-phase.test.ts`: each phase, a missing folder (null) and an unparseable record
  (`"unreadable"`).
- [ ] **Step 2:** Run; fail. Implement per the interface above, using `writeFileDurable`,
  `mkdirDurable` and `syncFolderHolding` from `./fs-atomic.js`.
- [ ] **Step 3:** Run; pass. Commit.

### Task 2: The staged restore and the first start use the flow

- [ ] **Step 1:** Re-point the path-only tests first (rules §4) and run them red against the old
  code to see they now name the new paths.
- [ ] **Step 2:** Change `restore-request.ts`, `restore.ts`, `rebuild-first-start.ts`, `boot.ts`,
  `rejoin-command.ts` and the readers per What it builds 3-6 and the Global Constraints table.
  Delete `clearStagedRestore`, `clearNodeKey`'s `.tmp` handling if `attachmentPath` makes it
  unreachable, and `REBUILD_MARKER`.
- [ ] **Step 3:** Run the Finish line's server files; the A1390 and A1415 cases
  (`restore-emergency-crash.e2e`, `hour-recovery-placement-1`, `hour-recovery-placement-2`) pass
  with paths changed only. Commit.

### Task 3: T4, by killing the new code at each step

- [ ] **Step 1:** In `restore-emergency-crash.e2e.test.ts`, re-add Task 0's two phases against the
  new layout (the equivalent states: a `first-start` record whose `artifact` is gone; a flow whose
  attachments are partly gone) and add four kill points, each a gate in the child as in Task 0:
  - after the publish rename, before `flows/` is synced (a child that stages the restore);
  - after the record says `first-start`, before `dropAttachments` starts;
  - part-way through `dropAttachments` (one attachment removed);
  - inside `endRestoreFlow`, after the rename into `scratch/` and before the removal (a child that
    seeds a `first-start` flow and ends it).
- [ ] **Step 2:** After each, run the next start (`f.run()`, and `emptyScratch` and
  `firstStartPending` where the start would) and assert: the staged restore runs exactly once over
  the whole sequence (the preparation journal and the fiscal snapshot equal those after one run, as
  the existing "does not activate twice" case at `:917-930` checks); no `key`, `node-key`,
  `venue.db` or `placement.db` attachment is left once the record says `first-start` and the next
  start has run; nothing is left in `scratch/` after `emptyScratch`; after the `endRestoreFlow` kill,
  no flow exists and the first start is not run again.
- [ ] **Step 3:** Run; they pass against Task 2's code. If one fails, fix the code, not the case.
  Commit.

### Task 4: One refusal; docs

- [ ] **Step 1:** Failing case in `restore-command.test.ts`: `"a restore command run while a staged
  restore waits is refused restore.request_waiting and leaves it"` (the flow's record and every
  attachment are byte-for-byte unchanged). And in `boot.setup-routes.test.ts`: `"staging a restore
  from the setup page replaces a waiting one"` (pins today's behaviour; it passes before and after).
- [ ] **Step 2:** Implement the check in the restore command after the venue lock is held; add the
  code to `errors.ts` and its words to `sharedRefusal`.
- [ ] **Step 3:** The docs in Files. Run the guards. `pnpm format:check`. Commit.

## Owner decisions

- **Q1. Who lands.** **Owner, 2026-11-09:** the owner lands it (header; confirmed with the
  coordinator's routing list). Recorded here so the watcher routes the pull request to the owner
  rather than letting the lane merge it.
- **Q2. What does a start do with a `record.json` it cannot parse?** **Owner, 2026-11-09:** the
  default below. Today the two files answer differently (What it builds 2): a malformed request is
  deleted and that start fails once; an unreadable rebuild marker still runs the first start.
  **Chosen:** no restore runs;
  the start logs `restore.flow_unreadable` and treats a first start as pending with source
  `unknown`, then the first start's completion ends the flow. Running a first start on a box whose
  restore never placed anything issues a new leaf and raises the membership term by one, which
  every retried first start already does (`rebuild-first-start.ts:96-103`, "Each re-run issues
  another leaf and, once the term has been stored, moves the term up again"). The record is written
  through `writeFileDurable` (a rename), so a crash leaves the old record or the new one, not a torn
  one. Not chosen: delete the flow and fail the start once, as today's request does; that drops a
  pending first start.

## After the tasks

`/finish-branch` with this plan as its note, then hand the pull request to the owner to land.
