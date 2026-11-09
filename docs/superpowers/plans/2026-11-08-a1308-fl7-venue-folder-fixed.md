# A1308 file layout fl7: the venue folder fixed inside the state folder on a box; the claim file and the setup lock file go

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** On a box the venue folder is always `<state>/venue`, and `WAITRON_VENUE_DIR` is a
development-only setting the box can never receive; with that settled, the venue-folder claim
(`first-setup-claim.json`), the setup lock file (`setup-operation.lock`), the second set-aside
destination for a venue folder on another filesystem, and the refusals of an older setup layout go.

**Architecture:** One resolver, `venueDirOf(env, stateDir)` in the layout module, replaces the eight
places that work the venue folder out from `WAITRON_VENUE_DIR` with a `<state>/venue` default — six
in `apps/server/src` and two dev scripts (What it builds 1). Two more readers keep the variable as
they are: `packages/credentials/src/bin.ts:10` and `packages/provisioning/src/cli.ts:77`. Neither
has a state folder to default from (each refuses an unset value), and neither ships in the box
image, which copies only the server's entries (`deploy/Dockerfile:203-214`). The box's deploy
files never pass the variable
(`deploy/compose.yml:21-42` lists the app's environment explicitly; the image sets only
`WAITRON_STATE_DIR`, `deploy/Dockerfile:267`), `waitron.sh` stops reading it, and a deploy guard
pins both. The setup record (`first-setup.json`) already carries both folders and checks them on
every read (`packages/provisioning/src/first-setup-state.ts:415-418`), and "publication complete"
is already derived from it (`markerStatus(state)`, used at `:573-581`), so the claim can go once every
reader is handed the state folder. T3 shows every holder of `setup-operation.lock` already holds
`venue.lock`, so the in-process `active` flag (`setup-operation.ts:163`) is all that remains.

**Tech Stack:** TypeScript 7, Vitest 4.1.12, POSIX shell.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 ("The venue folder is fixed
inside the state folder on a box"), §3 rows 48, 51, §4 Upgrades (the leftover-name refusals,
`first-setup-workspace.ts:7-13`), §5 T3; [`environment.md`](../specs/2026-11-02-rationalisation/environment.md)
row `WAITRON_VENUE_DIR` ("keep, development only"); handed to this plan by the environment plans
(coordinator, 2026-11-08). Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).
Lines at `649b7576e0`.

**Who lands:** the lane (no fiscal file or value; the setup record keeps its content).

**Waits for A1379 part 2 to land.** This slice cannot start until A1379 pull request 2 (removing
Continue) has landed. The owner answered that plan's three questions on 2026-11-09
(`docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md`, "The owner's answers") and lands
it. fl8a, fl8b, fl9 and fl10 all come after this slice, so the whole chain from here waits for that
pull request to land (Needs; Stop points).

**First line of the pull request:** "A box part way through a first setup when this lands must use
Start again (its claim file is no longer read); other boxes keep working."

## What "development only" means here (decided in this plan)

The server keeps reading `WAITRON_VENUE_DIR` when it is set: 114 test files and the CI smoke steps
(`.github/workflows/ci.yml:686,738`) point the server at a separate venue folder, 20 of those test
files also naming `WAITRON_ENV: "production"` (both counts re-run at `5338b917a2`: `git grep -l
WAITRON_VENUE_DIR -- '*.test.ts' '*.test.mjs'`, then those files holding the literal
`WAITRON_ENV: "production"`). Refusing the variable in production would rewrite those 20 for no
gain on a box, because a box cannot receive it: compose forwards only the names it lists, and none
is `WAITRON_VENUE_DIR`. So the guarantee lives in the deploy files and their guard, and the variable
moves to the development group of the product's list (the environment plans' variable module).
**Owner, 2026-11-09:** the server does not refuse the variable outside development; it is listed
as a development setting.

## T3 — read, not run, then pinned by Task 3's test

