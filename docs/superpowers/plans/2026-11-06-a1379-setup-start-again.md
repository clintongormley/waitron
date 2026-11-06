# A1379: a failed setup always offers Start again

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A first setup that stopped part way can always be deleted with Start again, unless its
database holds an invoice or another record Waitron never deletes; the setup password's way back
in ("Continue with your setup password") and everything that only it reached are removed.

**Architecture:** Two pull requests. **PR 1** needs no owner answer: the setup record store
stops taking two dead actions (item 2), Start again is offered for a record whose claim mark needs
repair (item 6), the repair page's heading and button fixes (item 3), and a real-disk test plus
corrected words for the full disk (item 5). **PR 2** is A1322 and what depends on it, built after
the owner answers Questions 1-3: Start again's deletion list gains `trading.env` beside a held
database (and, if the owner allows, the setup's own certificate record); the ordinary setup server
gains a way to stop a setup so the repair page can delete it; Continue, Finish setup (reachable
only after Continue), the command line's way back in and the record store go; the repair page
loses the password step. The `kept-records` refusal stays in both and is proved by deletion.

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

**F3b. On a real box the certificate record makes Start again refuse anyway** (fresh-context
review, 2026-11-06; checked here by reading). Activation saves the certificate
(`sealSettings`, `packages/provisioning/src/first-setup-activation.ts:212`) before the trading
settings (`:213`); the fiscal module's save writes a `fiscal_certificate_installs` row with
`source: "setup"` (`packages/fiscal-verifactu/src/provisioning-secret.ts:114-120`). That table is
append-only (`packages/fiscal-verifactu/src/classification.ts:22-26`) and not in
`FISCAL_START_AGAIN_DELETABLE = ["fiscal_allocations"]` (`start-again-holdings.ts:6`). The test
helper's save writes nothing (`apps/server/test/held-setup-database.ts:105-113`). The reviewer ran
a throwaway `heldSetup()` with one such row: refused `kept-records` (`rows=105 kept=1 records=0`);
the control without it was accepted. So without Question 1, A1322 is not delivered for any setup
that got as far as saving its certificate, and the same refusal already applies today to one that
stopped between the two saves.

**F12. Series names after Start again.** Start again deletes `module-preparation-state.json`
(`first-setup-start-again-deletion.ts:272`), where the attempt's series name lives; the owner's
A1206 decision accepts that the box forgets names it deletes (CLAUDE.md §5, "Start again keeps no
record of the names it deletes"). A zero fiscal-record count in the setup database means nothing
was filed under the name. P2-2's accepted case asserts that count.

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
  missing-database path keeps refusing it (`first-setup-start-again-held-wipe.test.ts:63-78` stays).
  `setup-finished` stays: a `complete` attempt is refused whatever else it holds.
- **D2. On the ordinary setup server, Start again first stops the setup.** A new route,
  `POST /setup-api/first-setup/resolution/stop`, records the existing `abandoned` event on a
  `claimed` or `consumption-intent` attempt and restarts the box; the box then starts on the repair
  page (`needsResolution`, `first-setup-entry.ts:40-47`), whose Start again accepts an abandoned
  attempt (`PRESENT_START_AGAIN_STATUSES`, `first-setup-resolution.ts:175-179`). It deletes nothing
  on a server holding the database open (`boot.ts:1233`) and adds no file. Question 3.
- **D3. A reloaded tab keeps going on the key it already holds** (Question 2, recommended
  default). The server asks a tab for nothing more than its key, revision, owner generation and a
  live status (`authorize`, `first-setup-owner.ts:171-186`); the tab saves the revision and
  generation on every state it accepts (`#acceptState`, `first-setup-session.ts:265-275`); a
  duplicated tab is fenced by the attempt's Web Lock, taken `ifAvailable` at `open()`
  (`:168-169`, `#holdAttempt` `:193-198`). I found no evidence it cannot work; PR 2 Task 10 tests
  it. Only a tab with no saved key (a new tab, another device, a claim cut off mid-flight) is
  offered Start again.
- **D4. The resolution record store.** PR 1 removes only the two actions and the field item 2
  names. PR 2 removes the store whole once its two writers (the owner audit, Continue; the finish
  audit, Finish) are gone, keeping `canonicalFirstSetupDirectory`, `canonicalFirstSetupRoots`,
  `firstSetupDirectory`, `RegisterAnswer`, `FirstSetupOriginal`. Start again keeps deleting a
  `first-setup-resolutions/` folder it finds (`first-setup-start-again-deletion.ts:34, 276-291`).
- **D5. The command line refuses a stopped setup** (owner, 2026-11-04, rationalisation README §10).
- **D6. Full disk: no spare change; the words get the reason right** (F6, F7).
- **D7. The setup record drops `resume`/`recover` and `claimNonceHash`; the inspection drops
  `password` and `repairEligible`** (PR 2; only Continue read them). The browser keeps its nonce for
  its lock names (`first-setup-session.ts:168`).
- **D8. The module seat's `resume` stays.** Its `resume` entries in the series-name selection
  (`packages/fiscal-verifactu/src/hour-selection.ts:54-57, 133-174`) are part of the stored
  series-name history CLAUDE.md §5 relies on. After PR 2 the seat's `resume`/`commandResume`
  (`packages/module/src/initial-setup.ts:36,40`) has no caller; PR 2's thread says so (owner rule
  2026-11-06: no new backlog entry).

## Held

Nothing is held for A1308: every change is to routes, files in the state folder and the setup app.

Left open for other reasons:

- **A setup record that cannot be read at all** (`pair` `invalid` or `partial`, `revision` null).
  Start again's deletion marker needs the record's attempt id and frozen digest
  (`first-setup-resolution.ts:213-229`), so deleting it is a new design with fiscal risk.
  Question 4.
- **An abandoned attempt the repair page refuses `setup.not_ready`** because its fiscal assignment
  may have been used (`apps/server/src/first-setup-unused-assignment.ts`). PR 2 Task 3 tests the
  ordinary case; if refused, the implementer stops and reports.

## Questions for the owner (with defaults)

Questions 1-3 must be answered before any PR 2 task is dispatched. PR 1 needs no answer.

1. **May Start again delete the setup's own certificate record?** (fiscal; F3b) A real box's
   activation saves the AEAT certificate before the trading settings, writing a row into an
   append-only table no module lets Start again delete. So once activation got that far, Start
   again refuses as `kept-records` and A1322 is not delivered on a real box. If yes, Start again
   may delete `fiscal_certificate_installs` rows that are this attempt's own (this node's id,
   `source = 'setup'`); that change is in `packages/fiscal-verifactu`, so you land PR 2. **Default:
   none; it is your call.** If no, PR 2 must keep a way to finish such a setup, and is re-planned.
