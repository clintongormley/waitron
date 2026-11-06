# A1379: a failed setup always offers Start again

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A first setup that stopped part way can always be deleted with Start again, unless its
database holds an invoice or another record Waitron never deletes; the setup password's way back
in ("Continue with your setup password") and everything that only it reached are removed.

**Architecture:** Start again's deletion list gains `trading.env` (for a setup whose database is
held, as `modules.json` already is), and its `trading-settings` refusal goes; the `kept-records`
refusal stays and is proved by deletion. Because the ordinary setup server keeps the setup
database open and does not serve Start again at all, a page there that has lost the setup's tab
asks the box to stop the setup (the existing `abandoned` mark) and restart; the box then starts on
the repair page, whose Start again deletes it. Continue, the Finish setup path that only Continue
could reach, the command line's way back into a stopped setup, and the first-setup resolution
record store (whose last writers go with Continue) are deleted with their tests. The setup app's
repair page loses the password step and gains the fixes the bundle lists.

**Tech Stack:** TypeScript 7 in each package, Hono 4.13.16, Lit (setup app), Vitest 4.1.12 (setup
app in browser mode, real Chromium), `node:sqlite`.

**Spec:** the six entries of `docs/backlog/setup.md` "## Bundle A1379" (line 642 on `5558d26e89`)
and their details (lines 342, 349, 387, 474, 561), with the owner's A1322 order (2026-11-04). The
rationalisation spec's "What a first setup keeps"
(`docs/superpowers/specs/2026-11-02-rationalisation/files.md:65-104`) already listed most of what
Continue holds up; it was read, not run, and this plan re-checked it against the code.

**Branch:** `feat/a1379-setup-start-again`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a1379-setup-start-again`, off main
`5558d26e89`. The executing session keeps the ledger
`docs/handoffs/2026-11-06-a1379-setup-start-again.md`.

## Global Constraints

- **A1308 hold.** No migration, no schema file, no new or changed table, column, index or trigger.
  Nothing in this plan needs one (see "Held"). Every task's commit check includes
  `git -C <worktree> diff --name-only 5558d26e89 -- 'packages/*/src/schema/**' 'packages/*/drizzle/**' 'packages/migrations/**'`
  printing nothing. If a step turns out to need one, stop and report.
- **Fiscal invariant (CLAUDE.md §5).** Start again never deletes a setup database holding an
  invoice or any row of an append-only table that no module lists as deletable. The refusal is
  `assertNoKeptRecords` (`apps/server/src/first-setup-resolution.ts:60-69`), called at `:291` for
  every held or read-first database. No task weakens it. Task 1 proves it by deletion.
- Pre-live: no backwards-compatibility code (CLAUDE.md §3, last data rule). A box part way through
  a setup when this lands may be reset.
- English only in code, comments, identifiers and tests. User-visible words in English and Spanish.
- Refusal words follow CLAUDE.md §3's first rule: say what happened and what each choice does;
  never send the person to somebody else, or to a tab that may not exist.
- Comments only for an invariant or a non-obvious why; cut stale ones in files you touch.
- Every commit `git commit -s`, message in plain English.
- Each implementer runs `pnpm format:check` and the typecheck of every package it changed
  (`pnpm --filter <pkg> typecheck`) before committing, plus the focused tests its task names.
  CI owns the package suites. A focused run is read by its `Tests` count line, never its exit
  status alone.
- Setup app tests run real headless Chromium: check `memory_pressure | grep free` first.
- An implementer past about 150 tool calls with the task unfinished stops at a passing or cleanly
  red point, commits, and returns a handover.

## What the code says, with receipts

Each point that decides the design was run, not only read; the run is named.

**F1. Continue is three server entry points and one browser button.** `recoverFirstSetupOwner`,
`resumeFirstSetup` and `recoverFirstSetup` (`packages/provisioning/src/first-setup-owner.ts:425-438`)
all go through `restoreOwnership` (`:187-329`), which checks the password and writes a `recover` or
`resume` history event. Routes: `/setup-api/first-setup/resume` and `/recover`
(`apps/server/src/setup-first-fiscal-api.ts:419-442`) and `START_AGAIN_ROUTES.recover`
(`:604-609`, handler `:692-723`). `/recover` has no production client; only
`apps/server/src/first-setup-recovery.route.test.ts` calls it. The setup app calls the other two
from `#resumeFirstSetup` (`apps/setup/src/setup-app.ts:1213-1260`) through
`FirstSetupSession.resume`/`recover` (`apps/setup/src/first-setup-session.ts:344-366`). The command
line calls `recoverFirstSetupOwner` (`packages/provisioning/src/cli.ts:313-345`). `withResolutionPassword`
(`first-setup-owner.ts:332-358`) has no production caller (`git grep -n -w withResolutionPassword -- apps packages ':!*.test.ts'`
prints only its definition).

**F2. Finish setup is reachable only after Continue.** `finishFirstSetup` refuses unless the last
ownership event is `recover` (`packages/provisioning/src/first-setup-activation.ts:238-242`);
so do the command line's resume (`first-setup-command.ts:20-24`) and the module seat's resume
(`first-setup-preparation.ts:126-130`). Pinned today by
`packages/provisioning/src/first-setup-activation.test.ts:775` ("shared Finish refuses an
unrecovered owner…") and `apps/setup/src/setup-app-finish.test.ts:174`. The Finish routes
(`setup-first-fiscal-api.ts:725-833`) are mounted only when `withPublication` is given, which only
the repair entry does (`apps/server/src/first-setup-entry.ts:293-305`). The browser calls only
`/resolution/finish` (`apps/setup/src/api/client.ts:570-582`). With Continue gone, the whole path
is dead.

**F3. A setup that saved its trading settings is accepted once `trading.env` is out of the way;
an invoice still refuses it.** Ran a throwaway test in `apps/server/src` (deleted afterwards) on
`heldSetup()` (`apps/server/test/held-setup-database.ts`, a real activation with every module):

```
PROBE1 state before: [first-fiscal-documents, …recovery.json, first-setup-node-key.json, first-setup.json, module-preparation-state.json, modules.json, trading.env]
PROBE1 venue before: [first-setup-claim.json, node.db, venue.db, venue.lock]
PROBE1 summary (trading.env removed by hand): {"ok":{"reached":"fiscal-finished"}}
PROBE1 state after Start again: []      venue after: [venue.lock]
PROBE2 (trading settings + 1 invoice, trading.env removed): setup.start_again_refused kept-records, reason "rows=111 kept=6 records=1 accepted=0"
PROBE3 control (trading.env left): setup.start_again_refused trading-settings
```

The failing case for probe 1 would have printed `kept-records`: publication's own rows (node
identity, membership, sealed credentials) are not kept rows. Limit: the fixture's
`persistTrading` throws after writing `trading.env` (status `committed`), and its fiscal secret
`seal` is a no-op, so a real box's sealed certificate row was not in the database read.

**F4. The ordinary setup server does not serve Start again at all.** A throwaway test (deleted
afterwards) mounted `mountSetup` as boot's setup mode does and posted to each route:

```
PROBE setup-mode summary status: 404      start-again status: 404
PROBE setup-mode recover status (empty body): 400      made-up path: 404
```