Every holder of `setup-operation.lock` already holds `venue.lock`: the lock is taken only inside
`run` (`setup-operation.ts:160-226`), reached only from `setup-api.ts:719-724` (provision `:994`,
adopt `:1100`, restore `:1239,1455,1536`), whose store is built only in setup mode (`boot.ts:1412`)
after the long-lived open at `boot.ts:1229` took `venue.lock`. The command line's first setup runs
inside `withVenueState` (`packages/provisioning/src/cli.ts:514`, exclusive open). One first-setup
write runs outside `venue.lock`: the "files found" page counts a wrong password into
`first-setup-start-again-guesses.json` (`first-setup-start-again-choose.ts:105,110`) before taking
the lock at `:111`; only the in-process turn (`:99`) orders it. The fresh-context review confirmed
this reading. This plan takes the lock first, and its release (today `hold.release()` at `:161`, in
the `finally` of the `try` that opens after `:111`) moves out to cover the wrong-password exit too
(`:107-108`, which throws `setup.owner_required`), so a wrong password never leaves the venue folder
held.

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- CLAUDE.md §3 "One process owns a venue folder at a time" and "Never unlink `venue.lock`".
- Start again's fiscal refusal (`assertNoKeptRecords`, `apps/server/src/first-setup-resolution.ts`)
  is not touched.

## What it builds

1. `export function venueDirOf(env: Readonly<Record<string, string | undefined>>, stateDir: string): string`
   in `packages/store/src/state-layout.ts`: `WAITRON_VENUE_DIR` resolved absolute when set and not
   empty (`isUnset` semantics, `apps/server/src/env-value.ts`), else `join(stateDir, VENUE_DIR_NAME)`.
   Used at `apps/server/src/config.ts:553`, `node-entry.ts:728-732`, `first-setup-launch.ts:43-44`,
   `restore-command.ts:315-316`, `rejoin-command.ts:79-80`, `break-glass-command.ts:86-88`,
   `apps/server/scripts/dev-setup.ts:424-425`, `apps/server/scripts/dev-onboard.ts:91-92`.
   `apps/server/scripts/venue-dir.ts` (no caller but its test) is deleted with its test.
2. `deploy/waitron.sh:536-563`: the stamp reader uses `join(state, "venue")` only, and its comment
   (`:536-538`, which today says it resolves the folder "from the same two variables" as
   `config.ts`) says the venue folder is always `venue` under the state folder on a box. The
   comment must not spell the variable's name, nor may the refusal message at `:563`: the new
   guard reads `waitron.sh` as text and would fail on either. `scripts/deploy-image-env.test.ts`
   gains `"the box's deploy files never name WAITRON_VENUE_DIR"` over `deploy/Dockerfile`,
   `deploy/compose.yml`, `deploy/waitron.sh`, `deploy/.env.example` (weaker than its name: it reads
   those four files as text, not what a container receives).
3. The claim goes: `first-setup-state.ts` stops writing and reading `first-setup-claim.json`
   (`:550-558`, `:584-585`, `:717`, `readPair` `:470-500`, `readForRepair` `:590-615`,
   `publicationComplete` from `markerStatus(state) === "complete"`); a claim is one durable write of
   the record. Callers that knew only the venue folder take the state folder too:
   `assertVenueFirstSetupAllowed` / `inspectFirstSetupMarker` (`:505-524`) gain `stateDir`, and
   their callers pass it (`restore-command.ts:333-334`, `restore-request.ts:442-443`,
   `restore.ts:501`, `reset-request.ts:99`, `packages/provisioning/src/cli.ts:510,519`).
   `first-setup-start-again-deletion.ts:131,295`, `first-setup-start-again-leftovers.ts`,
   `first-setup-resolution-inspection.ts:176,289,350,363`, `apps/server/src/first-setup-resolution.ts:151`,
   `apps/server/src/first-setup-unused-assignment.ts:46` drop the name.
4. `setup-operation.lock` goes: `acquire`/`release` (`setup-operation.ts:102-158`) are deleted;
   `run` keeps `active` and its `setup.already_provisioning` refusal.
5. The guesses count takes the venue lock first (`first-setup-start-again-choose.ts:99-111`), and
   the lock's release covers every exit after it, the wrong-password `setup.owner_required` throw
   (`:107-108`) included (T3 above).
6. The set-aside has one destination: `setAsideDestinations` (`first-setup-start-again-set-aside.ts:101-108`)
   always returns `{ state: "<folder>/state", venue: "<folder>/venue" }` under the state folder;
   `venueBesideState`, `destinationRoots`, `stemFolderOf`'s venue-root case and fl1's
   `VENUE_SET_ASIDE_DIR` go. The `EXDEV` refusal (`:243-247`,
   `setup.start_again_set_aside_unavailable`) stays for a development venue folder on another disk.