2. **A reload of the setup page part way through. Recommended default: the tab keeps going on
   the key it already holds** (D3). Alternative: the reloaded tab is offered Start again and the
   setup is entered again.
3. **Stopping a setup from a page that does not hold it, while the box is on its ordinary setup
   screens** (D2). Default: allowed over HTTPS from the box's own page, with no password, as the
   repair page's Start again already is. Option, smaller: refuse a stop while the setup's own tab
   has made a request in the last 5 minutes (kept in memory, so a restart clears it).
4. **A setup record that cannot be read.** Default: left as it is, entry kept in the backlog.
5. **New and changed words**, collected by each PR's last task.

## Review weight

**PR 1: FULL.** It offers Start again's deletion for a record kind the page refused before
(fiscal-invariant area), and changes the setup record store's validator. Per-task review on
P1-2 and P1-3; full `/finish-branch` wave, two Codex run-it reviews.

**PR 2: FULL.** It deletes data (Start again's list, the certificate rows if Question 1 is yes),
changes authentication (removes password recovery, adds a route with no owner) and cross-package
contracts. Per-task review on P2-1, P2-2, P2-3, P2-8, P2-9, P2-10; two Codex run-it reviews; the
simplify seat runs. If Question 1 is yes, the owner lands it.

## Review Focus

1. **A setup stopped at each step from claimed to publication, then Start again** — with a real
   certificate row. Expected (Question 1 yes): state folder empty, venue folder lock files only,
   zero fiscal records. Pinned by P2-2 and P2-3.
2. **An invoice beside saved trading settings and a certificate.** Expected: `kept-records`,
   nothing changes. P2-2, proved by deletion.
3. **A reloaded tab.** Expected (Question 2 default): it carries on with no password. P2-10.
4. **The owner's tab after another page stopped its setup.** Expected: next change refused
   `setup.owner_required`; the page says it no longer holds the setup and offers Start again. P2-3, P2-13.
5. **A full disk.** Expected: refused before a restart, deleted after it. P1-4.

---

## Pull request 1 — needs no owner answer (this branch)

Continue stays in PR 1. Main stays green and working after it.

### Task P1-1: The setup record store stops taking `retire`, `select-workspace` and `nextWorkspace` (item 2)

**Files:** `packages/provisioning/src/first-setup-resolution.ts` (action union `:46-49`, metadata
`:43`, validator `:190-270`, `prepare` `:525-527`), `first-setup-owner-audit.ts:149`,
`first-setup-finish-audit.ts:36`, `index.ts` (`WorkspaceBinding` export); tests
`first-setup-resolution.test.ts`, `.durability.test.ts` (sample action `retire` at `:46,113,175-176`),
`.integrity.test.ts:33`.

- [ ] **Step 1: Failing tests:** a record whose action is `retire` or `select-workspace`, or that
  carries a `nextWorkspace` key, is refused `setup.attempt_invalid`. Switch the durability and
  integrity suites' sample action to `marker-repair` (a "later action" variant to
  `ownership-rebind`), keeping every assertion.
