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
database and the setup's own certificate record (the owner allowed it); the ordinary setup server
gains a way to stop a setup so the repair page can delete it; Continue, Finish setup (reachable
only after Continue), the command line's way back in and the record store go; the repair page
loses the password step. The `kept-records` refusal stays in both and is proved by deletion.
PR 1 landed as #2521 (main `94ba3178ef`). The owner answered Questions 1-4 on 2026-11-07, so PR 2
is written out in full below against main `fe36c18720`.

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
`docs/handoffs/2026-11-06-a1379-setup-start-again.md`. PR 2: branch `fix/a1379-start-again-part-2`,
worktree `/Users/clintongormley/workspace/worktrees/waitron-fix-a1379-start-again-part-2`, off main
`fe36c18720`; ledger `docs/handoffs/2026-11-07-a1379-start-again-part-2.md`.

## Global Constraints

- **A1308 hold.** No migration, no schema file, no new or changed table, column, index or trigger.
  Nothing in this plan needs one (see "Held"). Every task's commit check includes
  `git -C <worktree> diff --name-only 5558d26e89 -- 'packages/*/src/schema/**' 'packages/*/drizzle/**' 'packages/migrations/**'`
  printing nothing (PR 2: the same command with `fe36c18720` in place of `5558d26e89`). If a step
  turns out to need one, stop and report. No `location` concept either (owner rule).
- **Fiscal invariant (CLAUDE.md §5).** Start again never deletes a setup database holding an
  invoice or any row of an append-only table that no module lists as deletable. The refusal is
  `assertNoKeptRecords` (`apps/server/src/first-setup-resolution.ts:60-69`), called at `:291` for
  every held or read-first database. No task weakens it. PR 2's Tasks P2-2 and P2-3 prove it by
  deletion. The one widening is the owner's (Question 1): this setup's own certificate rows.
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
from `#resumeFirstSetup` (`apps/setup/src/setup-app.ts:1214-1261`) through
`FirstSetupSession.resume`/`recover` (`apps/setup/src/first-setup-session.ts:344-369`). The command
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
the repair entry does (`apps/server/src/first-setup-entry.ts:291-296`). The browser calls only
`/resolution/finish` (`apps/setup/src/api/client.ts:582-590`). With Continue gone, the whole path
is dead. Three of the four server test files named for deletion in the first version also hold
cases that are not about Finish, judged by their names (`first-fiscal-interruption.test.ts` is
mostly activation; `first-fiscal-hour-finish.test.ts:304-548` name Start again; and
`first-fiscal-declared-publication.test.ts:434` checks that activation records the certificate),
so P2-10 sorts them case by case.

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
`source: "setup"` (`packages/fiscal-verifactu/src/provisioning-secret.ts:114-126`, the source at
`:117`). That table is append-only (`packages/fiscal-verifactu/src/classification.ts:22-26`) and
not in `FISCAL_START_AGAIN_DELETABLE = ["fiscal_allocations"]` (`start-again-holdings.ts:6`). The
test helper's save writes nothing (`apps/server/test/held-setup-database.ts:108-115`, `seal` at
`:113`). The table's `source` is `setup` or `dashboard`, and a `dashboard` row must name a person
and a checked endpoint (`packages/fiscal-verifactu/src/schema/certificate-installs.ts:35-40`).
`startAgainDeletable` today means whole tables, every row
(`packages/module/src/module.ts:1527-1530`); the holdings reader treats it so
(`apps/server/src/first-setup-database-holdings.ts:213, 231`). The reviewer ran
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
ordinary server (`needsResolution`, `first-setup-entry.ts:31-47`). There the setup app draws
Start again for a new tab, whose request then 404s; for a reloaded tab it draws only Continue
(the page reads the inspection only when it has no state, `setup-app.ts:1130`). Today Continue is
the only working way on there; without it, a lost tab is a dead end. The ordinary server holds
`venue.db` open (`apps/server/src/boot.ts:1229`), so it must not delete it (Decision D2). The
owner's own tab can already abandon its setup with its key (`POST /setup-api/first-setup/abandon`,
`setup-first-fiscal-api.ts:488, 568-576`); the record accepts `abandoned` from any status but
`complete` and `abandoned` (`packages/provisioning/src/first-setup-state.ts:746-749, 826-829`).
The two servers answer `/setup-api/first-setup/status` without a key differently: the ordinary
server says `{ claimed }` (`setup-first-fiscal-api.ts:443-450`), the repair entry
`{ claimed: true, resolution: true }` (`first-setup-entry.ts:287-289`).

**F5. A reload asks for the password today.** `open()` sets `#proofRequired` whenever a saved
owner exists (`first-setup-session.ts:166`); only claim, resume and recover clear it; every change
goes through `#owner()`, which refuses while it is set. Pinned by `first-setup-session.test.ts:382`
and `setup-app-first-fiscal.test.ts:104,345`. So after a reload the person must type the password.
The page draws the password block for any live, unfinished state whatever the session says
(`!terminal || recoveryRequired`, `setup-app.ts:2345-2350`), and only Continue's success path
moves on to the next screen (`#resumeFirstSetup`, `setup-app.ts:1247-1255`), so carrying on after
a reload is a page change as well as a session change (P2-19).

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
(`packages/provisioning/src/first-setup-state.ts:614-631`). Start again's server side does not look
at the mark (`first-setup-resolution.ts:235-312`); the page refused to offer it because
`wipeOffered` needed `pair === "valid"`. PR 1 ran it (P1-2) and changed `wipeOffered`
(`setup-app.ts:236-239`).

**F9. Recover from backup follows Start again.** Both buttons use `wipeOffered` for `disabled`
(`setup-app.ts:2249-2278`) and the same summary and deletion (`#openWipeConfirmation`,
`#sendWipeFirstSetup`). So wherever Start again is offered, Recover from backup is too; the plan
keeps that, including the new places (repairable record, ordinary server).

**F10. No error code becomes unused.** `setup.owner_required` stays (owner checks, HTTPS checks,
Move's password at `packages/provisioning/src/first-setup-start-again-choose.ts:106-108`); the `first-setup` password throttle
stays for `reconfirm`'s `node-key-reissue` (`first-setup-owner.ts:444`). Only a cause value goes:
`trading-settings` of `setup.start_again_refused` (`apps/server/src/errors.ts:1204-1208`). The
inspection's `password` is `uncheckable` exactly when the record cannot be read, which is also when
`revision` is null (`packages/provisioning/src/first-setup-resolution-inspection.ts:372-374`), so
dropping it (D7) loses nothing `wipeOffered` does not already test; `#firstResolutionSnapshot`
(`setup-app.ts:1263-1276`) is the one other reader.
`ownerVerifier` stays (Move and `reconfirm` read it).

**F11. The bundle's two page oddities.** The heading reads `t.interrupted` whenever an inspection
is held, including after Start again succeeds (fixed in PR 1; `setup-app.ts:2340`). The doubled
error: the password block draws `firstOwnerError` (`:2352-2355`) and the confirmation draws
`firstWipeError` (`:2321`); the password block goes with Continue. Whether two Start again buttons can still be
drawn at once was not established: the conditions changed after #1752 (`git log -L` shows
`4c5ba38db0`, `65da3baaae`, `d3005b7c05`). PR 1 pinned "one at a time" in seven states; it was
already true.

## Decisions

- **D1. `trading.env` joins the deletion list only beside a held database**, the rule
  `modules.json` already follows (`first-setup-start-again-deletion.ts:79-89, 277, 486-491, 591-597`).
  Without a held database it stays refused (`setup.not_ready`, "refused artifact"), so the
  missing-database path keeps refusing it (`first-setup-start-again-held-wipe.test.ts:63-78` stays).
  `setup-finished` stays: a `complete` attempt is refused whatever else it holds.
- **D2. On the ordinary setup server, Start again first stops the setup.** A new route,
  `POST /setup-api/first-setup/resolution/stop`, restarts the box so that it starts on the repair
  page (`needsResolution`, `first-setup-entry.ts:31-47`). What it writes first depends on the
  attempt's status (review fold 2026-11-07, I1 and I2):
  - `claimed` or `consumption-intent`: it first runs the repair page's own Start again checks
    (`assessStartAgain`, `first-setup-resolution.ts:235-312`, as the summary runs them), and
    refuses with whatever they throw, writing nothing, if Start again would then refuse. Those
    checks give the same answer for these two statuses as for `abandoned`: all three take the
    "present" path (`PRESENT_START_AGAIN_STATUSES`, `:175-179`; `held` at `:251`), and neither
    `unused` (`:91-101`) nor `firstSetupUnusedAssignment`
    (`apps/server/src/first-setup-unused-assignment.ts:22-43`) reads the status, and both accept
    an `abandoned` event. Only then does it record the existing `abandoned` event. Without that
    check, a stop the repair page then refused would leave an attempt that takes no further change
    (P2-14a) and a box that only a reinstall clears.
  - `activation-started`, `committed`, `publication`, `uncertain`, `abandoned`, or `complete`
    whose claim mark still says `active`: it writes nothing and only restarts. `needsResolution`
    already sends each of these to the repair page on the next start (`first-setup-entry.ts:36-46`:
    every one of these statuses is in its list, and `publicationComplete` is false while the mark
    says `active`). A failed activation leaves the box on the ordinary server in one of these
    (the activation route restarts only on success, `setup-first-fiscal-api.ts:246`; `/abandon` does not
    restart, `:568-578`), so refusing them would leave Start again refused until a power cut.
    Activation runs inside the coordinator turn (`:217`), so a stop waits for one that is running
    and never cuts it.
  - `complete` with its mark `complete`: `setup.attempt_conflict` (the setup finished).
  It deletes nothing on a server holding the database open (`boot.ts:1229`) and adds no file.
  **Owner, 2026-11-07 (Question 3): anyone on the box's own page may stop it, over HTTPS, with no
  password**, as the repair page's Start again already is. Like Start again's route, it accepts a
  request that sends neither `Origin` nor `Sec-Fetch-Site` (`sentFromThisOrigin`,
  `apps/server/src/own-page.ts:10-17`), such as `curl` on the LAN; the HTTPS check is what stops a
  page that rebinds a name to the box. The route is mounted on the ordinary server only, and only
  when the server can restart itself (`deps.requestRestart`, optional at `setup-api.ts:148`).
- **D3. A reloaded tab keeps going on the key it already holds** (**owner, 2026-11-07, Question
  2: carry on, no password**). The server asks a tab for nothing more than its key, revision, owner generation and a
  live status (`authorize`, `first-setup-owner.ts:171-186`); the tab saves the revision and
  generation on every state it accepts (`#acceptState`, `first-setup-session.ts:248-267`); a
  duplicated tab is fenced by the attempt's Web Lock, taken `ifAvailable` at `open()`
  (`:168-169`, `#holdAttempt` `:195-200`). I found no evidence it cannot work; P2-16a and P2-19
  test it. Only a tab with no saved key (a new tab, another device, a claim cut off mid-flight) is
  offered Start again.
- **D4. The resolution record store.** PR 1 removes only the two actions and the field item 2
  names. PR 2 removes the store whole once its two writers (the owner audit, Continue; the finish
  audit, Finish) are gone, keeping `canonicalFirstSetupDirectory`, `canonicalFirstSetupRoots`,
  `firstSetupDirectory`, `RegisterAnswer`, `FirstSetupOriginal`. Start again keeps deleting a
  `first-setup-resolutions/` folder it finds in the state folder
  (`first-setup-start-again-deletion.ts:34, 278-293`).
- **D5. The command line refuses a stopped setup.** A builder decision the owner accepted: the
  rationalisation README §10 lists it under "Applied as the design", and
  `docs/superpowers/specs/2026-11-02-rationalisation/files.md:91` calls it a "builder decision".
- **D6. Full disk: no spare change in PR 1** (F6, F7). PR 2's P2-5 measures whether Start again
  fits the spare when the setup database must be copied. If it does not, P2-5 pins today's refusal
  and records the owner decision needed; the rest of PR 2 does not wait for it (D10).
- **D7. The setup record drops `resume`/`recover` and `claimNonceHash`; the inspection drops
  `password` and `repairEligible`** (PR 2; only Continue read them). The browser keeps its nonce for
  its lock names (`first-setup-session.ts:168`).
- **D8. The module seat's `resume` and `commandResume` go; the stored `resume` entries stay**
  (review fold 2026-11-07, M8; owner rule 2026-11-06: fix loose ends in the pull request). After
  P2-9 nothing calls the seat's `resume` or `commandResume` (`packages/module/src/initial-setup.ts:36-40`):
  their callers are `preparation.resume` (`packages/provisioning/src/first-setup-preparation.ts:118-147`)
  and `resumeFirstSetupCommand` (`first-setup-command.ts:14-46`, called at `:44`), both deleted
  by P2-9. The fiscal module's implementations (`packages/fiscal-verifactu/src/initial-hour-setup.ts:143-157`)
  go with them, and so does each fiscal function then left with no caller
  (`hostedHourPreparation(...).resume`, `hour-preparation.ts:117-129`, and the selection engine's
  `resume`, `hour-selection.ts:536-540`), in P2-23. The `resume` entries already in a stored
  series-name history (`hour-selection.ts:54-57, 133-174`) keep being read, because CLAUDE.md §5
  relies on every name in that history being counted as taken. The owner lands this pull request
  for the fiscal change anyway, so this adds no review step.
  **As built (P2-23, 2026-11-09):** the seat's `resume` is deleted; `commandResume` is renamed
  `commandBeforeActivation` instead, because since P2-9 it is the command's last check before
  activation (`packages/provisioning/src/first-setup-command.ts`); its body is unchanged.
