# A993 — a change of producer opens a new fiscal installation by itself: build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: plan, refreshed 2026-11-22 on `main` at `dbf567d417`, revised after fresh reads 1 and 2
(`~/waitron-campaign-l/receipts/a993-plan-read-{1,2}.md`), then after the owner's answer of
2026-11-22; for the owner's choice on decisions 3 and 12. Fiscal: the owner lands every pull
request.** Every `file:line` below was read on that commit. Besides the `git grep`/`grep` commands
quoted, two things were run, both listed in "Changed after the owner's answer". What no longer held
from the 2026-11-11 version is in "What changed since 2026-11-11"; what each review changed is in
the "Changed after" sections.

**Goal:** a production box upgraded to a release whose producer differs from its chain's opens a
new installation (new chain, new five-symbol installation name, new series from 1) by itself and
trades, but only when the upgrade's own note names that new producer; any other start with a
different producer refuses `sif.producer_changed` as today.

**Architecture:** A950's checked upgrade, the path every install on a running box takes, works out
from the old and new images whether the release changes the producer. If it does, the host writes
a note naming the release, the new producer and the old one: into the copy each check runs on, and,
once every check has passed, into the box's live state folder during the stop. The new release
reads the note at its start. When the note names this release, this producer and the chain head's
producer, the start does not refuse. Instead it holds every sale and record, through the start-clock
gate that already holds them while a start waits for its time, until the installation is open. It
opens the installation as soon as the start's time is confirmed: at once when the box's time service
is synchronised, otherwise when a person confirms the time on a till or on Box status through the
existing routes (decision 3). The stopped sale check runs the same opening on its copy before the
live data is touched. A start with no note, or a note naming something else, refuses
`sif.producer_changed` as today. The opening uses the activation that restore and the conflict
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
  - otherwise, once a person confirms the time on a till or on Box status (decision 3).
  Records already made keep the old producer and are sent unchanged (`drain.ts:648` groups by SIF).
- **Limited by A950, not by this plan, unless decision 12 is taken:** the checked upgrade's copy
  sale fails every upgrade whose box's time service is not synchronised at that moment
  (`upgrade-sale.ts:161-163`, run below). So without decision 12, the person route covers only a
  time service lost between the copy sale and the new release's start.
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
  is weaker than §5 asks for a restore or a promotion, in the three ways decision 3 states. Two
  devices alone are never used.
- Database writes go to `venue.db` only (the four tables `allocation.ts:435-478` writes). The note is
  a file in the state folder, written only by the upgrade's host and deleted only by the server.
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
    `src/till-box-clock-api.test.ts`.

  Decision 12, if taken, reverses one case of `upgrade-sale.test.ts` in PR 3 (the table below).

## What changed since 2026-11-11

1. **A950 built the checked upgrade.** Every install on a started box goes through
   `cmd_checked_install` (`deploy/waitron.sh:1098`, called at `:1279-1288`) into
   `scripts/box/upgrades/cli.mjs:332-431`. The steps:
   - an online trial on a copy while the old release sells (`host.mjs:758`, called at `:284`);
   - stop, then a stopped copy;
   - readiness and a real sale on a second copy (`candidate.mjs:39`);
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
  attempt committed but not cleaned up, so later applies are refused (`cli.mjs:384`). The design
  then changed so that no start waited. **Superseded 2026-11-22:** that wait was this plan's own
  in-boot wait, not the ordinary start-clock wait, which has neither problem; see "Changed after the
  owner's answer".