- [ ] **Step 2:** `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-resolution.test.ts src/first-setup-resolution.durability.test.ts src/first-setup-resolution.integrity.test.ts src/first-setup-owner-audit.test.ts`; the new cases fail.
- [ ] **Step 3:** Remove the two actions, `WorkspaceBinding`, `validateWorkspaceBinding`, the field
  and the two writers' `nextWorkspace: null`.
- [ ] **Step 4:** Same run passes; `git grep -n "nextWorkspace\|select-workspace\|WorkspaceBinding" -- packages apps` prints nothing.
- [ ] **Step 5: Commit.**

### Task P1-2: A record whose claim mark needs repair can be started again (server)

**Files:** test `apps/server/src/first-setup-start-again-repairable.test.ts` (helpers from
`first-setup-start-again.test.ts`); `apps/server/src/first-setup-resolution.ts` only if it fails.

- [ ] **Step 1:** Two cases, building the repairable pair as `first-setup-state.test.ts` does (claimed
  with its mark rewritten to `claiming`; abandoned with it rewritten to `active`): the inspection
  says `pair: "repairable"`, the summary answers (its `reached` as
  `first-setup-start-again-confirmation.ts:44-52` computes it), Start again resolves, both folders
  hold only lock files.
- [ ] **Step 2:** Run. If they pass at once, F8 held; say so in the commit. If not, minimal change.
- [ ] **Step 3: Commit.**

### Task P1-3: The repair page offers Start again for a repairable record; heading; one Start again at a time (items 3 and 6)