7. The older-layout refusals go: `LEGACY_NAMES` and `assertNoLegacyFirstSetupWorkspace`
   (`first-setup-workspace.ts:7-43`), `insideFirstSetupWorkspace`, their callers, and the legacy
   names in `FIRST_SETUP_HOST_FILES` (`first-setup-state.ts:147-150`) and in the deletion module's
   `LEGACY` and refused lists (`first-setup-start-again-deletion.ts:35-40,53-74`). Before go-live
   these are compatibility code (CLAUDE.md §3 last data rule; files.md §4).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| Moving `first-setup.json` and its side files into `flows/setup/` | Next pull request | fl8a |
| `first-setup-deleting.json` in the venue folder | Start again's own crash record; stays (files.md row 57) | — |
| Classifying `WAITRON_VENUE_DIR` in the product's variable list | The environment plans own the list | environment plans |
| A production refusal of `WAITRON_VENUE_DIR` | See "What development only means here" | not built (owner, 2026-11-09) |

## Assertions that change, by design (rules §4)

- `packages/provisioning/src/first-setup-state.test.ts:749-784`, "keeps an interrupted completion
  out of trading while allowing a credential resume to recheck publication". It fails the SECOND
  durable write of the `complete` update — the claim, written after the record
  (`first-setup-state.ts:581-585`) — and asserts the record then reads `complete` while
  `publicationComplete` is `false`. With the claim gone there is one write, so that cut no longer
  exists: a box whose record says `complete` now reads `publicationComplete: true`, and boot's two
  readers act on it (`apps/server/src/first-fiscal-mode.ts:13`, `first-setup-entry.ts:35`). Design:
  files.md row 51, "its 'publication complete' status moves into the record". Read, not run: the
  record write is the last step of `complete` today, so nothing happens between the two writes that
  the second one witnessed. The case is rewritten to fail the record's one write instead and keeps
  its point: the record still reads `publication`, `publicationComplete` is `false`, and
  `reconcileFirstSetupBeforeMode` keeps the box out of trading (`first-fiscal-mode.ts:27-29`). If
  A1379 part 2 has already rewritten or deleted this case (it uses the `resume` event that part 2
  removes with Continue), take its form on `main` and apply only the claim change; list it in the PR.

## Files

Those named in What it builds, plus `packages/provisioning/src/index.ts`, `apps/server/src/first-setup-entry.ts`
(if it reads the claim), `scripts/start-again-records-writers.test.ts` (drop `VENUE_SET_ASIDE_DIR`
from `NAMES`), `CLAUDE.md` if any line names the claim (`git grep -n first-setup-claim CLAUDE.md docs/developers`),
`deploy/README.md:536` (the stamp reader paragraph).
Test: the 30 test files naming `first-setup-claim.json`, `first-setup-start-again-set-aside.test.ts`
(19 cross-filesystem hits) and `first-setup-start-again-choose.test.ts` (2),
`setup-operation.test.ts` and `setup-operation.faults.test.ts` (lock cases), `scripts/waitron-sh.test.mjs`
(stamp reader case), and tests of the legacy refusals.

## Size

Estimated: code ~230 counted added (resolver and sites ~45, claim removal ~90 net of ~160 deleted,
callers ~30, lock and guesses ~15, set-aside ~20, `waitron.sh` ~5, deploy guard ~25); tests ~360
(claim fixtures in 30 files ~200, new cases ~110, set-aside cases rewritten ~50); docs ~15.
Deletions (lock, legacy, cross-filesystem branch and their tests) uncounted. **Total counted ~605.**

## Finish line

- `git grep -n -E "first-setup-claim|setup-operation\.lock|LEGACY_NAMES|insideFirstSetupWorkspace|venueBesideState" -- apps packages scripts`
  prints nothing.
- `git grep -n -P '\.WAITRON_VENUE_DIR\b|"WAITRON_VENUE_DIR"' -- apps packages scripts deploy ':!*.test.ts' ':!*.test.mjs' ':!*.md'`
  (the places that read the value, not the ones that pass it to a child) prints exactly:
  `packages/store/src/state-layout.ts` (the resolver); `apps/server/scripts/dev-setup.ts:94` and
  `apps/server/scripts/dev-onboard.ts:26` (their lists of variable names);
  `apps/server/scripts/cloud-integration-fixture.ts:135` (reads back the value it set at `:118`);
  `packages/credentials/src/bin.ts:10` and `packages/provisioning/src/cli.ts:77` (Architecture).
  Control: at `5338b917a2` it prints 15 lines, among them `deploy/waitron.sh:562` and the six
  `apps/server/src` sites. `-P`, because git 2.56's `-E` matches nothing for `\b`.