- **I3:** the checks task drops its role and fencing reads. A box that reaches the checks is always a sole
  serving primary (`host.mjs:500-556`). The two-box limit is stated above.
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
- **I1:** once the installation is opened, the chain head is empty (`allocation.ts:455-461`), and
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

   **What 1 and 2 leave open.** The opening empties the chain head (`allocation.ts:455-461`), and
   the start check returns when there is no head (`producer-change.ts:31`). So between the opening
   and the first record, a start under any producer passes. Since the new release opens the
   installation itself (decision 3), this can happen only if someone stops the new release after it
   opened the installation, before its first record, and starts the old images by hand, and the two
   releases differ in no migration (otherwise `assertNotAhead` refuses the old one). The old release
   would then write the first record of the installation opened for the new producer, naming its own
   producer truthfully, and the new release's next start would refuse `sif.producer_changed`. No
   guard is built. The owner, 2026-11-22: "there should be no releases started by hand, so no need
   for a guard." The plan's claim is therefore: every start whose chain has a record under another
   producer, and no note naming the change, refuses.
3. ★ **The new release opens the installation at its start, once the start's time is confirmed by
   the existing means.**
   - **When:** with the time service synchronised, at the start's own look, before the listener
     opens (`boot.ts:3931-3945`). Otherwise when a person ends the start's wait on a till or on Box
     status through the routes listed above. While a note waits, two devices alone do not end the
     wait, as they already do not end a wait caused by AEAT's future-date refusal
     (`start-clock-check.ts:107`).
   - **The second clock:** the time service as before, or the person's confirmation, read as
     `compareHourClocks` with `boxClockAlone` (`hour-clock.ts:67-70,131`), used only while the box's
     clock has not stepped since the confirmation. A restore's start carries its page's choice under
     the same condition (§5).
   - **Weaker than §5's naming rule, in three ways.** (a) The person is any staff member the till
     admits or a Box administration holder, not someone proved by the setup password, a recovery key
     or a `node.manage` sign-in. (b) "Keep the box's time" and Box status's confirm carry no second
     clock at all, only the person's reading of the box's time. (c) The till's and Box status's
     agreement margin is 60 seconds, not 30. A clock behind the release's date is still refused by
     the release floor. A clock a person accepts while it is far ahead names the installation for
     that future minute, and this step's minute rule (decision 9) then refuses another identity
     change until real time passes it. I did not check what a restore or a promotion does then.
   - **Option 1 (recommended):** accept every existing confirmation except two devices alone, as
     above. It is the owner's existing solution and needs no new words.
   - **Option 2 (closest to §5):** accept only the time service, or a Box administration holder
     whose device the box measured within 30 seconds, or who set the box's clock from that device.
     It needs Box status's confirm to send the device's time (today it sends only `challengeId` and
     `asShown`, `box-status-screen.ts:459,512`), "keep" withheld while a note waits, and new refusal
     words on the till and Box status offering the administrator's sign-in there. So ★7 would not
     hold for it, and Task 6 grows.
4. **No stuck page, and no new clock route.** While a note waits, the box behaves as any start that
   waits for its time: up, answering `/health`, reaching the kitchen. Sales and records refuse
   `clock.unconfirmed`, and staff see the existing waiting notice (`clock-unconfirmed-alert.ts:20`)
   and the till's Check the time (`apps/till/src/widgets/box-time-dialog.ts`). The cases:
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
   - **The opening refused after a person's confirmation** (the release floor, or the clock stepped
     since): the box goes back to waiting (`backToWaiting`, `start-clock-check.ts:99-105`), and the
     till offers Check the time again, including setting the box's clock from the till.
   - **The opening refused after the time service confirmed it** (`minute_in_use`): it retries every
     15 seconds, the clock watch's period, while the note waits.
   - **The opening throws unexpectedly at the start:** it is caught and logged, the gate keeps
     holding, and it retries as above. It never fails the start, so read 1's I2 does not return.
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
     folder's owner. It goes into the online trial's copy between capture and trial
     (`host.mjs:766-770`) and into the stopped checks' copy (`candidate.mjs:64-65`). Once every
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
   - **Disclosed limit:** root on the box can write the note by hand, as root can edit the database.
7. ★ **No new words in the upgrade's report or on any screen** (under option 1 of decision 3). A
   refused opening on a copy carries `sif.identity_change_waiting` with its reason as A950's failure
   text, and Box status shows A950's ordinary deferral or rollback. At the start, the reason is
   logged and the existing waiting notice shows. The design's three Spanish report lines are not
   built. Option 2 of decision 3 would need new refusal words.