**Files:** `apps/setup/src/setup-app.ts` (`wipeOffered` `:236-239` accepts `pair === "repairable"`;
the heading `:2337` reads `t.heading` once `firstRestarting`), tests `setup-app-resolution.test.ts`,
`setup-app-resolution.a11y.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `"a record whose claim mark needs repair offers Start again and Recover from backup"`.
  - `"a record that cannot be read offers neither, and says why"` (`pair: "invalid"`, `revision: null`).
  - `"after Start again the heading is First setup"` (EN and ES).
  - `"at most one Start again button is drawn in every state"` (closed, confirmation open, with an
    error, busy, refused, missing database, Recover's confirmation open). If it passes before
    Step 3, say so in the commit (item 3's second point was already fixed).
- [ ] **Step 2:** `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`; they fail.
- [ ] **Step 3:** Implement. No new words (the heading reuses "First setup").
- [ ] **Step 4:** Run both files, both themes; typecheck. Look at the page at 375 px and desktop.
- [ ] **Step 5: Commit.**

### Task P1-4: Full disk: a restart lets Start again finish (item 5)

**Files:** test `apps/server/src/start-again-full-disk.e2e.test.ts`; words
`apps/setup/src/i18n/strings/shell.ts:12,172` and their pins (`setup-app-resolution.test.ts:1192-1255`,
`setup-app-wipe.test.ts:213-219`).

- [ ] **Step 1:** New case modelled on F6's run, for a spare present and absent: `heldSetup()`,
  `writeRecoveryState(stateDir, FRESH)`, a real `SPARE_SPACE_BYTES` spare when present,
  `small.fill(0)`, then `runEntry` capturing the served app. With the spare: log has
  `storage.spare_released`, `/setup-api/status` says `needs: ["first-setup-resolution"]`, summary and
  Start again answer 200, venue folder lock files only. Without: the full-disk recovery page, setup
  routes 404. Keep the existing cases (`:70`, `:107`).
- [ ] **Step 2:** Run on a small disk (testing-guide, "Full-disk tests use a small real
  filesystem"). It should pass at once; if not, stop and report.
- [ ] **Step 3:** Change the pins to the proposed words, watch them fail, change the words.
- [ ] **Step 4:** Run the setup files; pass. **Step 5: Commit.**

### Task P1-5: Guide, backlog and words for PR 1

- [ ] **Step 1:** `apps/server/src/guide/{en,es}/backup-recovery.md` `{#interrupted-setup}`: a setup
  whose record carries a mark that needs repair is offered Start again and Recover from backup;
  only a record that cannot be read leaves reinstalling. Run `apps/server/src/guide-content.test.ts`
  and `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2:** `docs/backlog/setup.md`: delete the entries at `:342` (item 2) and `:474` (item 5);
  rewrite `:349` to the Continue-spacing point only and `:561` to the unreadable-record case;
  rewrite the "## Bundle A1379" block to its remaining entries; update `docs/backlog.md:404`.
- [ ] **Step 3: Words for the owner:** collect every new or changed user-visible string on the
  branch (EN and ES) from `git diff 5558d26e89 -- apps/setup/src/screens apps/setup/src/i18n apps/server/src/guide`
  into the PR description. **Step 4: Commit.**

---

## Pull request 2 — A1322 and what depends on it (after Questions 1-3 are answered)

Branch `feat/a1379-continue-removed` from `main` after PR 1 lands
(`python3 ~/workspace/tools/worktree.py new waitron feat/a1379-continue-removed --headless`).
Task steps below assume the defaults; adjust P2-1, P2-3, P2-10 and P2-13 to the answers. Where a task says "as the first version's Task N", the full task text
(files, interfaces, test-first steps) is in this plan's first version:
`git show 51739a1477:docs/superpowers/plans/2026-11-06-a1379-setup-start-again.md`. Before
dispatching PR 2, write those tasks out in full here with the owner's answers folded in, and have
the plan reviewed again.

### Task P2-1: Start again may delete the attempt's own certificate record (only if Question 1 is yes)

**Files:** `packages/fiscal-verifactu/src/start-again-holdings.ts:6`, and, to hold it to this
attempt's rows, the holdings read in `apps/server/src/first-setup-database-holdings.ts` (count a
`fiscal_certificate_installs` row as kept unless `node_id` is the attempt's node and `source` is
`setup`). Test: `apps/server/src/first-setup-start-again-held.test.ts`.

- [ ] Failing tests first: one setup-sourced row of this node → accepted; a row of another node, or
  with another `source` → `kept-records`. Prove the limit by deleting it (the other-node case must
  fail). Commit.

### Task P2-2: Start again deletes a setup that saved its trading settings; an invoice still refuses it

As the first version's Task 1 (D1, `HELD_ONLY = ["modules.json", "trading.env"]`, `heldBy` true on
any of them, the `trading-settings` cause gone from `first-setup-resolution.ts:49-58, 76-90` and
`errors.ts:1206-1211`), with these changes:

- `heldSetup` gains `certificate: true`, which writes one real `fiscal_certificate_installs` row
  through the fiscal module's own save (in place of the no-op `seal`,
  `apps/server/test/held-setup-database.ts:113`), so the tests fail for the right reason.
- The accepted case (`tradingSettings` and `certificate`) asserts, before Start again,
  `readSetupDatabase(...).holdings.records === 0`, then that both folders are emptied.
- The invoice case adds `certificate: true`; the fiscal refusal is proved by deleting
  `assertNoKeptRecords(read)` (`first-setup-resolution.ts:291`).
- It also updates `first-setup-start-again-held-journals.test.ts:157` and
  `first-setup-start-again-held-recovery.test.ts:152`, which pin the old refusal.

### Task P2-3: The ordinary setup server stops a setup for Start again

As the first version's Task 3 (`stopForStartAgain`, `START_AGAIN_ROUTES.stop`), with these changes:

- The route calls `assertFirstFiscalRequest` (same origin, JSON only; `setup-first-fiscal-api.ts:99-106`,
  as at `:843` and `:877`) before `assertHttps`.
- New refusal tests, each leaving `first-setup.json` byte for byte: a foreign `Origin`, and a
  `text/plain` body.
- A stop sent while the owner's setup step holds the coordinator waits its turn; then the owner's
  next change is refused `setup.owner_required`.
- The record refuses any further change to the abandoned attempt (`first-setup-state.ts:747-749`).
- If Question 3 chose the smaller gate: a stop within 5 minutes of the owner tab's last request is
  refused `setup.attempt_conflict`, and one after that is accepted (fake clock).

### Tasks P2-4 to P2-6: The server suites stop signing in with the password (tests only)

Each replaces sign-in used only to set up a test, keeping every behavioural assertion. A case whose
subject is Continue is left for P2-9. Each runs its files with an unchanged `Tests` count.

- **P2-4:** `apps/server/test/held-setup-database.ts` (`signIn` `:258-284`), `start-again-held-fixture.ts`,
  `first-setup-start-again-held*.test.ts`, `first-setup-start-again.test.ts`, `held-setup-database.test.ts`,
  `first-fiscal-hour.e2e.test.ts:80-87`, `first-setup-set-aside-lifetime.test.ts`,
  `first-setup-unused-pdf.test.ts`, `first-setup-retired-assignments.test.ts`.
- **P2-5:** `first-fiscal-boot.test.ts`, `first-fiscal-cloud.route.test.ts`, `first-fiscal-delivery.test.ts`,
  `first-fiscal-document-download.e2e.test.ts`, `first-fiscal-evidence.test.ts`,
  `first-fiscal-hour-boot.e2e.test.ts`, `first-fiscal-hour-refusals.e2e.test.ts`.
- **P2-6:** `first-fiscal-setup.e2e.test.ts`, `first-setup-growth.test.ts`,
  `first-setup-recovery-delivery.test.ts`, `first-setup-resolution-inspection.test.ts`,
  `first-setup-resolution.route.test.ts`, `module-operation-host.test.ts`,
  `setup-first-fiscal.route.test.ts`, `setup-first-fiscal-api.disk-full.test.ts`.

### Task P2-7: The command line refuses a stopped setup

As the first version's Task 6 (D5): `cli.ts:313-345, 424-430`; delete `resumeFirstSetupCommand`,
the `finishFirstSetup` branch of `first-setup-command-activation.ts:64-73`, `preparation.resume`,
`resumeBinding`; failing test first, `"a stopped setup is refused setup.attempt_conflict, and
nothing on disk changes"` (claimed and activation-started).

### Task P2-8: Remove Finish setup

As the first version's Task 7: `finishFirstSetup`, the finish audit, `finishFirstFiscalSetup`,
`withFirstSetupPublication`, the `withPublication` option and the five Finish routes; failing test
first in `retired-first-setup-routes.test.ts` (each Finish route answers 404 on the repair entry).

### Task P2-9: Remove Continue on the server

As the first version's Task 8 (the three entry points, `restoreOwnership`, `withResolutionPassword`,
the owner audit, `onOwnershipRecovered`, `assertRepairAllowed`, the three routes,
`START_AGAIN_ROUTES.recover`, the Continue case of `start-again-full-disk.e2e.test.ts:70`), and
also `packages/provisioning/src/first-setup-node-key.test.ts:187,505`, which set up through
`resumeFirstSetup`. Failing test first: no route takes the setup password to win a setup back.