`mountSetupFirstFiscalApi` mounts the repair routes with no options
(`setup-first-fiscal-api.ts:429`), and the summary and Start again routes are registered only
when given (`setup-first-fiscal-api.ts:840`, `:874`). A claimed setup whose database exists and is empty stays on the
ordinary server (`needsResolution`, `first-setup-entry.ts:31-48`). There the setup app draws
Start again for a new tab, whose request then 404s; for a reloaded tab it draws only Continue
(the page reads the inspection only when it has no state, `setup-app.ts:1129`). Today Continue is
the only working way on there; without it, a lost tab is a dead end. The ordinary server holds
`venue.db` open (`apps/server/src/boot.ts:1233`), so it must not delete it (Decision D2).

**F5. A reload asks for the password today.** `open()` sets `#proofRequired` whenever a saved
owner exists (`first-setup-session.ts:166`); only claim, resume and recover clear it; every change
goes through `#owner()`, which refuses while it is set. Pinned by `first-setup-session.test.ts:382`
and `setup-app-first-fiscal.test.ts:104,345`. So after a reload the person must type the password.

**F6. The full-disk entry's premise is wrong; a restart already works.** Run by a research agent on
a real small disk (probes in `/tmp/a1379-probe.3c9n/`, outside the repo, may be gone): at 0 bytes
free, Start again fails at its first step, taking the venue lock (`packages/store/src/venue-lock.ts:60`,
SQLite error 14), whether or not a copy is needed. The held database copies nothing in the existing
held case (3,739,648 bytes, no `-wal`). A restart gives the spare up before the repair page is served
(`releaseSpareToStart`, `apps/server/src/node-entry.ts:270-278`, called at `:357` before
`resolveFirstSetupEntry` at `:359`). The whole chain run (`restart.probe.ts`): held setup, real
8 MiB spare, disk filled to 0, `runEntry` → `storage.spare_released {"bytes":8388608}`, the repair
app served, summary 200 `{"reached":"fiscal-finished"}`, Start again 200, venue folder emptied.
Control with no spare: the full-disk recovery page, setup routes 404. Sizes measured: an empty
migrated `venue.db` and a held setup's are both 3,739,648 bytes; `node.db` 90,112. A leftover
`-wal` has no measured bound (no `journal_size_limit` is set). The repair page already says
"Restart the box" whenever free space is under the start floor (`first-setup-entry.ts:76-79`;
`apps/setup/src/i18n/strings/shell.ts:12,172`), but says the room comes from old logs and crash
reports, which the probe's start did not delete.

**F7. Giving the spare up from the repair page would break a written rule.** CLAUDE.md §3: "Within
the server, only the start (…) deletes `<state>/spare-space`"; `scripts/spare-space.test.ts`
allows `releaseSpare` only in `node-entry.ts` and `spare-space.ts` and refuses it by name in
`first-setup-entry.ts`. With F6 showing a restart is enough, this plan does not touch the rule.

**F8. A record whose claim mark needs repair is always an unused attempt.** `readForRepair`
returns `repairMarker` only for a claimed attempt whose mark says `claiming`, or an abandoned one
whose mark says `active`, and only when no attempt used anything
(`packages/provisioning/src/first-setup-state.ts:615-630`). Start again's server side does not look
at the mark (`first-setup-resolution.ts:235-312`); the page refuses to offer it because
`wipeOffered` needs `pair === "valid"` (`setup-app.ts:236-239`). Not run; Task 2 runs it.

**F9. Recover from backup follows Start again.** Both buttons use `wipeOffered` for `disabled`
(`setup-app.ts:2246-2276`) and the same summary and deletion (`#openWipeConfirmation`,
`#sendWipeFirstSetup`). So wherever Start again is offered, Recover from backup is too; the plan
keeps that, including the new places (repairable record, ordinary server).

**F10. No error code becomes unused.** `setup.owner_required` stays (owner checks, HTTPS checks,
Move's password at `first-setup-start-again-choose.ts:106`); the `first-setup` password throttle
stays for `reconfirm`'s `node-key-reissue` (`first-setup-owner.ts:444`). Only a cause value goes:
`trading-settings` of `setup.start_again_refused` (`apps/server/src/errors.ts:1211`).
`ownerVerifier` stays (Move and `reconfirm` read it).

**F11. The bundle's two page oddities.** The heading reads `t.interrupted` whenever an inspection
is held, including after Start again succeeds (`setup-app.ts:2337-2338`). The doubled error: the
password block draws `firstOwnerError` (`:2350-2352`) and the confirmation draws `firstWipeError`
(`:2318`); the password block goes with Continue. Whether two Start again buttons can still be
drawn at once was not established: the conditions changed after #1752 (`git log -L` shows
`4c5ba38db0`, `65da3baaae`, `d3005b7c05`). Task 12 pins "one at a time" and records whether it
was already true.

## Decisions

- **D1. `trading.env` joins the deletion list only beside a held database**, the rule
  `modules.json` already follows (`first-setup-start-again-deletion.ts:79-90, 284, 485-490`).
  Without a held database it stays refused (`setup.not_ready`, "refused artifact"), so the
  missing-database path keeps refusing it (the case at
  `apps/server/src/first-setup-start-again-held-wipe.test.ts:63-78` stays as it is). It is deleted
  with the held items, after `modules.json`. `setup-finished` stays: a `complete` attempt is
  refused whatever else it holds.
- **D2. On the ordinary setup server, Start again first stops the setup.** A new route,
  `POST /setup-api/first-setup/resolution/stop`, taking exactly the inspection ids, over HTTPS
  only, with no owner and no password, records the existing `abandoned` event on a `claimed` or
  `consumption-intent` attempt and restarts the box. An abandoned attempt starts on the repair
  page (`needsResolution`, `first-setup-entry.ts:40-47`), whose Start again accepts it
  (`PRESENT_START_AGAIN_STATUSES`, `first-setup-resolution.ts:175-179`). This deletes nothing on a
  server holding the database open, and adds no file. It is Question 2.
- **D3. A reloaded tab is offered Start again, not a way back** (Question 1). The session keeps
  `#proofRequired` as "this tab no longer holds the setup"; the page reads the inspection whenever
  it is set.
- **D4. The resolution record store goes whole** (item 2). Its only production writers are the
  owner audit (Continue) and the finish audit (Finish). It keeps `canonicalFirstSetupDirectory`,
  `canonicalFirstSetupRoots`, `firstSetupDirectory`, `RegisterAnswer` and `FirstSetupOriginal`,
  which Start again uses. Start again keeps deleting a `first-setup-resolutions/` folder it finds
  (`first-setup-start-again-deletion.ts:34, 276-291`): unchanged deletion code is safer than an
  edit, and the rationalisation's `flows/` work retires the name.
- **D5. The command line refuses a stopped setup** (owner, 2026-11-04, rationalisation README
  §10 "The `waitron-provision` command-line resume goes with Continue (A1322)").
- **D6. Full disk: no spare change; the words get the reason right** (F6, F7). A new real-disk test
  pins that a restart lets Start again finish.