8. **Order PR 1 → 2 → 3.** Nothing writes a note until PR 3.
9. **The minute.** The opening takes the box's current minute. It refuses `minute_in_use` when any
   used minute is that minute or later, and retries as decision 4 says. There is no 150-second wait
   and no settle, as for `promote`; the shared rule in `hour-selection.ts:541-566` stays untouched.
   Inside its transaction the opening repeats its reads, and the used-name refusal
   (`installation_used`, `allocation.ts:103-114`) catches a name taken in between. The box is a sole
   serving primary (`host.mjs:500-556` refused any other at the upgrade). I believe no other path
   opens an installation on a sole serving primary while it runs; that was read, not run.
10. **`openIdentityChange` takes `Database` and opens its own transaction.** It reads the time
    service (up to 2 seconds, `hour-clock-time-service.ts:4`) outside the write lock. This is
    stated as a commented decision at its site (CLAUDE.md §3). The server calls it after the
    confirming request's transaction has committed, never inside it.
11. **No container opens the live database during the stop.** The host writes the note into the
    live state folder itself, under the hold it took at the stop (`host.mjs:324-326`), which holds
    `venue.lock`. So CLAUDE.md §3's "file-changing commands take `lockVenueDatabase`" needs no
    exception. **Where the opening is recorded:** the `fiscal_allocations` row
    (`allocation.ts:466-478`) is the durable record, and the server logs the opening.
12. ★ **May the copy sale run on a box whose time service is not synchronised?** This applies to
    every upgrade, not only a producer change.
    - **Today:** it fails (`upgrade-sale.ts:161-163`, run above), so such a box gets no upgrade at
      all.
    - **Proposal:** inside `checkUpgradeSale` only, the copy's start counts as confirmed by the box's
      own clock. The copy and its record are thrown away; the sale must still succeed. The live box
      then starts the new release and waits for its time as after any restart (`/health` answers
      while it waits: run above).
    - **What it changes:** A950's rule that a test sale fails on "the same refusal as the source"
      (`2026-11-09-a950-shorter-upgrades.md:36`), for one refusal, `clock.unconfirmed`.
    - **Without it,** decision 3's person route covers only a time service lost between the copy
      sale and the new release's start.
    - **Recommended: yes**, as Task 9. I did not check how often a box that can fetch a release
      lacks a synchronised time service: a release arrives over the internet, or by the signed
      manual install.

## Changed test checks

| Check | Before | After |
| --- | --- | --- |
| `apps/server/src/recovery-surface.test.ts:440-462`, the `sif.producer_changed` words (Task 10) | EN title "…and this version of Waitron cannot open one, so the box will not sell."; action "…Changing the producer needs a Waitron version that can open a new fiscal installation, which does not exist yet." (ES likewise) | EN title "This box has been given a different software producer from the one its invoices were recorded under, without the upgrade that opens a new fiscal installation for it, so the box will not sell."; action "Install a Waitron version that names the same producer as this box's invoices. A version with a new producer opens its new fiscal installation by itself when it is installed as an upgrade." ES: "…sin la actualización que le abre una nueva instalación fiscal, así que el equipo no venderá." / "Instala una versión de Waitron que indique el mismo productor que las facturas de este equipo. Una versión con un productor nuevo abre su nueva instalación fiscal por sí sola cuando se instala como actualización." |
| `apps/server/src/upgrade-sale.test.ts:127-136`, only if decision 12 is taken (Task 9) | "fails the upgrade when the host has not confirmed this start's clock": rejects with `clock.unconfirmed` | "sells on the copy when the host's time service is not synchronised, the copy's start confirmed by the box's own clock" |

No other check reverses. `git grep -n "producer_changed" -- '*.test.*'` lists:
- `boot.producer-change.test.ts:171-180`: still refuses;
- `producer-change.test.ts:59,168,189`: unchanged;
- `recovery-surface.test.ts:440-633`: the words above; the retry list at `:601-633` stays true.