### Task P2-10: The setup record, the inspection and the record store

As the first version's Task 9 (D4 second half, D7), and the session change for Question 2:
with the default, `FirstSetupSession.open()` no longer requires proof for a saved key
(`first-setup-session.ts:166`; `#proofRequired` only while a claim is pending). Failing tests in
`first-setup-session.test.ts`: `"a reload carries on with the saved key and sends no password"` and
`"a duplicated tab is refused while the first holds the attempt"`.

### Task P2-11: The setup app's session and client

As the first version's Task 10, minus the reload part (now P2-10): delete `resume`, `recover`,
`finish` from the session and the client; add `stopFirstSetup`; the client types drop
`password`, `repairEligible` and the `trading-settings` cause.

### Task P2-12: The setup app without Finish setup

As the first version's Task 11.

### Task P2-13: The repair page without the password step; the error drawn once; phone width (items 1, 3 and 4)

The password half of the first version's Task 12: the password field, `#resumeFirstSetup`, the
`trading-settings` words, `owner_required`/`attempt_uncertain` words; tests `"no password field and
no password sent"`, `"a refused Start again draws its message once"`, `"at 375 px no two buttons
overlap"`. It also updates `setup-app-recover.test.ts:138` and `start-again-wipe.test.ts:206`,
which pin the old refusal cause.

