# A993 — a change of producer opens a new fiscal installation by itself: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: plan, refreshed 2026-11-22 on `main` at `dbf567d417`, revised after fresh reads 1, 2
and 3 (`~/waitron-campaign-l/receipts/a993-plan-read-{1,2,3}.md`) and the owner's answer of
2026-11-22. Cleared by the watcher 2026-11-22 12:41, who also took decision 12 as recommended
(`~/waitron-campaign-l/questions.md`, "WATCHER 2026-11-22 12:41"); the owner answered "yes" to
decisions 3 and 7 on 2026-11-22 12:52 (same file, "WATCHER 2026-11-22 12:52 — OWNER: A993
decisions 3 and 7: yes to both"). Building from 2026-11-24 on `main` at `9f25456694`; a
`file:line` below that has moved since `dbf567d417` is re-found by name. Fiscal: the owner lands
every pull request.** Besides the `git grep`/`grep` commands quoted, the things run are listed in
"Changed after the owner's answer" and "Changed after read 3". What no longer held from the
2026-11-11 version is in "What changed since 2026-11-11"; what each review changed is in the
"Changed after" sections.

**Goal:** a production box upgraded to a release whose producer differs from its chain's opens a
new installation (new chain, new five-symbol installation name, new series from 1) by itself and
trades, but only when the upgrade's own note names that new producer; any other start with a
different producer refuses `sif.producer_changed` as today.

**Architecture:** A950's checked upgrade, the path every install on a running box takes, works out
from the old and new images whether the release changes the producer. If it does, the host writes
a note naming the release, the new producer and the old one: into the copy each check runs on, and,
once every check has passed, into the box's live state folder during the stop. The new release
reads the note at its start. When the note names this release, this producer and the chain head's
producer, the start does not refuse. Instead the start keeps waiting for its time, which already
holds every sale and record, until the installation is open: a confirmation that arrives while the
note waits is held, not applied, and the wait ends only once the opening has committed. The opening
runs at the start's own look when the box's time service is synchronised, and otherwise at the
clock watch's next look after a person confirms the time on a till or on Box status through the
existing routes (decisions 3 and 4). Each attempt checks again, inside its transaction, that the box
is still the venue's only box and its serving primary. The stopped sale check runs the same opening
on its copy before the live data is touched. A start with no note, or a note naming something else,
refuses `sif.producer_changed` as today. The opening uses the activation that restore and the conflict
switch already use (`withHourAdmission` → `activateModuleAllocation` → the writes at
`allocation.ts:435-478`), with a new action `identity-change` whose authority only the fiscal
module's own step can mint.

**Tech stack:** TypeScript, Vitest, `node:sqlite` through drizzle, the host upgrade driver
(`scripts/box/upgrades/*.mjs`, plain Node).

**Spec:** [A940 design §5.6](../specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993).

Terms. **Producer**: who makes the software and signs its declaration; every Veri\*Factu record
names its tax number. **Installation**: one copy of the software at one taxpayer, named by five
symbols for the UTC minute it was opened, with its own chain of records and invoice series.
**Note**: the file `identity-change.json` the upgrade's host writes into a state folder, naming the
release being installed, its producer, and the producer it replaces (decision 6). Earlier versions
of this plan called it the marker and handed it over as an environment value; A950's own code uses
"marker" for its attempt file, so this plan no longer does.

## Authority

- Design approved, owner 2026-10-22 about 02:45; way A chosen about 02:55 ("the upgrade changes
  only while it can read the internet's clock, and otherwise the old release keeps selling …; in the
  stuck case the page also accepts a phone's or a till's clock"); countdown about 03:12 (design §11).
- Owner 2026-11-06 about 18:13 (`~/waitron-campaign/questions.md:2416`): "(2) Once A993 exists, a
  start opens a new installation for a producer difference only when the upgrade's own marker names
  that same new producer; otherwise it keeps refusing."
- Owner 2026-11-21 18:17 (`~/waitron-campaign-l/questions.md:1033`): "build it".
- Owner 2026-11-22, relayed by the watcher: "why are two box venues refused? there should be no
  releases started by hand, so no need for a guard. We already have a solution to setting the time,
  why limit it to internet time?" Then, on two-box venues, the owner chose "Build A993 single-box
  now": two-box venues get the producer change with the paired-upgrades backlog item.
- Standing rules: no venue is live, so no compatibility code (CLAUDE.md §3); the placeholder
  producer may be replaced once before any production start (CLAUDE.md §5).

## What it delivers, and what it does not

- **Usable after PR 3:** a single production box upgraded through the checked upgrade to a release
  naming another producer opens its new installation at the new release's first start whose time is
  confirmed, and trades on it:
  - at once, before its first answer, when the box's time service is synchronised;
  - otherwise, once a person confirms the time on a till or on Box status (decision 3; built only
    with decision 12).
  Records already made keep the old producer and are sent unchanged (`drain.ts:648` groups by SIF).
- **Limited by A950, not by this plan, unless decision 12 is taken:** the checked upgrade's copy
  sale fails every upgrade whose box's time service is not synchronised at that moment
  (`upgrade-sale.ts:161-163`, run below). So without decision 12, such a box gets no upgrade at
  all, and the person route (Tasks 6a and 6b) is not built: it would serve only a time service lost
  between the copy sale and the new release's start.
- **Still unavailable:**
  - a two-box venue: the checked upgrade refuses any box with a partner, or whose role is not
    serving primary ("paired upgrades are not available", `assertSingleBox`, `host.mjs:500-556`).
    The owner chose this on 2026-11-22; the producer change comes to two-box venues with the
    paired-upgrades point of A950's backlog entry (`docs/backlog.md`, "Automatic upgrades with
    rollback");
  - a box given the new release any other way (a hand-run `docker compose up`): there is no note, so
    it refuses `sif.producer_changed`, and the recovery page says to install it as an upgrade;
  - a change of the two-character code or of the fiscal mode.

## Global constraints

- `computeHuella`, `chain.ts`, invoice-number allocation, `registros_facturacion` and its triggers,
  `recordSale`/`recordCorrection`/`recordSubstitution` do not change. Every PR runs
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  **unedited**. A task that finds it needs any of these changed stops and asks the owner.
- No schema change, so no migration and no venue reset.
- Production only. A preproduction box keeps trading on its chain under the new producer, as Task 8
  of A940 built and the owner accepted (fiscal.md, A993).
- The name follows CLAUDE.md §5's restore and promotion rules where they can be met: five symbols for
  the box's UTC minute (`encodeMinuteIdentity`); a second clock (`compareHourClocks`,
  `hour-clock.ts:67`, with the release floor `readHourRelease`); never a minute in the history the
  box reads (`readHourHistory`, `hour-history-reader.ts:200`). The second clock is the box's time
  service being synchronised (`observeTimeServiceHourClock`, `hour-clock-time-service.ts:12`), or a
  person's confirmation of the start's time while the box's clock has not stepped since. The second
  is weaker than §5 asks for a restore or a promotion, in the six ways decision 3 states. Two
  devices alone are never used.
- Database writes go to `venue.db` only (the four tables `allocation.ts:435-478` writes). The note is
  a file in the state folder. Only the upgrade's host writes it. The server deletes it once the
  opening commits; a plain reset deletes it; and A950's Restore removes it with every other file the
  copy taken before the stop does not hold (`copy.mjs:73-75`).
  Nothing in `node.db` changes, so the two-file order rule does not arise (read, not run).
- FULL review path (fiscal invariants). Every PR also runs the root's
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts`.
- **No behaviour change until PR 3.** PRs 1 and 2 touch code every activation, every upgrade check
  and every start runs through, and nothing writes a note until PR 3. These suites prove it
  unchanged: their existing cases run **unedited**, and a task may only add cases to them:
  - fiscal-verifactu: `src/allocation-envelope.test.ts`, `src/allocation.test.ts`,
    `src/hour-throwaway-allocation.test.ts`, `src/hosted-hour-recovery.test.ts`,
    `src/hour-selection.test.ts`, `src/producer-change.test.ts`;
  - server: `src/upgrade-trial.test.ts`, `src/upgrade-sale.test.ts`,
    `src/boot.producer-change.test.ts`, `src/boot.start-clock-gate.test.ts`,
    `src/clock-unconfirmed-gate.test.ts`, `src/start-clock-check.test.ts`,
    `src/till-box-clock-api.test.ts`, `src/box-health-api.test.ts`, `src/clock-watch.start-up.test.ts`;
  - till: `src/i18n/staff-notices.test.ts`.

  Decision 12, if taken, reverses no case: the server is unchanged, and the helper's tests are new
  (Task 9).

## What changed since 2026-11-11

1. **A950 built the checked upgrade.** Every install on a started box goes through
   `cmd_checked_install` (`deploy/waitron.sh:1098`, called at `:1279-1288`) into
   `scripts/box/upgrades/cli.mjs:332-431`. The steps:
   - an online trial on a copy while the old release sells (`host.mjs:758`, called at `:284`);
   - stop, then a stopped copy;
   - readiness and a real sale on a second copy (`candidate.mjs:40`);
   - Restore or Keep, or an automatic restore (`transaction.mjs:144-202`).

   The old slice 2 (a new server command inside `waitron.sh install`) is replaced by the host
   driver and the existing checks. The old citations `waitron.sh:765-783`, `:401-442` and `:676` no
   longer describe the path.
2. **Those checks already refuse a producer change.** `checkUpgradeData` calls
   `checkFilingIdentity` (`upgrade-checks.ts:89-90`), so today such an upgrade fails at the online
   trial and the old release keeps selling (read, not run).
3. **The copy sale already needs the time service synchronised** (`upgrade-sale.ts:161-163`). The
   stopped checks have a clock relay (`candidate.mjs:72,81`); the online trial has none
   (`host.mjs:776-803`).
4. **"The internet's clock" is now the box's time service.** `hour-clock-internet.ts` is gone. The
   `internet` source means the host reports the time service synchronised
   (`hour-clock-time-service.ts:12-58`). CLAUDE.md §5: a synchronised time service carries a new
   name on by itself.
5. **A947 4a landed.** Admission takes the five-symbol minute (`allocation-envelope.ts:451`). The
   actions are `setup`, `restore`, `promote`, `conflict-switch`. A one-shot allocation that skips
   the saved selection exists, `hour-throwaway-allocation.ts:19-101`, and is the template here.
6. **Backup verification checks every stored approval's shape** (`backup-verification-history.ts:133-158`;
   the operator parser is `allocation-operator.ts:13-25`). So the plan reuses an existing shape
   (decision 5).
7. **Line moves.** The refusal runs at `boot.ts:2595-2598`. The seat method is
   `fiscal-verifactu/src/backend.ts:789`, and its interface is `packages/fiscal/src/backend.ts:499`
   (not `:605`).
8. **A940 slices 4 and 5 (#2987, #3001, #3014, #3051).** A production start of a build that is not
   a release refuses `server.unreleased_build`, so `softwareVersion()` names a release. The
   producer is the image's own `ENV` (`deploy/Dockerfile:316-324`), which compose does not pass
   (`deploy/compose.yml:18-40`). Kept declarations need nothing.
9. **Asesor Q53(d)(2) is already widened** (`docs/compliance/asesor-questions.md:2080-2081`).
10. **`tenants` became `taxpayer`** (A1308 vb1). Its writers change only the legal name and the
    domicile (`taxpayer-name.ts:18,45`).
11. **Dropped:** the old question 0 (answered), the activity-log line (the `fiscal_allocations` row,
    `allocation.ts:466-478`, is the record) and the A1308 collision note (no column is added).

## Changed after read 1

- **I1:** the step checks whether there is anything to open before it reads the clock, and checks
  again inside its transaction (Task 2).
- **I2:** read 1 found that a start which waits for its time is counted as a failed start
  (`node-entry.ts:300-310,903-915`), and that it fails A950's resume, which runs
  `docker compose up --wait --wait-timeout 180` (`host.mjs:641`). A failed resume leaves the
  attempt committed but not cleaned up, so later applies are refused (`cli.mjs:379-380`). The design
  then changed so that no start waited. **Superseded 2026-11-22:** that wait was this plan's own
  in-boot wait, not the ordinary start-clock wait, which has neither problem; see "Changed after the
  owner's answer".
- **I3:** the checks task drops its role and fencing reads. A box that reaches the checks is always a sole
  serving primary (`host.mjs:500-556`). The two-box limit is stated above. **Superseded after
  read 3:** that holds at the upgrade, but the opening now runs later, in the running server, and
  can wait hours; so the opening checks the box's role again inside its transaction (decision 9,
  Task 3).
- **I4:** PR 3's documents task lists every stale receipt (Task 10).
- **M1:** `nextHourMinute` is dropped (decision 9).
- **M3:** the readers of the reused shape are named, and the stale comment is fixed (decision 5).
- **M4:** "no behaviour change" replaces "nothing a box can reach".
- **M5:** the wording is corrected (Task 1, Task 4, decision 10).
- **M6:** the old Task 3 is split (Tasks 2 and 3), the old Task 8 is gone, and the old Task 10 is
  split.
- **Rejected:** none.

## Changed after read 2

Read 2 is `~/waitron-campaign-l/receipts/a993-plan-read-2.md`.

- **C1:** read 2 ran the real locks. During the stop, the host holds `recovery.lock` and
  `venue/venue.lock` (`holdUpgradeState`, `host.mjs:452-482`, taken at `:324-326`), so a live step
  calling `lockVenueDatabase` (`upgrade-checks.ts:50`) is refused with
  `provisioning.database_in_use`. The fix then was a live step running under the host's hold.
  **Superseded 2026-11-22:** no container opens the live database during the stop any more; the
  host writes the note itself under its own hold (decision 11).
- **I1:** once the installation is opened, the chain head is empty (`allocation.ts:448-454`), and
  the start check passes an empty chain (`producer-change.ts:31`). **Answered 2026-11-22:** no guard
  (decisions 1 and 2).
- **I2:** manual mode leaves the box stopped until Restore. Keep's refusal moves into
  `transaction.mjs:227` (Task 8). Still true for a failed check.
- **Minors:** three more stale texts are listed (Task 10); where the opening is recorded is stated
  (decision 11); an interrupted-upgrade test is added (Task 8). The live container's name and label
  no longer arise.
- **Rejected:** none. Each finding matched the code I read (`host.mjs:452-482`,
  `transaction.mjs:194-199,227-232`, `candidate.mjs:13-17,76-92`, `waitron.sh:44`, `CLAUDE.md:692`).

## Changed after the owner's answer (2026-11-22)

- **The guard is dropped** (decisions 1 and 2), on the owner's words: "there should be no releases
  started by hand, so no need for a guard."
- **The two-box limit stays**, by the owner's choice "Build A993 single-box now". One line in
  `docs/backlog.md`, at A950's paired-upgrades point, says the producer change comes with it.
- **The time.** The owner asked "We already have a solution to setting the time, why limit it to
  internet time?" The opening moves out of the upgrade's stop into the new release's start, where
  the existing confirmation lives (decisions 3, 4, 6 and 11; tasks rewritten). Why it cannot stay in
  the stop, and what still limits it, is in "Why the existing confirmation cannot be used".
- **What I established, and how** (receipts for the new design):
  - **The ordinary start-clock wait keeps the server up.** The start asks the time service before
    the listener opens and then carries on (`boot.ts:3931-3945`); `/health` does not read the clock
    (`healthSnapshot`, `health.ts:144-180`). Run: a throwaway copy of
    `apps/server/src/boot.time-service.test.ts` (deleted afterwards) started a box that files records
    with its time service answering not synchronised. It read the start's state as `waiting`, read
    it again 15 seconds later (past the duties' first pass) as still `waiting`, and fetched `/health`:
    200, every duty `stale: false`. The failing case would have printed 503 or timed out in the
    file's `vi.waitFor` for 200. Control: the same case with the time service synchronised read
    `by_internet`, so the state check tells the two apart; it also answered 200.
  - **It is not a failed start.** The failure count clears once `startServer` resolves and the
    process stays up (`node-entry.ts:903-915`); `fullyStarted` is set only on a box that answered
    while waiting for its peers (`node-entry.ts:300-306`). The ordinary wait resolves `startServer`
    with the listener open. Read, not run.
  - **Sales wait; the kitchen does not.** The gate wraps only the route check and the four record
    writers (`start-clock-gate.ts:8-14,29-45`); CLAUDE.md §5 says orders still reach the kitchen.
    Read, not run.
  - **Who may confirm, and through which routes:**
    - the box's time service, at the start and at every look of the clock watch
      (`lookAtClockService`, `start-clock-check.ts:173-178`);
    - two enrolled devices within 5 seconds (`start-clock-check.ts:11,106-115`);
    - on a till, `POST /api/box-clock/challenge` then `/api/box-clock/confirm`
      (`till-box-clock-api.ts:103`). Any staff member the till's profile admits may use it until the
      internet confirms the start, and an administrator, signed in or by PIN, while it waits
      (`:98-102`). The confirm takes one of three shapes: a reading within 60 seconds of the box
      (`CLOCK_WITNESS_MARGIN_MS`, `packages/fiscal/src/clock-witnesses.ts:1`; `:258-260,316-336`),
      "keep the box's time", which reads nothing from the till (`:280-314`), or a set of the box's
      clock from the till;
    - on Box status, a Box administration holder (`system.box_admin`): `POST /api/box/clock-confirm`
      (`box-health-api.ts:267-310`), which receives no device time (the browser compares its own
      clock within 60 seconds, `box-status-screen.ts:37,439-462`, or confirms the time as shown,
      `:498-520`), and `POST /api/box/clock-set` (`:218-265`).
  - **Read 1's I2 named a different wait.** Read 1 described this plan's own earlier in-boot wait:
    no listener at all, or a page answering 503 as the restore's waiting start does
    (`start-clock-waiting.ts:66-73`), whose attempt node-entry takes back off. The ordinary
    start-clock wait answers `/health` with 200 (run above), so A950's resume, which waits for the
    container's health check on `/health` (`compose.yml:60-70`, `host.mjs:641`), would pass. That is
    inferred; I did not run a resume. But an ordinary upgrade onto a box whose time service is not
    synchronised does not reach the resume today, because the copy sale fails first. Run:
    `pnpm exec vitest run src/upgrade-sale.test.ts -t "has not confirmed"` in `apps/server`:
    1 passed, 2 skipped. That case expects `checkUpgradeSale` to reject with `clock.unconfirmed`.
    Automatic mode then puts the old release back (`transaction.mjs:194-199`); manual mode waits for
    Restore or Keep, and only Keep reaches the resume (`:227-231`).
- **A note replaces the environment value.** The running app must now know an opening is allowed,
  so the note reaches it, through the live state folder only (decision 6). The live `open` check
  mode, its container, the trial's clock relay and decision 11's lock exception are gone.
- **New decision 12** (★): whether the copy sale may run on a box whose time service is not
  synchronised. It applies to every upgrade.

## Changed after read 3

Read 3 is `~/waitron-campaign-l/receipts/a993-plan-read-3.md`. Each finding was checked against
the code on this tree before the plan changed. What I ran, each probe in a throwaway test file that
I deleted afterwards (`git status --short` showed only the plan and `docs/backlog.md` changed):

- **The waiting notice once a person confirms** (`apps/server/src`). A start-clock state, its
  waiting-notice source and today's gate: before the confirmation the notice was present and the
  gate held; after `confirm("by_person")` it printed
  `{"waits":null,"gate":false,"confirmed":1,"status":"by_person"}`. So a confirmation removes the
  notice and opens today's gate at once. `1 passed (1)`.
- **The shared minute rule** (`packages/fiscal-verifactu/src`, a copy of `hour-selection.test.ts`
  with two cases). A promotion whose history holds only a minute a day ahead was given the current
  minute, `0CNNW`. Control: with the current minute used, it was not given it, and waited for the
  next minute (`{"status":"waiting","targetMs":1792150860000,"remainingMs":60000}`).
  `2 passed | 119 skipped`.

The findings:

- **I1 (accepted).** Confirmed by the first probe and by reading `clock-unconfirmed-alert.ts:25`,
  `clock-correction.ts:208-209` and `box-status-screen.ts:412,458`. Changed: while a note waits,
  a confirmation is held and the start stays waiting until the opening commits (decision 4,
  Task 5a), so the notice, the alert and Check the time stay and the gate needs no new input. The
  minute rule is now restore and promotion's (decision 9; second probe). A refusal that is not about
  the clock raises `sif.identity_change_blocked` (decision 7). Today's waiting words promise that
  two devices end the wait (`apps/till/src/i18n/strings.ts:2225-2226`), which is false while a note
  waits, so new words are unavoidable; decision 7 lists them for the owner.
- **I2 (accepted, in a different form).** Confirmed by reading `background-duties.ts`,
  `job-catalogue.ts:26`, `boot.ts:2813` and `handover-stepdown.ts:181-213`. Changed: there is no
  retry loop of this plan's own. The opening runs at the start's own look and in the clock watch's
  look, a job the runner stops at a stepdown and on a failed start, so no new duty needs
  registering. The box's role is checked again inside the opening's transaction (decision 9,
  Tasks 3 and 5b). What stays unproved is under "Not established".
- **I3 (accepted).** Confirmed: the relay is `host.mjs:696-743`, used only at `candidate.mjs:72`;
  nothing in `scripts/box/upgrades` asks the time service before the stop (read 3's search; I did
  not repeat it); there is no Restore once an upgrade is kept (`transaction.mjs:216`). Changed:
  decision 12 is now the helper's form (the relay tells the copy its time is synchronised), with
  its cost in plain words; the server bypass and its weak guard are dropped (Task 9); Tasks 6a and
  6b are built only with decision 12.
- **M1 (accepted):** decision 7 rewritten; `sif.identity_change_waiting` reaches only the log.
- **M2 (accepted, made moot):** the opening no longer hangs off `onConfirmed`, which runs inside
  the confirming transaction (read 3's run 1). It runs only from the start's look and the clock
  watch (decision 10), so there is no double call at the start.
- **M3 (accepted):** citations corrected: `allocation.ts:448-454`, `candidate.mjs:40`,
  `cli.mjs:379-380`, `apps/server/src/i18n/recovery-page.ts`,
  `packages/module/src/operation-authority.ts:51`, the capture and trial loop at
  `host.mjs:772-815`, and "deleted only by the server" (Global constraints). The gate's "third
  input" is gone with I1's change.
- **M4 (accepted):** Task 1 gains the case where the genuine authority is admitted, and says which
  case already passes today (read at `allocation-envelope.ts:289`, not run).
- **M5 (accepted):** Task 5 is split into 5a, 5b and 5c (the words), and Task 6 into 6a and 6b.
- **M6 (accepted):** decision 2 names the go-back button, and `docs/backlog.md` gains the line.
- **M7 (accepted):** decision 3 now states six weaknesses, (a) to (f), says why devices are left
  out, answers its open question with the second probe, and offers read 3's narrower option as 1b.
- **Rejected:** none.

## Why the existing confirmation cannot be used

- **Not inside the upgrade's stop.** Every existing confirmation is a route of the running server
  (`till-box-clock-api.ts:103`, `box-health-api.ts:218,267`) or its clock watch. During the stop no
  release serves tills or Box status: the sale's container runs with `--network none`
  (`candidate.mjs:115-128`), and the readiness check's listener refuses every request
  (`2026-11-09-a950-shorter-upgrades.md:38`). So the opening moves to the new release's own start,
  after the stop.
- **Not on a box whose time service is unsynchronised at the copy sale, until decision 12.** The
  copy sale throws `Upgrade sale clock.unconfirmed` unless the time service is synchronised
  (`upgrade-sale.ts:161-163`, run above). This is A950's rule for every upgrade: "Every test sale
  must succeed: any refusal fails readiness, including the same refusal as the source"
  (`2026-11-09-a950-shorter-upgrades.md:36`). So on such a box the new release never starts, and
  nobody is offered the chance to confirm its time. This holds for an ordinary upgrade as much as
  for a producer change.

## Decisions (recommended defaults; ★ needs the owner)

1. **Producer only, with no stored identity column** (departs from the design's "What each chain
   stores"; answered 2026-11-22). A chain's producer is its head record's
   (`producer-change.ts:26-33`). The code and the mode cannot differ today.
2. **No check when a record is written, and no guard for an old release started by hand**
   (departs from the design's "The guard"; answered 2026-11-22). A check at writing would sit in
   `chain.ts`. The start's refusal stays the guard (`boot.producer-change.test.ts:171`, unedited).

   **What 1 and 2 leave open.** The opening empties the chain head (`allocation.ts:448-454`), and
   the start check returns when there is no head (`producer-change.ts:31`). So between the opening
   and the first record, a start under any producer passes. Since the new release opens the
   installation itself (decision 3), this can happen only if someone stops the new release after it
   opened the installation, before its first record, and starts the old images by hand, and the two
   releases differ in no migration (otherwise `assertNotAhead` refuses the old one). The old release
   would then write the first record of the installation opened for the new producer, naming its own
   producer truthfully, and the new release's next start would refuse `sif.producer_changed`. No
   guard is built. The owner, 2026-11-22: "there should be no releases started by hand, so no need
   for a guard." The plan's claim is therefore: every start whose chain has a record under another
   producer, and no note naming the change, refuses. One planned path would reach this gap with
   nobody starting a release by hand: A950's password-checked go-back button, planned for after the
   first venue (`docs/backlog/box.md:1656`). This branch adds a line to A950's entry in
   `docs/backlog.md` saying the go-back must refuse an upgrade whose opening has committed.
3. ★ **The new release opens the installation at its start, once the start's time is confirmed by
   the existing means.**
   - **When:** with the time service synchronised, at the start's own look, before the listener
     opens (`boot.ts:3931-3945`). Otherwise, with decision 12 only, at the clock watch's next look
     after a person confirms the time on a till or on Box status through the routes listed above.
     The start keeps waiting until the opening commits (decision 4). While a note waits, two
     devices alone do not end the wait, as they already do not end a wait caused by AEAT's
     future-date refusal (`start-clock-check.ts:107`). Why devices are left out, although they are
     part of the existing solution: CLAUDE.md §5 never names an installation from devices alone; a
     restore or a promotion counts another machine's clock only once a person proved on that page
     confirms it.
   - **The second clock:** the time service as before, or the person's confirmation, read as
     `compareHourClocks` with `boxClockAlone` (`hour-clock.ts:67-70,131`), used only while the box's
     clock has not stepped since the confirmation. A restore's start carries its page's choice under
     the same condition (§5).
   - **What the owner accepts with option 1: six ways it is weaker than §5's naming rule for a
     restore or a promotion.**
     - (a) The person is any staff member the till admits, or a Box administration holder, not
       someone proved by the setup password, a recovery key or a `node.manage` sign-in.
     - (b) "Keep the box's time" and Box status's confirm carry no second clock at all, only the
       person's reading of the box's time.
     - (c) The till's and Box status's agreement margin is 60 seconds
       (`packages/fiscal/src/clock-witnesses.ts:1`), not 30.
     - (d) It is the first production use of naming an installation from the box's own clock alone.
       Every person route reaches the fiscal module as `boxClockAlone`; the till's agreeing reading
       never gets there, so the module itself checks only the release floor. Today `boxClockAlone`
       is used only for a development box's preproduction setup (`hour-preparation.ts:164`,
       `hour-setup-clock.ts:233`; CLAUDE.md §5).
     - (e) A staff member can set the box's clock from their till during the wait, and that time
       then names the installation.
     - (f) Without new words, the person is never told that confirming the time also opens a new
       fiscal installation. Decision 7 now proposes words that tell them.

     Two limits stay. A clock behind the release's date is still refused by the release floor. A
     clock a person accepts while it is far ahead names the installation for that future minute.
     That no longer blocks a later opening: the opening now skips only a minute already used, as
     restore and promotion do (decision 9, run in "Changed after read 3"). How much this adds to
     today's risk: every sale after a person confirms a start's time is already dated by that same
     clock, so a wrong name rides on a clock the owner already lets the box trade on.
   - **Option 1 (recommended):** accept every existing person confirmation, but not two devices
     alone, as above. It is the owner's existing solution. It needs the words in decision 7.
   - **Option 1b (narrower, read 3's suggestion):** as option 1, but while a note waits take only a
     confirmation that carries a device's reading: a till reading that agrees, or a set from a till
     or Box status. "Keep the box's time" would not be offered on the till while a note waits (the
     till already copes with keep not being offered, `till-box-clock-api.ts:177-179`). Box status
     cannot do this today: its agreeing check and its "confirm as shown" both send only
     `asShown: true` (`box-status-screen.ts:459,512`), so the server cannot tell them apart; Box
     status would have to send its reading. It removes (b) and narrows (d). I believe it needs no
     new words beyond decision 7's; not checked.
   - **Option 2 (closest to §5):** accept only the time service, or a Box administration holder
     whose device the box measured within 30 seconds, or who set the box's clock from that device.
     It needs everything option 1b needs, and new refusal words on the till and Box status offering
     the administrator's sign-in there, and Tasks 6a and 6b grow.
4. **No stuck page, and no new clock route; the start keeps waiting until the opening commits.**
   While a note waits, the box behaves as any start that waits for its time: up, answering
   `/health`, reaching the kitchen. Sales and records refuse `clock.unconfirmed`, and staff see the
   waiting notice (`clock-unconfirmed-alert.ts:20`), worded for this wait (decision 7), and the
   till's Check the time (`apps/till/src/widgets/box-time-dialog.ts`).
   - **Why the start must keep waiting.** The notice, the alert and Box status's offer to confirm
     all read only whether the start is waiting (`clock-unconfirmed-alert.ts:25`,
     `box-status-screen.ts:412,458`), and the till's Check the time refuses `not_stopped` once the start
     is confirmed by the internet (`clock-correction.ts:208-209`). So if a confirmation ended the
     wait before the opening succeeded, an opening that kept failing would hold every sale with no
     notice and no way to act (read 3, I1; run in "Changed after read 3").
   - **How.** While a note waits, the start-clock state holds a confirmation instead of applying
     it: the time service's, or (with decision 12) a person's. It stays `waiting`, so the gate, the
     notice and both confirmation routes work exactly as in any wait, and the gate needs no new
     input. Once the opening commits, the server deletes the note and applies the held
     confirmation, which ends the wait as it does today (including the `onConfirmed` call,
     `boot.ts:2583`). A clock step, or a return to waiting for any cause, drops a held
     confirmation. Devices confirm nothing while a note waits.
   - **Where the opening runs.** At the start's own look, before the listener opens, and at each
     look of the clock watch (every 15 seconds, `clock-watch.ts:19`) while a held confirmation
     stands. A person's confirmation wakes the clock watch (`jobRunner.wake`, `job-runner.ts:325`)
     so it does not wait the full 15 seconds. So the opening never runs inside a request's
     transaction, and there is no loop of this plan's own: the clock watch is a job the runner
     stops at a stepdown (`job-catalogue.ts:26`) and on a failed start (`boot.ts:2813`). As built
     2026-11-24: `clockWatchJob`'s `minSleepMs` is 0, since at the interval a wake ended no sleep.

   The cases:
   - **A crash before A950 commits:** recovery restores the copy taken before the note was written,
     and Restore removes files that are not in the copy (`copy.mjs:59-75`). Keep is refused for an
     identity-changing attempt (Task 8).
   - **A crash after A950 commits, or a resume that times out:** the note stays in the live state
     folder, and the new release's next start opens the installation.
   - **A start by hand of the new release with no note:** it refuses, with words that say to install
     the release as an upgrade.
   - **The time service unsynchronised at the copy sale:** A950 fails the check, as for every
     upgrade. Automatic mode puts the old release back; manual mode waits for Restore. Decision 12
     changes this.
   - **The opening refused for its clock after a person's confirmation** (the release floor, or the
     clock stepped since): the held confirmation is dropped and the box is still waiting, so the
     till offers Check the time again, including setting the box's clock from the till.
   - **The current minute already used** (`minute_in_use`): the held confirmation stays, and the
     clock watch's next look, 15 seconds later, tries the next minute.
   - **Refused for anything else, or throwing** (`history_invalid`, the box no longer the venue's
     only box or its serving primary, an unexpected error): it is caught and logged, the box keeps
     waiting, the clock watch tries again at each look while the held confirmation stands, and
     Box status and the bell show the alert `sif.identity_change_blocked` (decision 7) in place of
     the waiting alert, since the time is no longer what it waits for. It never fails the start, so
     read 1's I2 does not return. Its one way out for the operator is Restart the box; a history
     that stays broken has none (see "Not established").
   - **Decision 12 declined:** a person's confirmation while a note waits is not held and changes
     nothing; the box opens once its time service synchronises, and decision 7's words say so.
5. **The approval and operator shape.** It is the existing version 2 with
   `oldMachineRelinquished: true`, and `oldMachineOffline` and `oldMachineAbsent` false (the old
   installation is this box's, closed by its own step). The operator is the text
   `identity-change:<release>`. Its readers:
   - `backup-verification-history.ts:133-158` accepts it. Read 1 ran "a stored version 2
     relinquished approval verifies", which passes. Its comment at `:134` ("Only a relinquished
     promotion writes version 2") is corrected in Task 3.
   - `hour-history-reader.ts:133-146` and `backup-verification.ts:93-104` read only the event, the
     node and the time.
   - `filing-overview.ts:213-217` leaves it out of "Identity changes without a handover". That is
     right: the old chain closed on the same box, and no history is missing.

   The door is the private authority, not this data.
6. **The note** is the file `identity-change.json` in a state folder:
   `{"version":1,"release":"1.4.0","producerTaxId":"<new>","fromProducerTaxId":"<old>"}`.
   - **Who writes it, and where:** only the upgrade's host, with `writeFileDurable` and the state
     folder's owner. It goes into the online trial's copy between capture and trial (both run in
     one loop, `host.mjs:772-815`, which Task 7 splits) and into the stopped checks' copy (`candidate.mjs:64-65`). Once every
     stopped check has passed, it goes into the live state folder, under the hold the host took at
     the stop. The host also saves a copy in the attempt directory, for Keep's refusal. It never goes
     into Compose, `.env` or any environment value.
   - **When it is written:** only when the candidate is a numbered release (its `ref.name` label is
     `v<version>`, as `waitron.sh:474-486` reads it) whose `WAITRON_PRODUCER_TAX_ID` differs from the
     old image's.
   - **When it is acted on:** in production, only when all three match: its `release` and
     `softwareVersion()`, its `producerTaxId` and the running producer, and its
     `fromProducerTaxId` and the chain head's producer. Otherwise it is ignored, and the start
     refuses as today if the producers differ. A file that is not exactly this shape counts as
     absent.
   - **Who deletes it:** the server, after the opening commits, and at a start that finds the head
     already under the running producer (a crash between the two). A plain reset deletes it too: its
     name is a `state-layout.ts` entry whose fate is `deleted`.
   - **As built 2026-11-24:** only a box that files records (`filesRecords`) reads the note; any
     other is refused as today, because the gate that keeps a waiting box from selling holds only on
     one that files. The seat's `checkFilingIdentity` answers `leftover` when the note names the
     running release and producer and nothing is left to open: the head is already under the running
     producer, the open installation holds no record yet (a crash between the opening and the first
     record), or the box is not production. So a preproduction box that files records deletes it too.
   - **As built 2026-11-24, the note carried forward** (cleared by the watcher, 08:23, not the owner;
     it goes past "When it is written" above): before the stop the host reads the live state folder's
     note. When it is exactly the reader's shape, its `producerTaxId` is the old image's and its
     `release` is the version in the old image's release label, the new note's `fromProducerTaxId`
     is the live note's, and not the old image's. An old image without a numbered release's label
     carries nothing, and then a note is written only if the two images' producers differ. So a
     fixed release by the same producer is accepted while the first one's opening keeps failing, and
     a third producer's note names the producer the latest record is under. There is still no note
     when that producer is the candidate's own. A live note left over from an opening already made
     (a crash before its deletion) opens nothing for a release by the same producer; a third
     producer is refused until the running release's start deletes the note.
   - **As built 2026-11-24, a failed read:** a refused or unreadable `docker image inspect` of either
     image abandons the upgrade before anything stops. An image naming no producer, and a candidate
     without a numbered release's label, still mean no note.
   - **Disclosed limit:** root on the box can write the note by hand, as root can edit the database.
   - **Disclosed limit, a race:** if the running release (producer B) opens its installation,
     deletes the note and files a record after the trial's copy is taken, the attempt still carries
     "from A" and an upgrade to a third producer C is refused after the stop; an automatic one
     restores, a manual one stays shut until Restore, and a retry then names B.
   - **Disclosed limit:** going back to A over a waiting B note leaves that note in the state
     folder; it is acted on only if that B release is installed again, and an upgrade to it writes
     the same note itself, so it matters only to someone pinning that release by hand.
   - **Disclosed limit:** the running release's start leaves a left-over note naming another release
     alone (`boot.identity-change.test.ts`, "leaves a note naming another release alone"); it stays
     until an upgrade replaces it with a note of its own, the release it names starts and uses or
     deletes it, or a plain reset.
7. ★ **New words are unavoidable on three screens; the upgrade's report gets none.**
   - **The upgrade's report: no new words.** A refused opening on a copy leaves the copy's start
     waiting, so its test sale answers 409 `clock.unconfirmed` and A950 reports
     "Upgrade sale <path>: 409 … clock.unconfirmed" (`upgrade-sale.ts:196-197`), then fails the
     check as for any failed sale. The readiness check only answers `pending` and opens nothing.
     `sif.identity_change_waiting` reaches only the log. The design's three Spanish report lines are
     not built.
   - **Why the screens need words.** While a note waits, two devices do not end the wait, but
     today's waiting words say they do: the till's "Payments wait: the server is waiting for devices
     to connect and agree with its time ({agreed} of 2 so far)" (`apps/till/src/i18n/strings.ts:2225-2226`),
     and the bell's "…confirms by itself once two do…"
     (`apps/dashboard/src/i18n/alert-messages.ts`, `clock_unconfirmed.otherwise`). A cause the till
     does not know is shown as "unknown" (`apps/till/src/i18n/staff-notices.ts:15-20`). So the wait
     gets a cause of its own, `identity_change`, and an opening that fails for a reason other than
     the clock gets an alert. These words also tell the person that confirming the time opens a new
     fiscal installation (decision 3, point f).
   - **The words proposed** (English, then Spanish):
     1. The bell, `clock_unconfirmed` for the cause `identity_change`: "This version of Waitron has
        a new software producer, so the box opens a new fiscal installation, with new invoice
        numbers, as soon as its time is confirmed. Until then it is not taking payments. It
        confirms by itself once its time service reaches a time server over the internet; tills and
        handhelds agreeing with its time are not enough for this. You can confirm or correct the
        date and time now on the Box status page; staff can use “Check the time” on a till." /
        "Esta versión de Waitron tiene un productor del software nuevo, así que el servidor abre una
        nueva instalación fiscal, con una numeración de facturas nueva, en cuanto se confirme su
        hora. Hasta entonces no acepta cobros. La confirma por sí solo en cuanto su servicio de hora
        contacta con un servidor de hora por internet; para esto no basta con que las cajas o
        terminales coincidan con su hora. Puedes confirmar o corregir la fecha y la hora ahora en
        Estado del servidor; el personal puede usar «Comprobar la hora» en una caja."
     2. Box status's clock line, `box_status.clock.waiting_identity_change`: "The new software
        producer needs a new fiscal installation, which opens once the box's time is confirmed: no
        payments are taken until then. The box's clock says {boxAt}." / "El productor del software
        nuevo necesita una nueva instalación fiscal, que se abre en cuanto se confirme la hora del
        servidor: hasta entonces no se aceptan cobros. El reloj del servidor indica {boxAt}."
     3. The till's notice, `staff_notice.clock.unconfirmed_identity_change`: "Payments wait: the
        server must open new invoice numbering first, once its time is confirmed" / "Los cobros
        esperan: el servidor debe abrir antes una numeración de facturas nueva, en cuanto se
        confirme su hora". (2026-11-24: the till's English line says "box" where this says "server":
        the till's word changed on 2026-11-22 20:39, commit a71e1b45c0, after the owner's yes.)
     4. The alert `sif.identity_change_blocked` (area `box`): "The box could not open its new fiscal
        installation for the new software producer, so it is not taking payments. It keeps trying.
        If this stays, open Box status and press Restart the box." / "El servidor no ha podido abrir
        su nueva instalación fiscal para el productor del software nuevo, así que no acepta cobros.
        Lo sigue intentando. Si sigue así, abre Estado del servidor y pulsa Reiniciar el servidor."
   - **If decision 12 is declined,** 1 ends "…over the internet; confirming the time by hand or
     tills agreeing with it are not enough for this." / "…por internet; para esto no basta con
     confirmar la hora a mano ni con que las cajas coincidan con ella.", and 2 says "once the box's
     time service confirms its time" / "en cuanto el servicio de hora del servidor confirme su hora".
   - The till's guide gains the notice, in English and Spanish (`apps/server/src/guide/*/till-notices.md`).
   - **As built 2026-11-24** (cleared by the watcher, 07:03, not the owner): while blocked, the Sales
     row repeats the alert's words, and the Clock row leaves out **The date and time are right**.
   - Option 2 of decision 3 would need refusal words as well.
8. **Order PR 1 → 2 → 3.** Nothing writes a note until PR 3.
9. **The minute, and the box's role.**
   - **The minute** follows restore and promotion's shared rule (`hour-selection.ts:557-559`): the
     opening takes the box's current minute unless that exact minute is in the history it reads. A
     used minute later than now does not block it. If the current minute is used, it refuses
     `minute_in_use` and the clock watch's next look, 15 seconds later, tries again on the minute
     then current; that stands in for the shared rule's saved wait, which the identity change skips
     as `promote` skips the settle. The shared rule itself stays untouched.
   - Inside its transaction the opening repeats its reads, and the used-name refusal
     (`installation_used`, `allocation.ts:103-114`) catches a name taken in between.
   - **The box's role is checked again at the opening.** The upgrade refused any box that was not
     the venue's only box and its serving primary (`host.mjs:500-556`), but the opening can now wait
     hours, long enough for a spare to join or a handover to begin. So, inside its transaction, the
     opening refuses unless the box files records (`filesRecords`, `boot.ts:2476-2477`), is neither
     a mirror nor fenced (`isReadOnly`, `boot.ts:2479`), and the saved membership names this box
     alone as serving primary (`node_membership` in `venue.db`, read as `host.mjs:507-517` reads
     it). A start that is fenced or a mirror never runs it (the same condition as the producer check,
     `boot.ts:2595`). A stepdown stops the clock watch (`job-catalogue.ts:26`), and the watch's pass
     checks its stop signal before the transaction.
   - I believe no other path opens an installation on a sole serving primary while it runs; that was
     read, not run.
10. **`openIdentityChange` takes `Database` and opens its own transaction.** It reads the time
    service (up to 2 seconds, `hour-clock-time-service.ts:4`) outside the write lock. This is
    stated as a commented decision at its site (CLAUDE.md §3). The server calls it only from the
    start's own look and from the clock watch's look, in the clock correction's turn so no clock
    set runs beside it, and never inside a request's transaction.
11. **No container opens the live database during the stop.** The host writes the note into the
    live state folder itself, under the hold it took at the stop (`host.mjs:324-326`), which holds
    `venue.lock`. So CLAUDE.md §3's "file-changing commands take `lockVenueDatabase`" needs no
    exception. **Where the opening is recorded:** the `fiscal_allocations` row
    (`allocation.ts:466-478`) is the durable record, and the server logs the opening.
12. ★ **May the copy sale run on a box whose time service is not synchronised?** This applies to
    every upgrade, not only a producer change.
    - **Today:** it fails (`upgrade-sale.ts:161-163`, run above). Nothing in
      `scripts/box/upgrades` asks the time service before the stop (read 3's search). So every
      attempt on such a box stops it, fails the test sale, and goes back to the old version
      (automatic mode; manual mode waits for Restore), which then waits for its time like any start
      of a box that files records. Selling is no worse off either way; what changes is which
      version the box ends up on.
    - **Proposal (changed after read 3):** the upgrade's helper process, not the server, does it.
      The copy reads the time service through a relay the helper runs (`clockStatusRelay`,
      `host.mjs:696-743`, started at `candidate.mjs:72`). The relay passes on the host's answer
      when it says synchronised, and otherwise answers "synchronised" itself, for the copy only.
      The copy's start then confirms by the internet and runs its sale, and a copy with a note opens
      its installation through the same path as a synchronised live box. The server gains no
      option to confirm a start without a clock, and `upgrade-sale.test.ts:127-136` stays as it is.
      The live box then starts the new release and waits for its time as after any restart
      (`/health` answers while it waits: run above). Read 2's earlier version, a boot option that
      `checkUpgradeSale` passes, is dropped: it put a "confirmed with no clock" switch into the
      production server, and its guard case proved only the default (read 3, I3).
    - **What it costs, in plain words.** On a box that has not reached an internet time server,
      the test sale no longer proves that the new version can get through its own wait for the
      time, because the copy is told the time is fine. If the new version's wait or its
      confirmation were broken, the box would be stuck on it: once an upgrade is kept there is no
      Restore (`transaction.mjs:216`), and A950's go-back button is not built. For a producer
      change, the box would also be unable to open its new installation, so it could not sell until
      a fixed version arrived. On a box whose time service is synchronised, nothing changes.
    - **What it changes in A950's rule:** "any refusal fails readiness, including the same refusal
      as the source" (`2026-11-09-a950-shorter-upgrades.md:36`) no longer covers one refusal,
      `clock.unconfirmed`, on such a box.
    - **Without it,** such a box gets no upgrade, and Tasks 6a and 6b (a person's confirmation
      opens the installation) are not built.
    - **Recommended: yes, in the helper's form**, as Task 9. The risk it adds is a stopped box,
      never a wrong record: the gate and the note checks are unchanged. I did not check how often a
      box that can fetch a release lacks a synchronised time service: a release arrives over the
      internet, or by the signed manual install, and a venue's network can let web traffic out
      while blocking the time protocol (not measured).
    - **A cheaper partial step if declined:** the helper could ask the time service before the stop
      and refuse early, sparing the stop and the rollback. It still gives such a box no upgrade.

## Changed test checks

| Check | Before | After |
| --- | --- | --- |
| `apps/server/src/recovery-surface.test.ts:440-462`, the `sif.producer_changed` words (Task 10) | EN title "…and this version of Waitron cannot open one, so the box will not sell."; action "…Changing the producer needs a Waitron version that can open a new fiscal installation, which does not exist yet." (ES likewise) | EN title "This box has been given a different software producer from the one its invoices were recorded under, without the upgrade that opens a new fiscal installation for it, so the box will not sell."; action "Install a Waitron version that names the same producer as this box's invoices. A version with a new producer opens its new fiscal installation by itself when it is installed as an upgrade." ES: "…sin la actualización que le abre una nueva instalación fiscal, así que el equipo no venderá." / "Instala una versión de Waitron que indique el mismo productor que las facturas de este equipo. Una versión con un productor nuevo abre su nueva instalación fiscal por sí sola cuando se instala como actualización." |

No other check reverses; `upgrade-sale.test.ts:127-136` stays as it is under decision 12's helper
form. `git grep -n "producer_changed" -- '*.test.*'` lists:
- `boot.producer-change.test.ts:171-180`: still refuses;
- `producer-change.test.ts:59,168,189`: unchanged;
- `recovery-surface.test.ts:440-633`: the words above; the retry list at `:601-633` stays true.

## Review focus

1. **A sale before the opening:** the start stays waiting while a note waits, a confirmation is
   held, not applied, and the wait ends only after the opening commits (Task 5a).
2. **Two devices never end a wait while a note waits** (Task 5a).
3. **The opening on a box that is no longer alone or no longer the serving primary:** refused inside
   its transaction (Tasks 3 and 5b).
4. **An opening that keeps failing is visible and has a next step:** the waiting notice, or
   `sif.identity_change_blocked`, and Check the time stays available (Task 5b).
5. **A copy opening that fails at the stopped sale check:** A950 restores the copy as for any failed
   check, and no live note exists yet (Task 8).
6. **A crash after the live note is written but before A950 commits:** recovery restores the copy,
   which removes the note (Task 8). Keep is refused.
7. **A backup after the change verifies**, and a restore reads its history (Task 3, case 4).
8. **The note reaches the running app only through the live state folder:** the reopened Compose,
   `.env` and the app's environment never carry it (Task 7).

---

## PR 1 — the fiscal module can open an identity-change installation (not yet called)

Result: no behaviour change. `fiscal-verifactu` gains one seat method that no route reaches. About
200 production lines and 400 test lines.

### Task 1: the `identity-change` action and its private authority

**Files:**
- Create: `packages/fiscal-verifactu/src/identity-change-authority.ts`.
- Modify the three action lists: `allocation-envelope.ts:289` (and the relinquished check at
  `:304`), `allocation-operation.ts:120`, and `allocation.ts:169-171`.
- `hour-selection.ts:384` does **not** gain the action: the identity change skips the saved
  selection.
- Test: `identity-change-authority.test.ts`.

**Produces:**
- `withIdentityChangeAuthority<T>(binding: OperationBinding, release: string, run: (authority: OperationAuthority) => Promise<T>): Promise<T>`.
  It calls `withOperationAuthority` (`packages/module/src/operation-authority.ts:51`) with the operator
  `identity-change:<release>`, adds the authority to a module-private `WeakSet`, and removes it in
  `finally`.
- `isIdentityChangeAuthority(authority: unknown): boolean`.
- Neither is exported from `index.ts`.
- Each list accepts `identity-change` only when `isIdentityChangeAuthority` holds, and refuses an
  identity-change authority for every other action. `:304` admits `identity-change` beside
  `promote`.

- [ ] **Step 1: Write the failing tests.**
  - **The genuine authority is admitted:** a `withIdentityChangeAuthority` authority, the binding
    action `identity-change` and a well-formed input → `withHourAdmission` runs its body, and each
    of the other two lists accepts it too. This is the case that fails before the code exists for
    the right reason; without it, an implementation that refuses everything would pass this task.
  - An authority from `withOperationAuthority` with the action `identity-change` →
    `withHourAdmission` refuses `reauthentication_required`. This one already passes on today's
    code, since `identity-change` is in none of the lists (`allocation-envelope.ts:289`, read); it
    is a guard, proved by the deletion below.
  - An identity-change authority with the action `restore` → refused.
  - The authority after `run` settles → refused.
  - Proof by deletion: delete the `WeakSet` check, and the second case must fail.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change-authority.test.ts` → FAIL.
  The first case must fail by being refused or by the missing module, not by a typo.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Run the same command plus the constraint suites,
  unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 2: deciding whether to open, and on which minute

**Files:**
- Create: `packages/fiscal-verifactu/src/identity-change.ts`.
- Modify: `errors.ts`, to add `sif.identity_change_waiting`, typed `{ reason: string }`.
- Test: `identity-change.test.ts` (`useVenueDb`, with `readHourRelease` mocked as the existing hour
  tests mock it).

**Produces:**
- `planIdentityChange(db: Database, nodeId: NodeId, note: IdentityChangeNote, secondClock: SecondClock): Promise<{ kind: "nothing-to-open" | "not-named" } | { kind: "open"; minuteMs: number; sourceSifId: string }>`.
- `IdentityChangeNote = { release: string; producerTaxId: string; fromProducerTaxId: string }` and
  `SecondClock = { kind: "time-service"; read: () => Promise<boolean> } | { kind: "confirmed-start"; standing: () => boolean }`,
  both exported from `packages/fiscal/src/backend.ts`.

The checks, in order:
1. **Not named:** `not-named` unless `note.release === softwareVersion()` and
   `note.producerTaxId` is the running producer's NIF.
2. **Outside production:** `nothing-to-open`.
3. **Nothing to open (read-only, before any clock):** `nothing-to-open` when there is no chain head,
   or the head already names the running producer, read as `producer-change.ts:26-33` reads it.
   `not-named` when the head is not `note.fromProducerTaxId`.
4. **The clock.**
   - `time-service`: `observeTimeServiceHourClock`, then a box sample, then `compareHourClocks` with
     the release floor.
   - `confirmed-start`: `standing()` must answer true, or it throws `sif.identity_change_waiting`
     `confirmation_stale`. Then a box sample and `compareHourClocks(…, { boxClockAlone: true })`
     with the release floor.
   - When `canSelectHour` is false, it throws `sif.identity_change_waiting` with `clockRefusal`'s
     reason.
5. **The minute:** history through `readHourHistory` and `projectHourHistory`. Contradictions →
   `history_invalid`. The box's current minute itself in the used minutes →
   `sif.identity_change_waiting` `minute_in_use`. A used minute later than now is not a refusal
   (decision 9).

- [ ] **Step 1: Write the failing tests.**
  1. Head under producer A, running B, a note naming B and A, time service synchronised → `open`,
     on the box's current minute.
  2. A note naming another release, another producer, or another `fromProducerTaxId` →
     `not-named`. Proof by deletion of each comparison.
  3. The head already under B, time service **unsynchronised** → `nothing-to-open`, with no clock
     read (the stub counts calls).
  4. Head under A, `time-service` unsynchronised → throws `second_clock_missing`.
  5. Head under A, `confirmed-start` standing → `open`; not standing → `confirmation_stale`; the box
     clock before the release floor → refused with the floor's reason.
  6. Preproduction → `nothing-to-open`.
  7. The current minute already in the history → `minute_in_use`. Control: a used minute a day
     ahead and nothing at the current minute → `open` on the current minute, as a promotion is
     admitted then (run in "Changed after read 3").
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with `src/producer-change.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 3: opening it, and the seat method

**Files:**
- Modify: `identity-change.ts`; `fiscal-verifactu/src/backend.ts:789`, to add the method;
  `packages/fiscal/src/backend.ts:499`, to add an optional member (that file is mutation-tested,
  `packages/fiscal/stryker.config.json:7`, but a type member has no mutants); and
  `backup-verification-history.ts:134`, to correct its comment.
- Test: `identity-change.test.ts`.

**Consumes:** Task 1's `withIdentityChangeAuthority` and Task 2's `planIdentityChange`.

**Produces:** `openIdentityChange(db: Database, nodeId: NodeId, note: IdentityChangeNote, secondClock: SecondClock, mayOpen: (tx: Transaction) => Promise<boolean>): Promise<"opened" | "nothing-to-open" | "not-named">`.

How it works:
- It plans first, then in one `withTransaction` repeats the plan's reads and refuses if they moved.
- First inside that transaction it asks `mayOpen(tx)`, and on `false` throws
  `sif.identity_change_waiting` `not_sole_primary`. The server supplies `mayOpen` (decision 9:
  files records, not a mirror or fenced, and the saved membership names this box alone as serving
  primary); the fiscal module does not read the box's role itself.
- It builds the input as `hour-throwaway-allocation.ts:47-72` builds its input, using decision 5's
  approval, `liveSeriesBases`, `encodeMinuteIdentity(minuteMs)`, and the binding
  `{ module: "fiscal-verifactu", action: "identity-change", eventId: randomUUID(), sourceId: sourceSifId, targetNodeId: nodeId }`.
- Then it runs `withHourAdmission` → `createAllocationPreparation` → `activatePreparedModuleAllocation(tx, …)`.

- [ ] **Step 1: Write the failing tests.**
  1. Case 1 of Task 2 → `opened`:
     - the old SIF row is revoked;
     - a new row's `numero_instalacion` is the minute's five symbols;
     - the old series are retired and new `<base>-<name>` series exist;
     - the next `recordSale` stores `PrimerRegistro` S under the new name;
     - the old record's stored `SistemaInformatico` is unchanged.
  2. Called twice → the second call answers `nothing-to-open`.
  3. The used-name refusal (`installation_used`, `allocation.ts:103-114`) is still reached when the
     plan's minute is planted in `registro_sif` between the plan and the transaction.
  4. `verifyBackupFiscalHistory` (`backup-verification-history.ts:492`) over the changed database
     passes.
  5. `mayOpen` answering `false` → `not_sole_primary`, and nothing is written (the SIF row and the
     series are as before). Proof by deletion of the check.
- [ ] **Step 2: Run them and watch them fail.** Same command as Task 2 → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the fiscal gates and
  `src/backup-verification-history.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

## PR 2 — a note lets the checks and the start through, and the start opens the installation

Result: no behaviour change until PR 3, because nothing writes a note yet. With a note in place, the
checks pass the producer refusal, and a start keeps waiting for its time until it has opened the
installation. About 260 production lines and 550 test lines, plus the words of decision 7, across
Tasks 4 to 5c, and Tasks 6a and 6b only with decision 12. If the pull request grows past what one
review can take, Tasks 5c, 6a and 6b go into a pull request of their own before PR 3.

### Task 4: reading the note, and the producer refusal that accepts it

**Files:**
- Create: `apps/server/src/identity-change-note.ts`.
- Modify: `packages/store/src/state-layout.ts`, a `deleted` entry for `identity-change.json`.
- Modify: `packages/fiscal-verifactu/src/producer-change.ts:17-34`. `refuseProducerChange` takes an
  optional note and answers `"pending"` instead of throwing when the note names this release, this
  producer and the head's producer. The seat's `checkFilingIdentity` passes it on and answers
  `{ pending: boolean }` (the interface at `packages/fiscal/src/backend.ts:499` gains the optional
  argument).
- Modify: `apps/server/src/upgrade-checks.ts:89-90`, to pass the note read from the check's state
  folder. A pending answer is reported as `identityChange: "pending"` in the details.
- Tests: `identity-change-note.test.ts`, `producer-change.test.ts` (new cases only),
  `upgrade-trial.test.ts`.

**Produces:**
- `readIdentityChangeNote(stateDir: string): Promise<IdentityChangeNote | null>`. It takes exact keys
  and `version: 1`; anything else answers `null`.
- `deleteIdentityChangeNote(stateDir: string): Promise<void>`. A missing file is not an error.

As built 2026-11-24: `checkFilingIdentity` answers `{ pending: true }`, `{ leftover: true }`
(decision 6) or `undefined`, because an existing unedited case in `producer-change.test.ts` pins
`undefined`; an unreadable note counts as absent.

- [ ] **Step 1: Write the failing tests.**
  - The reader: absent, empty, malformed, an extra key, `version: 2` → `null`; well formed → the
    three fields.
  - `refuseProducerChange` with a note naming the head's producer, this release and this producer →
    `"pending"`. With a note naming any other of the three → still `sif.producer_changed`. Proof by
    deletion of each comparison.
  - The trial with a matching note → passes and reports `identityChange: "pending"`. With no note →
    still `sif.producer_changed`.
  - `pnpm exec vitest run scripts/state-layout.test.ts` lists the new entry.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/identity-change-note.test.ts src/upgrade-trial.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/producer-change.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, plus the root's `scripts/module-seams.test.ts` and
  `scripts/state-layout.test.ts`, and `boot.producer-change.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 5a: the start keeps waiting while a note waits, and opens when the time service confirms it

**Files:**
- Modify: `apps/server/src/start-clock-check.ts:56-120`. `startClockState` gains a hold, off by
  default, so every existing case is unchanged:
  - `holdForIdentityChange()` turns it on; while it is on, `cause` answers `identity_change`
    (a new `StartClockCause`), and `confirmDevices` answers none, as it does while AEAT's
    future-date refusal is the cause (`:107`);
  - `confirm("by_internet", heads)` while it is on records a held confirmation and leaves the status
    `waiting`; any other `confirm` while it is on changes nothing and is logged by the caller
    (Task 6a widens this to a person's confirmation);
  - `backToWaiting`, for any cause, drops a held confirmation;
  - `releaseIdentityChange()` turns the hold off and applies the held confirmation, so the wait ends
    through the existing `confirm`, which calls `onConfirmed` once.
- Create: `apps/server/src/identity-change-opening.ts`. `attemptIdentityChange` calls the seat's
  `openIdentityChange` with the held confirmation's second clock and `mayOpen` (decision 9). On
  `opened` or `nothing-to-open` it deletes the note, then calls `releaseIdentityChange()`; a failed
  delete is logged and does not stop the release (the next start finds the head under the running
  producer and deletes it, decision 6). On a refusal for the clock it drops the held confirmation.
  It never throws to its caller: every refusal is logged with its reason and kept as the latest
  refusal, for Task 5b's alert.
- Modify: `apps/server/src/boot.ts:2583-2598`. The note is read from the state folder and passed to
  `checkFilingIdentity`. A pending answer calls `holdForIdentityChange()`. The gate is unchanged: the
  start is waiting, so `startClockGateHolds` (`start-clock-gate.ts:19-25`) already holds.
- Modify: `boot.ts:3931-3945`. When a note waits and the start's look leaves a held internet
  confirmation, `attemptIdentityChange` runs before the listener opens, in the clock correction's
  turn, and is awaited.
- Tests: `start-clock-check.test.ts` (new cases only); a new `boot.identity-change.test.ts`, on the
  production harness of `boot.producer-change.test.ts:50-169`.

- [ ] **Step 1: Write the failing tests.**
  - The state: with the hold on, an internet confirmation leaves `status` `waiting`, `cause`
    `identity_change`, and `onConfirmed` uncalled; two agreeing devices answer none; a
    `backToWaiting` drops the held confirmation; `releaseIdentityChange()` ends the wait and calls
    `onConfirmed` once. Control: the same steps with the hold off end the wait at the first
    confirmation.
  - With a note and the time service synchronised: the first sale answers 200 and stores
    `PrimerRegistro` under the new name, and the note is gone.
  - With a note and the time service unsynchronised: a sale answers 409 `clock.unconfirmed`, no
    record is written, `/health` answers 200, the note is still there, and the bell's alert list
    holds `clock.unconfirmed` with the cause `identity_change`.
  - With no note: still `sif.producer_changed` (the existing case, unedited).
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts src/boot.identity-change.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the start-clock suites listed under "Global
  constraints" unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 5b: the clock watch retries the opening, checks the box's role, and raises the alert

**Files:**
- Modify: `apps/server/src/clock-watch.ts:92-129` (`lookForStart`). After its look at the time
  service, while a held confirmation stands and the pass's stop signal is not set, it runs
  `attemptIdentityChange` in the correction's turn. This is the only retry: no loop of its own.
- Modify: `boot.ts`, `mayOpen` (decision 9): `filesRecords()`, not `isReadOnly()`, and the saved
  `node_membership` in the transaction naming this box alone as serving primary.
- Create: an alert source for `sif.identity_change_blocked`, area `box`, `system.manage`, raised
  while a note waits, a confirmation is held, and the latest refusal was not for the clock or
  `minute_in_use`. While it is raised, the waiting alert is not.
- Tests: `boot.identity-change.test.ts`; `clock-watch.start-up.test.ts` (new cases only);
  `scripts/alert-codes.test.ts` (the new code's area claim).

- [ ] **Step 1: Write the failing tests.**
  - The current minute planted in the history: the sale stays refused; at the watch's next look,
    on the next minute, it opens.
  - The opening throws (a stubbed seat): the start still finishes, the sale is still refused, the
    alert list shows `sif.identity_change_blocked` and not `clock.unconfirmed`, and the till's
    `POST /api/box-clock/challenge` is still admitted. Once the stub stops throwing, the next look
    opens it and the alert goes.
  - `mayOpen` false because the membership names a second active box: nothing opens, and the alert
    shows. Control: the same box alone opens.
  - A stepdown signalled while a confirmation is held: no further attempt runs (the stub counts
    calls).
  - The copy sale (`upgrade-sale.test.ts`, new case only) with a matching note and a synchronised
    time service: its record starts the new chain.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.identity-change.test.ts src/clock-watch.start-up.test.ts src/upgrade-sale.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, plus the root's `scripts/alert-codes.test.ts`, and
  `src/handover-stepdown.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 5c: the words for this wait (decision 7)

Built only with the words the owner approves under decision 7.

**Files:**
- `apps/dashboard/src/api/client.ts:2226`: the cause type gains `identity_change`.
- `apps/dashboard/src/i18n/alert-messages.ts`: `clock_unconfirmed.words.identity_change`, and the
  words of `sif.identity_change_blocked`; `clock_unconfirmed_host_silent` takes
  `HOST_SILENT_AFTER_START` for the new cause.
- `apps/dashboard/src/screens/box-status-rows.ts:201-204` and `apps/dashboard/src/i18n/strings.ts`
  (English and Spanish): `box_status.clock.waiting_identity_change`.
- `apps/till/src/i18n/staff-notices.ts:15-20` and `apps/till/src/i18n/strings.ts` (English and
  Spanish): `staff_notice.clock.unconfirmed_identity_change`.
- `apps/server/src/guide/en/till-notices.md` and its Spanish twin: the new notice.
- Tests: `apps/till/src/i18n/staff-notices.test.ts` (a new row beside `:76-78`), the dashboard's
  alert-message and Box status row tests (new cases only).

- [ ] **Step 1: Write the failing tests.** The till words the cause `identity_change` with its own
  key, not `staff_notice.unknown`; the bell and Box status show the new lines in both languages.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts` and the dashboard's
  named tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, plus the root's `scripts/alert-codes.test.ts`,
  `scripts/staff-notice-codes.test.ts`, `scripts/guide-links.test.ts` and
  `apps/server/src/guide-content.test.ts` → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 6a (only if decision 12 is taken): a person's confirmation opens it

Written for option 1 of decision 3. If the owner takes option 1b or 2, this task is rewritten before
dispatch.

**Files:**
- Modify: `apps/server/src/start-clock-check.ts`. While the hold is on, `confirm("by_person", heads)`
  also records a held confirmation, with the correction's step count and a wall and steady reading
  taken then. A held internet confirmation replaces a held person's one; never the reverse.
- Modify: `boot.ts`. A held person's confirmation gives `attemptIdentityChange` the second clock
  `{ kind: "confirmed-start", standing }`, where `standing` answers true while the step count is
  unchanged and the wall clock has not moved against the steady clock (`wallMovedAgainstSteady`,
  `clock-correction.ts`). Recording it wakes the clock watch (`jobRunner.wake("clock.watch")`,
  `job-runner.ts:325`), which only ends the watch's sleep: the attempt runs in the watch's pass,
  after the route's transaction and its turn have finished (`till-box-clock-api.ts:283,321`,
  `box-health-api.ts:285`).
- Tests: `boot.identity-change.test.ts`, `start-clock-check.test.ts` (new cases only).

- [ ] **Step 1: Write the failing tests.**
  - A note and the time service unsynchronised, then a till confirmation that agrees
    (`POST /api/box-clock/confirm`) → opened; the next sale answers 200 under the new name.
  - The same with "keep the box's time" → opened.
  - The same with Box status's `POST /api/box/clock-confirm` → opened.
  - Two devices agreeing within 5 seconds → still waiting, nothing opened. Control: with no note,
    the same two devices end the wait.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.identity-change.test.ts src/start-clock-check.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the start-clock suites unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 6b (only if decision 12 is taken): a stale confirmation, the release floor and a set from the till

**Files:** `boot.identity-change.test.ts` and, only if a case fails, `identity-change-opening.ts`.

- [ ] **Step 1: Write the failing tests.**
  - A confirmation followed by a clock step before the opening → still waiting, the held
    confirmation dropped, nothing opened; Check the time is still admitted.
  - A box clock before the release floor and "keep" → still waiting, nothing opened. Then a set from
    the till → opened.
- [ ] **Step 2: Run them and watch them fail.** Same command as Task 6a → FAIL (or, if they pass
  at once, prove each by deleting the check it covers).
- [ ] **Step 3: Implement** what fails.
- [ ] **Step 4: Run them and watch them pass**, with the start-clock suites unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

## PR 3 — the upgrade writes the note

Result: the outcome. About 100 production lines and 250 test lines, plus documents.

### Task 7: the host works out the note and gives it to the trial

**Files:**
- Modify `scripts/box/upgrades/host.mjs`:
  - `:246-307`: after the candidate ids, inspect `old.app` and `next.app` for `Config.Env`
    `WAITRON_PRODUCER_TAX_ID` and the `org.opencontainers.image.ref.name` label, giving decision 6's
    note or `null`;
  - `:772-815`: capture and trial run in one loop over `["capture", "trial"]`; write the note into
    the trial's copy after the capture pass and before the trial pass (a step between the two
    passes, or the loop split in two), owned as the copy is;
  - `:309-311`: save `identity-change.json` beside `candidate-compose.json`.
- Test: `host.test.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - A release with another producer → the trial's copy holds the note, and the attempt directory
    holds the file.
  - The same producer, or a `main` candidate → neither.
  - The trial still runs `--network none`, with no clock relay.
  - The Compose that `reopenImages` writes, `.env` and every env file the host writes never carry
    the note's contents.
- [ ] **Step 2: Run them and watch them fail.** `pnpm exec vitest run scripts/box/upgrades/host.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Same command → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 8: the stopped checks, the live note, and Keep

**Files:**
- Modify `scripts/box/upgrades/candidate.mjs`:
  - `:64-65`: when the attempt holds `identity-change.json`, write the note into `work/state` after
    the copy, owned as the copy is.
  - After the sale (`:172-175`), write the note into the live state folder (`marker.paths[0]`,
    A950's attempt marker) with `writeFileDurable`, owned as that folder is. Nothing else touches the
    live data during the stop. The host's hold, taken at `host.mjs:324-326`, stays held throughout
    (decision 11).
- Modify `transaction.mjs:227-232`: the Keep branch of `recoverUpgrade` refuses an attempt whose
  directory holds `identity-change.json`. Every Keep passes through it (`waitron.sh:1454` →
  `cli.mjs` → `:227`). The message: "This upgrade changes the software producer, so it cannot be
  kept after a failed check. Run `waitron.sh restore` to put the selling version back, then try
  the upgrade again."
  - **As built 2026-11-24:** the message says "so it cannot be kept.", without "after a failed
    check": Keep is also refused after a power cut stopped the checks, when none had failed.
- Tests: `candidate.test.mjs`, `transaction.test.mjs`, `host.test.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - The readiness and sale copy holds the note.
  - The live note is written last, only after every check passed, and only with a note.
  - A failing sale → no live note; Restore puts the live state back byte for byte.
  - Keep on an identity-changing attempt is refused; Keep on any other attempt is unchanged.
  - **The hold, by the order of calls** (`host.test.mjs`): no release of the hold happens between
    the stop and the live note, and the hold is released only in `resume`.
  - **An interrupted upgrade:** the live note is written, then the process stops before the attempt
    is recorded committed. Running `recover` restores the copy; the restored state folder has no
    note.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm exec vitest run scripts/box/upgrades/candidate.test.mjs scripts/box/upgrades/host.test.mjs scripts/box/upgrades/transaction.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass.** Same command → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 9 (only if decision 12 is taken): the copy is told its time is synchronised

**Files:**
- Modify `scripts/box/upgrades/host.mjs:696-743`, `clockStatusRelay`: an option
  `answerSynchronised`. With it, a `clock.status` request is still passed to the host; when the
  host's answer says `"synchronised":true` it is passed back unchanged, and otherwise (not
  synchronised, unreadable or unavailable) the relay answers a synchronised reply of the host's own
  shape (`host.test.mjs:1100-1101` shows it) and writes one line saying so into the attempt
  directory. Every other request is still refused as `forbidden`, so the copy still cannot set or
  restart anything on the host.
  - **As built 2026-11-24:** the line goes to `clock-answer.txt`, in the folder the relay is given
    as `attemptDirectory`. With the option, a host that sends nothing for a second counts as
    unavailable, since the copy stops waiting after two. If the line cannot be written, the relay
    passes on what the host said. Nothing in the code reads the line, and a finished attempt's
    folder is deleted with it, so a person can read it only while an attempt is held.
- Modify `scripts/box/upgrades/candidate.mjs:72`: the stopped checks' relay passes
  `answerSynchronised: true`. Nothing else starts a relay (`git grep -n clockStatusRelay`: only
  `candidate.mjs:8,72` and the host's own tests).
- `apps/server` does not change: `upgrade-sale.ts:161-163` and `upgrade-sale.test.ts:127-136` stay.
- Tests: `host.test.mjs`, `candidate.test.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - The relay with `answerSynchronised` over a host answering not synchronised → the client reads
    a synchronised reply, and the attempt directory holds the line. Over a host answering
    synchronised → the host's bytes unchanged, and no line. Over no host at all → synchronised, and
    the line.
  - A clock change request through it → still `forbidden`, and the host is not contacted (the
    existing case at `host.test.mjs:1094`, unedited, plus the same with the option).
  - Without the option → unchanged (the existing case, unedited).
  - `checkUpgradeCandidate` starts its relay with the option.
  `pnpm exec vitest run scripts/box/upgrades/host.test.mjs scripts/box/upgrades/candidate.test.mjs` → FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run them and watch them pass.** Same command, plus
  `pnpm --filter @waitron/server exec vitest run src/upgrade-sale.test.ts` unedited → PASS.
- [ ] **Step 4: Commit** with `git commit -s`. The pull request's first line says that every
  upgrade now runs its copy sale whatever the time service says, because the copy is told its time
  is synchronised.

### Task 10: correct every receipt the change retires

The list comes from `git grep -n "A993\|new fiscal installation" -- ':!docs/superpowers'`.

**Files:**
- `CLAUDE.md`:
  - The producer bullet at `:1026-1033` becomes "A production box opens a new installation for
    another producer only at the start of a release the checked upgrade installed, whose note names
    it, once that start's time is confirmed; every other start whose chain holds a record under
    another producer refuses `sif.producer_changed`". It names this plan's guards.
  - The start-clock bullet ("Every start of a box that files records…") gains "while an
    identity-change note waits, the start keeps waiting until the new installation is open: a
    confirmation is held until then, and two devices do not end the wait".
  - The restore and promotion bullet at `:1034` gains the identity change, with its weaker
    confirmation stated (decision 3).
  - `:692`: "holds a failed check for Restore or Keep" gains "(Restore only when it changes the
    producer)".
- `.github/workflows/ci.yml`: the comment at `:4692-4694`, and the refusal message at `:4734-4737`,
  which becomes "…and production boxes refuse to start on it unless it is installed as an upgrade,
  which opens a new fiscal installation. To publish it anyway, set…".
- `docs/developers/conventions-data.md`: the topic file's copy of the sale-path bullet ("Nothing
  external may block a sale…") gains what CLAUDE.md's gains. PR 2 already added the hold to "Every
  start confirms the box's time before it trades".
- `docs/operations/release.md:391-397`: **rewrite** "When the producer or the system code changes".
  The new text covers: set the three secrets, set `WAITRON_PRODUCER_CHANGE_ALLOWED`, install as an
  upgrade, a person confirms the time on a till or Box status if the box's time service is not
  synchronised (only with decision 12; otherwise the box waits for its time service), what
  `sif.identity_change_blocked` means, and the two-box limit.
- `docs/compliance/action-plan.md:219`.
- `docs/backlog.md:238`: the A940 entry's "until A993 lands" and "1b (A993) waits …".
- `docs/backlog.md:242-246`: delete A993.
- `docs/backlog.md`, A950's entry: the two lines this branch added stay (two-box venues get the
  producer change with paired upgrades; the go-back refuses an attempt whose opening has
  committed). If decision 12 is taken, "requires a successful disposable-copy sale" gains "with the
  copy told its time is synchronised".
- `docs/backlog/fiscal.md:1566-1571` and `:1578`.
- `docs/backlog/fiscal.md:1584-1624`: delete A993, and move the owner's constraint and decisions
  1–4, 7 and 12 to `## Decisions and deliberate limits` (`:1086`).
- `docs/compliance/2026-11-19-adviser-meeting.md`: a dated pointer only, since it is a
  historical record (PR 1 added one for the owner's "build it"; PR 3's says the change is usable).
- `deploy/waitron.sh:44`: the help line "keep … start the candidate despite its failed checks"
  gains "(not for an upgrade that changes the software producer)".
- The design's §5.6 (`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`):
  a dated pointer in its header, beside the existing ones at `:9-18`. It says this plan opens the
  installation at the new release's first start whose time is confirmed, through the existing
  start-clock confirmation, in place of the stuck page and the clock reading carried across the
  stop.
- `apps/server/src/i18n/recovery-page.ts:308-320` and its test (the table above).
- `apps/server/src/guide/en/fiscal-filing.md` and `es/fiscal-filing.md`: the list of identity
  changes "other than by a handover" now also leaves out a producer change; prefer deleting the
  exception to adding to it (the guide rule against explaining what the code handles itself).

- [ ] **Step 1: Change the test first.** Change `recovery-surface.test.ts:440-462` to the new
  words. `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts` → FAIL.
- [ ] **Step 2: Correct the files.** Change the words and every file above.
- [ ] **Step 3: Run the checks.**
  - The test → PASS.
  - `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/ci-workflow.test.mjs` → PASS.
  - The same `git grep` finds only this plan and the dated pointer.
- [ ] **Step 4: Commit** with `git commit -s`.

## Risks to which chain a record joins

| Risk | Guard |
| --- | --- |
| A sale joins the old chain under the new producer | `checkFilingIdentity` at every start (`boot.ts:2595-2598`) and in every check (`upgrade-checks.ts:90`) refuses unless a note names the change; the start keeps waiting, so the gate holds every record, while the note waits (Task 5a) |
| A sale or record before the opening | The start stays waiting while a note waits; a confirmation is held, not applied, until the opening commits (Task 5a); two devices never end that wait (Task 5a) |
| The opening on a box that is no longer alone, or no longer the serving primary | `mayOpen` inside the opening's transaction (Tasks 3 and 5b); the clock watch stops at a stepdown (`job-catalogue.ts:26`) |
| An opening that keeps failing holds sales with no word or way out | The start stays waiting, so the notice and Check the time stay; `sif.identity_change_blocked` for a refusal that is not about the clock (Task 5b) |
| The old release, started by hand after the opening, writes the new installation's first record | Not guarded, by the owner's answer of 2026-11-22: releases are never started by hand (decisions 1 and 2) |
| A stray note opens one | Only the host writes it, after the checks pass; it must name this release, this producer and the head's (Task 2, case 2; Task 4) |
| Another caller opens one | A private, one-use authority, refused for every other action (Task 1) |
| A name from a wrong clock, or one already used | A synchronised time service, or a person's confirmation (decision 3, weaker than §5 in six stated ways); the release floor, the history, `installation_used` (Tasks 2, 3, 6a and 6b) |
| A half-made change | One transaction through the unchanged activation; the live note is written only after the checks pass, and a failed or interrupted stop restores the copy without it (Task 8) |
| Two venues of one taxpayer take the same minute | A947's disclosed limit; one main box at a time |

## Not established

- What Box status shows for an automatic attempt refused at the copy sale because the time service
  was not synchronised. A950's existing handling of a failed check applies; I read it, I did not
  run it.
- That A950's resume passes while the new release waits for its time. Inferred from `/health`
  answering 200 during the wait (run) and the container's health check reading `/health` (read). I
  did not run a resume.
- That orders reach the kitchen while a note waits. Read from the gate's list
  (`start-clock-gate.ts:8-14`), not run; Task 5a can add a case if the reviewer wants one.
- That no other path opens an installation on a sole serving primary while it runs (decision 9).
  Read, not run; `installation_used` catches a race inside the transaction either way.
- Whether a stepdown can begin while an opening's transaction is open. The role check inside the
  transaction covers a stepdown that has already happened, and the clock watch stops at a
  stepdown; a stepdown that starts during the transaction itself was read, not run (the stepdown
  aborts duties and then closes them, `handover-stepdown.ts:181-213`; I did not find whether it
  waits for `venue.db`'s write lock). Task 5b's stepdown cases cover an attempt not yet begun and, by
  halting the watch, one still reading the time service.
- A history that stays broken (`history_invalid`) has no way out an operator can take: Restart the
  box only tries again. Restore and promotion refuse the same history. I did not design one; the
  owner may want one before go-live.
- What decision 12's helper form does to the copy beyond its sale: the copy believes its time
  service is synchronised for the whole check. Read only: the copy runs with no network
  (`candidate.mjs:115-128`) and the relay refuses every request but `clock.status`
  (`host.mjs:712-715`).
- The opening has never run on a real box. Writing the note into the live state folder inside the
  upgrade's stop on Linux is unqualified until a physical box upgrade, which A950 itself still lists
  as open.