## Review focus

1. **A sale before the opening:** the gate holds while a note waits, including after the start's
   time is confirmed and until the opening commits (Task 5).
2. **Two devices never end a wait while a note waits** (Task 6).
3. **A copy opening that fails at the stopped sale check:** A950 restores the copy as for any failed
   check, and no live note exists yet (Task 8).
4. **A crash after the live note is written but before A950 commits:** recovery restores the copy,
   which removes the note (Task 8). Keep is refused.
5. **A backup after the change verifies**, and a restore reads its history (Task 3, case 4).
6. **The note reaches the running app only through the live state folder:** the reopened Compose,
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
  It calls `withOperationAuthority` (`operation-authority.ts:51`) with the operator
  `identity-change:<release>`, adds the authority to a module-private `WeakSet`, and removes it in
  `finally`.
- `isIdentityChangeAuthority(authority: unknown): boolean`.
- Neither is exported from `index.ts`.
- Each list accepts `identity-change` only when `isIdentityChangeAuthority` holds, and refuses an
  identity-change authority for every other action. `:304` admits `identity-change` beside
  `promote`.

- [ ] **Step 1: Write the failing tests.**
  - An authority from `withOperationAuthority` with the action `identity-change` →
    `withHourAdmission` refuses `reauthentication_required`.
  - An identity-change authority with the action `restore` → refused.
  - The authority after `run` settles → refused.
  - Proof by deletion: delete the `WeakSet` check, and the first case must fail.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/identity-change-authority.test.ts` → FAIL.
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
   `history_invalid`. A used minute at or after the box's minute → `sif.identity_change_waiting`
   `minute_in_use`.

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
  7. The current minute already in the history → `minute_in_use`.
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

**Produces:** `openIdentityChange(db: Database, nodeId: NodeId, note: IdentityChangeNote, secondClock: SecondClock): Promise<"opened" | "nothing-to-open" | "not-named">`.

How it works:
- It plans first, then in one `withTransaction` repeats the plan's reads and refuses if they moved.
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
- [ ] **Step 2: Run them and watch them fail.** Same command as Task 2 → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the fiscal gates and
  `src/backup-verification-history.test.ts` unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

## PR 2 — a note lets the checks and the start through, and the start opens the installation

Result: no behaviour change until PR 3, because nothing writes a note yet. With a note in place, the
checks pass the producer refusal, and a start holds its sales until it has opened the installation.
About 180 production lines and 400 test lines.

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

### Task 5: the start holds, and opens when the time service confirms it

**Files:**
- Create: `apps/server/src/identity-change-opening.ts`. One routine that calls the seat's
  `openIdentityChange`, deletes the note once it answers `opened` or `nothing-to-open`, and then
  lifts its hold. It never throws to its caller: a refusal is logged with its reason, and the
  routine retries every 15 seconds while the note waits and the start stays confirmed.
- Modify: `apps/server/src/boot.ts:2583-2598`. The note is read from the state folder and passed to
  `checkFilingIdentity`. A pending answer sets the hold. `startClockGateHolds`
  (`start-clock-gate.ts:19-25`) gains a third input, so the gate holds while the note waits.
- Modify: `boot.ts:3931-3945`. When the start's look answers `by_internet` and a note waits, the
  routine runs before the listener opens, with `{ kind: "time-service" }`. The `onConfirmed` callback
  (`boot.ts:2583`) also runs it, after the confirming transaction, when a later look of the clock
  watch confirms by the internet.
- Tests: a new `boot.identity-change.test.ts`, on the production harness of
  `boot.producer-change.test.ts:50-169`; `upgrade-sale.test.ts` (new case only).

- [ ] **Step 1: Write the failing tests.**
  - With a note and the time service synchronised: the first sale answers 200 and stores
    `PrimerRegistro` under the new name, and the note is gone.
  - With a note and the time service unsynchronised: a sale answers 409 `clock.unconfirmed`, no
    record is written, `/health` answers 200, and the note is still there.
  - With no note: still `sif.producer_changed` (the existing case, unedited).
  - With the minute planted in the history: the sale stays refused, and once the plant is removed
    the next retry opens it.
  - The opening throws once (a stubbed seat): the start still finishes, and the gate still holds.
  - The copy sale (`upgrade-sale.test.ts`) with a matching note and a synchronised time service: its
    record starts the new chain.
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.identity-change.test.ts src/upgrade-sale.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and watch them pass**, with the start-clock suites listed under "Global
  constraints" unedited → PASS.
- [ ] **Step 5: Commit** with `git commit -s`.

### Task 6: a person's confirmation opens it; two devices do not

Written for option 1 of decision 3. If the owner takes option 2, this task is rewritten before
dispatch.

**Files:**
- Modify: `apps/server/src/start-clock-check.ts:106-115`. `confirmDevices` answers none while a note
  waits, as it does while AEAT's future-date refusal is the cause.
- Modify: `boot.ts`, the `onConfirmed` wiring. A wait ended by a person schedules the routine of
  Task 5 with `{ kind: "confirmed-start", standing }`. `standing` answers true while the clock
  correction's step count is unchanged since the confirmation and the wall clock has not moved
  against the steady clock (`wallMovedAgainstSteady`, `clock-correction.ts`). When that opening is
  refused for its clock, or for `confirmation_stale`, the routine sends the box back to waiting with
  `backToWaiting("start")`.
- Tests: `boot.identity-change.test.ts`, `start-clock-check.test.ts` (new cases only).

- [ ] **Step 1: Write the failing tests.**
  - A note and the time service unsynchronised, then a till confirmation that agrees
    (`POST /api/box-clock/confirm`) → opened; the next sale answers 200 under the new name.
  - The same with "keep the box's time" → opened.
  - The same with Box status's `POST /api/box/clock-confirm` → opened.
  - Two devices agreeing within 5 seconds → still waiting, nothing opened. Control: with no note,
    the same two devices end the wait.
  - A confirmation followed by a clock step before the opening → back to waiting, nothing opened.
  - A box clock before the release floor and "keep" → back to waiting. Then a set from the till →
    opened.
  - Look at the waiting notice while a note waits and two devices agree, and say what it shows. If
    it suggests that devices will end the wait, stop and report: that would need new words (★7).
- [ ] **Step 2: Run them and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.identity-change.test.ts src/start-clock-check.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
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
  - `:766-770`: write the note into the trial's copy, after capture and before the trial, owned as
    the copy is;
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

### Task 9 (only if decision 12 is taken): the copy sale on a box whose time service is not synchronised

**Files:**
- Modify: `apps/server/src/upgrade-sale.ts:159-166`. When the time service is not synchronised,
  start the copy's server with its start confirmed by the box's own clock instead of throwing. This
  goes through a boot option that only `checkUpgradeSale` passes. A copy with a note then opens its
  installation with `{ kind: "confirmed-start", standing: () => true }`.
- Modify: `boot.ts`, the option, beside the `startClockState` call at `:2583`.
- Test: `upgrade-sale.test.ts` (the reversed case in the table above), and a guard case that an
  ordinary start never takes the option (`boot.start-clock-gate.test.ts`'s first case, unedited,
  still refuses a sale with 409).

- [ ] **Step 1: Change the test first.** Reverse `upgrade-sale.test.ts:127-136` as the table says,
  and add: an unsynchronised copy with a note → its sale starts the new chain.
  `pnpm --filter @waitron/server exec vitest run src/upgrade-sale.test.ts` → FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run it and watch it pass**, plus `src/boot.start-clock-gate.test.ts` unedited → PASS.
- [ ] **Step 4: Commit** with `git commit -s`. The pull request's first line says that every upgrade
  now runs its copy sale whatever the time service says.

### Task 10: correct every receipt the change retires

The list comes from `git grep -n "A993\|new fiscal installation" -- ':!docs/superpowers'`.

**Files:**
- `CLAUDE.md`:
  - The producer bullet at `:1026-1033` becomes "A production box opens a new installation for
    another producer only at the start of a release the checked upgrade installed, whose note names
    it, once that start's time is confirmed; every other start whose chain holds a record under
    another producer refuses `sif.producer_changed`". It names this plan's guards.
  - The start-clock bullet ("Every start of a box that files records…") gains "while an
    identity-change note waits, two devices do not end the wait".
  - The restore and promotion bullet at `:1034` gains the identity change, with its weaker
    confirmation stated (decision 3).
  - `:692`: "holds a failed check for Restore or Keep" gains "(Restore only when it changes the
    producer)".
- `.github/workflows/ci.yml`: the comment at `:4692-4694`, and the refusal message at `:4734-4737`,
  which becomes "…and production boxes refuse to start on it unless it is installed as an upgrade,
  which opens a new fiscal installation. To publish it anyway, set…".
- `docs/operations/release.md:391-397`: **rewrite** "When the producer or the system code changes".
  The new text covers: set the three secrets, set `WAITRON_PRODUCER_CHANGE_ALLOWED`, install as an
  upgrade, a person confirms the time on a till or Box status if the box's time service is not
  synchronised, and the two-box limit.
- `docs/compliance/action-plan.md:219`.
- `docs/backlog.md:238`: the A940 entry's "until A993 lands" and "1b (A993) waits …".
- `docs/backlog.md:242-246`: delete A993.
- `docs/backlog.md`, A950's entry: the line added on 2026-11-22 stays (two-box venues get the
  producer change with paired upgrades). If decision 12 is taken, "requires a successful
  disposable-copy sale" gains "whatever the time service says".
- `docs/backlog/fiscal.md:1566-1571` and `:1578`.
- `docs/backlog/fiscal.md:1584-1624`: delete A993, and move the owner's constraint and decisions
  1–4, 7 and 12 to `## Decisions and deliberate limits` (`:1086`).