- `pnpm --filter @waitron/provisioning exec vitest run src/first-setup src/setup-operation src/cli-`;
  `pnpm --filter @waitron/server exec vitest run src/first-setup src/restore-command src/restore-request src/reset-request src/rejoin-command src/break-glass src/node-entry.test.ts src/config.test.ts src/recovery-start-again`.
- `pnpm exec vitest run scripts/deploy-image-env.test.ts scripts/waitron-sh.test.mjs scripts/state-layout.test.ts scripts/start-again-records-writers.test.ts`.
- Typecheck store, provisioning, server; `pnpm format:check`.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus: a holder of the setup lock found that does not hold `venue.lock` (T3's
receipts no longer hold); a claim reader not listed in What it builds 3; A1379 pull request 2 not
landed (`repairMarker` still in `first-setup-state.ts`).

## Needs

fl1 landed; A1379 pull request 2 landed (it removes `repairMarker`, `first-setup-state.ts:648-652`,
and the owner audit's claim read, `first-setup-owner-audit.ts:75`).

## Review Focus

1. A setup claimed and cut before its first update: the next start finds the record and offers
   Start again (Task 2).
2. A record whose `venueDir`/`stateDir` do not match the folders it is read from is still refused
   (`first-setup-state.ts:415-418`, existing cases).
3. A second process trying to take the venue lock while setup mode runs a provision is refused
   `provisioning.database_in_use` (Task 3).
4. Two wrong passwords sent at once on the "files found" page both count (Task 3).
5. A development venue folder on another disk: a Move is refused
   `setup.start_again_set_aside_unavailable` and nothing is moved (existing EXDEV case, kept).

---

### Task 1: One resolver; the deploy files

- [ ] **Step 1:** Failing tests: `packages/store/src/state-layout.test.ts` `"venueDirOf falls back to
  <state>/venue for unset and empty values and resolves a set one"`; the deploy guard case;
  `scripts/waitron-sh.test.mjs` `"the stamp reader reads <state>/venue even when WAITRON_VENUE_DIR is
  set"`.
- [ ] **Step 2:** Run; fail. Implement What it builds 1-2. Run; pass. Commit.

### Task 2: The claim goes

- [ ] **Step 1:** Failing cases in `packages/provisioning/src/first-setup-state.test.ts`:
  `"a claim writes only the record"` (the venue folder holds no setup file afterwards);
  `"publication complete is read from the record"`; `"a record found with no claim beside it is
  resumable"`.
- [ ] **Step 2:** Run; fail. Implement What it builds 3. Re-point the 30 test files: a fixture that
  wrote a claim stops writing it; an assertion that a claim exists, or is deleted, is removed with
  its reason in the PR (files.md row 51; rules §4 — list each).
- [ ] **Step 3:** Run the provisioning and server first-setup files. Commit.

### Task 3: No setup lock file; the guesses inside the lock

- [ ] **Step 1:** Failing cases: in `apps/server/src/boot.setup-routes.test.ts`, `"while setup mode
  runs, another process cannot take the venue lock"` (spawn a child that calls `lockVenueDirectory`
  on the venue folder while the server is up; expect `VenueInUseError`); in
  `first-setup-start-again-choose.test.ts`, `"a wrong password is counted while the venue folder is
  held"` (a stub `lockVenueDatabase` records whether the guess write ran inside it).
- [ ] **Step 2:** Run; the second fails. Delete the lock file code and its tests' lock cases (they
  test only the file); move `lockVenueDatabase` before `beginStartAgainGuess`.
- [ ] **Step 3:** Run; pass. Commit.

### Task 4: One set-aside destination; no older-layout refusals

- [ ] **Step 1:** Rewrite the cross-filesystem cases of `first-setup-start-again-set-aside.test.ts`
  to the one remaining behaviour (`EXDEV` refused, nothing moved); delete the cases that test a
  venue-root destination. Delete the legacy-refusal cases.
- [ ] **Step 2:** Implement What it builds 6-7. Run the Finish line. Commit.

## After the tasks

`/finish-branch` with this plan as its note.