### Task P2-14: Start again from a page that does not hold the setup, on the ordinary server

The stop half of the first version's Task 14: a new tab or another device on the ordinary server
(`firstSetupStatus().resolution !== true`) gets the stop confirmation, posts `resolution/stop`, then
Reconnect reaches the repair page; the owner's tab after a stop says it no longer holds the setup
and offers Start again. Repair-page Start again goes straight to its summary.

### Task P2-15: Guide, docs, backlog and words for PR 2

- [ ] Guide EN/ES `{#interrupted-setup}`, `docs/operations/first-live-fiscal-setup.md:97-110`,
  `docs/operations/recovery-document.md:28`, `docs/developers/conventions-data.md:3391-3402`,
  `docs/developers/testing-guide.md:2985-2992`.
- [ ] `git grep -n -i "setup password\|contraseña de configuración\|Continue with\|Continuar con\|tradingSaved" -- apps/server/src/guide apps/setup/src docs/operations ':!docs/operations/a679-changed-checks.md'`
  prints nothing (the a679 file is a dated record, left as written).
- [ ] Backlog: delete what remains of the bundle; `docs/backlog.md:106,404` go.
- [ ] **Words for the owner:** collect every new or changed string (EN and ES) into the PR
  description. PR thread note: the module seat's `resume`/`commandResume` now has no caller (D8).

## Words for the owner (proposed)

| PR | Key | English | Spanish |
| --- | --- | --- | --- |
| 1 | `shell.first_setup.disk_full` (changed) | …Restart the box: as it starts, it uses any space it still keeps in reserve and removes old logs and crash reports to make room. Then try again. … | …Reinicia el equipo: al arrancar, usa el espacio que aún guarde en reserva y quita registros y avisos de fallo antiguos para hacer sitio. Después, vuelve a intentarlo. … |
| 2 | stop ask (new) | To start again or recover from a backup, the box first stops this setup and restarts. Then this page shows what would be deleted, and nothing is deleted until you confirm it there. | Para empezar de nuevo o recuperar desde una copia, el equipo primero detiene esta configuración y se reinicia. Después esta página muestra lo que se borraría, y no se borra nada hasta que lo confirmes allí. |
| 2 | stop button (new) | Stop this setup | Detener esta configuración |
| 2 | stopped (new) | The setup is stopped and the box is restarting. Reconnect to continue. | La configuración está detenida y el equipo se está reiniciando. Reconecta para continuar. |
| 2 | `shell.first_setup.owner_required` (changed) | This page no longer holds this setup. Reconnect to see what you can do with it. | Esta página ya no tiene esta configuración. Reconecta para ver qué puedes hacer con ella. |
| 2 | `shell.first_setup.attempt_uncertain` (changed) | This setup may already have used its assignment, so it is not repeated. Reconnect to see what you can do with it. | Puede que esta configuración ya haya usado su asignación, así que no se repite. Reconecta para ver qué puedes hacer con ella. |

PR 2 deletes: "Continue with your setup password", "Administrator password", "Enter your
password.", "Enter the administrator password you chose during setup.", the "cannot check the
original setup password" line, the two trading-settings sentences, and the Finish setup words.

## After the tasks

PR 1: `/finish-branch` on this worktree with this plan as its note, then ready to land. PR 2:
dispatched only after Questions 1-3 are answered; `/finish-branch` in its own worktree.

## Review fold (2026-11-06)

A fresh-context review found one critical, six important and two minor points. All were taken.
C1 (the certificate row) became Question 1 and PR 2 Task P2-1. I1 added the same-origin and JSON
checks to the stop route. I2 made "keep going on the held key" the default. I3 placed six tests in
the tasks that break them. I4 dropped the seat-removal task. I5 states series-name reuse. I6 split
two tasks. M1 corrected the search. M2 added two stop-route tests. The work is now two pull
requests: PR 1 needs no owner answer.