- `docs/compliance/2026-11-19-adviser-meeting.md:463`: a dated pointer only, since it is a
  historical record.
- `deploy/waitron.sh:44`: the help line "keep … start the candidate despite its failed checks"
  gains "(not for an upgrade that changes the software producer)".
- The design's §5.6 (`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`):
  a dated pointer in its header, beside the existing ones at `:9-18`. It says this plan opens the
  installation at the new release's first start whose time is confirmed, through the existing
  start-clock confirmation, in place of the stuck page and the clock reading carried across the
  stop.
- `i18n/recovery-page.ts:308-320` and its test (the table above).

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
| A sale joins the old chain under the new producer | `checkFilingIdentity` at every start (`boot.ts:2595-2598`) and in every check (`upgrade-checks.ts:90`) refuses unless a note names the change; the gate holds every record while the note waits (Task 5) |
| A sale or record before the opening | The start-clock gate holds while a note waits, even once the start's time is confirmed (Task 5); two devices never end that wait (Task 6) |
| The old release, started by hand after the opening, writes the new installation's first record | Not guarded, by the owner's answer of 2026-11-22: releases are never started by hand (decisions 1 and 2) |
| A stray note opens one | Only the host writes it, after the checks pass; it must name this release, this producer and the head's (Task 2, case 2; Task 4) |
| Another caller opens one | A private, one-use authority, refused for every other action (Task 1) |
| A name from a wrong clock, or one already used | A synchronised time service, or a person's confirmation (decision 3, weaker than §5, stated); the release floor, the history, `installation_used` (Tasks 2, 3 and 6) |
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
  (`start-clock-gate.ts:8-14`), not run; Task 5 can add a case if the reviewer wants one.
- That no other path opens an installation on a sole serving primary while it runs (decision 9).
  Read, not run; `installation_used` catches a race inside the transaction either way.
- What the waiting notice shows while a note waits and two devices agree (Task 6 looks).
- The opening has never run on a real box. Writing the note into the live state folder inside the
  upgrade's stop on Linux is unqualified until a physical box upgrade, which A950 itself still lists
  as open.