- **D9. Start again may delete this setup's own certificate rows** (**owner, 2026-11-07, Question
  1**). `fiscal_certificate_installs` joins `fiscal_allocations` in `FISCAL_START_AGAIN_DELETABLE`.
  The owner limited it to rows `source = 'setup'`; since the list means whole tables (F3b), the
  fiscal module counts every row of that table whose `source` is not `setup` as kept, through a
  new optional seat, `startAgainKept(db): Promise<number>`, beside `startAgainHoldings`. The server
  reader runs it as **a step of its own** (review fold 2026-11-07, I4): the reader runs each step
  apart "so a damaged table cannot hide a record kept elsewhere"
  (`apps/server/src/first-setup-database-holdings.ts:159-162`), and a damaged `envios` or
  `registros_facturacion` makes the holdings step fall back to `{ records: 0, accepted: 0 }`
  (`:238`), so a `kept` count returned inside that step would fall back to 0 with it and let
  Start again delete a dashboard row it refuses today. Chosen over "treat the certificate table as
  kept whenever the holdings step fails" because it is one independent step and no cross-reference
  between a module's failed step and its deletable tables, and because it does not refuse a setup
  whose only certificate row is its own when some other fiscal table is damaged. A damaged
  certificate table itself loses its own rows, as every per-table count does today (`:216-231`).
  Any invoice, and any other kept row, still refuses. No node-id test: the owner's answer names the
  source alone, every row in a setup database is written by that setup, and the seat is given only
  the database (Question 1 as asked also named "this node's id"; the PR description's first lines
  say why it was dropped). The fiscal-package change is the owner's to land.
- **D10. The spare file and a copied setup database.** Start again needs disk room in proportion
  to the database only when it must copy it: a `-journal` beside it, or a `-wal` that is not empty
  (`lstat(...).size !== 0`, `packages/provisioning/src/read-only-database.ts:20`, called from
  `readSetupDatabase`, `apps/server/src/first-setup-database-holdings.ts:62-101`; the copy is
  `venue.db` plus its `-wal`, `-journal` and `-shm`, `apps/server/src/venue-private-copy.ts:41-46`,
  into `tmpdir()`). A clean close deletes the `-wal` (the comment at
  `apps/server/test/held-setup-database.ts:76-78`), so the copy is what follows an unclean stop:
  a power cut or a killed process. P2-5 measures the files a simulated crash leaves and the
  largest copy that fits beside an 8 MiB spare after a restart. If some setup the box accepts does
  not fit, P2-5 pins today's refusal and records the owner decision needed; the rest of PR 2 does
  not wait for it. The fix is either a larger spare (a written rule, CLAUDE.md §3, "the box's spare
  file") or reading the database without a disk copy (how Start again checks a database for
  invoices, §5), and both are the owner's to choose.

## Held

Nothing is held for A1308: every change is to routes, files in the state folder and the setup app.

Left open for other reasons:

- **A setup record that cannot be read at all** (`pair` `invalid` or `partial`, `revision` null).
  Start again's deletion marker needs the record's attempt id and frozen digest
  (`first-setup-resolution.ts:213-229`), so deleting it is a new design with fiscal risk. Owner,
  2026-11-07: it stays as it is, with its backlog entry (P2-21 moves the entry to another bundle).
- **An attempt the repair page refuses `setup.not_ready`** because its fiscal assignment may have
  been used (`apps/server/src/first-setup-unused-assignment.ts`). The stop no longer creates one:
  it runs the same checks first and refuses before writing (D2), so the owner's tab keeps its
  setup. Such an attempt can then be cleared only by finishing it from its own tab or by a
  reinstall; P2-4b pins which states are refused, and if the ordinary case (a `consumption-intent`
  attempt that kept its recovery document) is among them, the implementer stops and reports.

## Questions for the owner (answered 2026-11-07)

**Answered by the owner, relayed by the campaign watcher on 2026-11-07 at 12:49.** In short:
1. **Yes**, Start again may delete this setup's own certificate rows (`source = 'setup'`), beside
   `fiscal_allocations`; any invoice or other kept record still refuses. Keep the deletion proof
   and add one for the certificate case. The owner lands the fiscal-package change (D9).
2. **Carry on, no password**: a reload continues with the key the tab already holds (D3).
3. **Anyone on the box's page** may stop the setup over HTTPS with no password (D2).
4. **Left as it is**: a setup record that cannot be read keeps its backlog entry.
5. The words are collected by P2-21 into the PR description.

The questions as they were asked:

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

## Question for the owner (2026-11-07)

**A setup cut off between saving itself as complete and saving its claim mark** (review fold
2026-11-07, I3). P2-22 builds the recommended default; the other option is a small change to
that task if you choose it.

What happens. A setup's last step saves the setup record as complete (`first-setup.json`) and
then, as a second file, its claim mark (`first-setup-claim.json`) (`persist`,
`packages/provisioning/src/first-setup-state.ts:581-587`). By then everything else is done: the
fiscal identity, the certificate and the trading settings are saved
(`publishCheckedFirstSetup`, `packages/provisioning/src/first-setup-activation.ts:209-218`). If the
power goes between those two writes, the next start keeps the box from selling
(`apps/server/src/first-fiscal-mode.ts:28-31`) and shows the repair page
(`apps/server/src/first-setup-entry.ts:36-46`). Today "Continue with your setup password" reopens
it and Finish setup saves it again (`first-setup-state.ts:747, 783-785`). This pull request removes
both, and Start again refuses a setup saved as complete (`setup-finished`,
`apps/server/src/first-setup-resolution.ts:89, 256`), so without a decision the box could only be
reinstalled.

Worked example. A café owner finishes the setup at 10:02. The box saves "setup complete" and loses
power a split second before it saves the claim mark. At 10:05 it starts again: it will not sell,
and the setup page says the setup stopped part way.