- **D7. The first-setup record drops the `resume` and `recover` event kinds and `claimNonceHash`**,
  and the claim route stops taking `clientClaimNonce` (only `restoreOwnership` read its hash,
  `first-setup-owner.ts:223`). The browser keeps its own nonce for its lock names
  (`first-setup-session.ts:168`). The inspection drops `password` and `repairEligible` (only
  Continue read them; the page uses `revision !== null` instead).
- **D8. The module seat's `resume` goes in a second pull request** (Task 16): it is in
  `packages/fiscal-verifactu`, so the owner lands it. The first pull request leaves the seat with
  no caller.

## Held

Nothing is held for A1308. Every change is to routes, files in the state folder (the
`first-setup.json` record format, Start again's deletion list) and the setup app; no table,
column, index, trigger, schema file or migration changes.

Left open for other reasons (each stays in the backlog, rewritten):

- **A setup record that cannot be read at all** (the inspection's `pair` is `invalid` or
  `partial`, `revision` null). Start again needs the record's attempt id and frozen digest for its
  deletion marker (`first-setup-resolution.ts:213-229`), so deleting such a setup is a new design
  with fiscal risk. Recover from backup stays off there too. Question 3.
- **An abandoned attempt the repair page refuses as `setup.not_ready`** because its fiscal
  assignment may have been used (`firstSetupUnusedAssignment`,
  `apps/server/src/first-setup-unused-assignment.ts`). Today Continue was its way on. Task 3 tests
  the ordinary path (a consumption-intent attempt that kept its recovery document); if that is
  refused, the implementer stops and reports, and it becomes an owner question.

## Questions for the owner (with defaults)

1. **A reload of the setup page part way through.** Today the tab asks for the setup password and
   carries on. With Continue gone, the default is that the reloaded tab offers Start again, so a
   reload loses the setup (it has to be entered again). Alternative: the tab keeps going on the key
   it already holds (the server never asked for more than that key,
   `first-setup-owner.ts:171-186`); a new tab or another device still gets Start again. Default:
   as ordered, Start again.
2. **Start again from a page that does not hold the setup, while the box is still on its ordinary
   setup screens.** Default (D2): the page asks the box to stop the setup and restart; the repair
   page then shows what Start again deletes and asks for the tick. Consequence: anyone who can open
   the setup page over HTTPS can stop a setup that is in progress in the owner's tab, as anyone can
   already delete one on the repair page. Alternative: none found that avoids a new file or a
   change to how the box starts.
3. **A setup record that cannot be read.** Default: left as it is (no Start again, no Recover from
   backup; the page says it cannot confirm deleting is safe), with its backlog entry kept.
4. **New and changed words**, listed by Task 15 for approval before landing.

## Review weight

**FULL.** Risk triggers: it deletes data (Start again's deletion list and its fiscal refusal), it
changes authentication (removes password ownership recovery; adds a route that changes a setup
with no owner and no password), and it changes cross-package contracts (provisioning's owner and
record, the server's routes, the setup app's client types). Per-task reviews for Tasks 1, 3, 7, 8,
9 and 10; the full `/finish-branch` wave with two Codex run-it reviews side by side, the second
told to set this plan aside. The simplify seat runs: the branch deletes and restructures a lot.
Pull request 2 (Task 16) is fiscal: the owner lands it.

## Review Focus

1. **A setup stopped at each step from claimed to publication, then Start again.** Expected: the
   state folder is left empty and the venue folder holds only lock files, and a new setup can
   claim. Pinned by Task 1 (committed with trading settings) and Task 3 (claimed and
   consumption-intent through the stop route).
2. **A database holding an invoice beside saved trading settings.** Expected: `kept-records`,
   nothing changes. Pinned by Task 1, proved by deletion.
3. **A reloaded tab on the ordinary server.** Expected: the page offers Start again and Recover
   from backup, and Start again stops the setup and leads to the repair page. Pinned by Tasks 3,
   10 and 14.
4. **The owner's tab after another page stopped its setup.** Expected: its next change is refused
   `setup.owner_required`, and the page says this page no longer holds the setup and offers Start
   again. Pinned by Task 14.
5. **A full disk.** Expected: Start again is refused `storage.disk_full`, the words say to restart,
   and after the restart Start again deletes the setup. Pinned by Task 13.

---

## File structure

- `packages/provisioning/src/first-setup-start-again-deletion.ts`: `trading.env` held-only (Task 1).
- `apps/server/src/first-setup-resolution.ts`: drops `trading-settings`; gains `stopForStartAgain` (Tasks 1, 3).
- `apps/server/src/setup-first-fiscal-api.ts`: `stop` route; loses `resume`, `recover`,
  `resolution/recover`, the Finish routes, `withPublication` (Tasks 3, 7, 8).
- `packages/provisioning/src/first-setup-owner.ts`, `first-setup-state.ts`,
  `first-setup-resolution.ts`, `first-setup-resolution-inspection.ts`, `first-setup-activation.ts`,
  `cli.ts`, `first-setup-command*.ts`, `first-setup-preparation.ts`, `first-setup-runtime.ts`:
  removals (Tasks 6-9).
- Deleted: `packages/provisioning/src/first-setup-owner-audit.ts`, `first-setup-finish-audit.ts`,
  `apps/server/src/first-setup-owner-audit.ts`, `first-setup-finish-audit.ts`,
  `first-setup-publication.ts`, with their tests.
- `apps/setup/src/first-setup-session.ts`, `api/client.ts`, `api/first-setup-types.ts`,
  `setup-app.ts`, `screens/initial-owner-strings.ts`, `i18n/strings/shell.ts`: Tasks 10-14.
- `apps/server/src/guide/{en,es}/backup-recovery.md`, `docs/operations/*.md`,
  `docs/developers/*.md`, `docs/backlog*.md`: Task 15.

---

## Pull request 1 — this branch

### Task 1: Start again deletes a setup that saved its trading settings; an invoice still refuses it

**Files:**
- Modify: `packages/provisioning/src/first-setup-start-again-deletion.ts` (`REFUSED` `:53-73`,
  `listed` `:127-145`, `itemsOnDisk` `:245-292`, `assertStartAgainAllowedOnDisk` `:485-490`,
  `collectStartAgainFindings` `:578-583`)
- Modify: `apps/server/src/first-setup-resolution.ts` (`refused` `:49-58`,
  `assertHeldStartAgainOffered` `:76-90`), `apps/server/src/errors.ts:1206-1211` (cause union and
  its doc comment)
- Test: `apps/server/src/first-setup-start-again-held.test.ts`,
  `packages/provisioning/src/first-setup-start-again-deletion.test.ts`,
  `first-setup-start-again-findings.test.ts`, `first-setup-start-again-marker.test.ts`

**Interfaces:**
- Produces: `setup.start_again_refused` causes are `"setup-finished" | "kept-records"`. The
  deletion module's held-only names are `["modules.json", "trading.env"]` (one constant,
  `HELD_ONLY`), used everywhere `MODULES` is special-cased today.

- [ ] **Step 1: Write the failing tests.** In `first-setup-start-again-held.test.ts`, replace the
  two `trading-settings` cases (`:39-51`, and the `"saved trading settings"` row of `:139-152`) with:
  - `"saved trading settings beside a held database: the summary says fiscal-finished and Start again deletes everything"`:
    `heldSetup({ tradingSettings: true })`; `withoutSignIn`; summary `toEqual({ reached: "fiscal-finished" })`;
    `startAgainFirstSetup(ids)`; `expectStartAgainDeleted(f)` (or, if that helper needs a signed-in
    shape, assert `readdir(stateDir)` is `[]` and `readdir(venueDir)` holds only names matching
    `/^(venue|recovery|migrations)\.lock(-journal)?$|^venue\.holder\.json$/`).
  - `"saved trading settings and an invoice record refuse the summary and Start again kept-records, and nothing changes"`:
    `heldSetup({ tradingSettings: true, invoices: 1 })`; `expectRefused` and
    `expectStartAgainRefused` with `{ code: "setup.start_again_refused", params: { cause: "kept-records" } }`.
  - `"a complete attempt with saved trading settings refuses setup-finished"` (the `complete` row
    of `:39-51` now expects `setup-finished`).
  - The `unknown`/`partial` rows with `{ tradingSettings: true }` (`:154-166`) now expect `notReady`.
  In the provisioning deletion tests: `trading.env` beside a held marker is listed, fingerprinted
  and deleted; without `held` it is refused `refused artifact: state/trading.env`. `heldBy`
  (`:86-89`) reads only `modules.json` today, so a held marker naming `trading.env` but not
  `modules.json` would be finished as not held; make `heldBy` true when the marker names any
  `HELD_ONLY` file, and test a marker with each one alone.
- [ ] **Step 2: Run, and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts` and
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-findings.test.ts src/first-setup-start-again-marker.test.ts`.
  Expected: the new deletion cases fail with `trading-settings` or `refused artifact`.
- [ ] **Step 3: Implement.** Drop the `trading.env` branch of `assertHeldStartAgainOffered` and the
  cause from `refused`, the error type and the comment. In the deletion module add `HELD_ONLY`;
  `listed` accepts `trading.env` at the state root; `itemsOnDisk` adds it with `held` after
  `modules.json`; the two `REFUSED` loops skip any `HELD_ONLY` name when held.
- [ ] **Step 4: Run and pass**, then **prove the fiscal refusal by deletion**: comment out
  `assertNoKeptRecords(read);` (`first-setup-resolution.ts:291`) and run the held suite. The
  invoice cases (`:18`, the new trading-plus-invoice case, the `"an invoice record"` row) must fail
  with a resolved summary or a deletion. Restore; run again; all pass. Also run
  `src/first-setup-start-again-held-wipe.test.ts` and `src/first-setup-start-again.test.ts` (the
  missing-database and not-held `trading.env` refusals at `held-wipe:63` and
  `first-setup-start-again.test.ts:1160` must still pass unchanged).
- [ ] **Step 5: Commit.**

### Task 2: A record whose claim mark needs repair can be started again (server)

**Files:**
- Test: `apps/server/src/first-setup-start-again.test.ts` (or a new
  `first-setup-start-again-repairable.test.ts` beside it, reusing its helpers)
- Modify: only if the test fails, `apps/server/src/first-setup-resolution.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the tests.** Two cases, each building the repairable pair the way
  `packages/provisioning/src/first-setup-state.test.ts` does (a claimed attempt with its mark
  rewritten to `claiming`; an abandoned attempt with its mark rewritten to `active`):
  `"a claimed attempt whose claim mark needs repair: the inspection says repairable, the summary answers and Start again deletes it"`
  and the same for the abandoned one. Assert `inspection.pair === "repairable"`, summary
  answers (its `reached` as `startAgainSummary` computes it,
  `packages/provisioning/src/first-setup-start-again-confirmation.ts:44-52`), Start again resolves, both folders hold only lock files.
- [ ] **Step 2: Run.** `pnpm --filter @waitron/server exec vitest run <file>`. If they pass at once,
  F8 held; say so in the commit message and keep them. If not, make the minimal change in
  `assessStartAgain` and re-run.
- [ ] **Step 3: Commit.**

### Task 3: The ordinary setup server stops a setup for Start again

**Files:**
- Modify: `apps/server/src/first-setup-resolution.ts` (add the action),
  `apps/server/src/setup-first-fiscal-api.ts` (`START_AGAIN_ROUTES.stop`, the route, mounted from
  `mountSetupFirstFiscalApi` with `deps.requestRestart`)
- Test: new `apps/server/src/first-setup-stop.route.test.ts`

**Interfaces:**
- Produces: `createFirstSetupResolutionActions(...).stopForStartAgain(request: StartAgainSummaryRequest): Promise<void>`;
  `START_AGAIN_ROUTES.stop = { method: "POST", path: "/setup-api/first-setup/resolution/stop" }`;
  answer 200 `{ restarting: true }`, then `requestRestart` on a timer as Start again does
  (`setup-first-fiscal-api.ts:933`).
- Behaviour, in order, inside `withVenueExclusion` and `coordinator.run`: exact keys
  `inspectionId, revision, ownerGeneration` (positive safe integers, else `setup.request_invalid`
  as the summary route does); HTTPS (`assertHttps`, else `setup.owner_required`); the inspection
  matches (else `setup.attempt_conflict`); `store.read()` status is `claimed` or
  `consumption-intent` (else `setup.attempt_conflict`); `store.update(attemptId, revision, { kind: "abandoned" }, hold)`;
  invalidate `owner`, `evidence`, `delivery` for the attempt.

- [ ] **Step 1: Write the failing tests** against `mountSetup` built as
  `hourFirstFiscalFixture` does (`apps/server/test/hour-first-fiscal.ts:42-51`), with
  `requestRestart` a spy and the fiscal clock mocks of `first-fiscal-hour.e2e.test.ts:20-34`:
  - `"a claimed setup is stopped over HTTPS with no owner: the record says abandoned and the box restarts"`
  - `"then the repair entry serves Start again for it, and Start again deletes it"`: call
    `resolveFirstSetupEntry(roots, {})`, expect `kind: "resolution"`, then summary and Start again
    through its app answer 200 and the folders hold only lock files. Give the fixture a real empty
    `venue.db` in its venue folder first, so `needsResolution` reads it as `no-venue-rows` before
    the stop and the test shows the stop is what sends it to the repair page.
  - the same two for a `consumption-intent` attempt that kept its recovery document
    (`keepHourRecoveryDocument`, `apps/server/test/hour-recovery-delivery.ts`). If Start again
    refuses it `setup.not_ready`, stop and report (see "Held").
  - refusals, each leaving `first-setup.json` byte for byte: plain HTTP (`setup.owner_required`),
    stale ids (`setup.attempt_conflict`), an extra key (`setup.request_invalid`), an
    `activation-started` attempt (`setup.attempt_conflict`).
  - `"the owner's tab is refused after another page stopped the setup"`: the owner capability's
    next `/setup-api/first-setup/status` with owner headers answers `setup.owner_required`.
- [ ] **Step 2: Run, and watch them fail** (404 for the route).
  `pnpm --filter @waitron/server exec vitest run src/first-setup-stop.route.test.ts`
- [ ] **Step 3: Implement** the action and route.
- [ ] **Step 4: Run and pass**; prove the status gate by deletion (remove the status check: the
  `activation-started` case must fail) and the HTTPS gate (remove `assertHttps`: the plain-HTTP
  case must fail). Restore.
- [ ] **Step 5: Commit.**

### Task 4: Server fixtures and Start-again suites stop signing in with the password

Tests only. Replaces sign-in used as setup; cases whose subject is Continue are left for Task 8.

**Files:**
- Modify: `apps/server/test/held-setup-database.ts` (delete `signIn`, `:258-284`),
  `apps/server/test/start-again-held-fixture.ts` (`signedIn`, `keptRecordsLogReason`,
  `askStartAgain`, `handMade`: read the inspection ids without signing in, as `withoutSignIn` does),
  `apps/server/src/first-setup-start-again-held*.test.ts`, `first-setup-start-again.test.ts`,
  `held-setup-database.test.ts`, `first-fiscal-hour.e2e.test.ts` (its `resolution/recover` call at
  `:80-87`), `first-setup-set-aside-lifetime.test.ts`, `first-setup-unused-pdf.test.ts`,
  `first-setup-retired-assignments.test.ts`

- [ ] **Step 1:** In each file, `git grep -n "signIn\|recoverFirstSetupOwner\|resolution/recover"`;
  replace each use that only prepares a later step. A case asserting a revision or owner
  generation that the sign-in bumped is updated to the value without it. Keep every behavioural
  assertion; a `signIn: true/false` option that only chose whether to sign in goes.
- [ ] **Step 2: Run each touched file**, e.g.
  `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-start-again-held-wipe.test.ts src/first-setup-start-again-held-recovery.test.ts src/first-setup-start-again-held-damaged.test.ts src/first-setup-start-again-held-journals.test.ts src/first-setup-start-again.test.ts src/held-setup-database.test.ts`
  (the e2e suite separately). Expected: same `Tests` count as before the change, all passing.
- [ ] **Step 3:** `git grep -n "recoverFirstSetupOwner" -- apps/server/test` prints nothing.
- [ ] **Step 4: Commit.**

### Task 5: The remaining server suites stop signing in

Tests only, same rule as Task 4.

**Files:** `apps/server/src/first-fiscal-boot.test.ts`, `first-fiscal-cloud.route.test.ts`,
`first-fiscal-delivery.test.ts`, `first-fiscal-document-download.e2e.test.ts`,
`first-fiscal-evidence.test.ts`, `first-fiscal-hour-boot.e2e.test.ts`,
`first-fiscal-hour-refusals.e2e.test.ts`, `first-fiscal-setup.e2e.test.ts`,
`first-setup-growth.test.ts`, `first-setup-recovery-delivery.test.ts`,
`first-setup-resolution-inspection.test.ts`, `first-setup-resolution.route.test.ts`,
`module-operation-host.test.ts`, `setup-first-fiscal.route.test.ts`,
`setup-first-fiscal-api.disk-full.test.ts`. Not these, which Task 7 deletes:
`first-fiscal-hour-finish.test.ts`, `first-fiscal-interruption.test.ts`,
`first-fiscal-declared-publication.test.ts`, `first-setup-finish.route.test.ts`; nor
`first-setup-recovery.route.test.ts` (Task 8).

- [ ] **Step 1:** For each file, list its uses; replace the setup-only ones. Where a case's subject
  is password recovery or the resume route, leave it and note it in the handover for Task 8.
- [ ] **Step 2:** Run each touched file; same `Tests` counts, all passing.
- [ ] **Step 3: Commit.**

### Task 6: The command line refuses a stopped setup

**Files:**
- Modify: `packages/provisioning/src/cli.ts` (`:313-345`, `:424-430`),
  `first-setup-command.ts` (delete `resumeFirstSetupCommand`), `first-setup-command-activation.ts`
  (delete the `finishFirstSetup` branch `:64-73`; those statuses throw `setup.attempt_uncertain`),
  `first-setup-preparation.ts` (delete `preparation.resume` and `resumeBinding`),
  `first-setup-runtime.ts` (`resumeBinding` wiring `:265-266`),
  `first-setup-recovery-delivery.ts` (`checkKept`, if `git grep` shows no other caller)
- Test: `cli-first-setup.test.ts`, `cli-same-hour-entry.test.ts`, `first-setup-command.test.ts`,
  `first-setup-command-document.test.ts`, `first-setup-command-import.test.ts`,
  `first-setup-runtime.test.ts`, `first-setup-recovery-delivery.test.ts`

**Interfaces:**
- Produces: when `runtime.store.readForRepair()` finds any attempt, `waitron-provision` throws
  `setup.attempt_conflict` before prompting or writing (it no longer reads the password for it).

- [ ] **Step 1: Write the failing test** in `cli-first-setup.test.ts`:
  `"a stopped setup is refused setup.attempt_conflict, and nothing on disk changes"` for a claimed
  and an `activation-started` attempt (snapshot both folders before and after). Delete the cases
  that run the resume or finish branches (`cli-first-setup.test.ts:312,339,601`,
  `cli-same-hour-entry.test.ts:43`, `first-setup-command.test.ts:712-907` and the cases the
  dependency map names at `:341,492,509,617,656`, `first-setup-command-document.test.ts:204-323`,
  `first-setup-command-import.test.ts:384`, `first-setup-runtime.test.ts:380`).
- [ ] **Step 2: Run, watch the new case fail.**
  `pnpm --filter @waitron/provisioning exec vitest run src/cli-first-setup.test.ts`
- [ ] **Step 3: Implement**; delete the dead functions.
- [ ] **Step 4: Run** every test file named above; all pass. `git grep -n "resumeFirstSetupCommand\|resumeBinding\|preparation.resume" -- packages apps ':!*.md'` prints nothing.
- [ ] **Step 5: Commit.**

### Task 7: Remove Finish setup

**Files:**
- Modify: `packages/provisioning/src/first-setup-activation.ts` (delete `finishFirstSetup` and
  `FirstSetupFinishDeps`, `:221-262`; the `beforeComplete` hook if nothing else passes it),
  `packages/provisioning/src/index.ts`
- Delete: `packages/provisioning/src/first-setup-finish-audit.ts`,
  `apps/server/src/first-setup-finish-audit.ts`, `apps/server/src/first-setup-publication.ts`
- Modify: `apps/server/src/first-fiscal-activation.ts` (delete `finishFirstFiscalSetup`, `:167-195`),
  `apps/server/src/setup-first-fiscal-api.ts` (the `withPublication` option and the five
  `resolution/*` Finish routes, `:725-833`), `apps/server/src/first-setup-entry.ts:298-304`
- Delete tests: `apps/server/src/first-setup-finish.route.test.ts`,
  `first-fiscal-hour-finish.test.ts`, `first-fiscal-interruption.test.ts`,
  `first-fiscal-declared-publication.test.ts`; the Finish cases of
  `packages/provisioning/src/first-setup-activation.test.ts` (`finishFixture` and from `:699`).
  Before deleting a file, read it for any assertion about activation itself (not Finish) and move
  that case to `first-setup-activation.test.ts` or the server activation suites.
- Test: `apps/server/src/retired-first-setup-routes.test.ts`

- [ ] **Step 1: Write the failing test** in `retired-first-setup-routes.test.ts`:
  `"the repair entry no longer serves Finish setup"`: through `resolveFirstSetupEntry`'s app, each
  of `GET resolution/publication` and `POST resolution/{reconfirm,document,document-kept,finish}`
  answers 404.
- [ ] **Step 2: Run, watch it fail.**
- [ ] **Step 3: Delete** the code and the tests above.
- [ ] **Step 4: Run** `src/retired-first-setup-routes.test.ts`, `src/first-setup-entry.test.ts`,
  `src/first-setup-resolution.boot.test.ts` (server) and `src/first-setup-activation.test.ts`
  (provisioning); all pass. `git grep -n "finishFirstSetup\|finishFirstFiscalSetup\|withFirstSetupPublication\|prepareFirstSetupFinishAudit" -- apps packages`
  prints only `apps/setup` (removed in Tasks 10-11).
- [ ] **Step 5: Commit.**

### Task 8: Remove Continue on the server

**Files:**
- Modify: `packages/provisioning/src/first-setup-owner.ts` (delete `RecoverFirstSetupOwnerRequest`,
  `restoreOwnership`, `recoverFirstSetupOwner`, `resumeFirstSetup`, `recoverFirstSetup`,
  `withResolutionPassword`, the `resolution`, `onOwnershipRecovered` and `assertRepairAllowed`
  options), `first-setup-runtime.ts` (`onOwnershipRecovered`, `:75, 130-133`),
  `apps/server/src/module-operation-host.ts:43`, `packages/provisioning/src/index.ts`
- Delete: `packages/provisioning/src/first-setup-owner-audit.ts` and its test,
  `apps/server/src/first-setup-owner-audit.ts`
- Modify: `apps/server/src/setup-first-fiscal-api.ts` (routes `/resume`, `/recover`,
  `resolution/recover`; `START_AGAIN_ROUTES.recover`; the repair routes' doc comment `:603`)
- Delete tests: `apps/server/src/first-setup-recovery.route.test.ts`; the Continue cases of
  `packages/provisioning/src/first-setup-owner.test.ts` (`:83,126,154,200,312,351,366,381,427,443,490,529,571,613`),
  of `apps/server/src/start-again-full-disk.e2e.test.ts` (`:70`, "Continue's password step answers
  507"), and those Task 5's handover listed
- Test: `apps/server/src/retired-first-setup-routes.test.ts`

- [ ] **Step 1: Write the failing test:** `"no route takes the setup password to win the setup back"`:
  on `mountSetup` and on the repair entry's app, `POST /setup-api/first-setup/resume`,
  `/recover` and `/resolution/recover` with a valid-looking body answer 404, and
  `first-setup.json` is unchanged.
- [ ] **Step 2: Run, watch it fail.**
- [ ] **Step 3: Delete** the code and tests.
- [ ] **Step 4: Run** the retired-routes suite, `src/first-setup-owner.test.ts`,
  `src/first-setup-runtime.test.ts` (provisioning), `src/module-operation-host.test.ts` and
  `src/setup-first-fiscal.route.test.ts` (server). `git grep -n "recoverFirstSetupOwner\|resumeFirstSetup\|recoverFirstSetup\|restoreOwnership\|withResolutionPassword\|createFirstSetupOwnerAudit" -- packages apps/server`
  prints nothing.
- [ ] **Step 5: Commit.**

### Task 9: The setup record and its inspection lose what only Continue used; the resolution record store goes

**Files:**
- Modify: `packages/provisioning/src/first-setup-state.ts` (event kinds `resume`/`recover` out of
  the parser `:383-384` and the "unused" test `:620`; `claimNonceHash` out of the record, `claim`
  and the parser `:333,348,656-707`; the store's `repairMarker` `:636-655`; the two reopen rules
  in `update`, `:748` and `:785`), `first-setup-owner.ts` (`claimFirstSetup` stops taking
  `clientClaimNonce`), `apps/server/src/setup-first-fiscal-api.ts` (the claim route's body),
  `apps/server/src/first-setup-resolution.ts:99` and `first-setup-unused-assignment.ts:30-31`
  (drop `resume`/`recover` from the lists), `packages/provisioning/src/first-setup-resolution-inspection.ts`
  (drop `password` and `repairEligible`; keep `revision`, `ownerGeneration`)
- Modify: `packages/provisioning/src/first-setup-resolution.ts`: delete the store
  (`createFirstSetupResolutionStore`, `createFirstSetupOriginalsCache`, `ResolutionRecord`,
  `ResolutionInput`, `WorkspaceBinding`, `validateWorkspaceBinding` and the record validator),
  keeping `canonicalFirstSetupDirectory`, `canonicalFirstSetupRoots`, `firstSetupDirectory`,
  `RegisterAnswer`, `FirstSetupOriginal`; `index.ts` exports
- Delete tests: `first-setup-resolution.test.ts`, `.durability.test.ts`, `.integrity.test.ts`
  (move any case about the kept helpers into a new `first-setup-directories.test.ts`); the
  record cases of `first-setup-state.test.ts` (`:478,497,518,536,749,865,910,928,949`) and
  `first-setup-resolution-inspection.test.ts` that test the dropped fields or repair
- Modify the docs line: `docs/developers/conventions-data.md:3391-3402` ("First-setup password
  recovery audit") becomes one dated line saying A1379 removed it

**Interfaces:**
- Produces: `FirstSetupInspection` without `password` and `repairEligible`. Claim body
  `{ venue, configurationImport?, newTaxpayer? }`.

- [ ] **Step 1: Write the failing tests:** in `first-setup-state.test.ts`, a record carrying a
  `resume` event or a `claimNonceHash` is refused `setup.attempt_invalid`; a claim writes no
  `claimNonceHash`. In `first-setup-resolution-inspection.test.ts`, the inspection's keys are
  exactly `version, inspectionId, pair, database, revision, ownerGeneration, emptyDatabase, artifacts`.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement and delete.** `git grep -n "nextWorkspace\|select-workspace\|createFirstSetupResolutionStore\|claimNonceHash\|repairEligible" -- packages apps/server`
  prints nothing outside `apps/setup` (Task 10).
- [ ] **Step 4: Run** the provisioning files touched, and the server's
  `src/first-setup-start-again.test.ts`, `src/first-setup-resolution.route.test.ts`,
  `src/setup-first-fiscal.route.test.ts`. All pass.
- [ ] **Step 5: Commit.**

### Task 10: The setup app's session: no way back, a reloaded tab reads the inspection

**Files:**
- Modify: `apps/setup/src/first-setup-session.ts` (delete `resume`, `recover`, `finish`; keep
  `#proofRequired`, renamed `#lostClaim`, with `recoveryRequired` renamed `claimLost`),
  `apps/setup/src/api/client.ts` (delete `resumeFirstSetup`, `recoverFirstSetupOwner`,
  `finishFirstSetup`; add `stopFirstSetup(snapshot)` posting to `resolution/stop`; claim body
  without `clientClaimNonce`), `apps/setup/src/api/first-setup-types.ts` (inspection without
  `password`/`repairEligible`; `StartAgainRefusalCause` without `trading-settings`),
  `apps/setup/test/*-browser.ts` fixtures (drop the two fields), `REFUSAL_CAUSES`
  (`first-setup-session.ts:63-67`)
- Delete tests: `apps/setup/src/first-setup-finish.test.ts`; the reload-and-resume cases of
  `first-setup-session.test.ts` (`:217,236,382`) and `api/first-setup.test.ts:41`

**Interfaces:**
- Produces: `FirstSetupSession.claimLost: boolean`; `SetupApi.stopFirstSetup(snapshot: FirstSetupResolutionSnapshot): Promise<{ restarting: true }>`.

- [ ] **Step 1: Write the failing tests** in `first-setup-session.test.ts`:
  `"a reload with a saved owner reads the state and reports the claim lost, and refuses every change setup.owner_required"`,
  and `"a refused start-again cause the page has no words for is undefined"` for
  `"trading-settings"`. In `api/first-setup.test.ts`, `stopFirstSetup` posts exactly the
  snapshot to `/setup-api/first-setup/resolution/stop`.
- [ ] **Step 2: Run, watch them fail.**
  `pnpm --filter @waitron/setup exec vitest run src/first-setup-session.test.ts src/api/first-setup.test.ts`
- [ ] **Step 3: Implement**; fix `setup-app.ts` compile errors only by deleting calls to removed
  methods (the page's behaviour is Tasks 11-12).
- [ ] **Step 4: Run** the two files and `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 5: Commit.**

### Task 11: The setup app without Finish setup

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (`#startFinishFirstSetup` `:1462-1475`, `firstFinishing`
  and every branch on it, the Finish button `:2391-2404`), the review and email screens' finish
  words (`finishReview`, `finishEmail`), `screens/initial-owner-strings.ts` (`finish*`)
- Delete tests: `setup-app-finish.test.ts`, `setup-app-finish.a11y.test.ts`; the Finish cases of
  `setup-certificate-refusal.test.ts:102` and `setup-app-first-fiscal.test.ts:381`

- [ ] **Step 1: Write the failing test** in `setup-app-resolution.test.ts`:
  `"an attempt that started activation offers Start again and Recover from backup, and no Finish setup"`
  (inspection `pair: "valid"`, state `activation-started`; no `[data-test=finish-setup]`).
- [ ] **Step 2: Run, watch it fail.** `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`
- [ ] **Step 3: Delete** the Finish code and words.
- [ ] **Step 4: Run** `setup-app-resolution`, `setup-app-first-fiscal`, `setup-certificate-refusal`
  and the review and email screen tests; typecheck.
- [ ] **Step 5: Commit.**

### Task 12: The repair page without the password step (items 3 and 4)

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (`#resumeFirstSetup` and the password field, scope and
  block `:2254-2269, 2342-2360`; the heading `:2337`; `#firstResolutionSnapshot` `:1262-1276` reads
  `revision`/`ownerGeneration` only; `refusalWords` loses `trading-settings`; `uncheckable` line
  `:2339`), `screens/initial-owner-strings.ts` (delete `resume`, `password`, `required`,
  `resumeHelp`, `uncheckable`, `tradingSaved`, `tradingSavedPassword`),
  `i18n/strings/shell.ts` (`shell.first_setup.owner_required` and `attempt_uncertain`, EN and ES,
  per "Words for the owner")
- Test: `setup-app-resolution.test.ts`, `setup-app-held-refusals.test.ts`,
  `setup-app-missing-database.test.ts`, `setup-app-wipe.test.ts`, `setup-app-first-fiscal.test.ts`,
  `setup-app-resolution.a11y.test.ts`, `setup-app-held-database.a11y.test.ts`; delete the cases the
  dependency map names (`setup-app-resolution.test.ts:76,304,322,350,367,422,440,452,557,1229`,
  `setup-app-first-fiscal.test.ts:104,345`, `setup-app-missing-database.test.ts:83`,
  `setup-app-wipe.test.ts:108`, `setup-app-held-refusals.test.ts:89,128,164`) after moving any
  Start-again assertion they hold into a surviving case

- [ ] **Step 1: Write the failing tests:**
  - `"the repair page draws no password field and sends no password"` (no `resume-password`, no
    `resume`; no request body carries `password`).
  - `"after Start again the heading is First setup and the page says the old attempt is deleted"`
    (`h1` text is `First setup` / `Primera configuración`; heading item 3).
  - `"at most one Start again button is drawn in every state"`: closed, confirmation open,
    confirmation with an error, busy, refused, missing database, Recover's confirmation open; count
    `[data-test=start-again], [data-test=confirm-start-again]` is at most 1 each time. If it passes
    before Step 3, say so in the commit message (item 3's second point was already fixed).
  - `"a refused Start again draws its message once"` (item 4): the confirmation's refusal text
    appears exactly once in `shadowRoot.textContent`.
  - `"a phone-width repair page lays out with no overlap"`: at 375 px, the bounding boxes of the
    page's buttons do not intersect (item 3's third point; Continue itself is gone).
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** every file listed; a11y suites in both themes; typecheck. Look at the page at
  375 px and desktop width, both themes (CLAUDE.md §4 "Open it and LOOK"); screenshots stay in the
  implementer's working folder, never committed.
- [ ] **Step 5: Commit.**

### Task 13: Full disk: a restart lets Start again finish (item 5)

**Files:**
- Test: `apps/server/src/start-again-full-disk.e2e.test.ts`
- Modify: `apps/setup/src/i18n/strings/shell.ts:12,172` (`shell.first_setup.disk_full`, EN and ES),
  its pins in `setup-app-resolution.test.ts:1192-1255` and `setup-app-wipe.test.ts:213-219`

- [ ] **Step 1: Write the test**, modelled on the research probe described in F6: for
  `withSpare` true and false, `heldSetup()`, `writeRecoveryState(stateDir, FRESH)`, a real
  `SPARE_SPACE_BYTES` spare when true, `small.fill(0)`, then `runEntry` with `serveRecovery`
  capturing the app and `startServer` throwing. With the spare: the log has
  `storage.spare_released`, the captured app answers `/setup-api/status` with
  `needs: ["first-setup-resolution"]`, summary 200 and Start again 200, and the venue folder holds
  only lock files. Without: the full-disk recovery page is served and the setup routes answer 404.
  Keep the existing held case (`:107`): it is the refusal before a restart.
- [ ] **Step 2: Run** on a small disk (macOS makes one with `hdiutil`; testing-guide "Full-disk
  tests use a small real filesystem"):
  `pnpm --filter @waitron/server exec vitest run src/start-again-full-disk.e2e.test.ts`. It should
  pass at once (F6); if it does not, stop and report.
- [ ] **Step 3: Change the words** to the approved text; update their pins first and watch them fail.
- [ ] **Step 4: Run** the setup tests named; all pass.
- [ ] **Step 5: Commit.**

### Task 14: Start again and Recover from backup wherever a setup can be deleted (items 1 and 6)

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (`wipeOffered` `:236-239` accepts `pair === "repairable"`;
  `#openFirstSession` `:1129` reads the inspection whenever `claimLost`; `#renderFirstOwner` takes
  `inspection` when `claimLost`; on the ordinary server, known from `firstSetupStatus().resolution !== true`,
  Start again and Recover from backup open the stop confirmation, whose button calls
  `api.stopFirstSetup`, then `firstRestarting` with the stopped words; `#reconnectFirstSetup` then
  lands on the repair page), `screens/initial-owner-strings.ts` (the stop words)
- Test: `setup-app-resolution.test.ts`, `setup-app-resolution.a11y.test.ts`,
  `setup-app-first-fiscal.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a reloaded tab on the ordinary server offers Start again and Recover from backup, and Start again asks to stop the setup first"`:
    a saved owner in `sessionStorage`; the status answers without `resolution`; pressing Start
    again draws the stop words and a `confirm-stop` button; confirming posts exactly the snapshot
    to `resolution/stop`; the page shows the stopped words and Reconnect.
  - the same from a new tab with nothing saved.
  - `"on the repair page Start again goes straight to what it deletes"` (status `resolution: true`:
    no stop step, no request to `resolution/stop`).
  - `"a record whose claim mark needs repair offers Start again and Recover from backup"` (`pair: "repairable"`).
  - `"a record that cannot be read offers neither, and says why"` (`pair: "invalid"`, `revision: null`).
  - `"the owner's tab, after another page stopped the setup, says this page no longer holds it and offers Start again"`:
    a change answered `setup.owner_required` draws the new `owner_required` words and Start again.
  - a11y: the stop confirmation in both themes.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files; typecheck; look at the stop confirmation at 375 px and
  desktop, both themes.
- [ ] **Step 5: Commit.**

### Task 15: Guide, docs, backlog and the owner's words

**Files:**
- Modify: `apps/server/src/guide/en/backup-recovery.md` and `es/backup-recovery.md`
  ("When first setup was interrupted" `{#interrupted-setup}`: drop the trading-settings refusal
  and "Continue with your setup password"; say a setup that saved its trading settings can be
  started again unless its database holds an invoice; say that while the box is still on its setup
  screens, Start again first stops the setup and restarts the box; a record needing repair is
  offered both; a record that cannot be read is offered neither). Write each sentence from the
  code; cut, do not reword, any sentence a person does not act on.
- Modify: `docs/operations/first-live-fiscal-setup.md:97-110` ("Resume an interruption"),
  `docs/operations/recovery-document.md:28`, `docs/developers/testing-guide.md:2985-2992` (the
  password-recovery anecdote: one dated line or cut).
- Modify: `docs/backlog/setup.md`: delete the bundle's entries at `:342`, `:349`, `:387`, `:474`
  and the "## Bundle A1379" block (`:642-663`); rewrite `:561` ("No Recover from backup…") to the
  unreadable-record case only, as its own entry if Question 3 keeps it, and point at it from an
  existing setup bundle; `docs/backlog.md:106` and `:404` (index lines) go. Add an entry for the
  abandoned-but-assignment-maybe-used case only if Task 3 found it.
- Create: none. The words list goes in the pull request description, not a file.

- [ ] **Step 1:** Run `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`
  (root project: `pnpm exec vitest run scripts/guide-links.test.ts`) after the guide edit; both pass.
- [ ] **Step 2:** `git grep -n -i "setup password\|contraseña de configuración\|Continue with\|tradingSaved" -- apps/server/src/guide apps/setup/src docs/operations`
  prints nothing.
- [ ] **Step 3:** Collect every new or changed user-visible string on the branch, EN and ES, from
  `git diff 5558d26e89 -- apps/setup/src/screens/initial-owner-strings.ts apps/setup/src/i18n/strings apps/server/src/guide`,
  into the "Words for the owner" table of the pull request description, with deleted strings
  listed separately.
- [ ] **Step 4: Commit** (`docs/` and guide together; the guide is not docs-only, so it rides this
  pull request).

## Pull request 2 — the module seat's resume (fiscal; the owner lands it)

### Task 16: Delete the module seat's `resume` and `commandResume`

Branch `feat/a1379-seat-resume` from `main` after pull request 1 lands
(`python3 ~/workspace/tools/worktree.py new waitron feat/a1379-seat-resume --headless`).

**Files:** `packages/module/src/initial-setup.ts:36,40`;
`packages/fiscal-verifactu/src/initial-hour-setup.ts:143,149`; `hour-preparation.ts:117`
(`hostedHourPreparation().resume`); the selection engine's `resume` mode (`hour-selection.ts:536`)
only if `git grep` shows no other caller; tests `initial-hour-setup.test.ts:764,778,869`,
`hour-resumption.test.ts`.

- [ ] **Step 1:** `git grep -n -w "resume\|commandResume" -- packages/module packages/fiscal-verifactu apps packages/provisioning`
  and confirm no production caller remains (pull request 1 removed `preparation.resume`).
- [ ] **Step 2:** Delete the seat fields, the implementations and their tests; keep every test of
  the selection engine's other modes.
- [ ] **Step 3:** Run the fiscal package's touched files and `pnpm --filter @waitron/fiscal-verifactu typecheck`.
- [ ] **Step 4: Commit**, open the pull request, and leave it for the owner to land.

## Words for the owner (proposed; Task 15 collects the final list)

| Key | English | Spanish |
| --- | --- | --- |
| stop ask (new) | To start again or recover from a backup, the box first stops this setup and restarts. Then this page shows what would be deleted, and nothing is deleted until you confirm it there. | Para empezar de nuevo o recuperar desde una copia, el equipo primero detiene esta configuración y se reinicia. Después esta página muestra lo que se borraría, y no se borra nada hasta que lo confirmes allí. |
| stop button (new) | Stop this setup | Detener esta configuración |
| stopped (new) | The setup is stopped and the box is restarting. Reconnect to continue. | La configuración está detenida y el equipo se está reiniciando. Reconecta para continuar. |
| `shell.first_setup.owner_required` (changed) | This page no longer holds this setup. Reconnect to see what you can do with it. | Esta página ya no tiene esta configuración. Reconecta para ver qué puedes hacer con ella. |
| `shell.first_setup.attempt_uncertain` (changed; "Resume the saved attempt" names a way that is gone) | This setup may already have used its assignment, so it is not repeated. Reconnect to see what you can do with it. | Puede que esta configuración ya haya usado su asignación, así que no se repite. Reconecta para ver qué puedes hacer con ella. |
| `shell.first_setup.disk_full` (changed: the room comes mostly from the reserve) | …Restart the box: as it starts, it uses the space it keeps in reserve and removes old logs and crash reports to make room. Then try again. … | …Reinicia el equipo: al arrancar, usa el espacio que guarda en reserva y quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. … |
| heading after Start again | reuses "First setup" | reuses "Primera configuración" |

Deleted: "Continue with your setup password", "Administrator password", "Enter your password.",
"Enter the administrator password you chose during setup.", the "cannot check the original setup
password" line, the two trading-settings refusal sentences, and the Finish setup words.

## After the tasks

`/finish-branch` on this worktree with this plan as its note. Tell the owner the branch is ready,
with Questions 1-3 and the words table; do not land before the owner answers them.