1. **Recommended: Start again deletes it**, as it deletes any setup that stopped part way. Nothing
   was sold, because the box refused to sell, and the invoice check still refuses if anything was.
   In the example the owner sets the box up again from 10:05. This is A1322 read as written ("a
   failed setup always offers Start again"); it changes one refusal and adds no new way for a box to
   start selling.
2. **The next start finishes saving the claim mark**, and the box opens with the setup as it was
   saved. In the example the box sells at 10:05 with nothing redone. Kinder to the owner, but it is
   a new way into selling that skips the second check Finish setup made before it saved again (the
   test that pins today's path is named "allowing a credential resume to recheck publication",
   `first-setup-state.test.ts:749`), so it needs its own fiscal review.

## Review weight

**PR 1: FULL.** It offers Start again's deletion for a record kind the page refused before
(fiscal-invariant area), and changes the setup record store's validator. Per-task review on
P1-2 and P1-3; full `/finish-branch` wave, two Codex run-it reviews.

**PR 2: FULL.** It deletes data (Start again's list gains `trading.env` and this setup's
certificate rows), changes authentication (removes password recovery, adds a route with no owner,
lets a reloaded tab carry on with its key) and a cross-package contract (the module holdings
seat). Per-task review on P2-1, P2-2, P2-3, P2-4a, P2-4b, P2-11, P2-12, P2-13, P2-14a, P2-14b,
P2-16a, P2-19, P2-20, P2-22 and P2-23; two Codex run-it reviews side by side; the simplify seat
runs (it restructures code). **The owner lands it**: the fiscal-package changes are the owner's
(P2-1, which is Question 1, and P2-23, which removes code from the fiscal package). The PR
description's first line says so, and lane B marks the item `needs-owner-review` and tells the watcher when it is ready.

## Review Focus

1. **A setup stopped at each step from claimed to publication, then Start again** — with a real
   certificate row. Expected: state folder empty, venue folder lock files only, zero fiscal
   records. Pinned by P2-2, P2-3 and P2-4b.
2. **A stop the repair page would then refuse.** Expected: the stop refuses with the same answer,
   `first-setup.json` unchanged, and the owner's tab carries on. P2-4a, P2-4b.
3. **A stop after a failed activation** (`activation-started`, `committed`, `publication`,
   `uncertain`, or abandoned by the owner's own tab). Expected: nothing written, the box restarts,
   the repair page serves Start again. P2-4a, P2-4b.
4. **A setup saved as complete whose claim mark was not.** Expected: the owner's choice (Question
   for the owner, 2026-11-07); by default Start again deletes it. P2-22.
5. **An invoice beside saved trading settings and a certificate.** Expected: `kept-records`,
   nothing changes. P2-2 and P2-3, proved by deletion.
6. **A certificate row the dashboard wrote** (`source = 'dashboard'`) in a setup database,
   including beside a damaged `envios` or `registros_facturacion`. Expected: `kept-records`. P2-1,
   proved by deletion.
7. **A reloaded tab.** Expected: it carries on with no password. P2-16a, P2-19.
8. **The owner's tab after another page stopped its setup.** Expected: next change refused
   `setup.owner_required`; the page says it no longer holds the setup and offers Start again.
   P2-4b, P2-20.
9. **A full disk.** Expected: refused before a restart, deleted after it, and P2-5's measurement
   of the files a simulated crash leaves against the spare.

---

## Pull request 1 — needs no owner answer (landed as #2521, 2026-11-07)

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

## Pull request 2 — A1322 and what depends on it

**Re-checked on 2026-11-07 against main `fe36c18720`.** Every "What the code says" and Decisions
receipt these tasks rely on was re-read at its file and line (F1, F2, F3b, F4, F5, F8-F12, D1-D4,
D7, D8); line numbers that had moved or were off are corrected in place above. None of the claims had
turned false. Three findings were new and changed the tasks: the four Finish test files also hold
activation and Start again cases (F2, so P2-10 sorts them case by case); carrying on after a reload
needs a page change as well as a session change (F5, P2-19); and `startAgainDeletable` means whole
tables, so the owner's `source = 'setup'` limit needs the fiscal seat to count the other rows
(F3b, D9). The answers are folded in (Questions, D2, D3, D9); the full-disk measurement PR 1 left is
P2-5 (D10).

Branch `fix/a1379-start-again-part-2`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-fix-a1379-start-again-part-2`, off main
`fe36c18720`.

**Before dispatching, check A1384** (#2527, "Setup's refusals say what happened", open on
2026-11-07). It changes the same files: Start again's HTTPS refusal becomes
`setup.connection_insecure` (403) instead of `setup.owner_required`; `setup.not_ready` gains a
`cause`, and `unavailable()` in `apps/server/src/first-setup-resolution.ts` takes one; a copy that
runs out of disk answers `storage.disk_full`; the page's `refusalWords` becomes a table keyed by
`WipeRefusal` (`apps/setup/src/start-again-wipe.ts`). If it has landed, rebase this branch first and
re-run each task's `git grep` before starting it. The tasks that meet these refusals (P2-4a, P2-5,
P2-18b, P2-20) name them so that they read right either way.

**Order.** P2-1 → P2-2 → P2-3 → P2-22 (each builds on the last); P2-4a → P2-4b, and P2-5, any
time after P2-3; P2-6a → P2-6b, P2-7, P2-8 and P2-9 before P2-12; P2-23 after P2-9; P2-10 before
P2-11; P2-12 → P2-13 → P2-14a → P2-14b → P2-15; P2-16a → P2-16b after P2-15 and P2-4b; P2-17 →
P2-18a → P2-18b, P2-19 and P2-20 after P2-16b; P2-21 last. P2-5 blocks nothing: if its
measurement needs an owner decision, it records it and the other tasks carry on.

**Every task**, besides the Global Constraints: run the focused files it names and read their
`Tests` line; run `pnpm format:check` and the typecheck of every package it changed; check the
schema command prints nothing; commit with `git commit -s` and a plain-English message. A test
that changes because the behaviour changed is named in the commit message with the reason.

**Every task that deletes a test case ("move what stays").** Before deleting a case, read every
assertion in it. An assertion about behaviour that stays moves into a surviving case (an existing
one or a new one), and the handover lists each moved assertion with the case it went to. Only
assertions whose subject is the removed behaviour (Continue, its password, Finish setup, the
dropped record fields) go with the case. A case rewritten to pass against the new code without
its old assertion is a deletion, and is listed as one. Each task below names the assertions the
2026-11-07 review found that must move; the list is a floor, not the whole.

### Task P2-1: The fiscal module lets Start again delete this setup's own certificate rows (D9)

**Risk: fiscal, and a cross-package contract.** It changes `packages/fiscal-verifactu` and the
module contract in `packages/module`. The golden huella test and the immutability suite must pass
**unedited**. The PR is the owner's to land (Question 1): the PR description's first line says so,
and lane B marks the item `needs-owner-review`.

**Files:**
- Modify: `packages/fiscal-verifactu/src/start-again-holdings.ts` (the list `:6`; a new
  `startAgainKept` beside the seat `:15-31`: the count of `fiscal_certificate_installs` rows whose
  `source` is not `setup`), and the fiscal module's contribution that exports the seat (find it
  with `git grep -n "startAgainHoldings" -- packages/fiscal-verifactu/src ':!*.test.ts'`)
- Modify: `packages/module/src/initial-setup.ts:77-80` (a new optional seat
  `startAgainKept?(db: Pick<Database, "execute">): Promise<number>`, documented as "rows of a table
  this module lists in `startAgainDeletable` that Start again must still keep"),
  `packages/module/src/module.ts:1527-1529` (the `startAgainDeletable` comment: every row may go
  unless the module's `startAgainKept` counts it as kept)
- Modify: `apps/server/src/first-setup-database-holdings.ts:233-243` (runs each module's
  `startAgainKept` as **its own `step`**, default 0, and adds it to `kept`; the holdings step and
  its default `{ records: 0, accepted: 0 }` are unchanged; D9 says why a separate step),
  `apps/server/test/setup-holdings-fixture.ts:68-71` (the seat type, if the compiler asks)
- Test: `packages/fiscal-verifactu/src/start-again-holdings.test.ts`,
  `packages/composition/src/composition.test.ts:514-521`,
  `apps/server/src/first-setup-database-holdings.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Fiscal, for both contributions (`:17-20`): `"counts a certificate row the dashboard installed as
    kept, and one setup installed as nothing"`. Write a `source: "setup"` row (person null) and a
    `source: "dashboard"` row (person, `checkedAt`, `checkedEndpoint` set) through
    `recordInstall` (`packages/fiscal-verifactu/src/certificate-record.ts:27-32`) inside
    `withTransaction`; `startAgainKept` answers 0 after the first and 1 after the second, and
    `startAgainHoldings` answers `{ records: 0, accepted: 0 }` throughout (unchanged).
  - Fiscal: `"refuses rather than counting nothing when the certificate table is missing"` (drop
    `fiscal_certificate_installs` in a `useVenueDb` setup, as `:110-122` drops `envios`;
    `startAgainKept` rejects `/no such table: fiscal_certificate_installs/`).
  - Fiscal `:124-126` and composition `:514-521`: the list is
    `["fiscal_allocations", "fiscal_certificate_installs"]` (rename the fiscal case to "lists the
    append-only tables the fiscal activation writes as deletable").
  - Server: `"a setup certificate row is not kept; a dashboard one is"` on `heldSetup()`, writing
    each row straight into `venue.db` as the fixture's other raw writes do
    (`apps/server/test/setup-holdings-fixture.ts:55-64`); `readSetupDatabase` answers `kept: 0`, then
    `kept: 1`.
  - Server, the I4 case: `"a dashboard certificate row is still kept when another fiscal table is
    damaged"`: `heldSetup()` with a dashboard row, then `envios` dropped (and, as a second row of
    an `it.each`, `registros_facturacion` dropped); `readSetupDatabase` answers `kind: "damaged"`
    with `seen.kept` 1, and Start again's summary refuses `kept-records`. Before writing it, say
    what the failing case prints: `seen.kept` 0 and a summary answered 200 with
    `databaseUnreadable: true`.
- [ ] **Step 2: Run, and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/start-again-holdings.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/first-setup-database-holdings.test.ts`.
  Expected: the new cases fail on `kept` (undefined, or 1 for the setup row).
- [ ] **Step 3: Implement.** `startAgainKept` is one count with no `try` (a failure throws). The
  server runs it in its own `step(() => seat(target), 0)` after the holdings step.
- [ ] **Step 4: Run and pass, then prove each part by deletion.** (a) Return 0 always from
  `startAgainKept`: the fiscal and server dashboard-row cases must fail. (b) Take
  `"fiscal_certificate_installs"` out of the list: the server's setup-row case must fail with
  `kept: 1`. (c) Move the `startAgainKept` call inside the holdings step (one step for both): the
  I4 case must fail with `seen.kept` 0. Restore all three; run again; all pass.
- [ ] **Step 5: The fiscal guards, unedited.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  passes, and `git diff fe36c18720 -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
  prints nothing. Also `pnpm --filter @waitron/module exec vitest run src/module.test.ts` (the
  `module.start_again_deletable_invalid` check, `module.ts:1673-1680`, accepts the table because the
  fiscal classification marks it append-only). `fiscal-verifactu` has no Stryker set-up
  (`git ls-files | grep stryker` lists none under it), so no mutation run applies; Step 4's
  deletion proofs are what show the new cases can fail.
- [ ] **Step 6: Commit.** First line: "Start again may delete the setup's own certificate record
  (owner's fiscal decision, 2026-11-07)".

### Task P2-2: A real activation's certificate row: Start again deletes it, and an invoice beside it still refuses

**Files:**
- Modify: `apps/server/test/held-setup-database.ts` (option `certificate?: boolean`: the fiscal
  module keeps its own `provisioningSecret` instead of the stub at `:108-115`, and the activation
  sends a real certificate from `makeAuthority().issue()`
  (`@waitron/fiscal-verifactu/test/certificate-fixtures.js`, as
  `first-fiscal-declared-publication.test.ts:434-449` does) with `certKind: "sello"` in place of
  `aeatCert: { synthetic: true }` at `:183`)
- Test: `apps/server/src/held-setup-database.test.ts`,
  `apps/server/src/first-setup-start-again-held.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `held-setup-database.test.ts`: `"certificate: true leaves the setup's one certificate row"`:
    exactly one `fiscal_certificate_installs` row, `source: "setup"`, `node_id` the attempt's
    `frozen.nodeId`.
  - `first-setup-start-again-held.test.ts`: `"a held setup with its certificate row: nothing is
    kept, and Start again deletes everything"`: `heldSetup({ certificate: true })`;
    `readSetupDatabase(f.roots, f.host.modules!)` answers `kind: "read"`, `kept: 0`, `records: 0`;
    summary and Start again through `withoutSignIn`; `expectStartAgainDeleted(f.roots)`.
  - `"a held setup with its certificate row and an invoice refuses kept-records, and nothing
    changes"`: `heldSetup({ certificate: true, invoices: 1 })`, `expectRefused` with
    `{ code: "setup.start_again_refused", params: { cause: "kept-records" } }`.
- [ ] **Step 2: Run, and watch the fixture case fail** (no row yet).
  `pnpm --filter @waitron/server exec vitest run src/held-setup-database.test.ts src/first-setup-start-again-held.test.ts`.
- [ ] **Step 3: Implement the option.** If the fiscal module's own `validate` refuses the
  certificate under the fixture's clock, keep the stub `validate` beside the real `seal`, and say so
  in the commit.
- [ ] **Step 4: Run and pass, then prove both refusals by deletion.** (a) Take
  `"fiscal_certificate_installs"` out of `FISCAL_START_AGAIN_DELETABLE`: the certificate-only case
  must fail `kept-records` with log reason `kept=1`. (b) Comment out `assertNoKeptRecords(read);`
  (`apps/server/src/first-setup-resolution.ts:291`): the certificate-plus-invoice case must fail
  (a summary answer or a deletion). Restore both; run again; all pass.
- [ ] **Step 5: Commit.**

### Task P2-3: Start again deletes a setup that saved its trading settings; an invoice still refuses it (D1)

**Files:**
- Modify: `packages/provisioning/src/first-setup-start-again-deletion.ts` (`REFUSED` `:53-73`,
  `MODULES` and `heldBy` `:84-89`, `listed` `:127-145`, `itemsOnDisk` `:277`,
  `assertStartAgainAllowedOnDisk` `:486-491`, `collectStartAgainFindings` `:591-597`)
- Modify: `apps/server/src/first-setup-resolution.ts` (`refused` `:49-58`,
  `assertHeldStartAgainOffered` `:76-90`), `apps/server/src/errors.ts:1204-1208` (the cause union
  and its comment)
- Test: `apps/server/src/first-setup-start-again-held.test.ts` (`:39-51`, `:143-172`),
  `first-setup-start-again-held-journals.test.ts:156-166`,
  `first-setup-start-again-held-recovery.test.ts:152-158`;
  `packages/provisioning/src/first-setup-start-again-deletion.test.ts`,
  `first-setup-start-again-findings.test.ts`, `first-setup-start-again-marker.test.ts`

**Interfaces:** `setup.start_again_refused` causes are `"setup-finished" | "kept-records"`. The
deletion module's held-only names are one constant, `HELD_ONLY = ["modules.json", "trading.env"]`,
used wherever `MODULES` is special-cased today.

- [ ] **Step 1: Write the failing tests.**
  - Replace the trading-settings cases at `:39-51`: `"saved trading settings and the certificate
    beside a held database: the summary says fiscal-finished and Start again deletes everything"`
    (`heldSetup({ tradingSettings: true, certificate: true })`, summary `toEqual({ reached:
    "fiscal-finished" })`, `records` 0 before Start again (F12), `expectStartAgainDeleted`); and
    `"a complete attempt with saved trading settings refuses setup-finished"`.
  - `:143-154` table: the `"saved trading settings"` row becomes `"saved trading settings, the
    certificate and an invoice"`, `{ tradingSettings: true, certificate: true, invoices: 1 }`,
    expecting `kept-records`.
  - `:155-172`: the `unknown` and `partial` rows with `{ tradingSettings: true }` now expect
    `notReady`, as the rows without do.
  - `held-journals:156-166`: the trading-settings row beside a damaged database now expects what
    the same damage without trading settings expects in that file (find it and match it: the
    database is read as damaged, so the summary carries `databaseUnreadable`).
  - `held-recovery:152-158`: `"in the held state, saved trading settings and the certificate are
    deleted by Start again"`.
  - Provisioning: `trading.env` beside a held marker is listed, fingerprinted and deleted; without
    `held` it is refused `refused artifact: state/trading.env`; a marker naming only `trading.env`,
    or only `modules.json`, is read as held (today `heldBy` reads only `modules.json`).
- [ ] **Step 2: Run, and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts src/first-setup-start-again-held-journals.test.ts src/first-setup-start-again-held-recovery.test.ts`
  and
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-start-again-deletion.test.ts src/first-setup-start-again-findings.test.ts src/first-setup-start-again-marker.test.ts`.
  Expected: `trading-settings` or `refused artifact: state/trading.env`.
- [ ] **Step 3: Implement.** Drop the `trading.env` branch of `assertHeldStartAgainOffered` and
  the cause everywhere above; add `HELD_ONLY`; `listed` takes `trading.env` at the state root;
  `itemsOnDisk` adds it with `held` after `modules.json`; both `REFUSED` loops skip a `HELD_ONLY`
  name when held.
- [ ] **Step 4: Run and pass, then prove the fiscal refusal by deletion**: comment out
  `assertNoKeptRecords(read);` and run the held suite; the invoice cases (`:18`, the new
  trading-certificate-invoice row) must fail. Restore. Then run
  `src/first-setup-start-again-held-wipe.test.ts` and `src/first-setup-start-again.test.ts`
  unchanged: the missing-database refusal of `trading.env` (`held-wipe:63-78`) and the not-held one
  (`first-setup-start-again.test.ts:1163`) still pass.
- [ ] **Step 5: Commit.** `git grep -n "trading-settings" -- apps/server packages` prints only
  unrelated names (`hour-restore-retired-inputs.test.ts:349`, `standby-operation.test.ts`); the
  setup app's copies go in P2-16a to P2-18a.

### Task P2-4a: The stop route: its checks, what it writes, and its refusals (D2)

**Files:**
- Modify: `apps/server/src/first-setup-resolution.ts` (new action `stopForStartAgain`, inside
  `createFirstSetupResolutionActions` so it can call `assessStartAgain`, `:235-312`),
  `apps/server/src/setup-first-fiscal-api.ts` (`START_AGAIN_ROUTES.stop`; the route inside
  `mountFirstSetupResolutionApi`, registered only when both its `stop` option and
  `options.requestRestart` are given (M6: `deps.requestRestart` is optional, `setup-api.ts:148`,
  and a stop that restarts nothing would leave the setup stopped on the ordinary server); the
  ordinary server's call at `:429` passes `stop` and `deps.requestRestart`; the repair entry
  (`first-setup-entry.ts:291-300`) passes no `stop`)
- Test: new `apps/server/src/first-setup-stop.route.test.ts`

**Interfaces:**
- `createFirstSetupResolutionActions(...).stopForStartAgain(request: StartAgainSummaryRequest): Promise<void>`.
- `START_AGAIN_ROUTES.stop = { method: "POST", path: "/setup-api/first-setup/resolution/stop" }`;
  answer 200 `{ restarting: true }`, then `requestRestart` on a timer as Start again does
  (`setup-first-fiscal-api.ts:933`).
- In order: `assertFirstFiscalRequest` (same page, JSON only; `:99-106`; like Start again's route,
  a request with neither `Origin` nor `Sec-Fetch-Site` passes, `own-page.ts:10-17`), then the same
  `assertHttps` as the Start again route (`:835-839`); exact keys `inspectionId, revision,
  ownerGeneration`, positive safe integers (else `setup.request_invalid`, as `:845-855`); then
  inside `host.resolution.withVenueExclusion` and `host.coordinator.run`:
  1. `host.store.readResumable()` (not `read()`, which refuses a `complete` record whose mark says
     `active`, `first-setup-state.test.ts:771`). `null`: `setup.attempt_conflict`.
  2. `claimed` or `consumption-intent`: run `assessStartAgain(request, "summary")` and let any
     refusal it throws through unchanged (it also matches the inspection ids, else
     `setup.attempt_conflict`). Then `host.store.update(attemptId, revision, { kind: "abandoned" },
     hold)` and invalidate `owner`, `evidence` and `delivery` for the attempt.
  3. `activation-started`, `committed`, `publication`, `uncertain`, `abandoned`, or `complete` with
     `publicationComplete` false: match the inspection ids (else `setup.attempt_conflict`); write
     nothing.
  4. `complete` with `publicationComplete` true: `setup.attempt_conflict`.
  No password, no owner key (owner, Question 3).

- [ ] **Step 1: Write the failing tests** against `mountSetup` built as `hourFirstFiscalFixture`
  does (`apps/server/test/hour-first-fiscal.ts:42-51`), with `requestRestart` a spy, the clock
  mocks of `first-fiscal-hour.e2e.test.ts:20-34`, and a real empty migrated `venue.db` in the venue
  folder **held open for the whole test, as the ordinary server holds it** (`openVenueDatabase`,
  `boot.ts:1229`; M5), so `needsResolution` reads `no-venue-rows` before the stop and the
  inspection ids are matched under the real conditions:
  - `"a claimed setup is stopped over HTTPS with no owner: the record says abandoned and the box restarts"`.
  - `"an activation-started setup: the stop writes nothing and the box restarts"`
    (`first-setup.json` byte for byte; `requestRestart` called once). The same as an `it.each` row
    for `committed` (the held fixture's failed-publication case, `apps/server/test/held-setup-database.ts:162, 194`)
    and for an attempt the owner's own tab abandoned (`POST /setup-api/first-setup/abandon`).
  - `"a stop the repair page would refuse is refused, and writes nothing"`: a claimed attempt that
    has taken an input, beside a state file outside `firstSetupUnusedAssignment`'s allowed list
    (`first-setup-unused-assignment.ts:44-62`); if the summary accepts that, use another state the
    summary refuses, found by running it. The answer is the code the repair page's summary answers
    for the same folders (`setup.not_ready` today); `first-setup.json` byte for byte;
    `requestRestart` not called; the owner's next change succeeds.
  - Refusals, each leaving `first-setup.json` byte for byte and `requestRestart` not called: plain
    HTTP (the code Start again's own route answers), a forwarded HTTPS header on a plain socket
    (carried over from `first-setup-recovery.route.test.ts:72`, which P2-12 deletes; M5), a
    foreign `Origin` (`setup.owner_required`), a `text/plain` body (`setup.request_invalid`), stale
    ids (`setup.attempt_conflict`), an extra key (`setup.request_invalid`).
  - `"a stop sent while the owner's step holds the coordinator waits its turn"`.
  - `"the repair entry does not serve the stop route"` (404), and `"the ordinary server without
    requestRestart does not serve it"` (404).
- [ ] **Step 2: Run, and watch them fail** (404).
  `pnpm --filter @waitron/server exec vitest run src/first-setup-stop.route.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and pass; prove the gates by deletion**: remove the `assessStartAgain` call
  (the refused-by-the-repair-page case must fail), make step 3 write `abandoned` too (the
  activation-started case must fail), remove `assertHttps` (the plain-HTTP and forwarded-header
  cases must fail: the HTTPS check is what stops a page that rebinds a name to the box) and
  `assertFirstFiscalRequest` (the foreign-`Origin` case must fail). Restore.
- [ ] **Step 5: Commit.**

### Task P2-4b: After a stop, the repair page deletes it; the owner's tab is told (D2)

Tests through the whole path, on top of P2-4a. Same fixture as P2-4a (database held open). Fix in
P2-4a's code anything these find.

**Files:** test `apps/server/src/first-setup-stop.route.test.ts` (or a sibling
`first-setup-stop.e2e.test.ts` if the file passes about 400 lines).

- [ ] **Step 1: Write the failing tests:**
  - `"then the repair entry serves Start again for it, and Start again deletes it"`, as an
    `it.each` over the states a stop accepts and the repair page must then delete: a bare claim;
    after candidates; after an input; after an import; after the publication binding;
    `consumption-intent` with its recovery document kept (`keepHourRecoveryDocument`,
    `apps/server/test/hour-recovery-delivery.ts`) and without it; and the restart-only states
    (`activation-started`, `committed`, an attempt the owner's tab abandoned). For each: before the
    stop `resolveFirstSetupEntry(roots, {})` answers `kind: "normal"`; after it (database closed,
    as the restart closes it) `kind: "resolution"`; summary and Start again through its app answer
    200; both folders hold only lock files. A state P2-4a's stop refuses is not in this table but in
    the next.
  - `"a state the repair page refuses is refused by the stop too"`: for each state the table above
    cannot use (find them by running it), the stop's answer equals the repair page's summary answer
    for the same folders, and nothing is written. If `consumption-intent` with its recovery
    document kept is among them, stop and report (see "Held").
  - `"the owner's tab is refused after another page stopped the setup"`: its next owner-keyed
    change (`POST /setup-api/first-setup/input`) answers `setup.owner_required`, and the record
    refuses any further change to the abandoned attempt (`first-setup-state.ts:746-749`).
- [ ] **Step 2: Run, and watch any fail**: the follow-through cases may pass on P2-4a's code; a
  case that passes on its first run is checked by deletion instead (Step 4).
  `pnpm --filter @waitron/server exec vitest run src/first-setup-stop.route.test.ts`
- [ ] **Step 3: Fix** what failed.
- [ ] **Step 4: Prove by deletion**: make the stop write `abandoned` for every status without the
  check: the "refused by the stop too" cases must fail. Restore.
- [ ] **Step 5: Commit**, listing the states in each table.

### Task P2-5: Full disk: does Start again fit the spare when it must copy the setup database? (D10)

PR 1 showed a restart gives up the 8 MiB spare and Start again then finishes, for a held setup
whose database needs no copy (`apps/server/src/start-again-full-disk.e2e.test.ts:153-210`). Start
again copies the database into `tmpdir()` whenever a `-journal` sits beside it or its `-wal` is
not empty (`packages/provisioning/src/read-only-database.ts:20`), which is what a power cut or a
killed process leaves: a clean close deletes the `-wal`. That copy is the only write that grows
with the database. This task measures it on the files a simulated crash leaves. **It blocks no
other task**: if a size does not fit, it pins today's refusal, records the owner decision
needed, and the pull request carries on.

**Files:** test `apps/server/src/start-again-full-disk.e2e.test.ts` (its small disk is 32 MiB,
`:30`; `TMPDIR` is stubbed onto it, `:36`); `apps/server/test/held-setup-database.ts` (an option,
next to `pendingWal` `:237-255`, that leaves the files a crash leaves: write into a table an
activation already writes, so the inspection still reads `occupied`, copy `venue.db` and
`venue.db-wal` while the database is open, close it, and put the copies back).

- [ ] **Step 1: The crash files.** With that option and a large import into the held setup, record
  the sizes of `venue.db` and `venue.db-wal` as left. Also record the `-wal`'s size after a
  `pragma wal_checkpoint(passive)` with the database still open: whether the `-wal` shrinks after a
  checkpoint is measured here, not assumed.
- [ ] **Step 2: The threshold.** On the small disk, after a restart with the real spare (`restart()`
  at `:154-175`), with crash files whose copy (`venue.db` plus `-wal`) is about 4, 6, 7, 8 and 10
  MiB. Before each run, say what each answer would print: **passing**, summary and Start again
  answer 200 and the venue folder holds only lock files; **failing**, the summary answers 507
  `storage.disk_full` (after A1384) or 503 `setup.not_ready` with a logged reason beginning
  `copy failed:` or `read failed:` (record the reason actually logged), and `venue.db` is still
  there. Any refusal that leaves `venue.db` in place counts as failing. Two controls: (a) the same
  files with the `-wal` checkpointed into `venue.db` and truncated beforehand (no copy) must pass at
  the same fill, which shows it is the copy that costs; (b) crash files of about 20 MiB, larger
  than the room left, must fail as described, which shows the probe can print the failing answer.
  Record the largest copy that passes.
- [ ] **Step 3: What an unfinished setup can leave.** The largest input a setup takes is a
  configuration export of up to `MAX_CONFIGURATION_UPLOAD_BYTES` (64 MiB,
  `apps/server/src/setup-api.ts:244`). Starting from `first-fiscal-hour-import.e2e.test.ts`'s
  import, make the crash files after activation for exports of two sizes, and state the export
  size at which the copy passes Step 2's threshold. Name the experiment, not a conclusion wider
  than it.
- [ ] **Step 4, if every size a setup accepts fits:** keep one case at the largest measured size
  as a test ("a copy of a crashed setup database of N MiB still fits the spare after a restart")
  and commit.
- [ ] **Step 4, if some size does not fit:** add the case at the smallest failing size, pinning
  today's answer (the refusal from Step 2, nothing deleted, the spare already given up), and
  commit it. Do not change the spare or the read. Write the owner decision needed into the ledger
  and the handover, with both numbers: either a larger spare (CLAUDE.md §3, "the box's spare
  file") or reading the database without a disk copy (§5: how Start again checks a database for
  invoices). The driver relays it to the owner as one question; the other tasks carry on. The PR
  description states the measurement either way.

Run each step on a small disk (testing-guide, "Full-disk tests use a small real filesystem"):
`pnpm --filter @waitron/server exec vitest run src/start-again-full-disk.e2e.test.ts`. A run with
the cases reported SKIPPED measured nothing.

### Task P2-5c: A damaged setup database beside a non-empty `-wal` is refused, never deletable (questions.md 2026-11-07 23:12, default)

**Why.** `readSetupDatabase` (`apps/server/src/first-setup-database-holdings.ts`) answers
`{ kind: "damaged", seen }` when the read finds damage, and `assertNoKeptRecords` refuses only when
`seen` counts kept rows or records. A damaged database seen with none is offered for deletion after
the person confirms (`confirmUnreadableDatabase`). When a non-empty `-wal` sits beside it, an
invoice committed only into the `-wal` may be unreadable through the damaged main file, so
deleting would delete the only copy of that invoice (CLAUDE.md §5; Global Constraints' fiscal
invariant). P2-5b refused the worst form (a main file under 100 bytes beside a `-wal`, `short`).
A `-journal` beside a damaged read is already refused (`journal beside a damaged read`). The
watcher was asked (questions.md "## WATCHER-NEEDED: LANE B 2026-11-07 23:12"); its default, built
here: refuse a damaged read whenever a non-empty `-wal` sits beside it.

**Behaviour.** When the read reaches `damage !== undefined` and the database was opened because
its `-wal` is non-empty (the `opened.kind === "wal"` path without a journal), the read fails the
same way the `short` case does (`readFailed(...)`, a `SetupDatabaseReadFailed` whose reason names
"damaged beside a -wal"): nothing is deleted, the summary and Start again answer
`setup.not_ready`, and the stop route keeps its existing fall-through for read failures. A damaged
database with no `-wal`, or an empty one, keeps today's damaged-and-confirmed path unchanged.

**Files:** `apps/server/src/first-setup-database-holdings.ts` and its tests; any test that today
deletes a damaged database beside a non-empty `-wal` (grep the server suites for
`confirmUnreadableDatabase` and the damaged fixtures).

- [ ] **Step 1: Failing tests first** (write what passing and failing print before each run):
  - a setup database of 100 bytes or more whose main file is damaged (for example cut short after
    its first page) beside a non-empty `-wal`: the summary and Start again (with an unreadable
    confirmation) both answer `setup.not_ready`, and every file in the venue folder is
    byte-identical afterwards (reuse P2-5b's hash helper);
  - control: the same damaged main file with NO `-wal` still reaches the damaged-and-confirmed
    deletion exactly as today.
- [ ] **Step 2: Run, watch them fail for the expected reason.**
- [ ] **Step 3: Implement** (the smallest change in `readSetupDatabase`).
- [ ] **Step 4: Pass; prove by deletion**: remove the new refusal and see the first case fail.
- [ ] **Step 5:** if an existing test asserted the old deletion beside a non-empty `-wal`, list it
  in the report with the old and new expectation (an intended behaviour change, not a loosening).
- [ ] **Step 6: Commit** (`git commit -s`), naming the watcher question and its default.

### Tasks P2-6a to P2-8: The server suites stop signing in with the password (tests only)

Each replaces sign-in that only prepares a later step, reading the inspection's ids as
`withoutSignIn` does (`apps/server/test/start-again-held-fixture.ts`). A case asserting a revision
or owner generation that the sign-in bumped is updated to the value without it. Every behavioural
assertion stays; a `signIn: true/false` option that only chose whether to sign in goes. A case
whose subject is Continue itself is left for P2-12 and listed in the handover. Find the uses with
`git grep -n "recoverFirstSetupOwner\|resumeFirstSetup\|recoverFirstSetup\b\|resolution/recover\|first-setup/resume\|first-setup/recover\|\.signIn()\|signedIn" -- <files>`.
Each runs its files before and after, with the same `Tests` count, all passing. The "move what
stays" rule applies to every case these tasks change.

- **P2-6a:** `apps/server/test/start-again-held-fixture.ts` (`signedIn` `:86-90` and its callers
  `:107, :115, :159, :187`), `first-setup-start-again-held.test.ts`,
  `first-setup-start-again-held-recovery.test.ts` (`:80, :125, :225`),
  `first-setup-start-again.test.ts`, `held-setup-database.test.ts`. `held-setup-database.ts`'s
  `signIn` stays until P2-6b; these files stop calling it.
- **P2-6b:** `first-fiscal-hour.e2e.test.ts:80-87`, `first-setup-set-aside-lifetime.test.ts`,
  `first-setup-unused-pdf.test.ts`, `first-setup-retired-assignments.test.ts`, then
  `apps/server/test/held-setup-database.ts` (delete `signIn`, `:260-284`, and its type `:45-48`,
  once `git grep -n "\.signIn()" -- apps/server` shows no caller). After it,
  `git grep -n "recoverFirstSetupOwner" -- apps/server/test` prints nothing.
- **P2-7:** `first-fiscal-boot.test.ts`, `first-fiscal-cloud.route.test.ts`,
  `first-fiscal-delivery.test.ts`, `first-fiscal-document-download.e2e.test.ts`,
  `first-fiscal-evidence.test.ts`, `first-fiscal-hour-boot.e2e.test.ts`,
  `first-fiscal-hour-refusals.e2e.test.ts`, `first-fiscal-setup.e2e.test.ts`.
- **P2-8:** `first-setup-growth.test.ts`, `first-setup-recovery-delivery.test.ts`,
  `first-setup-resolution-inspection.test.ts`, `first-setup-resolution.route.test.ts`,
  `module-operation-host.test.ts`, `setup-first-fiscal.route.test.ts`,
  `setup-first-fiscal-api.disk-full.test.ts`, and `first-setup-key-reissue.boot.test.ts` (review
  fold M1: it posts to `/resume` after a restart, `:68`, only to hold a key again; its subject,
  `node-key-reissue`, stays, F10). After the restart it keeps the claim's own headers instead
  (the key's stored hash survives a restart: `authorize` reads it from the record,
  `packages/provisioning/src/first-setup-owner.ts:171-186`), and every assertion from `:71` on
  stays. If the claim's key is refused after the restart, stop and report: D3 rests on it.

Not these, which P2-10 sorts: `first-fiscal-hour-finish.test.ts`, `first-fiscal-interruption.test.ts`,
`first-fiscal-declared-publication.test.ts`, `first-setup-finish.route.test.ts`; nor
`first-setup-recovery.route.test.ts` (P2-12). All paths are under `apps/server/src/` unless named.

### Task P2-9a: The command line waits out the time check in one run (ruling 2026-11-08, found by P2-9)

**Why.** P2-9's implementer found (report `task-P2-9-report.md`, experiment: the refusal in place
failed 57 cases of `cli-first-setup.test.ts`) that a Veri*Factu setup run from the command line
always stops once on purpose: the hour module's settle wait (`packages/fiscal-verifactu/src/
initial-hour-setup.ts`, the `command` seat's `waiting`; at most `WAIT_BOUND_MS` = 150 s ahead,
`hour-selection.ts:65`) prints "run the command again within a minute after that time" and exits
with the record `claimed`. The second run gets back in only through `recoverFirstSetupOwner`, the
path D5 removes. Ruling (lane B, 2026-11-08): the command keeps its claim in memory and waits the
time out inside the same run, then carries on — as the setup page carries on with the tab's key
(D3). D5 then stands as written: a retained attempt found at the START of a run is refused.

**Behaviour.**
- When the hour step answers `waiting` with a target time, the command prints that it is waiting
  until that time (no "run the command again"), waits until it, and repeats the step in the same
  process with the claim it already holds. A target further ahead than the module's own bound, or
  a second `waiting` after the wait, is refused as today's other refusals are (no loop).
- The wait is injectable (the runtime's clock / a sleep function), so tests move a fake clock
  instead of sleeping.
- Nothing else about the command changes in this task; P2-9 removes the resume branch afterwards.

**Files:** `packages/provisioning/src/cli.ts` and whatever it calls for the step (find by name), the
hour module's `command` seat words in `packages/fiscal-verifactu/src/initial-hour-setup.ts` (the
fiscal package: this PR is the owner's to land anyway), `cli-first-setup.test.ts` (`runCliPastWait`
`:150` becomes one run; the case at `:168` "retains its settle wait and says why and until when"
keeps its assertions about why and until when, and now also asserts the run carries on).

- [ ] **Step 1: Failing tests first**: one run of the command past the settle wait finishes the
  step it stopped at before (fake clock moved by the injected wait), and never calls
  `recoverFirstSetupOwner` (spy); a target beyond the bound is refused.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** every case that used `runCliPastWait` passes in one run; `Tests` counts per file
  before and after in the report.
- [ ] **Step 5: Commit** (`git commit -s`).

### Task P2-9: The command line refuses a stopped setup (D5)

**Runs after P2-9a** (the command waits out the time check in one run, so refusing a retained
attempt at the start of a run no longer blocks a normal setup). `checkKept` and `finishFirstSetup`
have other callers (`first-fiscal-activation.ts:175`; two server tests): keep them.

**Files:**
- Modify: `packages/provisioning/src/cli.ts` (`:313-347`: a retained attempt whose status is
  `claimed` to `publication` throws `setup.attempt_conflict` before it checks the PIN, prompts or
  writes; other statuses keep `setup.attempt_uncertain`; `:424-430`, the resume branch, goes),
  `first-setup-command.ts` (delete `resumeFirstSetupCommand`, `:14-46`),
  `first-setup-command-activation.ts` (delete the `finishFirstSetup` branch `:64-73`; those statuses
  throw `setup.attempt_uncertain`), `first-setup-preparation.ts` (delete `preparation.resume`
  `:118-147` and the `resumeBinding` option `:27`), `first-setup-runtime.ts` (`resumeBinding`
  wiring `:266`), `first-setup-recovery-delivery.ts` (`checkKept`, only if `git grep` then shows no
  other caller)
- Test: `cli-first-setup.test.ts`, `cli-same-hour-entry.test.ts`, `first-setup-command.test.ts`,
  `first-setup-command-document.test.ts`, `first-setup-command-import.test.ts`,
  `first-setup-runtime.test.ts`, `first-setup-recovery-delivery.test.ts`

- [ ] **Step 1: Write the failing test** in `cli-first-setup.test.ts`:
  `"a stopped setup is refused setup.attempt_conflict, and nothing on disk changes"`, for a claimed
  and an `activation-started` attempt (snapshot both folders before and after; the output contains
  `setup.attempt_conflict {}`, as `:249` reads it). Delete the cases whose subject is the resume or
  finish branch: find them with
  `git grep -n "resumeFirstSetupCommand\|recoverFirstSetup\|finishFirstSetup\|commandResume\|preparation.resume" -- packages/provisioning/src/*.test.ts`,
  and move any assertion they hold about something else into a surviving case.
- [ ] **Step 2: Run, and watch the new case fail.**
  `pnpm --filter @waitron/provisioning exec vitest run src/cli-first-setup.test.ts`
- [ ] **Step 3: Implement**; delete the dead functions.
- [ ] **Step 4: Run** every test file named above; all pass.
  `git grep -n "resumeFirstSetupCommand\|resumeBinding\|preparation.resume" -- packages apps ':!*.md'`
  prints nothing.
- [ ] **Step 5: Commit.** The module seat's `resume`/`commandResume` now has no caller; P2-23
  removes it (D8).

### Task P2-10: Finish setup: sort its server test files (tests only)

The four files hold Finish cases and others (F2). A case whose subject is Finish, the publication
route or the reconfirm/document routes under `/resolution/` goes. A case about activation, Start
again, key stamping or anything else stays; if its file is deleted, it moves to a surviving suite
(the server activation suites, `first-setup-start-again*.test.ts`, or `first-setup-entry.test.ts`).
A kept case that reached its subject through Continue switches to reading the inspection without
signing in, as P2-6a does.

**Files:** `apps/server/src/first-setup-finish.route.test.ts` (every case is about Finish or its
publication route: delete the file after checking that), `first-fiscal-hour-finish.test.ts`
(`:304-548` name Start again and `:281` names key stamping: read each, they are expected to
stay), `first-fiscal-interruption.test.ts` (mostly activation: delete only what Finish or Continue
is the subject of), `first-fiscal-declared-publication.test.ts` (Finish cases include `:193`,
`:259` and `:352-411`; `:184` and `:434` are about activation and stay; read `:314` and `:338`).

- [ ] **Step 1:** For each file, list every case and say in the handover which goes, which stays
  and which moves, with one reason each.
- [ ] **Step 2:** Delete and move; record each file's `Tests` count before and after, and the
  count of moved cases.
- [ ] **Step 3:** Run every touched file and every file a case moved into; all pass.
- [ ] **Step 4: Commit**, the list in the message.

### Task P2-11: Finish setup: remove the code

**Files:**
- Modify: `packages/provisioning/src/first-setup-activation.ts` (delete `FirstSetupFinishDeps` and
  `finishFirstSetup`, `:221-262`; the `beforeComplete` hook and its comment `:216-217` if nothing
  else passes it), `packages/provisioning/src/index.ts` (`:159` and the Finish exports)
- Delete: `packages/provisioning/src/first-setup-finish-audit.ts` and its test,
  `apps/server/src/first-setup-finish-audit.ts`, `apps/server/src/first-setup-publication.ts`
- Modify: `apps/server/src/first-fiscal-activation.ts` (delete `finishFirstFiscalSetup`,
  `:167-197`), `apps/server/src/setup-first-fiscal-api.ts` (the `withPublication` option `:623`
  and the five Finish routes `:725-833`), `apps/server/src/first-setup-entry.ts` (`:4`, `:291-296`)
- Delete tests: the Finish cases of `packages/provisioning/src/first-setup-activation.test.ts`
  (`finishFixture` and the cases that use it, from about `:699`; the `resumeFirstSetup` set-up at
  `:885` moves to the claim's own key)
- Test: `apps/server/src/retired-first-setup-routes.test.ts`

- [ ] **Step 1: Write the failing test** in `retired-first-setup-routes.test.ts`:
  `"the repair entry no longer serves Finish setup"`: through `resolveFirstSetupEntry`'s app,
  `GET /setup-api/first-setup/resolution/publication` and `POST /resolution/{reconfirm,document,document-kept,finish}`
  each answer 404.
- [ ] **Step 2: Run, and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/retired-first-setup-routes.test.ts`
- [ ] **Step 3: Delete** the code and the Finish cases.
- [ ] **Step 4: Run** `src/retired-first-setup-routes.test.ts`, `src/first-setup-entry.test.ts`,
  `src/first-setup-resolution.boot.test.ts` (server) and `src/first-setup-activation.test.ts`
  (provisioning); all pass.
  `git grep -n "finishFirstSetup\|finishFirstFiscalSetup\|withFirstSetupPublication\|prepareFirstSetupFinishAudit\|withPublication" -- apps packages`
  prints only `apps/setup` (P2-16b, P2-17).
- [ ] **Step 5: Commit.**

### Task P2-12: Continue: remove its server routes

**Files:**
- Modify: `apps/server/src/setup-first-fiscal-api.ts` (routes `/resume` `:419-428`, `/recover`
  `:430-442`, `resolution/recover` `:692-723`; `START_AGAIN_ROUTES.recover` `:606`; the routes'
  comment `:603`)
- Delete: `apps/server/src/first-setup-recovery.route.test.ts` (its forwarded-HTTPS-header case,
  `:72`, now lives in P2-4a's stop tests; check it is there before deleting); the Continue case of
  `apps/server/src/start-again-full-disk.e2e.test.ts` (`:74`, "Continue's password step answers
  507"); the cases P2-6a to P2-8's handovers listed
- Test: `apps/server/src/retired-first-setup-routes.test.ts`

- [ ] **Step 1: Write the failing test:** `"no route takes the setup password to win the setup
  back"`: on `mountSetup` and on the repair entry's app, `POST /setup-api/first-setup/resume`,
  `/recover` and `/resolution/recover` with a well-formed body answer 404, and `first-setup.json`
  is unchanged.
- [ ] **Step 2: Run, and watch it fail.**
- [ ] **Step 3: Delete** the routes and tests.
- [ ] **Step 4: Run** the retired-routes suite, `src/setup-first-fiscal.route.test.ts` and
  `src/start-again-full-disk.e2e.test.ts` (on a small disk); all pass.
  `git grep -n "resolution/recover\|first-setup/resume\|first-setup/recover\|START_AGAIN_ROUTES.recover" -- apps/server`
  prints nothing.
- [ ] **Step 5: Commit.**

### Task P2-13: Continue: remove the owner's password recovery

**Files:**
- Modify: `packages/provisioning/src/first-setup-owner.ts` (delete `RecoverFirstSetupOwnerRequest`
  `:62-68`, `restoreOwnership` `:187-329`, `withResolutionPassword` `:332-358`,
  `recoverFirstSetupOwner`, `resumeFirstSetup` and `recoverFirstSetup` `:425-438`, and the
  `resolution`, `onOwnershipRecovered` and `assertRepairAllowed` options `:70-71, :84`),
  `first-setup-runtime.ts` (`onOwnershipRecovered` `:75, :129-133`),
  `apps/server/src/module-operation-host.ts:43`, `packages/provisioning/src/index.ts:89`
- Delete: `packages/provisioning/src/first-setup-owner-audit.ts` and its test,
  `apps/server/src/first-setup-owner-audit.ts`
- Test: delete the Continue cases of `packages/provisioning/src/first-setup-owner.test.ts` (`:83,
  126, 154, 312, 351, 366, 381, 427, 443, 490, 529, 571, 613`, and the `"resumed"` row of `:200`),
  moving what stays (the "move what stays" rule). At least these assertions stay and move into a
  surviving case: from `:571` ("retirement refuses existing owner capabilities and password
  recovery…"), that retirement refuses existing owner capabilities without rewriting the old
  state; from `:529` (`it.each(["complete", "interrupted-publication"])`), that a complete attempt
  is kept out of a new activation. Read `:366` ("rebinds a consumed unfinished attempt…") and
  `:381` (`it.each(["claim", "abandon"])`) the same way. Change the set-up of
  `first-setup-node-key.test.ts:187, 505` and `first-setup-runtime.test.ts:385` (they resume only
  to hold a fresh key: use the claim's own key, keeping every assertion)

- [ ] **Step 1: Write the failing test** in `first-setup-owner.test.ts`: `"the owner service offers
  no way to win a setup back with the password"`: the object `createFirstSetupOwner` returns has
  no `recoverFirstSetupOwner`, `resumeFirstSetup`, `recoverFirstSetup` or `withResolutionPassword`.
- [ ] **Step 2: Run, and watch it fail.**
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-owner.test.ts`
- [ ] **Step 3: Delete**, after moving what stays; the handover lists each moved assertion. `reconfirm`, `consumeReconfirmation`, `checkReconfirmation` and the
  `first-setup` password throttle stay (F10).
- [ ] **Step 4: Run** `src/first-setup-owner.test.ts`, `src/first-setup-node-key.test.ts`,
  `src/first-setup-runtime.test.ts` (provisioning) and `src/module-operation-host.test.ts` (server);
  all pass.
  `git grep -n "recoverFirstSetupOwner\|resumeFirstSetup\|recoverFirstSetup\|restoreOwnership\|withResolutionPassword\|createFirstSetupOwnerAudit\|onOwnershipRecovered\|assertRepairAllowed" -- packages apps/server`
  prints nothing.
- [ ] **Step 5: Commit.**

### Task P2-14a: The setup record drops the `resume` and `recover` events (D7)

**Files:**
- Modify: `packages/provisioning/src/first-setup-state.ts` (the `resume`/`recover` event kinds
  `:74-75` and their parser entries `:383-384`; the "unused" list `:620`; in `update`, the
  ownership branch `:723-724`, its allowed keys `:738-741`, the reopen rules `:746-749` (an
  abandoned attempt, and a `complete` one, take no change at all) and the `resume`/`recover` case
  `:783-792`; the store method `repairMarker` `:117-121, :636-655`, whose one caller,
  `restoreOwnership`, P2-13 deleted). **Keep** the `repairMarker` field that `readForRepair`
  answers: the inspection's `pair: "repairable"` reads it
  (`first-setup-resolution-inspection.ts:355-359`).
- Modify: `apps/server/src/first-setup-resolution.ts:99` and
  `apps/server/src/first-setup-unused-assignment.ts:30-31` (drop `resume` and `recover` from the
  lists)
- Test: `packages/provisioning/src/first-setup-state.test.ts` (delete the cases about the dropped
  kinds and the store's `repairMarker`, re-found by name, `:478, 497, 518, 536, 749, 865, 910, 928,
  949` in the first version, and leave those about `claimNonceHash` to P2-14b). The "move what
  stays" rule applies; at least these stay:
  - from `:749` ("keeps an interrupted completion out of trading while allowing a credential
    resume…"): the first half, up to `:774` — a `complete` record whose mark write failed makes
    `read()` refuse `setup.attempt_invalid`, and `readResumable()` answers `publicationComplete:
    false` with status `complete`. It becomes `"keeps an interrupted completion out of trading"`,
    and gains: a further change to it is refused `setup.attempt_conflict`.
  - from `:478` ("records valid public imports/checks and keeps them through a resume…"): the
    first half, that valid public imports and checks are recorded.

- [ ] **Step 1: Write the failing tests** in `first-setup-state.test.ts`: a record carrying a
  `resume` or a `recover` event is refused `setup.attempt_invalid`; an abandoned attempt refuses
  every change `setup.attempt_conflict`; the interrupted completion above refuses every change.
- [ ] **Step 2: Run, and watch them fail.**
  `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-state.test.ts`
- [ ] **Step 3: Implement**, after moving what stays. A box part way through a setup when this
  lands may be reset (pre-live).
- [ ] **Step 4: Run** the provisioning files touched, `src/cli-first-setup.test.ts`, and the
  server's `src/first-setup-start-again.test.ts`, `src/first-setup-start-again-repairable.test.ts`,
  `src/first-setup-stop.route.test.ts`; all pass.
  `git grep -n '"resume"\|"recover"' -- packages/provisioning/src apps/server/src ':!*.test.ts'`
  prints nothing that names a setup record event.
- [ ] **Step 5: Commit**, the moved assertions in the message.

### Task P2-14b: The setup record and the claim drop `claimNonceHash` and `clientClaimNonce` (D7)

**Files:**
- Modify: `packages/provisioning/src/first-setup-state.ts` (`claimNonceHash` in the record,
  `claim` and the parser `:93, :126, :333, :348, :664, :707`), `first-setup-owner.ts`
  (`claimFirstSetup` stops taking `clientClaimNonce`), `cli.ts` (its `claimFirstSetup` call),
  `apps/server/src/setup-first-fiscal-api.ts` (the claim body `:359-363` loses
  `clientClaimNonce`), and every server test helper that sends `clientClaimNonce` in a claim
  (`git grep -n "clientClaimNonce" -- apps/server packages/provisioning`)
- Test: the `claimNonceHash` cases of `first-setup-state.test.ts` (by name), moving what stays.

**Interfaces:** claim body `{ venue, configurationImport?, newTaxpayer? }`.

- [ ] **Step 1: Write the failing tests** in `first-setup-state.test.ts`: a record carrying a
  `claimNonceHash` is refused `setup.attempt_invalid`; a claim writes no `claimNonceHash`. In
  `apps/server/src/setup-first-fiscal.route.test.ts`: a claim body carrying `clientClaimNonce` is
  refused `setup.request_invalid`.
- [ ] **Step 2: Run, and watch them fail.**
- [ ] **Step 3: Implement.** The setup app still sends the field until P2-16b, so between the two
  commits a real server refuses the app's claim; both land in this one pull request.
- [ ] **Step 4: Run** the provisioning files touched, `src/cli-first-setup.test.ts`, the server's
  `src/setup-first-fiscal.route.test.ts` and every server file whose helper changed; all pass.
  `git grep -n "claimNonceHash" -- packages apps/server` prints nothing, and
  `git grep -n "clientClaimNonce" -- packages apps/server` prints nothing.
- [ ] **Step 5: Commit.**

### Task P2-15: The inspection drops `password` and `repairEligible`; the resolution record store goes (D4, D7)

**Files:**
- Modify: `packages/provisioning/src/first-setup-resolution-inspection.ts` (`:32, :35`,
  `:372-379`); keep `version: 2` (pre-live: no compatibility)
- Modify: `packages/provisioning/src/first-setup-resolution.ts`: delete the store
  (`createFirstSetupResolutionStore` `:289` onwards, `createFirstSetupOriginalsCache` `:280-288`,
  `ResolutionRecord`, `ResolutionInput` and the record validator), keeping
  `canonicalFirstSetupDirectory`, `canonicalFirstSetupRoots`, `firstSetupDirectory`,
  `RegisterAnswer`, `FirstSetupOriginal`; `index.ts:71` and the other exports
- Delete tests: `first-setup-resolution.test.ts`, `.durability.test.ts`, `.integrity.test.ts`,
  after moving any case about the kept helpers into a new `first-setup-directories.test.ts`; the
  cases of `first-setup-resolution-inspection.test.ts` (provisioning and server) and
  `apps/server/src/first-setup-resolution.boot.test.ts` that test the dropped fields
- Modify docs: `docs/developers/conventions-data.md:3421-3431` ("First-setup password recovery
  audit") becomes one dated line saying A1379 removed it

- [ ] **Step 1: Write the failing test** in `first-setup-resolution-inspection.test.ts`
  (provisioning): the inspection's keys are exactly
  `version, inspectionId, pair, database, revision, ownerGeneration, emptyDatabase, artifacts`.
- [ ] **Step 2: Run, and watch it fail.**
- [ ] **Step 3: Implement and delete.**
  `git grep -n "createFirstSetupResolutionStore\|createFirstSetupOriginalsCache\|repairEligible\|\"uncheckable\"" -- packages apps/server`
  prints nothing.
- [ ] **Step 4: Run** the provisioning files touched and the server's
  `src/first-setup-resolution-inspection.test.ts`, `src/first-setup-resolution.boot.test.ts`,
  `src/first-setup-start-again.test.ts`; all pass. Coverage: if deleting the store leaves a kept
  helper unreached, `first-setup-directories.test.ts` reaches it.
- [ ] **Step 5: Commit.**

### Task P2-16a: The setup app's session: a reload carries on (D3)

Behaviour only; the methods Continue and Finish use are deleted in P2-16b, with the page's calls
to them, so this commit compiles unchanged.

**Files:**
- Modify: `apps/setup/src/first-setup-session.ts` (`open()` sets `#proofRequired` only for a
  pending claim, `:166`; `REFUSAL_CAUSES` `:63-67` loses `trading-settings`; `refresh()` with a
  saved key, answered `{ claimed: true, resolution: true }` with no state (the box is on its
  repair page), drops the saved key and state and reports `recoveryRequired`, so the page reads
  the inspection)
- Test: `apps/setup/src/first-setup-session.test.ts`

- [ ] **Step 1: Write the failing tests** in `first-setup-session.test.ts`:
  - Replace `:382` with `"a reload with a saved key carries on: the status read sends the saved
    key, and the next change is sent with no password"`. Move what stays from `:382` first.
  - `"a claim whose answer was lost: after a reload the tab holds no key, reports
    recoveryRequired, and refuses every change setup.owner_required"`.
  - `"a duplicated tab holding the same saved key is refused before any HTTP while the first holds
    it"` (beside `:416`, with a saved owner).
  - `"a saved key the box answers from its repair page is dropped, and the tab reads as holding
    none"`.
  - `"a refused Start again cause the page has no words for is undefined"` for
    `"trading-settings"`.
- [ ] **Step 2: Run, and watch them fail.** Check `memory_pressure | grep free` first (real
  Chromium). `pnpm --filter @waitron/setup exec vitest run src/first-setup-session.test.ts`
- [ ] **Step 3: Implement.** The browser keeps its nonce for its lock names (`:168`).
- [ ] **Step 4: Run** the file and `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 5: Commit.**

### Task P2-16b: The setup app's session and client lose the way back in; the client gains the stop

**Files:**
- Modify: `apps/setup/src/first-setup-session.ts` (delete `resume`, `recover` `:344-369` and
  `finish` `:562` onwards)
- Modify: `apps/setup/src/api/client.ts` (delete `resumeFirstSetup` `:548-550`,
  `recoverFirstSetupOwner` `:556-566`, `finishFirstSetup` `:582-590`; add
  `stopFirstSetup(snapshot: FirstSetupResolutionSnapshot): Promise<{ restarting: true }>` posting
  exactly the snapshot to `/setup-api/first-setup/resolution/stop`; the claim body loses
  `clientClaimNonce` `:533-546`), `apps/setup/src/api/first-setup-types.ts` (inspection without
  `password` `:56` and `repairEligible` `:59`; `StartAgainRefusalCause` `:106` without
  `trading-settings`), the `apps/setup/test/*-browser.ts` fixtures (drop the two fields)
- Modify, to compile only: `apps/setup/src/setup-app.ts` — delete the calls to removed methods
  (`#resumeFirstSetup`'s `session.recover`/`resume`, the Finish send); the page's behaviour is
  P2-17 to P2-20
- Delete tests: `apps/setup/src/first-setup-finish.test.ts`; in `first-setup-session.test.ts` the
  resume cases `:217`, `:236-258`; in `api/first-setup.test.ts` the resume half of `:41` and the
  Finish case `:224`. The "move what stays" rule applies: the other half of `api/first-setup.test.ts:41`
  stays, and so does any assertion in `first-setup-finish.test.ts` about something other than
  Finish.

- [ ] **Step 1: Write the failing tests** in `api/first-setup.test.ts`: `stopFirstSetup` posts
  exactly the snapshot to `/setup-api/first-setup/resolution/stop`; a claim sends no
  `clientClaimNonce`.
- [ ] **Step 2: Run, and watch them fail.** Check `memory_pressure | grep free` first.
  `pnpm --filter @waitron/setup exec vitest run src/api/first-setup.test.ts`
- [ ] **Step 3: Implement and delete**, after moving what stays.
- [ ] **Step 4: Run** `src/first-setup-session.test.ts`, `src/api/first-setup.test.ts` and
  `pnpm --filter @waitron/setup typecheck`.
- [ ] **Step 5: Commit.**

### Task P2-17: The setup app without Finish setup

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (`#startFinishFirstSetup` `:1463` onwards, `firstFinishing`
  `:1089` and every branch on it, the Finish button `:2394-2406`), the review and email screens'
  Finish inputs (`publicationOnly`, `finishing`, `:2519-2567`), `screens/initial-owner-strings.ts`
  (`finish`, `finishReview`, `finishEmail`, `finishHelp`, EN and ES)
- Delete tests: `setup-app-finish.test.ts`, `setup-app-finish.a11y.test.ts`; the Finish case of
  `setup-certificate-refusal.test.ts:102` and of `setup-app-first-fiscal.test.ts:381`. The "move
  what stays" rule applies: an assertion in them about the certificate refusal's words, or about
  what the first-owner screen draws besides the Finish button, moves to a surviving case.

- [ ] **Step 1: Write the failing test** in `setup-app-resolution.test.ts`:
  `"an attempt that started activation offers Start again and Recover from backup, and no Finish setup"`
  (inspection `pair: "valid"`, state `activation-started`; no `[data-test=finish-setup]`).
- [ ] **Step 2: Run, and watch it fail.**
  `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`
- [ ] **Step 3: Delete** the Finish code and words.
- [ ] **Step 4: Run** `setup-app-resolution`, `setup-app-first-fiscal`, `setup-certificate-refusal`
  and the review and email screen tests; typecheck.
- [ ] **Step 5: Commit.**

### Task P2-18a: The repair page without the password step (item 1)

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (`#resumeFirstSetup` `:1214-1261`; the password field, its
  draft scope and block `:2230-2241, :2256-2271, :2342-2363`; the `uncheckable` line `:2342`;
  `#firstResolutionSnapshot` `:1263-1276` reads `revision` and `ownerGeneration` only;
  `refusalWords` loses `trading-settings` `:2222-2229`; the comment at `:1234` goes)
- Modify: `screens/initial-owner-strings.ts` (delete `resume`, `password`, `required`,
  `resumeHelp`, `uncheckable`, `tradingSaved`, `tradingSavedPassword`, EN and ES)
- Test: `setup-app-resolution.test.ts`, `setup-app-held-refusals.test.ts`,
  `setup-app-missing-database.test.ts`, `setup-app-wipe.test.ts`, `setup-app-recover.test.ts`,
  `start-again-wipe.test.ts`, `setup-app-first-fiscal.test.ts`. Delete the cases whose subject is
  Continue or its password (`setup-app-resolution.test.ts:76, 304, 322, 350, 367, 422, 440, 557, 1229`;
  `setup-app-missing-database.test.ts:83`; `setup-app-wipe.test.ts:108`;
  `setup-app-held-refusals.test.ts:89, 128, 164` and the `trading-settings` row of `:179`;
  `setup-app-recover.test.ts:138`; `start-again-wipe.test.ts:206`'s `trading-settings` row;
  `setup-app-resolution.test.ts:193-200, 1110, 1336`; `setup-app-wipe.test.ts:239, 327, 348`). The
  cases that used an uncheckable password to stand for "not offered" (`setup-app-wipe.test.ts:148, 294`,
  `setup-app-recover.test.ts:176`) use `pair: "invalid"`, `revision: null` instead, every
  assertion kept.

**Move what stays** (the rule above). At least these assertions are about behaviour that stays
and move into a surviving or new case, without the password:
- `setup-app-resolution.test.ts:367` ("does not collect a password when inspection fails, and
  retries the read on Reconnect"): Reconnect retries the read of the setup's state.
- `:557` ("reports a failed Reconnect read…"): a failed Reconnect read is reported.
- `:422` ("cancels Start again without losing the password draft or sending retirement"):
  cancelling Start again sends nothing.
- `:350` ("offers password recovery after a conflicting public ownership read"): what the page
  offers after `/setup-api/first-setup/status` answers `{ claimed: true, conflict: true }`. In its
  place: `"after a conflicting status read, the page reads the inspection and offers Start again
  and Recover from backup exactly when wipeOffered allows"` — on the ordinary server through the
  stop (P2-20); for a record that cannot be read (`pair: "invalid"`), neither, as the owner left it
  (Question 4).
- Any Start again or Recover from backup assertion in a deleted case.

- [ ] **Step 1: Write the failing tests:** `"the repair page draws no password field and sends no
  password"` (no `[data-test=resume-password]`, no `[data-test=resume]`; no request body carries
  `password`), and the moved cases above.
- [ ] **Step 2: Run, and watch them fail.** Check `memory_pressure | grep free` first.
  `pnpm --filter @waitron/setup exec vitest run src/setup-app-resolution.test.ts`
- [ ] **Step 3: Implement and delete**, after moving what stays; the handover lists each moved
  assertion and where it went.
- [ ] **Step 4: Run** every file listed; typecheck.
- [ ] **Step 5: Commit.**

### Task P2-18b: The repair page's error drawn once, phone width, and its changed words (items 3 and 4)

**Files:**
- Modify: `apps/setup/src/setup-app.ts` (the repair page's error and button layout),
  `i18n/strings/shell.ts` (`shell.first_setup.owner_required` `:4, :165` and `attempt_uncertain`
  `:6-7, :168-169`, per "Words for the owner")
- Test: `setup-app-resolution.test.ts`, `setup-app-resolution.a11y.test.ts`,
  `setup-app-held-database.a11y.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a refused Start again draws its message once"` (item 4): the refusal's text appears exactly
    once in `shadowRoot.textContent`.
  - `"at 375 px no two of the repair page's buttons overlap"` (item 3's last point): their bounding
    boxes do not intersect.
  - The new `owner_required` and `attempt_uncertain` words, EN and ES.
- [ ] **Step 2: Run, and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files listed; the a11y suites in both themes; typecheck. Look at the
  page at 375 px and at desktop width, both themes (CLAUDE.md §4, "Open it and LOOK"); screenshots
  stay in the implementer's working folder.
- [ ] **Step 5: Commit.**

### Task P2-19: A reloaded tab carries on where it was (D3)

**Files:** `apps/setup/src/setup-app.ts` (`#openFirstSession` `:1110-1134` and its callers
`#boot` `:786-812`, `#continueConnection` `:826-856`: after a refresh that leaves a live `claimed`
or `consumption-intent` state and `recoveryRequired` false, do what Continue's success did,
`:1247-1255`: `#acceptFirstIdentity()`, read the offerings, `#afterFirstOwner()`; for a live
`activation-started`, `committed` or `publication` state, what Continue's success did for those,
`:1248-1250`: the `first-owner` screen, which after P2-17 offers Start again and Recover from
backup, and on the ordinary server both go through the stop, which for these statuses only
restarts (D2)). Test: `setup-app-first-fiscal.test.ts`.

What each tab shows on the ordinary server (review fold I2), so that no state is left without a
way on:

| Status on the box | Reloaded tab holding the key | New tab, or a tab without the key |
| --- | --- | --- |
| `claimed`, `consumption-intent` | carries on where it was | Start again and Recover from backup, through the stop (which abandons, then restarts) |
| `activation-started`, `committed`, `publication` | the `first-owner` screen: Start again and Recover from backup, through the stop (which only restarts) | the same, through the stop (which only restarts) |
| `uncertain`, `abandoned` | refused `setup.owner_required` (`authorize`, `first-setup-owner.ts:171-186`, refuses `abandoned`; activation refuses `uncertain`): the `owner_required` words, then Start again through the stop (which only restarts) | the same |

- [ ] **Step 1: Write the failing tests**, replacing `:104` and `:345`:
  - `"a reload with a saved key carries on to the next step, sends no password, and claims and
    activates nothing again"` (the requests hold the status read and the offerings, nothing else;
    no secret draft comes back).
  - `"a reload while the box is on its repair page reads the inspection and offers Start again"`.
  - `"a reload after a failed activation draws Start again and Recover from backup, and no
    Finish setup"`, for `activation-started`, `committed` and `publication` (`it.each`).
  - `"a reload of an abandoned or uncertain attempt says this page no longer holds it and offers
    Start again"`.
- [ ] **Step 2: Run, and watch them fail.**
  `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `setup-app-first-fiscal`, `setup-app-resolution` and `first-setup-session`;
  typecheck.
- [ ] **Step 5: Commit.**

### Task P2-20: Start again from a page that does not hold the setup, on the ordinary server (items 1 and 6)

**Files:** `apps/setup/src/setup-app.ts` (the page remembers whether `/setup-api/first-setup/status`
said `resolution: true`; on the ordinary server, Start again and Recover from backup open the stop
confirmation, which says the stop cannot be undone and ends the setup for whoever is doing it
(review fold I7, CLAUDE.md §3: a destructive choice has a safe way back), with two buttons: Stop
this setup, which calls `api.stopFirstSetup(this.#firstResolutionSnapshot())` and then shows the
stopped words and Reconnect, and Cancel (the existing `cancel` word), which closes it and sends
nothing; `#reconnectFirstSetup` then lands on the repair page; a stop refused
`setup.attempt_conflict` draws `heldChanged`; a stop refused with any other code draws the words a
refused summary draws for that code, because the stop ran the same checks (D2));
`screens/initial-owner-strings.ts` (the stop words, EN and ES). Test:
`setup-app-resolution.test.ts`, `setup-app-resolution.a11y.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `"a new tab on the ordinary server offers Start again and Recover from backup, and Start again
    asks to stop the setup first"`: the status answers without `resolution`; pressing Start again
    draws the stop words and a `[data-test=confirm-stop]` button; confirming posts exactly the
    snapshot to `resolution/stop`; the page shows the stopped words and Reconnect.
  - `"Cancel on the stop confirmation closes it and sends nothing"`: no request to
    `resolution/stop`, and the page is as it was before Start again was pressed.
  - `"the stop confirmation says it cannot be undone and ends the setup for whoever is doing it"`
    (the stop ask's words, EN and ES).
  - `"a stop the box refuses as Start again would draws the summary's refusal words"` (for
    `setup.not_ready`), and no stopped words.
  - The same as the first case for a tab whose claim answer was lost (P2-16a's case).
  - `"on the repair page Start again goes straight to what it deletes"` (`resolution: true`: no stop
    step, no request to `resolution/stop`).
  - `"the owner's tab, after another page stopped the setup, says this page no longer holds it and
    offers Start again"`: a change answered `setup.owner_required` draws the new `owner_required`
    words; Reconnect, answered from the repair page, reads the inspection and offers Start again.
  - a11y: the stop confirmation in both themes.
- [ ] **Step 2: Run, and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files; typecheck; look at the stop confirmation at 375 px and desktop,
  both themes.
- [ ] **Step 5: Commit.**

### Task P2-21: Guide, docs, backlog and the owner's words

**Files:**
- Modify: `apps/server/src/guide/en/backup-recovery.md` and `es/backup-recovery.md`
  (`{#interrupted-setup}`): drop "continue with your setup password" (`:27` in English); say that a setup that saved its trading settings can be started again unless its
  database holds an invoice; say that while the box is still on its setup screens, Start again
  first stops the setup, which whoever is doing it cannot undo, and restarts the box. Write each
  sentence from the code; cut, do not reword, a sentence nobody acts on.
- Modify: `apps/server/README.md:48-56` (review fold M2): it still describes "ownership recovery
  with the setup password" and "publication-only Finish", and how to finish over HTTPS. Say what
  the repair page serves after this pull request (inspection, Start again's summary and Start
  again) and that the ordinary setup server serves the stop route.
- Modify: `docs/operations/first-live-fiscal-setup.md:97-115` ("Resume an interruption": no
  password recovery, no Finish), `docs/operations/recovery-document.md:28`.
  `docs/developers/testing-guide.md:3008-3014` stays: it records what ran on 2026-10-17.
- Modify: `docs/backlog/setup.md` "## Bundle A1379" (`:626-641`): delete A1322, the phone-width
  entry and the doubled-error entry with their detail sections; move "No Recover from backup when
  the setup's own record cannot be read" (owner: it stays) into the existing setup bundle that fits
  it best, named in the commit; delete the bundle and its index lines `docs/backlog.md:103, :395`.

- [ ] **Step 1:** Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`; both pass.
- [ ] **Step 2:** `git grep -n -i "setup password\|contraseña de configuración\|Continue with\|Continuar con tu\|tradingSaved\|ownership recovery\|publication-only Finish" -- apps/server/src/guide apps/server/README.md apps/setup/src docs/operations ':!docs/operations/a679-changed-checks.md'`
  prints nothing (the a679 file is a dated record).
- [ ] **Step 3: The pull request description**, written for the owner, who lands it:
  - First line: the fiscal-package changes (P2-1, P2-23) are the owner's to land.
  - Next lines (review fold M4): Question 1 as asked named "this node's id, `source = 'setup'`";
    the answer named the source alone, and D9 drops the node id because every row in a setup
    database is written by that setup and the seat is given only the database.
  - Review fold M9: the stop route, like Start again's, accepts a request that sends neither
    `Origin` nor `Sec-Fetch-Site` (`curl` on the LAN, for example); only the HTTPS check stops a
    page that rebinds a name to the box, and P2-4a proves that check by deletion.
  - The words table: every new, changed and deleted user-visible string on the branch, EN and ES,
    from
    `git diff fe36c18720 -- apps/setup/src/screens/initial-owner-strings.ts apps/setup/src/i18n/strings apps/server/src/guide`.
  - P2-5's measurement, and the owner decision it needs, if any.
  - The owner question of 2026-11-07 (P2-22), its answer if given, and which option was built.
- [ ] **Step 4: Commit** (the guide rides this pull request).

### Task P2-22: A setup saved as complete whose claim mark was not (review fold I3; Question for the owner, 2026-11-07)

**Risk: fiscal-adjacent** (it lets Start again delete a setup whose record says it finished). It
builds the recommended default of the owner question; if the owner picks option 2 before it is
dispatched, Step 3 changes as noted and the rest stands.

**Files:**
- Modify: `apps/server/src/first-setup-resolution.ts` (`assertHeldStartAgainOffered` `:76-90` and
  the missing-database refusal `:256`: refuse `setup-finished` only when the claim mark says
  `complete` too; `assessStartAgain` passes `retained.marker.status` from `readForRepair`)
- Test: `apps/server/src/first-setup-start-again-held.test.ts` (or a sibling
  `first-setup-interrupted-completion.test.ts`), using `heldSetup({ tradingSettings: true,
  certificate: true })` from P2-2 and P2-3

- [ ] **Step 1: Reproduce it by running.** Take the held setup to `complete` through the store
  (`publication`, then `complete`, as `first-setup-state.test.ts:752-768` does), but first copy
  `first-setup-claim.json` aside and put it back after the `complete` write: the record says
  `complete`, the mark still says `active`, which is exactly what a cut between the two writes of
  `persist` (`packages/provisioning/src/first-setup-state.ts:581-587`) leaves. Then show, each as
  an assertion: `readResumable()` answers `publicationComplete: false`; `resolveFirstSetupEntry`
  answers `kind: "resolution"`; `reconcileFirstSetupBeforeMode` leaves `config.node` undefined
  (`first-fiscal-mode.ts:28-31`); the summary refuses `setup.start_again_refused` with cause
  `setup-finished` (today's answer, recorded in the handover before any change).
- [ ] **Step 2: Write the failing tests** for the default:
  - `"a setup saved as complete whose claim mark was not: Start again deletes it"`: summary
    `fiscal-finished`, records 0, `expectStartAgainDeleted`. Before running, say what the failing
    case prints: `setup-finished`.
  - `"…and with an invoice beside it, Start again refuses kept-records"` (`invoices: 1`).
  - Control: `"a setup whose record and claim mark both say complete is still refused
    setup-finished"`, for a held database whose venue rows are gone (the one way such a box
    reaches the repair page: `needsResolution`, `first-setup-entry.ts:35-36`) and for a missing
    database.
  - Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-start-again-held.test.ts`;
    the first two fail on `setup-finished`, the control passes.
- [ ] **Step 3: Implement** the default. (Option 2 instead: the start finishes saving the claim
  mark when the record says `complete` and the mark `active`, before `needsResolution` reads them;
  then the first two cases become "the next start opens for business" and the control stays.)
- [ ] **Step 4: Run and pass, then prove by deletion**: comment out `assertNoKeptRecords(read);`
  (`:291`): the invoice case must fail. Restore. Remove the mark test (refuse every `complete`):
  the first case must fail; restore. If the deletion module refuses a file only a complete setup
  leaves, stop and report with the refusal's log reason.
- [ ] **Step 5: Commit.** The commit and the PR description name the owner question and that the
  default was built.

### Task P2-23: The fiscal module's `resume` seat goes (D8, review fold M8)

**Risk: fiscal** (it changes `packages/fiscal-verifactu` and the module contract). The golden
huella test and the immutability suite pass **unedited**, as in P2-1 Step 5.

**Files:**
- Modify: `packages/module/src/initial-setup.ts` (delete `commandResume` and `resume`, `:36-40`),
  `packages/fiscal-verifactu/src/initial-hour-setup.ts` (delete their implementations, `:143-157`),
  `packages/fiscal-verifactu/src/hour-preparation.ts` (delete `resume`, `:117-129`, if nothing else
  calls it), `packages/fiscal-verifactu/src/hour-selection.ts` (delete the engine's `resume`,
  `:536-540`, and the code in `perform` that only writes a new `resume` entry, if nothing else
  calls it)
- **Keep**: every line that reads a `resume` entry already in a stored series-name history
  (`hour-selection.ts:54-57, 133-174, 243, 325`), so a minute named there is still counted as
  taken (CLAUDE.md §5).
- Test: `packages/fiscal-verifactu/src/hour-resumption.test.ts` and any other test that calls the
  deleted functions (`git grep -n "\.resume(\|commandResume" -- packages/fiscal-verifactu/src packages/module/src`)

- [ ] **Step 1: Write the test that must keep passing**: `"a stored resume entry's minute is still
  taken"`: a series-name history holding a `resume` entry (written as stored data, not through the
  writer this task deletes) makes that minute's name refused as taken (read
  `hour-resumption.test.ts` and `hour-selection.ts:133-174` for how a taken name is found today;
  if a stored `resume` entry turns out not to mark its minute as taken, write what it does mark,
  and say so in the commit). This is a deletion, so no test fails first: the compiler and the
  `git grep` in Step 4 show the seat is gone, and Step 4's deletion proof shows the new case can
  fail.
- [ ] **Step 2: Run it, and see it pass before the change.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/hour-resumption.test.ts`
- [ ] **Step 3: Delete**, after moving what stays out of `hour-resumption.test.ts` (the "move
  what stays" rule): an assertion about how a stored history is read stays; one whose subject is
  writing a new resumption goes. If deleting the writer would change how a stored entry is read,
  stop at the last function that has no caller, and say so in the commit.
- [ ] **Step 4: Prove by deletion**: make the history reader skip `resume` entries
  (`hour-selection.ts:133`): the stored-entry case must fail. Restore. Run the fiscal guards of
  P2-1 Step 5, unedited.
  `git grep -n "commandResume\|preparation.resume\|hostedHourPreparation(.*).resume" -- packages apps`
  prints nothing.
- [ ] **Step 5: Commit.**

**As built (2026-11-09):** `commandResume` is renamed `commandBeforeActivation`, not deleted (see
D8); the Step 4 grep therefore prints nothing for `commandResume`.

### Task P2-24: Start again deletes an attempt cut off right after activation began, when nothing of it exists yet (the owner's option (b), 2026-11-08 13:38)

**The decision (owner, relayed by the watcher in `~/waitron-campaign-b/questions.md`, "WATCHER 2026-11-08 13:38 — OWNER DECIDED A1379 part 2: option (b)"):** Start again also deletes an attempt in `activation-started` or `uncertain` **only when its venue database is completely empty and nothing outside it exists** (no files, no backup copy, nothing else of that setup). Any other `activation-started` or `uncertain` attempt keeps today's refusal, with today's words. This replaces option (a), which the branch built as a default (keep the refusal; see the question at "WATCHER-NEEDED: LANE B 2026-11-08 06:15" in the same file).

**Why it exists:** since P2-9 the command no longer resumes a stopped setup, and since a78b1634bc the environment stamp is written only once activation has begun. If the box stops (or the stamp write fails) between moving the attempt to `activation-started` and writing the stamp, the venue database is empty past activation and Start again refuses with `setup.not_ready`; the page shows `wipeUnavailable` ("This box cannot confirm that deleting this setup is safe…"). The person has no terminal, so that is a dead end. The refusal comes from `assertHeldStartAgainOffered` in `apps/server/src/first-setup-resolution.ts` (`if (!holdsRecords) unavailable();`), because a held status whose inspection reads `no-venue-rows` and empty counts as holding nothing. Find the code by name; line numbers have moved.

**"Nothing outside it" — establish it from the code, never assume it.** Before writing the check, list every file, folder, row or copy a first setup can have written by the time its attempt reaches `activation-started` or `uncertain` (the environment stamp, `trading.env`, `modules.json`, a recovery-pack file, certificate files or rows, a backup or bucket copy, anything a module's activation writes before the venue database — follow the activation path in `packages/provisioning/src/first-setup-activation.ts`, `first-setup-runtime.ts` and the server's `first-setup-entry.ts` / `setup-first-fiscal-api.ts` to the places that write). Put that list in your report with a `file:line` for each writer. The new branch deletes only when the venue database is completely empty AND none of those exists other than the setup's own bookkeeping that Start again already removes for an earlier status; when in doubt about a thing, its presence refuses. Prefer reusing the existing held-setup reads and refusal helpers over a new inspection.

**Files (expected):** `apps/server/src/first-setup-resolution.ts` (the held-status check), the inspection if it must report the outside things, the matching held Start again test file (`apps/server/src/first-setup-start-again-held*.test.ts` — pick the one whose subject fits, or the end-to-end test a78b1634bc added for the refused command), the setup app's words only if a sentence becomes untrue, and every doc that states the old refusal: `packages/provisioning/README.md`, `docs/operations/first-live-fiscal-setup.md`, the command's sentence in `cli.ts` (grep "cannot confirm that deleting"). The golden huella test and `inmutabilidad` must pass UNEDITED; no schema or migration change.

- [ ] **Step 1: Write the failing tests** (the owner's three, verbatim in substance):
  1. Power stops between `activation-started` and the environment stamp, with an empty venue database and nothing outside it: Start again deletes it, and a fresh setup then succeeds (run the real fresh setup, as the a78b1634bc end-to-end test does). Same for `uncertain` (`it.each`).
  2. The same with one row in the venue database: refused, with today's wording (assert the domain code and the log reason, and that nothing was deleted).
  3. The same with an empty database but a file outside it (pick a file from your list that a real activation writes first; one case per kind of outside thing is not needed — one real one, plus the stamp): refused, nothing deleted.
- [ ] **Step 2: Run, and watch 1 fail and 2–3 pass** (they pin today's refusal).
- [ ] **Step 3: Implement** the narrowest change: only for `activation-started`/`uncertain`, only empty + nothing outside.
- [ ] **Step 4: Prove by deletion:** remove the "nothing outside" check → test 3 fails; remove the "empty" check → test 2 fails. Restore. Run the held Start again suites, `first-setup-resolution*` suites, the command's Start again suite, golden huella (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`) and `inmutabilidad`; typecheck the changed packages; `pnpm format:check`.
- [ ] **Step 5: Make the words true.** Every doc or string that says Start again refuses this case changes in this commit; say which in the report.
- [ ] **Step 6: Commit** (`git commit -s`), message naming the owner's choice of 2026-11-08 13:38.

## Words for the owner (proposed)

| PR | Key | English | Spanish |
| --- | --- | --- | --- |
| 1 | `shell.first_setup.disk_full` (unchanged after review) | Unchanged: a restart gives up the reserve only under 8 MiB free, or 16 MiB after a start that failed for a full disk (`releaseSpareToStart`, `apps/server/src/node-entry.ts`), while this message shows under 256 MiB, so naming the reserve promised more than the restart does. | Sin cambios. |
| 2 | stop ask (new, P2-20; changed by review fold I7) | To start again or recover from a backup, the box first stops this setup and restarts. Whoever is doing this setup, on this device or another, cannot carry on with it, and this cannot be undone. Then this page shows what would be deleted, and nothing is deleted until you confirm it there. | Para empezar de nuevo o recuperar desde una copia, el equipo primero detiene esta configuración y se reinicia. Quien esté haciendo esta configuración, en este dispositivo o en otro, no podrá continuarla, y esto no se puede deshacer. Después esta página muestra lo que se borraría, y no se borra nada hasta que lo confirmes allí. |
| 2 | stop button (new, P2-20) | Stop this setup | Detener esta configuración |
| 2 | stop cancel (P2-20, review fold I7; reuses the existing `cancel`) | Cancel | Cancelar |
| 2 | stopped (new, P2-20) | The setup is stopped and the box is restarting. Reconnect to continue. | La configuración está detenida y el equipo se está reiniciando. Reconecta para continuar. |
| 2 | `shell.first_setup.owner_required` (changed, P2-18b; today "Resume setup in its owner tab.") | This page no longer holds this setup. Reconnect to see what you can do with it. | Esta página ya no tiene esta configuración. Reconecta para ver qué puedes hacer con ella. |
| 2 | `shell.first_setup.attempt_uncertain` (changed, P2-18b; today "…Resume the saved attempt; do not assign it again.") | This setup may already have used its assignment, so it is not repeated. Reconnect to see what you can do with it. | Puede que esta configuración ya haya usado su asignación, así que no se repite. Reconecta para ver qué puedes hacer con ella. |

A stop the box refuses because the setup changed reuses `heldChanged` ("The setup changed after
this page read it. Try again."); a stop refused because Start again would then refuse draws the
words that refusal draws on the summary (D2); a stop over plain HTTP reuses whatever Start again's
own refusal draws (A1384's `wipeInsecure` once it lands). The guide's changed sentences (P2-21) go in the PR
description beside this table.

PR 2 deletes: "Continue with your setup password", "Administrator password", "Enter your
password.", "Enter the administrator password you chose during setup.", the "cannot check the
original setup password" line (`uncheckable`), the two trading-settings sentences (`tradingSaved`,
`tradingSavedPassword`), and the Finish setup words (`finish`, `finishReview`, `finishEmail`,
`finishHelp`), each in English and Spanish.

## After the tasks

PR 1: landed as #2521. PR 2: the fresh-context review of this PR 2 section ran on 2026-11-07 and
is folded in below ("Review fold (2026-11-07)"). The owner question of 2026-11-07 goes to the
watcher with this plan; P2-22 builds its default meanwhile. Then the tasks in the order above;
`/finish-branch` in this worktree with this plan as its note; the PR's first line says the
fiscal-package changes are the owner's to land; lane B marks the item `needs-owner-review` and
tells the watcher.

## Review fold (2026-11-06)

A fresh-context review found one critical, six important and two minor points. All were taken.
C1 (the certificate row) became Question 1 and PR 2 Task P2-1. I1 added the same-origin and JSON
checks to the stop route. I2 made "keep going on the held key" the default. I3 placed six tests in
the tasks that break them. I4 dropped the seat-removal task. I5 states series-name reuse. I6 split
two tasks. M1 corrected the search. M2 added two stop-route tests. The work is now two pull
requests: PR 1 needs no owner answer.

## Review fold (2026-11-07)

A fresh-context review of the PR 2 section (`waitron-campaign-b/a1379p2-plan-review.md`) found
seven important and nine minor points and four tasks too large. Each was checked against the code
at the line it cited before it was taken; none was found wrong. What was done:

- **I1** (a stop the repair page then refuses leaves a dead end). Checked: an abandoned attempt
  takes the "present" path (`first-setup-resolution.ts:175-179, 251`) and needs
  `presentAttemptEligibility` (`:140-162`); P2-14a makes it take no change. D2 and P2-4a: the stop
  runs `assessStartAgain` first and refuses, writing nothing, if Start again would refuse; the
  check gives the same answer for `claimed` and `consumption-intent` as for `abandoned` (D2 says
  why). P2-4b pins the states in each table. "Held" rewritten.
- **I2** (the stop refused exactly the stuck setups). Checked: the activation route restarts only
  on success (`setup-first-fiscal-api.ts:246`), `/abandon` does not restart (`:568-578`), and
  `needsResolution` sends every later status to the repair page (`first-setup-entry.ts:36-46`).
  D2 and P2-4a: for those statuses the stop writes nothing and only restarts. P2-19 gains a table of
  what each tab shows for each status; P2-4b, P2-19 and P2-20 test them.
- **I3** (a setup cut off between saving itself as complete and saving its claim mark). Checked:
  `persist` writes the record, then the mark (`first-setup-state.ts:581-587`); Start again refuses
  `complete` (`first-setup-resolution.ts:89, 256`). Neither the owner's answers nor A1322 settle it
  (A1322 says "a failed setup always offers Start again"; D1 kept `setup-finished`), so it is the
  "Question for the owner (2026-11-07)" above, and the new P2-22 reproduces it by running and
  builds the recommended default (Start again deletes it).
- **I4** (damage in one fiscal table could hide a dashboard certificate row). Checked at
  `first-setup-database-holdings.ts:233-243`. D9 and P2-1: the count is a new seat run as its own
  step, not a field of the holdings answer; D9 says why that is simpler than marking the table kept
  when the step fails. P2-1 gains the damaged-table case and a third deletion proof.
- **I5** (deleted tests that also pin behaviour that stays). A "move what stays" rule now heads the
  PR 2 tasks, and P2-6a to P2-8, P2-13, P2-14a, P2-16b, P2-17, P2-18a and P2-23 each name the
  assertions the review listed (`first-setup-state.test.ts:749, :478`;
  `first-setup-owner.test.ts:366, 381, 529, 571`; `setup-app-resolution.test.ts:350, 367, 422, 557`).
- **I6** (P2-5 could measure nothing). Checked: the copy is made whenever the `-wal` is not empty
  (`read-only-database.ts:20`), and a clean close deletes it. P2-5 rewritten to measure the files a
  simulated crash leaves, with what the failing case prints and two controls (no copy must pass; a
  copy larger than the room must fail). It blocks nothing: a size that does not fit is pinned and
  the owner decision recorded.
- **I7** (the stop words hid that it cannot be undone). The stop ask now says it ends the setup for
  whoever is doing it and cannot be undone; P2-20 adds a Cancel that sends nothing, with a test;
  "Words for the owner" updated.
- **M1**: `first-setup-key-reissue.boot.test.ts` added to P2-8, keeping the claim's own key.
- **M2**: `apps/server/README.md:48-56` added to P2-21, and its search widened.
- **M3**: P2-1 Step 5 now says `fiscal-verifactu` has no Stryker set-up (checked with
  `git ls-files | grep stryker`).
- **M4**: P2-21's PR description says why the node id was dropped (D9).
- **M5**: P2-4a's tests hold `venue.db` open as the ordinary server does, and carry over the
  forwarded-HTTPS-header case from the recovery route test P2-12 deletes.
- **M6**: the stop route is served only when the server can restart itself (D2, P2-4a, with a
  404 test).
- **M7**: D5 is cited as a builder decision the owner accepted.
- **M8**: D8 reversed: the seat's `resume` and `commandResume` go in the new P2-23, which keeps
  every read of a stored `resume` entry. This undoes the 2026-11-06 fold's "I4 dropped the
  seat-removal task" for the writers only; that fold kept the seat because of the stored
  history, which P2-23 keeps.
- **M9**: D2 and P2-21's PR description say the stop route, like Start again's, accepts a request
  with no page headers.
- **Task size**: P2-4 → P2-4a (route) and P2-4b (follow-through); P2-16 → P2-16a (session
  behaviour) and P2-16b (deletions, client, types, fixtures, compile fixes); P2-18 → P2-18a
  (password step) and P2-18b (error once, phone width, words). P2-14 → P2-14a (events) and
  P2-14b (claim nonce); P2-6 → P2-6a and P2-6b, the fixture's `signIn` deleted last.
