# A1420: every start confirms the box's time before it trades — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**Revision 5 (2026-11-10), cleared by the watcher 2026-11-10 17:28 (a watcher decision, not an owner approval).** Revision 4 answered the owner's Q1-Q4 and the 15:06 narrowing. Revision 5 holds the watcher's batch of 16:24 (`waitron-campaign-b/questions.md`, "WATCHER 2026-11-10 16:24"): the owner's later answers, the second read of revision 4 (`waitron-campaign-b/receipts/a1420-rev4-fable-review.md`, 14 findings) and the watcher's own review (`waitron-campaign-b/receipts/a1420-rev4-watcher-plan-review.txt`, 3 points). The owner's words are quoted where the plan rests on them, with their files under `waitron-campaign-shared/desk/done/`.

**What changed from revision 4.**

- **PR 2's stop reacts once** (finding 1, Critical, and the watcher's point 1). A refusal by AEAT of a sale dated in the future (code `1112`) sends the box back to waiting only when that sale was recorded after the box's time was last confirmed or corrected; a person checks the time, and the box carries on. It never compares the clock with a refused date again, so a correct box is never stopped on the refused date. A box kept in time by the internet never goes back to waiting (finding 9, decided once in D3).
- **Correctly dated sales never wait behind a refused future-dated one** (owner, 15:31: "No waiting"). A run of `1112` refusals no longer starts a hold on the rest of the chain. This changes the filing loop, `packages/fiscal-verifactu/src/drain.ts`, which is fiscal code; it is PR 2's Task 10b, with its own tests (D11). With no hold, there is no hourly retry that turns one more sale into a refused record (finding 2).
- **Tablets at the PIN screen count** (owner: "Count PIN-screen tablets (Recommended)"): two switched-on tills or handhelds confirm the box's time with nobody signed in. A small till change (Task 4b, now PR 1c).
- **The waiting words say the box is waiting for devices to connect and agree with its time**, with how many have agreed so far, on the till, the bell alert and the Box status row (owner: "we should say that we're waiting for devices to connect on the waiting screen").
- **The till's "Check the time" offers both "The server's time is right" and "Use this time"** while the box waits (finding 3); today it shows one button, chosen by whether the clocks differ.
- **AEAT never confirms a start** (owner on finding 5: "NTP is the answer for now").
- **A box whose clock service does not answer waits at every start, and the alert and Box status say why** (finding 4, D12). No owner question: the owner's rule already covers it.
- **The watch reads the time service at most once a minute**, through the reading every other reader shares (finding 10).
- **A confirmation that sets nothing writes a log line, not a database row** (the watcher's point 3); a correction still writes the row every clock set writes.
- **PR 1 is split into PR 1a** (the start check, the gate, devices and staff on tills) **and PR 1b** (the administrator's routes, the bell alert, Box status and its guide), each usable alone (the watcher's point 2). At the watcher's clearance 1a is split again, into 1a, 1c and 1d (below).
- **PR 5 also changes three server suites revision 4 missed**, one of them the control of a §5 guard; what each asserts instead is decided (finding 7).
- Q5 is answered ("Orders still go (Recommended)"); D6's and PR 4's sources are cited at the watcher's relays; Task 18c's case counts are corrected (finding 14).
- Findings 8-14 each have a row in "Review responses".
- **Corrected after the fresh review of revision 5** (same day): the `1112` exemption sits in the claim-time hold only, so a chain already held still drains (D11); the waiting confirmations no longer promise "every manager is told" (D3, "Words"); staff are admitted while waiting even when today's start-up window is shut (D1); the device count uses the confirming group rule; Task 6 is split into 6a and 6b, with 6b's size re-estimated; the client's "still sells" comment, a never-built 2026-11-06 sentence and the midnight limit are added; the PIN screen shows the waiting line (a reading); "Readings for the watcher" lists the five choices made without an owner question.

**Folded in at the watcher's clearance** (`waitron-campaign-b/questions.md`, "WATCHER 2026-11-10 17:28 — A1420 revision 5: CLEARED with two changes"; no further review):

- **PR 1a is split again**, because about 1,570 lines would not open in 3 hours. Task 4b (tablets at the PIN screen report their clock and show the waiting line) becomes **PR 1c**, a till-only PR after 1a. Task 6b's table of money routes becomes **PR 1d**, landing before PR 5; Task 6b's cases for the four writers stay in 1a, in Task 6a. Until PR 5 deletes them, the existing `clock-behind-stop.*` suites keep each money route guarded, and the gate wraps that same function, the seat's `refuseWhileClockBehind`. 1a comes to about 295 production and 390 test lines.
- **Task 7a's sentence** now reads "`keep: true` is refused once the start check is `by_internet`", so it cannot be read as refusing "The server's time is right" while the box waits.
- **Readings 1-5 are confirmed as they stand.** Reading 3 now puts the till guide's sentence in PR 1c, the PR that changes the till's PIN screen.

**Changed by PR 1a's review (2026-11-11), against the plan text at lines 17, 27, 73, 170-171 and 532 of this file** (receipts: PR #2808's thread and `docs/developers/conventions-data.md`):

- A confirmation that sets nothing still writes no row of its own, but when a clock stop also holds it writes the old stop's confirmation row in the same transaction.
- `keep: true` ("The server") is not offered while a clock stop holds, and is refused `stopped` then, leaving the start-up window open, even after the internet has confirmed the start.
- A set at reason `start` writes its row at reason `behind_chain` while the clock-behind stop holds, so it ends that stop, and then refuses a person `witnessed`, as main does at that reason, once AEAT has a reading taken during the stop.
- Open for the owner: a set at the start that moves a clock not behind the latest record to more than a minute behind it leaves the clock-behind stop in force after the start is confirmed; a person's "Yes" then lifts it while the till still offers "Check the time".

Earlier revisions are in this branch's history (`git log docs/a1420-start-clock-plan`). Task numbers are kept from revision 3 so earlier notes still point at the right task; Tasks 5 and 13 are gone, and Tasks 4b, 6a, 6b, 7a, 7b, 9a, 9b and 10b are new halves.

**What a person can do when this lands.**

- **PR 1a.** A box that starts with no internet takes no payment and writes no fiscal record until its time is confirmed; orders still reach the kitchen. It confirms by itself once its time service reaches the internet, or once two tills or handhelds with staff signed in show the same time as the box to within 5 seconds. Staff signed in on a till see "Payments wait: the server is waiting for devices to connect and agree with its time (1 of 2 so far)" and can use "Check the time" to keep the server's time or use the till's.
- **PR 1b.** Administrators are told on the bell and the Box status page, and can confirm the date and time there, or set the box from their own device's time, with no till and no internet.
- **PR 1c.** Tills and handhelds left at the PIN screen count too: two switched on and connected confirm the box's time with nobody signed in, and the PIN screen shows the waiting line with its count (reading 5). The till guide says what to do.
- **PR 1d.** Nothing new to see: one table of tests shows every money route refusing while the box waits, so PR 5 can delete the old stop's route suites.
- **PR 2.** When AEAT refuses a sale recorded since the time was last confirmed by devices or a person, because its date was in the future, the box stops taking payments until someone checks the time, once. Correctly dated sales keep filing behind refused ones.
- **PR 3.** A restore on a box whose time service is synchronised names its series without asking AEAT.
- **PR 4.** A restore that can reach neither its time service nor AEAT waits and retries every minute without bringing up the start-failure page; when that page does show because the clock moved during the check, it says so.
- **PR 5.** A sale is never refused because the clock reads earlier than the last sale.
- **PR 6.** The old stop's code is gone from the server, tills, dashboard and fiscal module.

**Order.** PR 1a first. PRs 1b, 1c and 1d each build on 1a alone and can be opened in any order once it lands; 1c carries the till guide for 1a's till changes, so it should follow soon after. PR 1d must land before PR 5, which deletes the suites 1d's table replaces. Then PR 2 (built on 1a and 1b), PR 3, PR 4, and PRs 5 and 6 together.

**Base:** `1252e2b6b3`, this branch's merge base with main. Line numbers are on that commit; on later main some sit a few lines higher (`nodeBackend` is `boot.ts:2074` here, `:2071` on `049ddd9db9`, `:2070` on `9e497a0a7f`), so match by name.

**Review weight: FULL, every PR.** Risk triggers: the clock in front of fiscal records and series naming (a fiscal invariant), a cross-package contract (`ModuleOperationHost`, PR 3), what the chain's append refuses (PR 5), and what the filing loop holds (PR 2). The plan gets a fresh-context review before any implementer is dispatched; each PR's `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). Every PR **waits for the owner** to land it.

## Words used in this plan

- **Time service / synchronised**: the host's own internet time keeper (systemd-timesyncd or chrony) and the `NTPSynchronized` flag the host service reads with `timedatectl show` (`deploy/box/waitron-box.sh:59-62,93`). The time service sets the clock itself; Waitron only reads the flag.
- **Host service**: the small root program outside Waitron's container that can read the time service and set the clock (`deploy/box/waitron-box.sh`), asked through `apps/server/src/box-host-client.ts`, which waits up to 2 s for a status (`DEFAULT_STATUS_MS`, `:43`) and 20 s for a set (`DEFAULT_SET_MS`, `:45`). It refuses to set while synchronised (`waitron-box.sh:118-121`). systemd starts one copy of it per request (`deploy/box/waitron-box.socket`, `Accept=yes`). The server shares one status reading a minute among all its readers (`boot.ts:3060-3062`).
- **AEAT's time**: the `Date` header of a reply from AEAT's servers over a checked HTTPS connection, read by `readAuthorityTime` (`packages/fiscal-verifactu/src/authority-time.ts`, 5-second limit). After revision 4 it is used only by the restore's series check, as today, and by the old stop until PR 6.
- **Device readings**: the clock each enrolled till or handheld sends with every equipment read; from PR 1c, also while it shows the PIN screen (R11).
- **The seat**: the fiscal module's one `FiscalBackend` object, built once in boot (`nodeBackend`, `apps/server/src/boot.ts:2074`) and handed to every route and loop. Every fiscal record is written by one of its four writers, `recordSale`, `recordVoid`, `recordCorrection`, `recordSubstitution` (`packages/fiscal-verifactu/src/backend.ts:305,431,504,609`); the only other callers of the chain's append are the record remedies, which production switches off (R7).
- **The start check** (new): each start's decision on whether its time is confirmed. Its state is **waiting** (nothing has confirmed it), **by devices** (two devices agreed), **by a person** (a till or administrator confirmed or corrected it), or **by the internet** (the time service is synchronised). The rules for moving between them are D3's.
- **A record's position**: its `secuencia`, the box's own running number for the records it writes, one higher for each (`chain.ts:173`); `chainHeads` reads the highest per box (`clock-behind.ts:41-47`).
- **The confirmation mark** (new, PR 2): the box's highest record position at the moment its time was last confirmed or corrected in this process. A record above the mark was written under the time as it now stands.
- **The stop** (today; its behaviour ends in PR 5, its code in PR 6): while the clock reads more than a minute before the latest fiscal record, no record is written and no money moves (`refuseWhileClockBehind`, `packages/fiscal-verifactu/src/clock-behind.ts:167-175`).
- **The series check**: naming a new invoice series at setup, restore or promotion needs a second clock within 30 seconds of the box's (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`, `AGREEMENT_MS` at `:39`).
- **The filing loop's hold**: after three refusals in a row with one code (`SAME_CODE_REFUSAL_LIMIT`, `drain.ts:64`), the chain's later never-sent records are held and the first held one is sent again hourly (`drain.ts:59-63,787-822`).

## Global constraints

- **No table, column, index, trigger, migration or schema-file change.** None is needed: a correction at reason `start` writes the row every clock set already writes (`clock_confirmations` accepts reason `start` and sources `staff` and `admin`, and requires a person exactly for those: `packages/fiscal-verifactu/src/schema/clock-confirmations.ts:7-20,62-65`); a confirmation that sets nothing writes a log line only (D3). The stop's tables stay, unwritten, after PR 6. If a step seems to need a schema change, stop and report.
- **The fiscal core is untouched in every PR**: `computeHuella`, the chain (`chain.ts`), numbering, `registros_facturacion` and its triggers, the alta builders, `allocation.ts`, `hour-selection.ts`. **PR 2 changes the filing loop (`drain.ts`), which is fiscal code outside that core**: only the hold taken when a record is first claimed, so that a run of `1112` refusals starts no hold (D11, Task 10b). **PR 5 changes what the chain's append refuses without editing it**: `attemptAppend` (`chain.ts:158`) asks `refuseWhileClockBehind`, which asks `clockBehindChain`, and PR 5 makes that function and `clockStopState` answer null (R8). After every task touching `packages/fiscal-verifactu`, this passes **unedited**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.
- **Clock sources (the owner's rule, 2026-11-10).** The time service confirms. Two devices agreeing with the box confirm it and set nothing. A person confirms or corrects; a correction is a set through the host service from the till's time or the administrator's own device, never while synchronised. AEAT never confirms or sets the clock at a start (owner, on finding 5: "NTP is the answer for now", `desk/done/20261110-1624-a1420-rev4-fable-review.md`). The old stop's AEAT set stays, unreached after PR 5, until PR 6 deletes it.
- **The series check is untouched except for Q1.** No device, till or administrator confirmation is ever read by it (R5).
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it.
- **User-visible words** are only those in "Words"; English and Spanish change together.
- **Real events only** (owner, 2026-11-08). Each branch names the venue event that reaches it.
- **Tests.** Each property has one owner layer. The host's and the time service's own failure modes are already tested where they are read (`box-host-client.test.ts`); a start is tested only for what it does with each answer. A "did NOT happen" assertion runs to a stated end point and has a control in which the same fake forces the effect. Reuse `ephemeralServerFixture`, `setupVenue`, `insertFiscalRegistro`, `deviceCookieForTest`, `provisionBillVenue`, `createClockWitnessStore`, `createFakeAeat` and the fake host in `boot.clock-watch.test.ts:166-182`.
- Tests run with `AI_AGENT` and `CLAUDECODE` unset when output matters; server tests with `TESTCONTAINERS_RYUK_DISABLED=true`. Read the `Tests` count. Browser runs (`apps/dashboard`, `apps/till`, `apps/setup`): `memory_pressure | grep free` first.
- Every commit `git commit -s`, plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.
- **Implementer size.** Each task is sized for one implementer in well under 100 tool calls. One that passes about 150 calls stops at a passing (or cleanly failing) point, commits, and hands over.

## What is true today (receipts)

### R1. An ordinary start does not look at the clock; only a clock behind the latest record is caught (RUN, revision 2)

Revision 2's probe: a real `startServer` on a real venue database (`useVenueDb` + `setupVenue`, `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`), the global `Date` swapped for one reading the real clock plus an offset, AEAT's `authenticatedHourHead` mocked, a fake host whose `setClock` moves the swapped clock, one fiscal record an hour before the true time. What it printed, in short:

- **Clock 2 days ahead:** `start=ok … setsAtStart=0 aeatAsksAtStart=0`, `saleCheckAfter75s=allowed`, `aeatAsks=0`: sales dated two days ahead, nothing checks.
- **Clock 2 days behind, AEAT answers:** sales refused at first (`refused clock.behind_chain`); after about 30 s the watch set the clock from AEAT (`clock_correction.stepped`, `confirmations=["authority"]`) and sales resumed.
- **Same, AEAT unreachable:** sales stay refused; AEAT asked once a minute.
- **Flat battery, 10 minutes slow, last sale 10 min 5 s earlier:** `saleCheck=allowed`, nothing asked: sales dated 10 minutes early.
- **Every set needs a stop today** (`clock-correction.ts:221-229`; `clock-set.route.test.ts -t "refuses a set with no stop"` → `Tests 1 passed`).

Why a flat battery comes up slow (systemd(1), "System clock epoch", read, not run): the clock starts near the last save of `/var/lib/systemd/timesync/clock`, so it is slow by about the length of the cut.

### R2. The restore's start (run in revisions 1-2, still true)

- Only a start that places a staged restore names a series. `runEntry` runs `runStagedRestore` before `startServer` (`apps/server/src/node-entry.ts`). The module's `resume` compares clocks as a box with no browser (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:146-149`) and refuses `sif.allocation_invalid` with `reason` `second_clock_missing` (AEAT unreachable) or `clock_disagreement` (more than 30 s out). Revision 1's probe printed `internet offset=29000 canSelect=true`, `offset=31000 … clock_disagreement` and `offset=null … second_clock_missing`.
- Each start writes one failure into `recovery.json` before its first step; three in a row bring up the start-failure page (`RECOVERY_AT`, `apps/server/src/recovery-state.ts`). `withoutAttempt` takes one back (used today for a start refused because a live process holds the venue folder). The process then exits and Docker starts it again (`restart: unless-stopped`, `deploy/compose.yml`).
- AEAT's failure reasons at the restore's start are `network`, `timeout`, `tls`, `response`, `configuration` and `clock-corrected` (`hour-clock-internet.ts:74-153`). Only `network` and `timeout` mean "not reachable yet".
- Today's start-failure words for `sif.allocation_invalid` already say "It checks its time against the internet first. Connect the box to the internet, then press “Retry a normal boot”." (`apps/server/src/i18n/recovery-page.ts:286-298`), chosen by code alone.

### R3. The server serves tills while it is not trading (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-till-at-start.test.ts` (moved out of the tree after the run; `git status --short` then printed nothing). R1's harness, with: AEAT unreachable (the mock throws `ENETUNREACH`); the host not synchronised; one enrolled till (`seedDevice` + `deviceCookieForTest`) and one staff member with a PIN; everything the till does goes over HTTP to the real listener, as the till app does: `GET /api/device/equipment` (its notices) with only the device cookie, `POST /api/session` (PIN sign-in), then `POST /api/box-clock/challenge` and `/confirm` ("Check the time") with the till's true time. The sale check is `refuseWhileClockBehind` at the box's reading, as in R1. Each scenario waits 20 s after start, past the clock watch's first look at 15 s (`CLOCK_WATCH_MS`).

**Stated before running.** If the server did not serve tills at that stage, BEHIND prints a non-200 equipment read or sign-in, or no `clock.check_time` notice. The control must print no notice and a refused challenge, or the probe cannot tell the cases apart.

Command: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/probe-a1420-till-at-start.test.ts` → `Tests 4 passed (4)`.

```
CONTROL boxMinusTrue=0s
CONTROL start=ok in 211ms aeatAsksAtStart=0
CONTROL till(no one signed in) at once: equipment 200 notices=[]
CONTROL PIN sign-in: 200
CONTROL saleCheckAtStart=allowed
CONTROL after20s aeatAsks=0
CONTROL till(signed in) after20s: equipment 200 notices=[]
CONTROL Check the time -> challenge: 409 {"error":{"code":"clock.set_refused","params":{"reason":"not_stopped"}}}
CONTROL sets=0 requester=null boxMinusTrue=0s confirmations=[]
BEHIND boxMinusTrue=-172800s
BEHIND start=ok in 245ms aeatAsksAtStart=0
BEHIND till(no one signed in) at once: equipment 200 notices=["clock.behind_chain"]
BEHIND PIN sign-in: 200
BEHIND saleCheckAtStart=refused clock.behind_chain
BEHIND after20s aeatAsks=1
BEHIND till(signed in) after20s: equipment 200 notices=["clock.check_time","clock.behind_chain"]
BEHIND Check the time -> challenge: 200 {"challengeId":"6946c2ec-…","boxAt":"2026-11-07T21:55:29.908Z"}
BEHIND Check the time -> confirm: 200 {"confirmationId":"6c9274d6-…","stepMs":172799998.930542,"confirmedAt":"2026-11-09T21:55:29.914Z"}
BEHIND sets=1 requester={"source":"staff","person":"7f59418c-…","device":"6a37f17f-…"} boxMinusTrue=0s confirmations=[{"source":"staff","reason":"behind_chain"}]
BEHIND saleCheckAfter=allowed
BEHIND till after: equipment 200 notices=[]
AHEAD  … start=ok, equipment 200 notices=[] (at once and after 20 s), PIN sign-in 200, aeatAsks=0,
AHEAD  challenge: 409 … "not_stopped", sets=0, boxMinusTrue=172800s, saleCheckAfter=allowed
SLOW10 … the same as AHEAD, boxMinusTrue=-600s
```

**What it means.**

- **Most of the person's path exists.** While today's stop holds, the server is fully up: an enrolled till reads its notices, staff sign in by PIN, "Check the time" is offered, and one confirm set the box's clock from the till's time through the host and sales resumed. Sending an order to the kitchen is not among the stop's checks (read, not run: the list in `conventions-data.md`, "Where a route's named check goes", names only payment, refund and invoice routes).
- **What the person sees.** The till shows notices only on its signed-in screens and clears them at sign-out (`apps/till/src/till-app.ts:18666-18669`), so the PIN screen shows nothing; after sign-in the line reads "Payments stopped: the server's clock reads earlier than its last sale" with "Check the time" (`apps/till/src/i18n/strings.ts:1897-1906`). **The dialog shows one action button, not a choice** (corrected in revision 5, finding 3): when the till and the box differ by more than a minute (`AGREES_MS`, `apps/till/src/widgets/box-time-dialog.ts:28,231`) it shows both clocks and only "Use this time"; when they agree it shows only "The time is right" (`:259`). The server route decides the same way, from the till's time alone: within a minute it confirms, further out it sets (`apps/server/src/till-box-clock-api.ts:258,327-328`). The second read ran the dialog's two cases that pin this (`box-time-dialog.test.ts -t "shows both times when this till differs, and offers this till's time|asks only to confirm when this till agrees"` → `Tests 2 passed | 62 skipped (64)`, its run, not mine). PR 1a gives the line new words and, while the box waits, a second button (Task 7a).
- **The gap.** A clock 2 days ahead or 10 minutes slow triggers none of it today: no notice, the challenge is refused `not_stopped`, sales are taken. The start check's "waiting" state opens this path (PR 1a).
- **A till or handheld already paired** is what connects. A new one cannot pair without an administrator: each start opens the pairing window shut (`apps/server/src/boot.ts`, "a restart or a promotion starts SHUT"). Read, not run.
- **At a restore's placement no till can help**: the server that serves tills starts only after placement (R2), and no device or person confirmation satisfies the series check (R5).

### R4. Why a box can be online and still not be synchronised (read, not run)

- **Waitron installs no time service.** `waitron.sh install` only runs `timedatectl set-ntp true` (`deploy/waitron.sh:322-330`); if that fails, or no time service is installed, it prints a line and carries on. The dashboard already raises `clock.sync_off` with `off`, `stopped` or `unsynchronised` (`apps/server/src/clock-sync-alert.ts`).
- **The host service may be missing.** `install_box_service` (`deploy/waitron.sh:357-395`) carries on, printing a line, when the host has no systemd, the group is taken, a temporary folder cannot be made or a step fails (`:361-373`, `:390-393`); compose then mounts no socket. The client answers `available: false` and "a box without the service (a laptop, Docker Desktop, a host without systemd) still sells" (`box-host-client.ts:13-14`). In production the dashboard already raises `clock.sync_off` with reason `unreachable` (`clock-sync-alert.ts:20`). D12 says what the start check does then.
- **Every boot starts unsynchronised.** The flag turns "yes" only after the time service's first successful exchange. The app's container starts as soon as Docker does, so the start's first look can come first. After a power cut the venue's router usually comes back after the box, so for the first minute or more the time service cannot answer. This is the common case, and it is why the start check keeps listening and confirms by itself. Task 19 measures it on the test box.
- **The venue's network blocks the time protocol.** NTP uses UDP port 123 (timedatectl(1)'s own example: "Using Time Server 216.239.38.15:123"). A network that lets only web traffic out never lets the time service synchronise. Such a box confirms by devices or a person at every start; with PIN-screen tablets counting (R11), two switched-on tablets do it with nobody tapping. The owner, asked whether AEAT's reply could stand in: "I can't believe that a mall would block NTP. We can build this if we need to. NTP is the answer for now" (`desk/done/20261110-1624-a1420-rev4-fable-review.md`). Task 19 blocks UDP 123 on the test box to show what the start does.

### R5. Who uses the stop today, and what each does after this plan (read; two claims checked)

A read-only trace of every consumer, 2026-11-09; the second read repeated the search for every production caller of `refuseWhileClockBehind` and `clockBehindLatestRecord` and found exactly these. Checked by me: `hour-clock.ts`, `hour-selection.ts`, `hour-setup-clock.ts` and `hosted-hour-recovery.ts` contain no reference to confirmations (`grep -n 'clock-confirmation\|clockConfirm'` printed nothing, exit 1), so **no device, till or administrator confirmation can ever let a series be named**; the series check's second clock is AEAT or, during setup, the setup page's own browser (`hour-setup-clock.ts:103-124`).

**The stop cannot be switched off at one point.** `clockStopState`'s judge compares the clock with the latest record itself (`packages/fiscal-verifactu/src/clock-confirmation.ts:63-67`) and then asks `clockBehindChain` whether a confirmation covers it (`:75`). Making only `clockBehindChain` answer "not behind" would read every behind clock as confirmed, then fail on a missing confirmation row (`:102`). So PR 5 makes both `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) answer null. That reaches every reader, including two that bypass the seat: the staff notice (`staff-notices.ts:27`) and the bell alert (`clock-behind-alerts.ts:25`) call `clockBehindChain` directly (R8). PR 6 then deletes the callers and the code.

| Consumer | Where | Today | After PRs 1a-1d and 2 | After PR 5 | After PR 6 |
| --- | --- | --- | --- | --- | --- |
| The chain's append | `fiscal-verifactu/src/chain.ts:158` | refuses a record more than a minute before the latest | unchanged | refuses only a time before 28-10-2024 (`refuseBeforeFirstIssueDate`, `first-issue-date.ts:15-24`); `chain.ts` unchanged (R8) | same |
| The seat's four writers | `backend.ts:305,431,504,609` | write through the append | refuse `clock.unconfirmed` while waiting (wrapper in boot, 1a) | same | same |
| Route checks: till sales, bill payments and refunds, tender refunds and retry, unpaid departure, eight dashboard resolutions | `till-sale.ts:720,1180,2246`; `bill-payments.ts:1141`; `bill-refunds.ts:216,685,698`; `tender-refunds.ts:93,98`; `tender-refund-api.ts:262`; `unpaid-departure.ts:102`; `payments-api.ts:368-369` | call the seat's `refuseWhileClockBehind` | refuse `clock.unconfirmed` first while waiting (wrapper in boot, 1a) | waiting or before 28-10-2024 only | same, renamed `refuseUntilRecordable` |
| Refund recovery loops; a card refund's re-check after a provider wait | `tender-refund-recovery.ts:36`; `bill-payments-loop.ts:244`; `clockStopsRefund`, `bill-refunds.ts:209-220` | pause during the stop | also pause while waiting (1a) | pause only while waiting | same |
| Clock watch | `apps/server/src/clock-watch.ts` | opens checks, sets from AEAT, confirms, all inside a stop | 1a: also reads the shared time-service reading and the device readings while the start is not confirmed by the internet; 2: also the latest `1112` refusal's position | its stop part sees no stop | stop part deleted, with its AEAT set |
| Correction's admission | `clock-correction.ts:143-169,221-229` | sets only inside a stop | also admits reason `start` from a staff member (1a) or an administrator (1b) while the start is not confirmed by the internet | same | only reason `start`, or `clock.unusable` |
| "Check the time" (staff) and the start-up window | `till-box-clock-api.ts:158-370`; `clock-start-up.ts` | offered during a stop found at start-up, after AEAT failed | 1a: also while waiting, at once, with both choices | only while waiting, or `clock.unusable` | stop branches deleted |
| Administrator's confirm and set ("Check with this device's time") | `box-health-api.ts:258-371`; the dashboard's offer, `box-status-screen.ts:452-459,1217-1231` | inside a stop only (R9) | 1b: also while waiting: confirm moves the start check to by a person and writes no row; set is sent as reason `start`; the dashboard offers both while waiting | same | stop branches deleted; both admitted only while the start is not confirmed by the internet, or under `clock.unusable` |
| Device readings | `clock-witnesses.ts`; `agreeingDeviceGroup`, `packages/fiscal/src/clock-witnesses.ts:116` | lift the stop at a 60 s margin | 1a: also confirm a waiting start at a 5 s margin; 1c: from PIN-screen tablets too | stop use never reached | the 60 s stop use deleted |
| The filing loop's hold | `drain.ts:59-64,855,969-981,1020,1137-1138` | holds after three refusals with any one code | 2: a run of `1112` starts no new hold; a chain already held drains as today (D11) | same | same |
| Clock checks, confirmations covering a step back, disproofs | `clock-checks.ts`, `clock-confirmation.ts`, `clock-stop-incidents.ts` | exist only for the stop | unchanged | never reached | deleted; tables stay, unwritten |
| The misdated-sales list, its download and `clock.records_misdated` | `clock-misdated.ts`, `box-health-api.ts:149-200` | listed after a stop's closing | unchanged | not reached by the stop | deleted (owner 15:06: no box-made list) |
| Alerts, emails and till/dashboard words for `clock.behind_chain`, `_restarted`, `_disproved` | `clock-behind-alerts.ts`, `box-alert-email.ts`, `staff-notices.ts`, till `pay-refusal.ts`, dashboard `box-status-rows.ts`, `alert-messages.ts` | shown and emailed | unchanged | never raised | deleted |
| `fiscal.clock_drift` hidden during the stop | `boot.ts:3106-3112`, `time-health.ts:91-112` | hidden while stopped | unchanged | never hidden | hidden while waiting instead |
| Survives untouched | `clock.unusable`, `clock.corrected`, `latestClockStep` (backup hold, `backup-sweep.ts:205`), `clock.disagrees`, `clock.sync_off`, challenges | | | | |

### R6. The gate must sit on both the route check and the seat's writers (RUN, 2026-11-09)

**Harness.** A throwaway file, `apps/server/src/probe-a1420-seat-gate.test.ts` (moved out of the tree after the run). `provisionBillVenue`'s venue (its app uses one seat object, as boot's does), with the seat's `refuseWhileClockBehind` and its four writers wrapped in place, as PR 1a's boot wrapper would; each wrapper logs its call and, when its flag is on, throws a stand-in refusal (`clock.unusable`). Then a cash sale (`POST /api/sales`) and a card sale (`POST /api/pay`) under each arrangement.

**Stated before running.** If gating only the writers were enough, the card sale under "WRITERS-ONLY" prints `cardCollects+0`; the A798 measurement (`conventions-data.md`, "Why the routes need their own check") predicts `+1`. The control must print `records+1` for each sale.

Command: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/probe-a1420-seat-gate.test.ts` → `Tests 1 passed (1)`.

```
CONTROL(no gate) cash: status=200 seatCalls=["refuseWhileClockBehind","recordSale"] records+1 sales+1 cardCollects+0
CONTROL(no gate) card: status=200 seatCalls=["refuseWhileClockBehind","recordSale"] records+1 sales+1 cardCollects+1
WRITERS-ONLY gate cash: status=409 seatCalls=["refuseWhileClockBehind","recordSale"] records+0 sales+0 cardCollects+0
WRITERS-ONLY gate card: status=507 seatCalls=["refuseWhileClockBehind","recordSale"] records+0 sales+0 cardCollects+1
ROUTE+WRITERS gate cash: status=409 seatCalls=["refuseWhileClockBehind"] records+0 sales+0 cardCollects+0
ROUTE+WRITERS gate card: status=409 seatCalls=["refuseWhileClockBehind"] records+0 sales+0 cardCollects+0
```

**What it means.** Wrapping the seat's writers holds every record, including paths with no route check (`cancel-credit.ts:68` writes a correction through `recordCorrection`), and the sale's whole transaction rolls back. But alone it charges the card first and answers `507`. The route check stops money before the reader. Both wrappers go in PR 1a, at one place in boot.

### R7. The record remedies cannot write in production (RUN, 2026-11-09)

The administrator remedies (`packages/fiscal-verifactu/src/record-remedy.ts:194`, `record-remedy-absent.ts:130`) call `appendToChain` directly, past the seat's writers. Production mounts them with the default set of enabled remedies, which is empty (`record-remedy-routes.ts:20,46`, mounted at `routes.ts:26`), so every remedy is refused `fiscal.remedy_disabled` before it writes.

- Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/record-remedy-corrective-http.test.ts -t "keeps the default production policy closed"` → `Tests 1 passed`.
- Control: with the default set changed to `new Set(["corrective-invoice"])` and the same command → `AssertionError: expected 200 to be 409`, `Tests 1 failed`: the remedy wrote. The file was restored (`git checkout --`; `git status --short` printed nothing).

So no remedy is gated in this plan (real events only). The A1407 backlog entry, which is what will switch a remedy on, gains one clause: an enabled remedy takes the start gate first.

### R8. Two functions answering "nothing" end the stop everywhere, with `chain.ts` unchanged (RUN, 2026-11-10; the server half completed by the second read)

**Harness.** A throwaway worktree (`git worktree add --detach` in `mktemp -d`, on this branch's code, removed afterwards). In it, `clockBehindChain` (`clock-behind.ts:147`) and `clockStopState` (`clock-confirmation.ts:107`) each got `return null` as their first statement; `git diff --stat -- packages/fiscal-verifactu/src/chain.ts` printed nothing.

**Stated before running.** If this ends the stop everywhere, `chain.clock-behind.test.ts` fails because the append now writes the earlier record, and the "behind" cases of `staff-notices.test.ts` and `clock-behind-alerts.test.ts` fail because nothing is reported. If those pass, the notice and alert still bypass the change.

- `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` → `Test Files 16 failed | 224 passed (240)`, `Tests 161 failed | 5296 passed (5457)`. Among them: `chain.clock-behind.test.ts > … refuses a sale a day behind the last record and writes nothing` → `AssertionError: promise resolved "{ …(2) }" instead of rejecting` (the record was written); `staff-notices.test.ts > … a reading more than a minute before the latest record shows the stop` failed; `clock-behind-alerts.test.ts > … raises one error while the clock reads more than a minute before the latest record` failed. The second read repeated this run and got the same figures, file for file.
- My run covered the 34 server suites that name the stop (`grep -l -E 'behind_chain|clockBehind|clockStopState|records_misdated|clock_checks|confirmClockStop|clock-behind|behind the chain' src/*.test.ts`) and `hour-recovery-host.test.ts`, which the scan does not match: the 15 files Task 17b lists failed, 146 cases between them. **The second read then ran the whole of `apps/server` under the same change** (`env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run` → `Test Files 18 failed | 1295 passed (1313)`, `Tests 149 failed`), and found three more files, one case each, that none of the scan's words match: `boot.restricted-quiet.test.ts` (`:337`, `expected 0 to be greater than 0`), `boot.clock-watch.test.ts` (`:236`, `expected 409 to be 200`) and `boot.box-health.test.ts` (`:166`). With the change taken out, those three files → `Tests 20 passed (20)`. Task 17b handles all 18 files (finding 7).

So PR 5 takes this route. Not run: `apps/till` and `apps/dashboard` (PR 5 changes no code they import beyond the seat's answers); a failure there is a STOP.

### R9. Without a stop, an administrator can neither confirm nor set the clock (read; two cases run, 2026-11-10)

Read on `d4a9aea323`, whose code is the base's:

- `POST /api/box/clock-confirm` asks the seat's `confirmClockStop`, and when it answers no confirmation the route throws `clock.confirm_refused` with reason `not_stopped` (`apps/server/src/box-health-api.ts:307`).
- `POST /api/box/clock-set` always sends reason `behind_chain` unless the clock reads before 28-10-2024 (`box-health-api.ts:343`). The correction's admission then judges the stop (`clock-correction.ts:143-169`) and answers `not_stopped` when there is none (`clock-correction.ts:226`), which the route turns into `clock.set_refused` (`box-health-api.ts:361,384-391`).
- The dashboard offers the button only during a stop or `clock.unusable` (`#canSetClock` and `settableStop`, `apps/dashboard/src/screens/box-status-screen.ts:452-459,1226-1231`), and only when the host answers (`:452-459`).

Run in a throwaway worktree: `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/clock-set.route.test.ts src/clock-confirm.route.test.ts -t "refuses a set with no stop|refuses a confirmation with no stop and no check waiting"` → `Tests 2 passed | 65 skipped (67)` (the second read repeated it with the same figures). Those cases put the clock at the latest record's time; a clock two days ahead is also "no stop" by the same comparison (`clock-confirmation.ts:63-67`). So Task 7b opens both routes while waiting.

### R10. PR 1a's gate at boot breaks four existing server suites (RUN, 2026-11-10)

**Harness.** A throwaway worktree (`git worktree add --detach` under `mktemp -d`, on this branch's head; removed afterwards). In `bootServer`, straight after the seat is built (`boot.ts:2074`), a stand-in for the gate: at a start where `filesRecords()` is true, ask the host's `clockStatus` (the test's fake host, else the real client); unless it answers available and synchronised, replace the seat's `refuseWhileClockBehind` and its four writers with a function that throws a stand-in refusal (`clock.unusable`), for the life of the process. This is an upper bound: nothing ever lifts the stand-in, where PR 1a would confirm on the time service, two devices or a person. The patch is kept at `waitron-campaign-b/receipts/a1420-start-gate-probe-20261110.patch`.

**Stated before running.** If the gate reached no existing test, every suite passes; a suite that starts a filing server and then sells fails with `409 clock.unusable`. The control is the same suites with the patch taken out, which must pass, or a failure cannot be put down to the gate.

Suites: the 102 files under `apps/server/src` that name `bootServer`, `startServer`, `ephemeralServerFixture` or `runEntry`. Command: `env -u AI_AGENT -u CLAUDECODE A1420_PROBE_LOG=1 TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run <the 102 files>` in `apps/server` → `Test Files 4 failed | 98 passed (102)`, `Tests 9 failed | 1346 passed | 37 skipped (1392)`; the stand-in printed `waiting=true` 85 times and `waiting=false` never.

- `boot.backup-network.test.ts`: 8 of 8 failed, each at `expect(sale.status, …).toBe(200)` (`:236`) with `{"error":{"code":"clock.unusable",…}}: expected 409 to be 200`.
- `promote-endpoint-e2e.test.ts`: 1 of 6 ("restart into primary; sells + chains on its own reserved SIF"), `expected 409 to be 200` at `:516`.
- `handover-controlled.e2e.test.ts`: its shared setup failed (`clock.unusable … expected 409 to be 200` at `:842`), so its 32 cases were skipped.
- `handover-stepdown.real.test.ts`: its setup failed (`expected [] to have a length of 1 but got +0`), so its 5 cases were skipped.

Control, patch removed, the same four files → `Test Files 4 passed (4)`, `Tests 51 passed (51)`.

**What it means.** PR 1a must give those four suites a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost` (`boot.ts:979`) ("Changed test checks" lists them).

### R11. Every till and handheld reports its clock while signed in; from PR 1c, at the PIN screen too (read, not run, 2026-11-10)

- Each `GET /api/device/equipment` carries the device's clock in the `x-waitron-device-clock` header (`apps/till/src/api/client.ts:3652`); the route notes it, with the box's wall and steady clocks at arrival, after checking only the device, never a session, unless the request comes from the box itself (`apps/server/src/device-api.ts:423-431`).
- The till reads its equipment every 15 s (`apps/till/src/state/equipment-poll.ts:4`), from sign-in (`till-app.ts:5684`) to sign-out (`:18671`). The poll's own comment says "the read needs the device, not a session" (`equipment-poll.ts:18-19`). So today a device at the PIN screen does not report.
- The store keeps each device's latest reading for five minutes by the steady clock, and drops it if the wall clock stepped since (`apps/server/src/clock-witnesses.ts:5-6,62-68`).
- `agreeingDeviceGroup` (`packages/fiscal/src/clock-witnesses.ts:116-119`) returns the largest group of two or more devices, one per network address, each agreeing with the box and with each other, today within `CLOCK_WITNESS_MARGIN_MS` = 60 s (`:1`). Devices at one address count as one.

So "two devices connect and show their time is within a few seconds of ours" needs one new margin, a call at each watch look, and a small till change: the PIN screen sends the same read every 15 s (Task 4b, PR 1c; owner: "Count PIN-screen tablets (Recommended)", `desk/done/20261110-1624-a1420-rev4-fable-review.md`). PR 1a uses 5 s ("a few seconds", owner 2026-11-10); the 60 s margin stays for the stop until PR 6. **A count of agreeing devices is cheap**: the same store, margin and grouping (`largestDeviceGroup`, `packages/fiscal/src/clock-witnesses.ts:80-100`), counting the largest group within 5 s of the box and of each other, is a few lines beside `agreeingDeviceGroup` (reasoned, not run). While the box waits it reads 0 or 1, which the waiting words show.

### R12. What AEAT does with a record dated ahead, and with one earlier than the record before it (read; facts the desk checked, 2026-11-10)

- **Issue date ahead of AEAT's date: refused.** «La FechaExpedicionFactura no podrá ser superior a la fecha actual», code `1112`, a rejection (research `2026-11-06-adviser-clock.md`, 60.8; `verifactu-findings.md:339-341`). Developer FAQ §17: such a record «no figuraría jamás en los sistemas de la AEAT». Its remedy is a corrective invoice naming it, issued at once, the original needing nothing more (FAQ §17 case 2.a, research 60.8's same-day correction); AEAT's test service took an R1 naming a refused invoice as `Correcto` (2026-10-05, verifactu run 37286368370, mode `rejected-invoice-credit`).
- **AEAT accepts later records chained after a refused one, on its test service.** `docs/compliance/verifactu-findings.md:1279` (the W41s-1 protocol runs of 2026-10-05; saved evidence `docs/superpowers/specs/2026-10-05-aeat-protocol-evidence.json`): a 1,000-record batch whose first record was refused (`Incorrecto`, code `1161`) while all 999 linked successors came back `Correcto`; two linked successors were also `Correcto` in the three-record same-batch and later-batch probes; and the next row, a credit naming and chaining to the refused original, `Correcto` (`:1280`). **Limits:** the refusal there was `1161`, not `1112`, and it was AEAT's test service, not production. Task 19's PR 2 step sends a real `1112` on the test service.
- **Generation time ahead of AEAT's clock on the same day: accepted with warning `2004`** beyond 240 s (`verifactu-findings.md:152-195`).
- **The 2026-11-06 decision "AEAT refusing the latest record as too far in the future stops trading until the clock is reset" (`docs/backlog/box.md:1595`) is not built.** `grep -rn 1112 --include='*.ts' apps packages | grep -v '\.test\.ts'` prints only a fixture comment (`packages/fiscal-verifactu/test/drain-fixtures.ts:43`) and a telephone number. PR 2 builds it in its corrected form (D9).
- **What Waitron does after refusals today** (read, not run): each refusal opens a filing case and, unless it is an hourly retry refused with its run's code, raises `fiscal.registro_rechazado` (`drain.ts:1552-1573`). After `SAME_CODE_REFUSAL_LIMIT` (three) refusals in a row with one code, the chain's next never-sent records are held and the first held is sent again hourly; the hold lifts once a send breaks the run (`drain.ts:59-64,787-822`). A held record sent hourly and refused is set refused like any other (`:1552-1560`), so under a run of `1112` each hour turns one more future-dated sale into a refused record, while correctly dated sales wait behind it (the second read, finding 2). The administrator gets `fiscal.refusals_repeated` for such a hold (`submission-alerts.ts:79-147`, which reads held records). PR 2 ends the hold for `1112` (D11).
- **A record stamped earlier than the record before it.** The chain is sent in the order records were made (`drain.ts` orders by `secuencia` within a chain; research 51.1: «en el mismo orden secuencial en el que hayan sido generados»). The previous-record block carries no time, only NIF, number, issue date and fingerprint, and AEAT's error list has no code comparing a record's time with the previous one's (research 51.2). No AEAT run has tried it; the owner judged the proposed test not worth running (Q2's answer).
- **"How old does an invoice have to be to be marked as old?"** (the owner's question in Q2's answer). Not by age. The box marks the records it sends while a technical failure has stopped sending (`technicalIncidentToken`, `drain.ts:317-324`), which sets `Incidencia="S"` in the message header (art. 16.4). Late records are accepted with no deadline (`verifactu-findings.md`, "Unplanned outage"). On AEAT's preproduction service, unmarked records sent over 5 minutes late came back `2004`, and a marked one sent 6 minutes late came back `Correcto` (`verifactu-findings.md` §18; production not tested).

## Decisions

**D1. The start check runs at every start, whatever the box's role**, in `bootServer` after the shared time-service reading exists (`boot.ts:3061-3062`) and before the trading listener binds (`boot.ts:3611`). The gate (D4), the staff notice and the bell alert ask `filesRecords()` at each call (`boot.ts:2034`, "Asked on each call … the role can change while the box runs"), so a box that does not file records (demo, preproduction without test submissions) is never gated or told, and a box that becomes primary while it runs is gated until its time is confirmed (finding 13). Order:

| # | Asked | Answer | What the box does | Who sees what |
| --- | --- | --- | --- | --- |
| 1 | Time service (`clockStatus`, at most 2 s; the answer fills the shared one-minute reading) | synchronised | confirmed **by the internet**; a log line | nothing |
| 2 | — | not synchronised, or the host does not answer (D12) | **waiting**: the listener opens; orders still reach the kitchen; no record and no money | staff signed in on a till: the waiting notice and "Check the time" (1a); at the PIN screen, the notice's line (1c); administrators: the bell alert and the Box status row (1b) |
| 3a | device readings, at each watch look | two or more devices at different addresses, signed in (1a) or at the PIN screen (1c), each within 5 s of the box and of each other (R11) | confirmed **by devices**: a log line with the readings; sets nothing | the notice and alert clear |
| 3b | a staff member's "Check the time" (1a) | the till's time | clocks within a minute: "The time is right" confirms **by a person**. Further apart: both "The server's time is right" (confirms by a person, sets nothing) and "Use this time" (sets the box from the till's time through the host, reason `start`, then by a person) | a set raises `clock.corrected` and its email |
| 3c | an administrator, on Box status (1b) | "The date and time are right", or "Check with this device's time" | confirmed **by a person**. The first sets nothing. The device's time within a minute confirms (no set); further out, it sets the box through `/api/box/clock-set` with reason `start` and source `admin`, then confirms (R9) | a set raises `clock.corrected` and its email |
| 4 | while not confirmed by the internet | the watch, every 15 s, reads the shared time-service reading (refreshed at most once a minute, D2) | synchronised: confirmed **by the internet**, and it stops asking | the notice and alert clear |

There is no timer between the routes: devices, staff and administrators are all accepted from the first moment of waiting, and the time service coming back confirms by itself. **Staff are admitted whenever the start check is not by the internet, whatever today's start-up window and AEAT state say.** Today that window can be shut while the box waits: the watch's first look that sees no stop shuts it for the life of the process (`clock-watch.ts:383-385,396`, `clock-start-up.ts:70-73`); a box that was not primary when it started has it shut from the start (`boot.ts:2026`, `clock-start-up.ts:22-23`); `admit` then answers `not_start_up`, or `authority_pending` while AEAT has not been asked, which no start check ever does (`clock-start-up.ts:36-38`); and the challenge and confirm routes refuse `not_stopped` through `noStop()` when no stop holds (`till-box-clock-api.ts:172-174,188,281`). So while the start check is not by the internet, the notice source offers "Check the time", the routes take the waiting state as the reason to admit, and they skip `noStop()` and `admit` (Task 7a). The window keeps its meaning for the old stop until PR 6. A power cut whose router returns a minute later then needs nobody. Once synchronised, the box trades however far the sync moved the clock (owner, 2026-11-10); until PR 5, a clock the sync moved more than a minute behind the latest record still meets today's stop, which its existing paths lift.

**D2. Waits.** At the start: one `clockStatus` of at most 2 s (`DEFAULT_STATUS_MS`) before the listener binds; AEAT is not asked. The watch keeps its 15 s look, but reads the time service through the shared one-minute reading (`clockServiceCache`, `boot.ts:3061-3062`), so the host program, which systemd starts once per request (`waitron-box.socket`, `Accept=yes`), is started no more often than that reading allows: once a minute, not every 15 s (finding 10). A router coming back is then noticed within about 75 s. A host that does not answer counts as not synchronised (D12).

**D3. The state is in memory, per process, and moves only these ways.** Each start begins **waiting** or, if synchronised, **by the internet**. **By the internet is final for the process: nothing moves it, D9 included** (finding 9). Waiting moves to by devices, by a person or by the internet as D1 says; by devices and by a person move to by the internet at the next look that finds the time service synchronised, and go back to waiting only under D9. Nothing is stored for a confirmation that sets nothing: it writes one log line, `clock_start.confirmed`, naming its source (`internet`, `devices`, `staff` or `admin`), the person's id when there is one, the devices' ids, the box's reading and the chain heads (`chainHeads`), as revision 4 already did for a confirmation by the internet (the watcher's point 3: nothing reads such a row after PR 6). Because nothing is stored or raised for it, no manager is told of such a confirmation, so the words shown while the box waits do not say they are (the till's "The time is right" and "The server's time is right", and the administrator's "The date and time are right": "Words"); no alert is added for it, since the owner's 15:06 words ("we don't try to catch people changing the time") lean against one. A correction (a till's "Use this time", the administrator's device) writes the row every clock set writes (`clock-step.ts:90-138`, reason `start`, which skips the stop's check there), which `latestClockStep` reads for the backup hold, and raises `clock.corrected` with its email, so "Every manager is told it was you, from this device" stays true for "Use this time". (2026-11-11, PR 1a's review: a clock set the host moved but did not confirm also sends by devices or by a person back to waiting.) (2026-11-11, PR 1a's review: while the old clock-behind stop also holds during a waiting start, a confirmation writes that stop's confirmation row in the same transaction, the keep ("The server") is not offered and is refused with reason `stopped`, and a correction at reason `start` writes its row at reason `behind_chain`, so it ends that stop as on main. PR 1b's administrator `/api/box/clock-confirm` must do the same; `/api/box/clock-set` gets the correction's part by sending reason `start` (Task 7b).)

**D4. Where the gate holds (R6).** In `boot.ts`, the one seat object is wrapped twice while the start check waits: its `refuseWhileClockBehind` throws `clock.unconfirmed` (409, no params) so every route R5 lists refuses before any card reader, refund send or drawer job; and its four writers throw the same, so no fiscal record is written by any path. The two refund loops and `clockStopsRefund` pause while waiting. A card already charged when a writer refuses is answered as today's stop answers it (`507 sale.charged_not_recorded`, new reason `clock_unconfirmed`). The Stripe webhook still stores a payment whose money has moved without writing a record (§5: "Still store money already moved"); it is recorded by the bill-payments loop once confirmed. Orders still reach the kitchen: the owner's answer to Q5. (2026-11-11, PR 1a: "by any path" narrowed to paths through the seat; the administrator's record remedies call the chain directly and are off in production, R7.)

**D5. The restore (PRs 3-4).** Placement names a series only on the series check. Synchronised: placement proceeds without asking AEAT (Q1). Not synchronised: today's check (AEAT within 30 s); AEAT unreachable (`network` or `timeout`): the restore waits, retrying every 60 s, uncounted, until the time service synchronises or AEAT answers; AEAT more than 30 s out: the start counts as today, with today's words, which already say to connect the box to the internet (R2). Nothing sets the clock at a restore. After placement the started server runs D1 like any start. The restore no longer raises the AEAT-disagrees alert the owner asked for on 2026-11-07 (`waitron-campaign-b/questions.md:1755-1757`); the watcher confirmed this reading at 16:24 ("Readings 1 and 2 stand"), consistent with "NTP is the answer for now".

**D6. The start-failure page chooses words by code and cause (PR 4).** Source: the watcher's relay of the owner's choice, "Owner chose A: the start-failure page picks its words by code and cause" (`waitron-campaign-b/questions.md:1747-1749`, WATCHER 2026-11-07 10:41, A1385 question 2), recorded in the A1420 queue entry as "Owner, 2026-11-07: chose option A for A1385's question 2" (`waitron-campaign-b/archive/queue-archived-2026-11-09.md:574`). `recovery.json` gains `lastErrorCause` from a closed set (`clock_moved`), kept on read only when a member (as `holderKind` is). Any other `sif.allocation_invalid` reason keeps #2532's words.

**D7. Waiting tries do not grow the start-failure log (PR 4).** A start taken back as waiting writes one line to the server log (`server.start_waiting_for_internet_clock`, with the `internet` reason) and nothing to the file the recovery page reads its tail from. Source for the uncounted retry: the watcher's relay, "Owner: yes, a start refused only because no internet clock answered keeps retrying by itself and does not count towards the three" (`questions.md:1751-1753`, WATCHER 2026-11-07 10:44; the queue entry, `archive/queue-archived-2026-11-09.md:576`).

**D8. Which invoices get corrected (owner, 2026-11-10 15:06).** Only those AEAT refuses as dated in the future (`1112`). Each refusal is already stored on the filing record (`envios.codigo_error`) and opens a filing case, so A1420 adds no list: A1407 (lane L) reads those refusals to issue the corrective invoices, and PR 1a's documents add that pointer to the A1407 backlog entry. **Known limit the owner accepted:** a wrong date AEAT accepts (a sale dated ahead and sent after the real date caught up) or never sees as wrong (a clock behind) is not corrected.

**D9. A future-date refusal sends a box confirmed by devices or a person back to waiting, once (PR 2).** Sources: the owner's decision of 2026-11-06 (`docs/backlog/box.md:1595`), restated 2026-11-10 14:59 ("we should respond appropriately by stopping selling and resetting the clock") and 15:31 ("A future invoice is rejected. We fix the clock we start sending correct invoices, and we send a correction invoice for the refused one. No waiting", `desk/done/20261110-1519-a1420-no-wait-behind-refused.md`).

- **What starts it.** At each watch look, a seat read (`latestFutureDateRefusal`) answers the highest position among this box's records whose filing reply carries `1112`. If that position is above the confirmation mark, and the start check reads by devices or by a person, the check goes back to waiting with cause `future_date_refused`. That record was written under the time as it now stands, so AEAT has shown that time to have been ahead of its own date.
- **What it never does.** It never compares the box's clock with a refused record's date (revision 4's "still reads that record's issue date or later" stopped a correct box for good on that date, finding 1). It reads nothing else and hunts for nothing.
- **What ends it.** A person: on a till, "Check the time" with either choice; on Box status, "The date and time are right" or "Check with this device's time"; or the time service synchronising. Two agreeing devices do not end it: they act with nobody looking, and AEAT has just shown a time confirmed that way, or by a person, to be wrong, so a person looks. A person may confirm the clock as it stands: the box cannot tell whether it is still ahead (a sale stamped a few seconds past midnight is refused the same way, finding 1's smaller case), and the person sees both clocks.
- **Why it reacts once.** Every confirmation or correction, including the start's, moves the mark to the box's highest record position at that moment (`chainHeads`). Every record written before the person's check is at or below the new mark, so the refusals still arriving for them as the loop sends them never stop the box again. It stops again only if a record written after the check is refused, which means the checked time was also wrong.
- **A box kept in time by the internet is never sent back** (D3): the owner's rule trusts the time service ("NTP is the answer for now"), and the host refuses a set while synchronised (`waitron-box.sh:118-121`), so a stop there could not be ended by a correction. Such a refusal writes a warning log line (`clock_start.future_date_refused_synchronised`) beside the filing case every refusal opens, and goes to A1407 like any other.
- **A restart** starts a fresh mark at its own confirmation, so refusals of records an earlier process wrote never stop the new one.
- While waiting in this cause, the gate holds as D4 says and orders still go. The refused records wait for A1407 (D8); correctly dated ones keep filing (D11).

**D10. The clock watch's jump records go with the stop (PR 6; read, not run).** `clock-watch.ts` takes a wall-clock move more than 60 s beyond the steady clock between two looks (`JUMP_MS`, `:28`, `:329-336`) as a jump, and AEAT's disagreements from its own asks and from filing replies (`aeat-transport.ts`, `:30-32`) likewise, and records each through the seat's `noteClockProvedWrong` (`:137-153`). What reads them today: the stop only. A disproof marks the earlier stop confirmations it reaches as unused or held (the `clock_watch.disproved_*` log lines, `:146-151`), raises `clock.behind_chain_disproved` ("The clock was proved wrong after `trustedUntil`", `clock-confirmation.ts:280`), and passes over any confirmation that names no record (`clock-stop-incidents.ts:193-199`; the second read's reading). Under the owner's rule ("we don't try to catch people changing the time") they go in PR 6 with `noteClockProvedWrong`, as Task 18a lists; no §5 sentence beyond C5 names them. What stays, because it is not about the stop: `latestClockStep` (the backup hold, `backup-sweep.ts:205`, reading the rows a set writes), `clock.corrected` for a set the box makes, and three existing warnings that change nothing a person can do at a till: `clock.disagrees` (two devices agree the box is over a minute out, `clock-disagrees-alert.ts`), `clock.sync_off`, and `fiscal.clock_drift`.

**D11. Correctly dated sales never wait behind a refused future-dated one (PR 2, Task 10b; owner, 2026-11-10 15:31: "No waiting").** This changes the filing loop, `packages/fiscal-verifactu/src/drain.ts`, which is fiscal code. In plain words: after AEAT refuses a sale as dated in the future, later sales are still sent straight away.

- **The change.** Only the hold taken when a record is first claimed (`haltOpenChainClaims`, the run test at `drain.ts:853-855`) stops treating a run of `1112` refusals as a run: it asks a variant of `sameCodeRunBefore` (`:969-981`) that answers false when the run's one code is `1112`. `sameCodeRunBefore` itself, and its two other uses, stay as they are: the hourly retry of a held chain's first record (`brakeHeldHeads`, `:1020`) and the release (`releasableHeads`, `:1137-1138`). Every other code keeps today's hold.
- **Why not change `sameCodeRunBefore` itself** (the fresh review of revision 5 ran it): a chain already held under three `1112` refusals when PR 2 lands would then never be retried or released, because both of those uses would stop seeing the run that holds it, and the claim hold's other test, "an earlier record of this chain is held" (`:848-852`), would hold every new record behind it for good. Their probe, the exemption switched on after the hold: `sent=0 estados=[detenido×3]`. With the exemption only at the claim hold: `sent=2, all aceptado`, and a chain refused `1112` from the start behaved the same either way. Such a held chain is retried hourly and released as today once a retry breaks the run; only new holds stop. (Their run, not mine; Task 10b repeats it as a case.)
- **What follows.** Each future-dated record is sent once, in its turn, like any record, and AEAT judges it by its own date. Each refusal still opens a filing case and raises its own `fiscal.registro_rechazado` (`drain.ts:1563-1573`), which A1407 reads; `fiscal.refusals_repeated`, which reads held records (`submission-alerts.ts:90-147`), is not raised for `1112`, because nothing is held.
- **How it stops one more refused sale each hour (finding 2).** With no new hold there is no held record and no hourly retry, so no record is refused because a retry sent it (a chain already held when PR 2 lands drains as above). The records refused are exactly those sent while their date was still ahead of AEAT's, and D9 stops new ones being written once the first refusal arrives on a box confirmed by devices or a person.
- **Evidence that AEAT accepts later records chained after a refused one**, with its limits (`1161`, not `1112`; the test service, not production): R12.

**D12. A box whose clock service does not answer waits at every start, and says why (PR 1a/1b; finding 4).** Such a box cannot see whether its time service is synchronised (R4), so D1 row 2 applies at every start; its time is confirmed by two devices (from PR 1c, with PIN-screen tablets, nobody needs to tap) or by a person, and it cannot be corrected, because a set needs the same host service (as today). The bell alert and the Box status row add one sentence saying the part of the box that reads its internet time is not answering, so it waits like this at every start ("Words"); the existing `clock.sync_off` alert with reason `unreachable` stays beside it. The installer's lines for a failed time-service switch-on and a missing clock service (`waitron.sh:328`, `:359`) and `deploy/README.md:110-114` say so too (Task 9a). **Not chosen:** turning the installer's carry-on into a refusal to install. That path serves laptops and Docker Desktop (`box-host-client.ts:13-14`) and changes `waitron.sh` for every host, and PIN-screen tablets already confirm such a box with nobody tapping. No owner question: the owner's rule (the time service, two devices, or a person) already covers it. The watcher can flip this to the refusal if it prefers.

## Owner questions (all answered)

**Q1. At a restore, may a synchronised time service stand in for AEAT when AEAT cannot be reached? ANSWERED 2026-11-10: yes.** Owner's words: "Yes, time service stands in (Recommended)" (`desk/done/20261110-0946-B-a1420-start-clock-q1.md`). PR 3 builds it; C4 below takes the "yes" wording.

**Q2 and Q3. May a sale's time be earlier than the last sale's? Does a device confirm by itself? ANSWERED 2026-11-10 14:52, in one message** (`desk/done/20261110-0946-B-a1420-start-clock-q2.md`, `-q3.md`):

> "The AEAT check won't work. If we have a long outage we could send invoices from days ago and AEAT will accept them, but i think they should be marked as old because of an outage. How old does an invoice have to be the require being marked as old?
>
> But either way, AEAT won't refuse them for being old, which means the test fails. I think it might refuse them for being too far in the future? But perhaps that requires a different day? We've tested all this in the Verifactu package. Check there for the answers.
>
> So if this was how you were planning on checking the AEAT time then I think it is flawed. I thought there was some API to ask AEAT for its current time. In this case, we rely on NTP only, we don't bother about AEAT.
>
> And if we successfully sync the clock using ntp then we continue to sell, it doesn't matter how much the clock changes.
>
> If we are not on the internet then we either wait for two devices (eg till and or handheld) to connect and to show that their time is within a few seconds of our time, in which case we accept the current time as correct and continue. Or we stop and ask a user to confirm that our current date+time is correct (or we ask them to correct it), then we continue."

What it decides: PR 5 removes the stop with no AEAT test first and no date-only confirmation. Two devices within a few seconds confirm with nobody tapping (D1 row 3a, 5 s); otherwise a person confirms or corrects (rows 3b, 3c). A single device never confirms alone, and devices never set the clock. The owner's questions are answered from the Verifactu findings in R12.

**Q4. Should the box still list sales recorded with a wrong time? ANSWERED 2026-11-10 14:59, narrowed at 15:06** (`desk/done/20261110-0946-B-a1420-start-clock-q4.md`, `20261110-1506-a1420-best-effort-clock.md`). 14:59:

> "What we want to achieve is to issue corrected invoices automatically. I believe we only need those for invoices with the wrong date. So we will need to make a list of invoices requiring correction.
>
> Question: will there be invoices that need correction? Let's say the clock is far in the future today. As soon as we try to file an invoice AEAT will complain and reject(?) the invoice, and we should respond appropriately by stopping selling and resetting the clock. So only the invoices in that batch should require correction, but we should have recorded those already from the AEAT response, no?"

15:06: "too complicated. i think we don't embark on these efforts to spot the wrong times. we make a best effort to set the right clock time at startup, then we use ntp to stay in sync. if AEAT tells us that we've submitted invoices for the wrong day then we correct them. we don't try to catch people changing the time."

What it decides: no list made by the box (D8); the reaction to a future-date refusal (D9, PR 2) stays from the 14:59 words. The owner's question "we should have recorded those already from the AEAT response, no?": yes (D8).

**Q5. While payments wait for the time to be confirmed, do orders still reach the kitchen? ANSWERED 2026-11-10 15:30: yes.** Owner's words: "Orders still go (Recommended)" (`desk/done/20261110-0946-B-a1420-start-clock-q5.md`). Only taking payment and writing fiscal records wait (D4).

**Answers given on revision 4 (2026-11-10, afternoon).**

- **Reading 3, filing behind a future-date refusal:** "No, they shouldn't wait. I don't understand why this would be a thing? A future invoice is rejected. We fix the clock we start sending correct invoices, and we send a correction invoice for the refused one. No waiting" (`desk/done/20261110-1519-a1420-no-wait-behind-refused.md`). D11.
- **Finding 5, AEAT's reply date as a confirmation when the time service cannot synchronise:** "when would we make a request to AEAT if we can't start up? I can't believe that a mall would block NTP. We can build this if we need to. NTP is the answer for now" (`desk/done/20261110-1624-a1420-rev4-fable-review.md`). No AEAT-based confirmation.
- **Finding 6, tablets at the PIN screen:** "Count PIN-screen tablets (Recommended)" (same file). Task 4b (PR 1c).
- **The waiting words:** "and we should say that we're waiting for devices to connect on the waiting screen" (`desk/done/20261110-1624-a1420-waiting-words.md`). "Words".

## Readings for the watcher

Choices lane B made without an owner question. **All five were confirmed as they stand by the watcher, 2026-11-10 17:28** (`waitron-campaign-b/questions.md`, "WATCHER 2026-11-10 17:28 — A1420 revision 5: CLEARED with two changes"; a watcher decision, not an owner approval). Each can still be flipped without touching the rest.

1. **A person's plain "the time is right" ends the future-date stop** (D9). The box cannot tell whether its clock is still ahead after AEAT's refusal, and the person sees both clocks. Flipped, only a correction or the time service ends it, and a box a few seconds fast at midnight could not be released from a till (the limit on sub-minute errors).
2. **A box whose clock service does not answer waits at every start, rather than the installer refusing to install** (D12).
3. **The till guide's sentence goes with the PR that changes the till screen**, which after the watcher's split is PR 1c (Task 4b's). The sentence tells staff that tablets at the sign-in screen count, which is true only from 1c. So 1a's own till changes (the waiting notice once signed in, the dialog's second button) have no guide paragraph until 1c lands.
4. **The future-date trigger lives in the watch's 15-second look and compares record numbers** (D9), not the moment AEAT's reply arrives: a refusal of an older sale can arrive after a confirmation and must not stop a box a person has just checked.
5. **The PIN screen also shows the waiting line**, with its count (Task 4b, PR 1c; about 25 production and 30 test lines). Taken from the owner's "we should say that we're waiting for devices to connect on the waiting screen": staff look at the PIN screen while the box waits, and PIN-screen tablets are now the main way to confirm. Flipped, the PIN screen keeps showing nothing, as today.

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Till staff notice `clock.unconfirmed` (`apps/till/src/i18n/strings.ts`, `codes.ts`), param `agreed` (0 or 1, below), PR 1a; the same line on the till's PIN screen in PR 1c (Task 4b, reading 5) | Payments wait: the server is waiting for devices to connect and agree with its time ({agreed} of 2 so far) | Los cobros esperan: el servidor espera a que se conecten dispositivos y coincidan con su hora ({agreed} de 2 por ahora) |
| Same, hint | the existing "Check the time" (`staff_notice.check_time`; `CHECKABLE` gains the code) | «Comprobar la hora» (unchanged) |
| Till payment refusal `sale.clock_unconfirmed`, PR 1a | Payment not recorded: the server is waiting for its time to be confirmed. The order stays open. Use “Check the time” at the top of the screen. | Cobro no registrado: el servidor espera a que se confirme su hora. El pedido sigue abierto. Usa «Comprobar la hora» en la parte superior de la pantalla. |
| Till card charged but refused, `sale.charged_clock_unconfirmed`, PR 1a | Card charged, but the payment is not recorded: the server is waiting for its time to be confirmed. Don't charge again. Once it is confirmed, try this payment again: it is recorded without charging again. | Tarjeta cobrada, pero el cobro no está registrado: el servidor espera a que se confirme su hora. No cobres otra vez. Cuando esté confirmada, vuelve a intentar este cobro: se registra sin cobrar otra vez. |
| Till "Check the time" dialog, while the box waits and the clocks agree, in place of `box_time.agrees` (`apps/till/src/i18n/strings.ts:1914-1915,3841-3842`), whose last sentence a waiting confirmation would make untrue (D3) (`box_time.agrees_waiting`), PR 1a | The server's clock says {box}, and this device agrees. If that is the right time, confirm it: payments start again. | El reloj del servidor marca {box} y este dispositivo coincide. Si es la hora correcta, confírmala: se puede volver a cobrar. |
| Same dialog, while the box waits and the clocks differ, under the existing words (`box_time.differs_keep`), PR 1a. No "every manager is told" sentence: nothing is raised for it (D3). The existing `box_time.differs_ask` keeps its sentence, because "Use this time" raises `clock.corrected` | If the server's time is the right one, keep it instead: payments start again. | Si la hora correcta es la del servidor, mantenla: se puede volver a cobrar. |
| Same, the second button (`box_time.keep_server`), beside the existing “Use this time” | The server's time is right | La hora del servidor es correcta |
| Bell alert `clock.unconfirmed`, param `agreed`, PR 1b | The box has not confirmed its time since it started, so it is not taking payments. It is waiting for tills or handhelds to connect and agree with its time ({agreed} of 2 so far), and confirms by itself once two do or once it reaches the internet. You can confirm or correct the date and time now on the Box status page; staff can use “Check the time” on a till. | El equipo no ha confirmado su hora desde que arrancó, así que no acepta cobros. Está esperando a que se conecten terminales y coincidan con su hora ({agreed} de 2 por ahora), y la confirma solo en cuanto lo hacen dos o en cuanto llega a internet. Puedes confirmar o corregir la fecha y la hora ahora en Estado del equipo; el personal puede usar «Comprobar la hora» en un terminal. |
| Same, and the Box status row, one more sentence when the box's clock service does not answer (param `hostAnswers: false`, D12), PR 1b | It cannot see its internet time, because the part of the box that reads it is not answering, so it waits like this at every start. | No puede ver su hora de internet porque la parte del equipo que la lee no responde, así que espera así en cada arranque. |
| Box status, Clock row while waiting, PR 1b | Waiting for devices to connect and agree with the box's time ({agreed} of 2 so far): no payments are taken. The box's clock says {boxAt:date-time}. | Esperando a que se conecten dispositivos y coincidan con la hora del equipo ({agreed} de 2 por ahora): no se aceptan cobros. El reloj del equipo indica {boxAt:date-time}. |
| Same, button | The date and time are right | La fecha y la hora son correctas |
| Same, help under the button | Press this only if the date and time above match a clock you trust. If they do not, use “Check with this device's time”. | Pulsa esto solo si la fecha y la hora de arriba coinciden con un reloj de confianza. Si no, usa «Comprobar con la hora de este dispositivo». |
| Till staff notice `clock.future_date_refused`, PR 2 | The tax agency refused a sale because the server's date was ahead. Payments wait until someone checks the time. | Hacienda rechazó una venta porque la fecha del servidor iba adelantada. Los cobros esperan hasta que alguien compruebe la hora. |
| Bell alert `clock.future_date_refused`, PR 2 | The tax agency refused a sale dated {date:date} because that date was in the future when it was sent, so the box has stopped taking payments until its time is checked. Confirm or correct the date and time on the Box status page; staff can use “Check the time” on a till. | Hacienda rechazó una venta con fecha {date:date} porque esa fecha era futura cuando se envió, así que el equipo ha dejado de aceptar cobros hasta que se compruebe su hora. Confirma o corrige la fecha y la hora en Estado del equipo; el personal puede usar «Comprobar la hora» en un terminal. |
| Box status, Clock row in that cause, PR 2 | The tax agency refused a sale as dated in the future: no payments are taken until the time is checked. The box's clock says {boxAt:date-time}. | Hacienda rechazó una venta por tener fecha futura: no se aceptan cobros hasta que se compruebe la hora. El reloj del equipo indica {boxAt:date-time}. |
| Bell and email after any set | unchanged `clock.corrected` words | unchanged |
| Start-failure page, cause `clock_moved` — title (PR 4) | The box could not check its clock. | El equipo no pudo comprobar su reloj. |
| Same — action | Its clock changed while the box was comparing it with the tax agency's time. Press “Retry a normal boot” to check again. | Su reloj cambió mientras el equipo lo comparaba con la hora de Hacienda. Pulsa «Reintentar un arranque normal» para comprobarlo de nuevo. |
| Waiting page (box's address while the restore waits) — title (PR 4) | The box is waiting for the internet's time. | El equipo está esperando la hora de internet. |
| Same — body | It needs that time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | La necesita para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Setup done screen, under "The server is restarting to finish setup." (`done.waiting_internet_clock`), PR 4 | The box is waiting for the internet's time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | El equipo está esperando la hora de internet para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Guide `backup-recovery.md` (EN/ES), replacing #2532's sentence after "If the clock check refuses, resolve its cause and try again." (PR 4) | If the box cannot get the internet's time when it restarts to finish the restore, it tries again every minute by itself; connect it to the internet if it is not. If it then shows a page saying it could not check its clock, do what that page says. | Si al reiniciarse para terminar la restauración el equipo no puede obtener la hora de internet, lo vuelve a intentar solo cada minuto; conéctalo a internet si no lo está. Si después muestra una página que dice que no pudo comprobar su reloj, haz lo que indica esa página. |
| Guide, the till's clock section in `till-notices.md` (EN/ES), PR 1c (reading 3) | When the server starts without the internet's time, payments wait. They start again by themselves once two tills or handhelds are switched on and connected, even at the sign-in screen, and agree with the server's time. Otherwise, use “Check the time”: keep the server's time if it is right, or use this device's time if that is. | Cuando el servidor arranca sin la hora de internet, los cobros esperan. Vuelven a funcionar solos en cuanto dos terminales están encendidos y conectados, aunque estén en la pantalla de inicio de sesión, y coinciden con la hora del servidor. Si no, usa «Comprobar la hora»: mantén la hora del servidor si es correcta, o usa la de este dispositivo si lo es esa. |

**The count `agreed`** is the size of the largest group of devices, one per address, within 5 s of the box and of each other: the rule that confirms, through the same grouping (`largestDeviceGroup`, `packages/fiscal/src/clock-witnesses.ts:80-100`) with its two-device floor lifted, so two devices that each agree with the box but not with each other read 1, never "2 of 2" while the box still waits. A group of two confirms at the watch's next look, within 15 s; until then the words show at most 1. The administrator's "The date and time are right" carries no "managers are told" sentence today or in this plan.

The restore's waiting page (PR 4) waits for the internet's time only: no device or person can finish a restore (R3, R5), so it does not mention devices. The dashboard's existing button is “Check with this device's time” / «Comprobar con la hora de este dispositivo» (`box_status.clock.admin.open`, `apps/dashboard/src/i18n/strings.ts:3741,7636`). The till's "Check the time" words are pinned in `apps/till/src/i18n/strings.test.ts:304-305`.

## Sentences changed, word for word

### Root `CLAUDE.md`

**C1. PR 1a inserts a new rule** in §5, in front of "More than a minute behind the latest fiscal record…" (line 899):

> **Every start of a box that files records writes no fiscal record and moves no money until its time is confirmed: by the box's internet time service being synchronised, by two enrolled devices at different addresses reading within 5 seconds of it, or by a person confirming or correcting the date and time on a till; AEAT is not asked, and orders still reach the kitchen** (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT … If we are not on the internet then we either wait for two devices … Or we stop and ask a user to confirm that our current date+time is correct (or we ask them to correct it)"; "Orders still go"). Guards: `apps/server/src/start-clock-check.test.ts`, `apps/server/src/clock-unconfirmed-gate.test.ts` and `apps/server/src/boot.start-clock-gate.test.ts`, weaker than the rule: the seat's four writers and one cash sale only; the record remedies, off in production, are outside it.

PR 1d, which adds the table of money routes to `clock-unconfirmed-gate.test.ts`, changes "the seat's four writers and one cash sale only" to "the money routes in the gate table only" (2026-11-12, PR 1d: worded as landed in root `CLAUDE.md` §5, naming the test file, the four writers and boot's one cash sale). PR 1b changes "on a till" to "on a till or on Box status". **C11.** PR 2 appends, before "Guards:": "A refusal by AEAT of a record dated in the future (`1112`) sends a start confirmed by devices or a person back to waiting once, if that record was written since; a box kept in time by the internet is never sent back, and such refusals never start a hold on later records (owner, 2026-11-10: "We fix the clock we start sending correct invoices … No waiting")." and adds `apps/server/src/clock-watch.future-date.test.ts` and `packages/fiscal-verifactu/src/drain.future-date.test.ts` to the guards.

**C2. PR 1a changes the "Nothing EXTERNAL may block a sale" rule** (§5, lines 878-880): its bold heading and its first sentence. Replace the heading

> **Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.**

with

> **Nothing EXTERNAL may block a sale, though a start must have its time confirmed first — and a till needs the venue's PRIMARY.**

and replace

> AEAT, the card network and the internet are never on the sale path of whichever node is primary: records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

with

> AEAT, the card network and the internet are never on the sale path of whichever node is primary, except that a start the internet cannot confirm waits for two devices or a person to confirm its time before its first payment (owner, 2026-11-10): records chain locally and the outbox drains later; a card falls back to 4G, a standalone terminal or cash.

**C3. The clock-setting sentence** (§5, lines 909-913), in two steps. Today:

> **The box sets its clock only through the host service, from AEAT, a till's time (a staff member's during start-up, an administrator's at any time) or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed.**

PR 1a replaces it with:

> **The box's internet time service keeps its clock; Waitron sets it only through the host service, from a till's time (a staff member's while the start has not confirmed the time, an administrator's at any time), an administrator's own device, or AEAT only inside the clock-behind stop — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed** (owner, 2026-11-10: "we rely on NTP only, we don't bother about AEAT").

PR 6, which deletes the stop and its AEAT set, drops ", or AEAT only inside the clock-behind stop".

**C4. PR 3 changes the restore sentence** (§5, lines 928-930). Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds, or, at the start placing a restore, the box's time service says it is synchronised (owner, 2026-11-10); never on a device's, till's or administrator's confirmation; a minute whose name is already in a history the box reads is not taken.

**C5. PR 5 replaces the stop's rule** (§5, lines 899-908). Replace

> **More than a minute behind the latest fiscal record, write no record and take/refund no new money unless a clock confirmation covers it.** After replay, call `refuseWhileClockBehind` before reader/refund/drawer work; pause both refund recovery loops. Recheck card-refund send/outcome in their dating transaction after provider waits. Still store money already moved. **Clock confirmation lifts the stop for one step back, with no gap limit; once a record is written under it, readings stay within a minute of the latest record written since.** Sources, never a box device outside development: [conventions-data.md](docs/developers/conventions-data.md#root-receipts-moved-on-2026-11-06). Guards: clock-behind-stop, payments clock-behind, fiscal chain/restart/confirmation, clock-confirm route and `apps/server/src/clock-watch.start-up.test.ts` suites, weaker than the rule: only named routes/readings/requests; new money routes unguarded.

with

> **A record's time is never compared with the latest record's: the start confirms the time, and once it is confirmed the box records with its clock however far a later sync moves it** (owner, 2026-11-10: "if we successfully sync the clock using ntp then we continue to sell, it doesn't matter how much the clock changes"). After replay, call the seat's `refuseWhileClockBehind` (by then: waiting, or before 28-10-2024) before reader/refund/drawer work; pause both refund recovery loops while waiting. Recheck card-refund send/outcome in their dating transaction after provider waits, against the same check. Still store money already moved. Guards: `packages/fiscal-verifactu/src/chain.earlier-time.test.ts` and `apps/server/src/clock-unconfirmed-gate.test.ts`, weaker than the rule: the money routes `clock-unconfirmed-gate.test.ts` lists.

(PR 6 renames `refuseWhileClockBehind` to `refuseUntilRecordable`, and C5 follows the rename.)

C5 keeps today's "Recheck card-refund send/outcome in their dating transaction after provider waits", with "against the same check" added, because the re-check stays in the code (R5's refund row: `clockStopsRefund`, `bill-refunds.ts:209-220`, still pauses while waiting). After PR 2 a box confirmed by devices or a person can go back to waiting during a provider's wait (D9), which the re-check catches; otherwise it finds a clock set before 28-10-2024 during the wait (`bill-refunds.ts:215-217`, read, not run).

**C6. PR 5 deletes the fiscal-fixture rule** in §4 (lines 738-740), which exists only because the stop refused a write behind a fixture's record:

> **A fiscal fixture must not be over a minute ahead of a later recording write's clock.** In a shared database, every write and helper takes its clock from the latest record time; otherwise give the case its own database. Nothing guards it.

Replacement: none (deleted, and the commit says so). Its receipt in `docs/developers/testing-guide.md` gets a dated pointer to this plan.

### `docs/developers/conventions-data.md`

**C7. PR 1a**, the section "Nothing external may block a sale, and a till needs the venue's primary" (lines 3985-3989): its heading becomes "Nothing external may block a sale, though a start must have its time confirmed first, and a till needs the venue's primary", and its bold line and first sentence take C2's replacements word for word.

**C8. PR 1a**, "The box sets its own clock" (lines 4479-4481). Replace "The box sets its clock only inside a stop it already has: the clock behind the latest record, or the clock before 28-10-2024 (`clock.unusable`). It opens no stop of its own." with "The box sets its clock inside a stop it already has (the clock behind the latest record, or before 28-10-2024), and, from a staff member's till or an administrator's device, while a start has not had its time confirmed by the internet. It opens no stop of its own." (PR 6 drops "the clock behind the latest record, or".)

**C9. The copies in "Who may confirm or set the clock"** (lines 6101-6118) hold C3's and C5's sentences word for word. Each copy takes the same replacement in the same PR (C3 in PRs 1a and 6, C5 in PR 5). The sentence between them, "Sources: AEAT, two agreeing devices at different addresses (not while the stop found at start-up lasts), an administrator's own device, or a till's time confirmed on it by an administrator at any time or, during a stop found at start-up once AEAT has not answered or cannot be asked, by a staff member signed in on it (owner, 2026-10-31); never a box device outside development.", becomes in PR 1a "Sources: the box's time service; during the stop, AEAT and two agreeing devices at different addresses (not while the stop found at start-up lasts); while a start waits, two devices at different addresses within 5 seconds, signed in, which confirm and set nothing; an administrator's own device; or a till's time confirmed on it by an administrator at any time or, while the start has not confirmed the time, by a staff member signed in on it (owner, 2026-10-31; 2026-11-10); never a box device outside development."; PR 1c changes "signed in," there to "at the PIN screen or signed in,"; and in PR 6 it loses "during the stop, AEAT and two agreeing devices at different addresses (not while the stop found at start-up lasts);".

**C10. PR 1a**, the till routes' entry (line 4535): "any staff member the till's profile admits, during the start-up window only (below)" becomes "any staff member the till's profile admits, while the start has not confirmed the time (below)".

### `docs/backlog/box.md`, the owner's decision of 2026-11-06 (line 1595)

This is a dated decision record, so the sentences are not rewritten in place: **PR 1a adds a dated line under it** — "**Superseded in part (owner, 2026-11-10, A1420).**" — followed by each sentence and its replacement:

| 2026-11-06 sentence | Replaced by (2026-11-10) | PR |
| --- | --- | --- |
| "Being unable to reach AEAT never stops trading." | "AEAT is not asked at a start. A start whose time service is not synchronised takes no payment until two devices agree with its clock or a person confirms or corrects its date and time." | 1a |
| "A start with no internet whose latest record is in the future beyond the margin needs the time confirmed first." | "Every start with no internet needs its time confirmed first, wherever its latest record is." | 1a |
| "Any accepted source showing the clock outside the margin stops trading until it is corrected, and AEAT disagreeing during normal trading is such a source." | "Nothing stops trading for the clock once a start's time is confirmed; a synchronised time service may move it any distance." | 5 |
| "A box whose time service says it is in sync raises an alert rather than stopping when AEAT disagrees." (never built) | "A box whose time service is synchronised is trusted: AEAT is not compared with it at a start or a restore, and AEAT refusing a sale as dated in the future does not stop it (owner, 2026-11-10: "NTP is the answer for now"; A1420 D5, D9)." Nothing built changes. | 1a |
| "…and records dated in the future beyond the margin are flagged for correction." | "…and invoices AEAT refuses as dated in the future are corrected (A1407); a wrong date AEAT accepts or never sees is not (owner, 2026-11-10)." | 1a |

"AEAT refusing the latest record as too far in the future stops trading until the clock is reset" is built by PR 2 in D9's form: once, for a box confirmed by devices or a person, until a person checks the time. PR 2 adds a dated line saying so, quoting the owner's 15:31 words. "The margin is one minute" is not changed by this plan.

## PR 1a — a start the internet cannot confirm waits for two devices or a person on a till

Tasks 1, 2, 3, 4, 6a, 7a and 9a: about 295 production and 390 test lines ("Size"). Revision 5 also put Tasks 4b and 6b here; since the watcher's clearance they are PRs 1c and 1d.

### Task 1: the start check's decision (apps/server and packages/fiscal, pure)

Files: new `apps/server/src/start-clock-check.ts` and its test; `packages/fiscal/src/clock-witnesses.ts` (`agreeingDeviceGroup(witnesses, marginMs = CLOCK_WITNESS_MARGIN_MS)`, the margin passed through to its agreement and grouping tests; new `agreeingDeviceCount(witnesses, marginMs)`: the size of the largest group within the margin of the box and of each other, one per address, through `largestDeviceGroup` (`:80-100`) with its floor of two lifted, shown capped at 1) and its test.

- [ ] Tests, `clock-witnesses.test.ts` (fiscal): two devices at two addresses 3 s and 4 s from the box, with `marginMs` 5 000 → both returned and a count of 2; one of them 6 s out → none returned and a count of 1; two at one address → a count of 1; two at two addresses, one 4 s ahead of the box and one 4 s behind (8 s apart) → a count of 1, not 2 (Minor 4 of the fresh review). Control: the existing 60 s cases, unedited.
- [ ] Tests, `start-clock-check.test.ts`, with a fake `clockStatus` and a `createClockWitnessStore` fed device readings. End point: each call settled.
  1. Synchronised → `by_internet`. Not synchronised → `waiting`. The host throws or answers `available: false` → `waiting`, and the state reports `hostAnswers: false` (D12).
  2. Waiting, two devices at different addresses within 5 s → `confirmDevices` returns the two readings and the state becomes `by_devices`. Controls: two devices at one address → stays waiting; two devices 2 days out, agreeing with each other → stays waiting (and nothing is set).
  3. The transitions of D3, one case each: `by_devices` or `by_person`, then a look that finds the time service synchronised → `by_internet`; once `by_internet`, `confirm` of any source and `backToWaiting` both leave it `by_internet` (this suite owns "by the internet is final"); `by_person` → `backToWaiting("future_date_refused")` → waiting with that cause (used by PR 2).
  4. Each `confirm` moves the confirmation mark to the heads it is given; `backToWaiting` does not move it.
- [ ] Implement `startClockCheck(deps) → Promise<"by_internet" | "waiting">` and `startClockState()` holding `waiting | by_devices | by_person | by_internet`, a cause, the mark, `hostAnswers`, with `confirm(by, heads)`, `backToWaiting(cause)` and `unconfirmed()`.
- [ ] `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts`, `pnpm --filter @waitron/server exec vitest run src/start-clock-check.test.ts`.

### Task 2: a set at reason `start` writes the row every set writes (fiscal seat type)

Files: `packages/fiscal/src/backend.ts` (`ClockStepRequest.reason`, `:270`, gains `"start"`); `apps/server/src/clock-correction.ts` (`ClockSetInput.reason`, `:60`, the same). `clock-step.ts` already writes the row without the stop's check for any reason but `behind_chain` (`:90`). No new seat method and no row for a confirmation that sets nothing (D3).

- [ ] Test (`clock-step.test.ts`, one new case): a verified step at reason `start` from source `staff` writes one row with its person and reason `start`, and raises `clock.corrected` as other steps do. Control: the existing `behind_chain` step case, unedited.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-step.test.ts`, then the fiscal core command.

### Task 3: boot runs the check before the listener; the correction admits reason `start`

Files: `boot.ts` (run Task 1 after the shared reading exists, `:3061-3062`, and before `:3611`, through `StartServerSeams.boxHost`, so no test's start reaches a real host; hold the state); `clock-correction.ts` (reason `start` admitted without a stop from source `staff` or `admin` while the state is not `by_internet`; such a set moves the state to `by_person` with the heads after it; source `authority` at reason `start` is refused).

- [ ] Test (`clock-correction.test.ts`, new cases only; **this suite owns "a set is refused once confirmed by the internet"**): reason `start` from staff admitted while waiting and while by devices; refused `not_stopped` once by the internet; reason `start` from `authority` refused. Control: the existing "refuses a set with no stop" case, unedited.
- [ ] Test (one case in `boot.clock-correction.test.ts`, which already boots with a fake host): not synchronised → the start check reads waiting before the listener's first answer, and the host receives no set. Control: synchronised → `by_internet`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts src/boot.clock-correction.test.ts`.

### Task 4: the watch keeps listening (apps/server)

Files: `clock-watch.ts` (a new `clockStatus` dependency: boot hands it the shared reading, `readClockService`), `clock-watch.start-up.test.ts` (new cases).

- [ ] Tests: while not `by_internet`, each look reads the time service through the dependency and, while waiting, asks Task 1 about the device readings; a waiting box whose time service turns synchronised is `by_internet` at the next look; two agreeing devices noted between looks confirm at the next look, write no row and log `clock_start.confirmed` with source `devices`; once `by_internet`, a look asks nothing for the start check. **Finding 10:** with boot's real one-minute cache and a fake host, four looks 15 s apart start one host read, and a fifth after 60 s starts a second (control). AEAT is asked by no start-check look (the fake AEAT's ask count stays 0 over three looks; control: the existing stop case that asks it). Control: the existing "no stop" case, unedited.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-watch.start-up.test.ts src/clock-watch.test.ts`.

### Task 6a: the gate's wrappers and wiring (apps/server)

Files: new `apps/server/src/start-clock-gate.ts` (the helper both boot and the gate's tests use: the two wrappers of D4 around the one seat, asking `filesRecords()` at each call); `boot.ts` (wraps the seat with it; hands `unconfirmed()` to the two loops and `clockStopsRefund`; 2026-11-12, PR 1d: 1a handed it to the two loops alone, and the till's and dashboard's refund routes get it from 1d); `tender-refund-recovery.ts`, `bill-payments-loop.ts`, `bill-refunds.ts` (one condition each); `apps/server/src/errors.ts` (`clock.unconfirmed: {}`; reason `clock_unconfirmed` on `sale.charged_not_recorded`); `till-api.ts` and `payments-api.ts` status maps (409); new `apps/server/src/clock-unconfirmed-gate.test.ts` (the four writers' cases below; PR 1d adds the table of money routes to it). Not `record-remedy-routes.ts` (R7).

- [ ] Tests, `start-clock-gate.test.ts`: the wrapped `refuseWhileClockBehind` throws `clock.unconfirmed` while waiting and passes through once confirmed (control); a box whose `filesRecords()` turns true while waiting is refused from that call (finding 13); control: while false, it passes. Both loops leave a pending refund untouched for one pass while waiting, and complete it once confirmed (control), in their own suites.
- [ ] Test, new `apps/server/src/clock-unconfirmed-gate.test.ts` on `provisionBillVenue` and the existing bill fixtures under `apps/server/src/testing/`, its seat wrapped by the helper: **the four writers themselves** (finding 8; kept in 1a at the watcher's clearance): `recordSale`, `recordVoid`, `recordCorrection` and `recordSubstitution`, called on the wrapped seat while waiting, each throw `clock.unconfirmed` and leave `registros_facturacion` unchanged; control: the same four calls once confirmed each write one record.
- [ ] Test, new `apps/server/src/boot.start-clock-gate.test.ts` (wiring only, R3's harness): not synchronised → `POST /api/sales` answers 409 `clock.unconfirmed`; synchronised → 200 and one record (control).
- [ ] The four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) get a start whose time is confirmed: a fake host answering synchronised, through `StartServerSeams.boxHost`. Setup only; no assertion changes. Then run the same 102-file selection R10 ran; any other failure is a STOP.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-gate.test.ts src/clock-unconfirmed-gate.test.ts src/boot.start-clock-gate.test.ts src/tender-refund-recovery.test.ts src/bill-payments-loop.test.ts src/boot.backup-network.test.ts src/promote-endpoint-e2e.test.ts src/handover-controlled.e2e.test.ts src/handover-stepdown.real.test.ts`, then the fiscal core command.

### Task 7a: "Check the time" while waiting, with both choices (server and till)

Files: `clock-start-up.ts` and its notice check `tillClockCheck` (`:46-79`): while the start check is not `by_internet`, "Check the time" is offered and staff are admitted whatever `open()` and the AEAT state say (D1); `till-box-clock-api.ts`: while the start check is not `by_internet`, the challenge (`:188`) and the confirm (`:281`) neither call `noStop()` nor ask `admit`, and the challenge answer carries `keepOffered: true`; the confirm accepts `keep: true`, which confirms the box's time as it stands whatever the till's reading (no host call, state `by_person`, log line); without `keep`, today's rule (`:258`): a till within a minute confirms the same way, further out "Use this time" sets through the host with reason `start` (`:327`) and then confirms; `keep: true` is refused once the start check is `by_internet`, with today's `noStop` refusal (`:172-174`). The staff-notice source (`clock.unconfirmed` while waiting, with `agreed`). Till: `widgets/box-time-dialog.ts` (when the challenge carries `keepOffered` and the clocks differ by more than a minute, the "ask" view adds `box_time.differs_keep` and a second primary button `box_time.keep_server` beside "Use this time"; when they agree, "The time is right" only, as today, because the correction refuses a set within a minute, `clock-correction.ts:235`, but with `box_time.agrees_waiting`'s words in place of `box_time.agrees`, which promise that every manager is told (D3)); `i18n/strings.ts`, `codes.ts`, `staff-notices.ts` (`CHECKABLE` gains `clock.unconfirmed`), `widgets/pay-refusal.ts` (the two refusals).

- [ ] Tests: `clock-start-up.test.ts` (offered while waiting, at once; offered while waiting with the window shut by `noStop()` first; offered while waiting on a box created with `primaryAtStart: false`; control: by the internet with the window open → not offered for waiting). `till-box-clock-api.test.ts`: **the window shut first** (`startUp.noStop()`), then a waiting box's challenge → 200 with `keepOffered: true`, and its confirm with `keep: true` → 200; the same with AEAT never asked (no `authority_pending`); control: the same shut window once by the internet → the challenge refused `not_stopped`, as today. Waiting, a till 10 minutes off sending `keep: true` → 200, no host call, no row, state `by_person`, one `clock_start.confirmed` log line with source `staff` (finding 3's case: a right box and a wrong tablet); a till 2 days off sending "Use this time" → one host set with reason `start` and requester `staff`, then by a person; a till within a minute → confirmed with no host call; **one route case: by the internet → `keep: true` refused**, the property's other owner being Task 3. Till, `box-time-dialog.test.ts`: with `keepOffered` and differing clocks, exactly "Not now", "The server's time is right" and "Use this time", and the first of the two sends `keep: true`; with `keepOffered` and agreeing clocks, the words are `box_time.agrees_waiting`'s, with no "Every manager is told" sentence in either language; without `keepOffered`, the existing two cases unedited (controls, still showing `box_time.agrees`). `src/i18n/staff-notices.test.ts` and `src/i18n/t.test.ts` (both languages, the `agreed` count), `pnpm exec vitest run scripts/staff-notice-codes.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-start-up.test.ts src/till-box-clock-api.test.ts src/boot.clock-watch.test.ts`, `pnpm --filter @waitron/till exec vitest run src/widgets/box-time-dialog.test.ts src/i18n/staff-notices.test.ts src/i18n/t.test.ts` (free memory first).

### Task 9a: PR 1a documents and the installer's words

- [ ] Root `CLAUDE.md` C1 (1a form), C2, C3 (1a form); `conventions-data.md` C7, C8, C9 (1a form), C10 and a new section "Every start confirms the box's time before it trades" (D1-D4, D12, R3, R4, R6, R7, and R11's signed-in readings; PR 1c adds the PIN screen), quoting the owner's 2026-11-10 words; grep the file for every other "only inside a stop" or "only during a stop" claim and fix each; `docs/backlog/box.md`'s dated line (its 1a rows); the A1407 entry in `docs/backlog.md` gains "an enabled remedy takes the start gate first" (R7) and "the invoices to correct are those AEAT refuses as dated in the future (`1112`), already stored on the filing record; a wrong date AEAT accepts is not corrected (owner, 2026-11-10; A1420 D8)"; A798 slice 9c's "a clock running ahead dates sales…" line narrows to a clock that drifts ahead while the box runs.
- [ ] D12's installer words: in `deploy/waitron.sh`, the `cannot` text (`:359`) gains ", or see whether it keeps internet time, so at every start it takes no payment until two tills or handhelds agree with its clock or someone confirms it", and `enable_time_sync`'s failure line (`:328`) and `deploy/README.md:113-114` gain "and every start waits until two tills or handhelds agree with its clock or someone confirms it" beside today's clause about the clock reading earlier than its last sale (which PR 5 removes). `scripts/waitron-sh.test.mjs:1282,1326,1397-1398` match on unchanged prefixes and stay unedited. The comment at `apps/server/src/box-host-client.ts:13-14` ("because a box without the service (a laptop, Docker Desktop, a host without systemd) still sells") becomes untrue for a box that files records: it changes to say such a box answers every request with `available: false`, which the start check reads as not synchronised (D12).
- [ ] `pnpm exec vitest run scripts/claude-md-pointers.test.ts scripts/waitron-sh.test.mjs`.

## PR 1b — administrators see the wait and confirm or correct the time on Box status

Built on PR 1a. Usable alone once 1a has landed: an administrator with no till and no internet can confirm or correct the time.

### Task 7b: the administrator's routes while waiting (server)

Files: `box-health-api.ts` (R9: `/api/box/clock-confirm` admitted while waiting, from the device's time within a minute or, with `asShown: true`, as the box's date and time stand; no row, a log line with source `admin`, state `by_person`; `/api/box/clock-set` sends reason `start` instead of `behind_chain` while waiting, `unusable` still taking precedence; routes handed no start check behave as today, so the existing route suites' setups stand). (2026-11-11, PR 1a's review: while the old clock-behind stop also holds, the waiting `/api/box/clock-confirm` must write that stop's confirmation (`confirmClockStop`) as well as confirm `by_person`, so it writes a row there, and must refuse `asShown` while a stop holds, as the till refuses its keep; the correction already writes a reason-`start` set's row at reason `behind_chain` while that stop holds. See D3.) (2026-11-13, PR 1b's review: `/api/box/clock-confirm` takes only `{ challengeId, asShown: true }`, since the dashboard compares its own device's time before offering it; and while the start waits `/api/box/clock-set` sends reason `start` even when the clock reads before 28-10-2024, as the till's route does. The confirm cases are in `clock-set.route.test.ts`; `clock-confirm.route.test.ts`, deleted in PR 6, stays deleted.)

- [ ] Tests: `clock-confirm.route.test.ts` (while waiting, an administrator's device within a minute of the box → 200, no row, no host call, state `by_person`; an `asShown` confirm while waiting → the same; control: the existing "refuses a confirmation with no stop and no check waiting", unedited). `clock-set.route.test.ts` (R9's case: waiting, no internet, no till, the box's clock two days ahead of the administrator's device → 200; the host receives one set with reason `start` and requester `{ source: "admin", person }`; one `start`/`admin` row with `stepMs` about −2 days; end point: the start check reads `by_person`. Control: the existing "refuses a set with no stop", unedited, for a box not waiting).
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/clock-set.route.test.ts`.

### Task 8: the bell alert and the Box status row (server and dashboard)

Files: new `apps/server/src/clock-unconfirmed-alert.ts` (an `AlertSource`, `system.manage`, raised while waiting and `filesRecords()`, with `agreed` and `hostAnswers`); `apps/server/src/box-health.ts` (the clock read answers `waiting` with `boxAt`, `agreed` and `hostAnswers`); `apps/dashboard/src/screens/box-status-rows.ts`, `box-status-screen.ts` (`settableStop` and `stopShowing`, `:1217-1231`, also hold while the Clock row reads waiting, so "Check with this device's time" is offered then when the host answers: R9; the "The date and time are right" button and its help), `apps/dashboard/src/i18n/strings.ts`, `alert-messages.ts`; the area claim for `clock.unconfirmed` (follow `scripts/alert-codes.test.ts`'s failure message).

- [ ] Tests: `clock-unconfirmed-alert.test.ts` (raised while waiting, with `agreed` 1 when one device agrees; the extra sentence when `hostAnswers` is false; not once confirmed, the control). `box-status-rows.test.ts` and `box-status-screen.test.ts` (the row's words and the box's date and time while waiting, absent once confirmed; "The date and time are right" sends `asShown: true` and the row goes after the answer; a refusal shows beside the button, per the Forms contract; while waiting, with the box not kept in time over the internet and the device two days off, "Check with this device's time" is offered and sends `/api/box/clock-set`; with the host not answering, it is not offered and the row carries D12's sentence; control: the same health once confirmed offers neither). `box-status-screen.a11y.test.ts` gains the waiting state in both themes.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-alert.test.ts src/box-health.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts src/i18n/alerts.test.ts` (free memory first), `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`.

### Task 9b: PR 1b documents

- [ ] C1's 1b step ("or on Box status"). In `apps/server/src/guide/en/box-status.md` and `es/box-status.md`, a new section "When payments wait for the box's time" with the shared id `{#clock-waiting}`: what an administrator does (D1 rows 3a-3c), that two switched-on tills or handhelds confirm by themselves, and that the internet confirms by itself.
- [ ] `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts`.

## PR 1c — tablets at the PIN screen count, and show the waiting line (till only)

Built on PR 1a. Till code only, plus the till guide (reading 3). Task 4b; about 55 production and 70 test lines.

### Task 4b: tablets report their clock from the PIN screen, and show the waiting line there (apps/till)

Files: `apps/till/src/till-app.ts` (a second `EquipmentPoll`, started while the PIN screen shows on an enrolled device and stopped at sign-in, where the signed-in poll starts (`:5684`), and when the device is no longer proved; its `onEquipment` keeps only a `clock.unconfirmed` notice, which the PIN screen shows as one line with its count, and nothing else); the PIN screen's render; its test. No server change: the route already notes the clock and answers notices with only the device checked (R11; R3's CONTROL and BEHIND lines show notices answered to a till with nobody signed in). Showing the line is reading 5, which the watcher confirmed at 17:28; it is about 25 production and 30 test lines of the task's total (reasoned, not run).

- [ ] Tests (till, browser): at the PIN screen, the client sends `GET /api/device/equipment` with `x-waitron-device-clock` every 15 s (fake timers; the existing `client.test.ts:3544` case owns the header); after sign-in only the signed-in poll reads (one read per tick, not two); after `device.unauthorized` nothing reads. The PIN screen shows the waiting line with "1 of 2 so far" when the read answers `clock.unconfirmed` with `agreed` 1, and no line once a read answers without it; control: any other notice code (for example `clock.unusable`) shows nothing at the PIN screen, as today (`till-app.ts:18666-18669` still clears the signed-in notices at sign-out).
- [ ] Documents: the till guide's clock section in `apps/server/src/guide/en/till-notices.md` and `es/till-notices.md` ("Words"; reading 3); C9's PR 1c step; and in `conventions-data.md`'s section "Every start confirms the box's time before it trades" (Task 9a), one sentence that tablets at the PIN screen count (R11).
- [ ] `pnpm --filter @waitron/till exec vitest run <the test file>` (free memory first), `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.

## PR 1d — one table shows every money route refusing while the box waits (tests only)

Built on PR 1a (Task 6a's helper and test file); lands before PR 5, which deletes the stop's six route suites this table replaces. Until then those suites (`clock-behind-stop.*.test.ts`) keep each money route guarded, because the gate wraps the same function they exercise, the seat's `refuseWhileClockBehind`. No production change. The 507's new reason `clock_unconfirmed`, added in Task 6a, has its first test here. Task 6b; about 680 test lines.

### Task 6b: the table of gated money routes (apps/server)

Files: `apps/server/src/clock-unconfirmed-gate.test.ts`, which Task 6a creates, on `provisionBillVenue` and the existing bill fixtures under `apps/server/src/testing/`, its seat wrapped by Task 6a's helper. This is the test PR 5 relies on when it deletes the stop's six route suites (`clock-behind-stop.*.test.ts`: 2,541 lines, 59 cases, about 43 lines a case).

- [ ] **One table, `it.each`, over every money route R5 lists** — `POST /api/pay` (counter card, stored order, zero total), `POST /api/sales` (cash), collect, bill payment, bill refund (new and pending replay), tender refund (new and pending), the tender-refund retry, unpaid departure, and the eight dashboard resolutions — each while waiting: answers 409 `clock.unconfirmed`, `collectCalls`, refund sends and drawer jobs unchanged, no row in `registros_facturacion`, `sales`, `tenders` or the route's own table. Control row: the same request once confirmed answers its success status.
- [ ] Same file, the money already moved: a card charged as the gate turns on whose sale would file answers `507 sale.charged_not_recorded` with `reason: "clock_unconfirmed"` and writes the payment once confirmed; the webhook stores a hosted payment while waiting (as `webhook.test.ts`'s behind case does); a correction through `cancel-credit.ts` is refused with nothing written.
- [ ] Root `CLAUDE.md` C1's PR 1d step; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-unconfirmed-gate.test.ts src/clock-behind-stop.pay.test.ts src/clock-behind-stop.refunds.test.ts src/webhook.test.ts`, then the fiscal core command.

**Size, re-checked against what it replaces:** about 26 cases (about 22 routes and three money-moved cases, their controls as rows; the four writers' cases are Task 6a's). At about 25 lines a case, sharing each route's setup across its two rows, that is about 680 lines: the 750 estimated for revision 5's Task 6b, less the four writers' 70 now in Task 6a. The suites it replaces took about 43 a case (reasoned from those counts, not run).

## PR 2 — a future-date refusal: the box stops once, and later sales keep filing (D9, D11)

Built on PR 1a (it needs the start check's state) and 1b (its alert and row). Two tasks.

### Task 10: a future-date refusal sends a box confirmed by devices or a person back to waiting, once (D9)

Files: `packages/fiscal-verifactu/src` (a seat read, `latestFutureDateRefusal(tx, nodeId)`: the highest `secuencia` on this box's chain whose filing record carries `1112`, with that record's issue date; a read, no change to `drain.ts` here); `packages/fiscal/src/backend.ts` (the optional seat method); `apps/server/src/clock-watch.ts` (each look while `by_devices` or `by_person`: a refusal above the start check's mark → `backToWaiting("future_date_refused")`; while `by_internet`, the warning log line of D9 once per refused record, nothing else); `apps/server/src/start-clock-check.ts` (devices do not confirm in that cause); `apps/server/src/errors.ts`; the till notice, the dashboard row and alert words; `clock-unconfirmed-alert.ts` (raises `clock.future_date_refused`, with the refused record's issue date, in that cause instead of `clock.unconfirmed`); the guide's `{#clock-waiting}` section, one paragraph (EN/ES); `docs/backlog/box.md`'s dated line (its PR 2 row); C11.

- [ ] Tests, the seat read (`clock-future-refusal.test.ts`, fiscal-verifactu): a `1112` reply on a refused record → its position and date; the highest of two; a `2004` warning (accepted) → null, the control; a `1112` on another box's chain → null.
- [ ] Tests, new `apps/server/src/clock-watch.future-date.test.ts`, the watch with a fake seat read and a fake clock. End point: each look settled.
  1. Confirmed by a person; a record written after; its `1112` refusal arrives → waiting, cause `future_date_refused`, and `POST /api/sales` through the gate answers 409 `clock.unconfirmed` (Task 6b's table, PR 1d, owns the routes).
  2. **Finding 1's sequence:** from case 1, a till a day behind sends "Use this time" → one host set, `by_person`, sales taken; then the fake clock is moved on to the refused record's date and past it, over four looks → still `by_person`, sales still taken; and a second `1112` refusal arriving for a record written before that correction → still `by_person`.
  3. From case 1, a person's "The server's time is right" (`keep: true`) → `by_person` (the midnight case of finding 1).
  4. **Finding 11:** from case 1, two devices at different addresses within 5 s of the box → still waiting; control: the same two devices in a plain waiting start → `by_devices`.
  5. From case 1, the time service turning synchronised → `by_internet`.
  6. By the internet; a refusal of a record written while synchronised → still `by_internet`, sales taken, one warning log line (D3, D9).
  7. Controls: a refusal of a record at or below the mark (written before the last confirmation) → no change; a restart (a fresh state, a fresh mark at its confirmation) with the old refusal stored → no change.
- [ ] Tests: `till-box-clock-api.test.ts`: in that cause, `keepOffered` is answered and `keep: true` confirms; and **with the start-up window shut first** (the watch's looks shut it before the refusal arrives), after the refusal sends the box back to waiting, the challenge answers 200 with `keepOffered: true` (D1's staff rule). `clock-unconfirmed-alert.test.ts`: the cause raises `clock.future_date_refused`, not `clock.unconfirmed`.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-future-refusal.test.ts`, `pnpm --filter @waitron/server exec vitest run src/clock-watch.future-date.test.ts src/clock-watch.start-up.test.ts src/till-box-clock-api.test.ts src/clock-unconfirmed-alert.test.ts src/guide-content.test.ts`, `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts`, `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/staff-notice-codes.test.ts`, then the fiscal core command.

### Task 10b: a run of `1112` refusals takes no new hold (filing loop, fiscal code; D11)

Files: `packages/fiscal-verifactu/src/drain.ts` (the claim hold's run test only, `:853-855`: a variant of `sameCodeRunBefore` that answers false when the run's one code is `1112`, named once as a constant beside `SAME_CODE_REFUSAL_LIMIT`, whose comment states the exception and why in one line with a pointer to A1420; `sameCodeRunBefore` itself, `brakeHeldHeads` (`:1020`) and `releasableHeads` (`:1137-1138`) unchanged); new `packages/fiscal-verifactu/src/drain.future-date.test.ts`.

- [ ] Test first, with `createFakeAeat` and `seedPendingEnvios` as `drain.clock-step.test.ts:209-220` does: three records refused `1112`, then a fourth correctly dated → after the next drain the fourth is sent and `aceptado`, not `detenido`; no `fiscal.refusals_repeated` alert; each of the three has its own filing case and `fiscal.registro_rechazado` incident. Control (forced effect): the same with code `1100` → the fourth is `detenido` and the alert is raised, as today. A fifth and sixth future-dated record sent after → each sent once and refused, none sent twice (no hourly retry). **A chain held before the change** (finding 1 of the fresh review of revision 5): three records refused `1112` and a fourth seeded `detenido` behind them, as today's code leaves it, plus a fifth new record → the fifth is held behind the held fourth (control: it is not sent before the release); an hour after the chain's last send the fourth is sent (`brakeHeldHeads`); answered `Correcto`, the chain is released and the fifth is sent and `aceptado` (`sent=2, all aceptado`, as the reviewer's probe printed). Watch the first case fail on the current code.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/drain.future-date.test.ts src/drain.test.ts src/drain.cases.test.ts src/drain.probe.test.ts src/drain.probe.seat.test.ts src/drain.clock-step.test.ts src/submission-alerts.cases.test.ts src/record-remedy-brake.test.ts` (read the `Tests` count; a failure in an existing suite is a STOP), then the fiscal core command **unedited**, and `git diff --stat <base> -- packages/fiscal-verifactu/src/chain.ts` prints nothing.

## PR 3 — a synchronised restore names its series without AEAT (Q1)

(2026-11-13: superseded for the build by `2026-11-13-a1420-restore-series-check.md`, after the owner's 2026-11-11 rule to stop reading AEAT's time.)

### Task 11: the comparison trusts a synchronised box (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/hour-clock.ts`, `hour-clock.test.ts`, `hour-setup-clock.ts`, `hour-setup-clock.test.ts`, `errors.ts` (optional param on `sif.allocation_invalid`: `internet?: string`, for PR 4).

- [ ] Tests (`hour-clock.test.ts`): `compareHourClocks(obs, release, { boxSynchronised: true })` with AEAT unavailable → `canSelectHour` true. The same without the option → false and `second_clock_missing` (control; the existing cases stay unedited). In `hour-setup-clock.test.ts`: with `boxSynchronised: true` no AEAT reading is taken (the fake reader's ask count is 0; control: without the option, 1); a `second_clock_missing` refusal carries `internet: "network"`.
- [ ] Implement. The release and range checks are unchanged.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts src/hour-setup-clock.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 12: the restore's start tells the module whether the box is synchronised (module contract)

Files: `packages/module/src/operation-preparation.ts` (type), `packages/provisioning/src/first-setup-runtime.ts` (`createModuleOperationHost` passes it through), `packages/fiscal-verifactu/src/hosted-hour-recovery.ts` and its test; `apps/server/src/recovery-preparation.ts`, `recovery-entry.ts`, `restore-request.ts` (the start's runner supplies it; the page runner does not).

- [ ] Add to `ModuleOperationHost`, with one comment saying only the start placing a staged restore supplies it:
  ```ts
  startClock?: {
    synchronised(): Promise<boolean>; // false when the host service does not answer
  };
  ```
- [ ] Tests (`hosted-hour-recovery.test.ts`), through `configure!(host).resumeRecovery` then `prepare` as existing cases do: (1) AEAT unreachable with `synchronised` → true: `prepare` admits and AEAT is not asked. (2) The same with `synchronised` → false: it throws `second_clock_missing`; case 1 is the control. (3) No seat: today's refusal (the existing cases, unedited).
- [ ] Test (`apps/server/src/restore-request.test.ts`): the start's runner hands the seat to the module, and `createInteractiveRecoveryPreparation` does not.
- [ ] Root `CLAUDE.md` C4.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hosted-hour-recovery.test.ts`, `pnpm --filter @waitron/server exec vitest run src/restore-request.test.ts src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`, `pnpm exec vitest run scripts/module-seams.test.ts scripts/claude-md-pointers.test.ts`, then the fiscal core command.

## PR 4 — the restore waits for the internet without counting, and the page names the cause

(2026-11-13: superseded for the build by `2026-11-13-a1420-restore-series-check.md`, after the owner's 2026-11-11 rule to stop reading AEAT's time.)

Asked for by the owner on 2026-11-07, through the watcher (D6, D7).

### Task 14: a restore's start that cannot reach the internet waits, uncounted (apps/server)

Files: `apps/server/src/node-entry.ts`; new `start-clock-waiting.ts` (the waiting app) and its test; `apps/server/src/errors.ts` (`server.waiting_for_internet_clock: {}`); `i18n/recovery-page.ts` (waiting page words). Under Q1, a synchronised box never reaches this wait.

- [ ] Tests (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake timers). End point: `runEntry` settled.
  1. `second_clock_missing` with `internet: "network"` → the count after equals the count before; the waiting app is served, closed at 60 000 ms and not before; the start-failure log file has the same length as before. Control (forced effect): `internet: "tls"` → the count rises by one and the log grows.
  2. `internet: "timeout"` → as case 1.
  3. Three `network` starts in a row → the box state is still `normal`.
- [ ] Tests (`start-clock-waiting.test.ts`): `GET /` (HTML) → 503, `Retry-After: 60`, the words in English, and in Spanish with `Accept-Language: es`. `GET /setup-api/status` → 503 `{ error: { code: "server.waiting_for_internet_clock" } }`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/start-clock-waiting.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

Why every 60 seconds with no overall limit: a router coming back is noticed within a minute, each try repeats the restore's archive checks so faster costs more, and the box cannot trade until the restore is placed, so waiting costs nothing. `tls`, `response` and `configuration` are not a network that will come back, so they count as today. Why this wait never brings up the start-failure page (finding 12): the owner asked for exactly that (D7), and for this code the page offers only "Connect the box to the internet, then press “Retry a normal boot”" (`recovery-page.ts:286-298`), which the waiting page says and does every minute by itself (read, not run).

### Task 15: the setup page says what the box is waiting for

Files: `apps/setup/src/screens/done-screen.ts` and its test, `apps/setup/src/i18n/strings/finish.ts`.

- [ ] Test: a poll answered 503 with `server.waiting_for_internet_clock` shows the waiting line under the restarting line. A following poll that fails to connect keeps it (between tries nothing answers). A 404 (trading) shows "ready" and drops it.
- [ ] `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts` (free memory first).

### Task 16: the start-failure page names the cause

Files: `recovery-state.ts` (`lastErrorCause`), `node-entry.ts` (`failStart` sets it), `recovery-surface.ts`, `i18n/recovery-page.ts`; the guide sentence in `backup-recovery.md` (EN/ES).

- [ ] Tests: `recovery-state.test.ts` (a cause outside the set is dropped on read; `withFailureCode` clears a stale one). `node-entry.test.ts`: AEAT's `clock-corrected` reason → cause `clock_moved`; `clock_disagreement` and `minute_in_use` → no cause. `recovery-surface.test.ts`: the cause's words in both languages; no cause → #2532's words (its case stays unedited).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/node-entry.test.ts src/recovery-surface.test.ts src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts`.

## PR 5 — the stop stops answering (Q2; the fiscal core unchanged)

**Behaviour only: no production deletion, and no edit to `chain.ts`.** PR 1d must have landed first: Task 17b deletes the route suites its table replaces. Q2's yes is the owner's 2026-11-10 answer; no AEAT test comes first. Three tasks, each for one implementer; the branch is pushed only after Task 17c, since between 17a and 17b the server's suites still expect the stop.

**PRs 5 and 6 land together.** PR 6 is built on PR 5's branch before PR 5 goes to the owner; both are put to the owner as one approval and landed one straight after the other in the same sitting. PR 5 alone leaves the stop's code in place but unreached, and the nightly run enforces `98/98/98/95` coverage, so a nightly between them could fail. If PR 6 is not ready when PR 5 is approved, PR 5 waits for it.

### Task 17a: `clockBehindChain` and `clockStopState` answer null (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/clock-behind.ts` (`clockBehindChain` answers null; its body goes in PR 6) and `clock-confirmation.ts` (`clockStopState` answers null). About +4 / −0 production lines. Through them the append, the seat's `refuseWhileClockBehind` and `clockBehindLatestRecord`, the staff notice and the bell alert all stop finding a stop; `refuseWhileClockBehind` still refuses a time before 28-10-2024 first (`clock-behind.ts:172`).

- [ ] Test first: new `packages/fiscal-verifactu/src/chain.earlier-time.test.ts`: a record dated an hour before the latest is written, chained after it in `secuencia`, with its own time; and one dated a day before. Control (forced effect): one dated 27-10-2024 is refused `clock.unusable`. Watch the first fail on the current code.
- [ ] Then delete or trim the fiscal suites R8 measured failing (161 cases), each case because the behaviour it asserts is removed: `chain.clock-behind.test.ts` (2 of 5 fail; deleted, replaced by `chain.earlier-time.test.ts`), `backend.clock-behind.test.ts` (1 of 3), `backend.clock-stop.test.ts` (3 of 6), `clock-behind.test.ts` (4 of 7), `clock-behind.restart.test.ts` (32 of 38), `clock-checks.test.ts` (27 of 41), `clock-confirmation.test.ts` (40 of 61), `clock-stop-incidents.test.ts` (33 of 37), `clock-misdated.test.ts` (10 of 24), `clock-step.test.ts` (2 of 29: the stop-closing steps), `clock-behind-alerts.test.ts` (2 of 9: the behind alert; the unusable cases stay), `staff-notices.test.ts` (1 of 22: the behind notice), and one case each in `record-remedy-http.test.ts` ("refuses a server clock behind the chain without appending"), `record-remedy-absent.test.ts` ("refuses a clock more than a minute behind the chain"), `record-remedy-corrective.test.ts` ("uses the host clock stop before appending the corrective invoice") and `record-remedy-corrective-http.test.ts` ("refuses a new corrective record when the host clock is behind the chain"). Those four remedy cases are deleted, not rewritten: a remedy is switched off in production, its refusal there comes only from the disabled policy, and "keeps the default production policy closed" already owns that (R7).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node` (read the `Tests` count; a failure in a suite not listed here is a STOP), the fiscal core command **unedited**, and `git diff --stat <base> -- packages/fiscal-verifactu/src/chain.ts` prints nothing.

### Task 17b: the server's suites (apps/server)

- [ ] Delete or trim the server suites R8 measured failing (149 cases in 18 files), each case because the behaviour it asserts is removed: `clock-behind-stop.bills.test.ts` (6 of 7), `.charged` (3 of 7), `.open` (4 of 5), `.pay` (7 of 9), `.records` (6 of 16), `.refunds` (14 of 16), `payments-api.clock-behind.test.ts` (9 of 26), `zone-clock-stop-interaction.test.ts` (4 of 4, deleted), `clock-watch.restart.test.ts` (13 of 13, deleted), `clock-confirm.route.test.ts` (34 of 45), `till-box-clock-api.test.ts` (31 of 41), `clock-set.route.test.ts` (12 of 22), `boot.clock-behind-wiring.test.ts` (1 of 3: "answers stopped for a time a day before the latest record"), `webhook.test.ts` (1 of 16: "records a hosted payment while the box's clock reads behind its last sale"; Task 6b's table owns the waiting version), `hour-recovery-host.test.ts` (1 of 37: "a restore below the backup's newest invoice names its minute, a sale is then refused by the clock-behind stop, and a confirmation lists the later sale"; becomes: the sale after that restore is taken, dated by the box's clock), and the three the second read found (finding 7):
  - `boot.box-health.test.ts` "says payments are stopped for the clock while the latest record is a day ahead of it" (`:147-169`): deleted; the waiting row's read is owned by Task 8's `box-health.test.ts`.
  - `boot.clock-watch.test.ts` "serves a till's check of the time, handing the set to the host as a staff member's" (`:165-250`): its setup loses the record a day ahead (`:195-198`), so the box is waiting only because its fake host answers not synchronised; every assertion stays (one set, requester `staff` with the person and device, the answer). What it checks, that boot serves a till's check and hands the set to the host as a staff member's, survives under the start check.
  - `boot.restricted-quiet.test.ts`, the control of the §5 guard "a box holding a `node_handover_restriction` row starts restricted, before every worker". Its pair "asks AEAT's host for no clock reading" (`:314-316`) and the control's `authority > 0` (`:337`) counted `readAuthorityTime` through the watch, which only the stop asked, made to by a record a day ahead (`:185-188`). After PR 5 no unrestricted start asks AEAT's time, so no control can force that effect. **Decision:** the pair is rewritten to count the clock watch's reads of the time service, through the `clockStatus` dependency Task 4 adds, wrapped as `readAuthorityTime` is today (`:51-77`): the restricted case "runs no clock watch look" asserts 0; the control asserts more than 0 within the same five seconds (the watch's `intervalMs` is already 200, and the fixture's start waits because no host answers: it hands none, read, not run). The record a day ahead goes. So the guard still proves that a restricted box starts no clock watch, with a control that makes one look. The `readAuthorityTime` proxy goes.
- [ ] Task 7a's and 7b's new cases in `clock-confirm.route.test.ts`, `till-box-clock-api.test.ts` and `clock-set.route.test.ts` are about waiting and stay. The PR lists each case removed or rewritten. **A failure in a suite not on this list is a STOP.** Task 6b's gate table already owns what the route suites tested that survives.
- [ ] `pnpm --filter @waitron/server exec vitest run` on every suite named here and the 102-file selection R10 ran (read the `Tests` count).

### Task 17c: rules, staff guides and the installer

- [ ] Root `CLAUDE.md` C5 and C6; C9's PR 5 parts; `docs/backlog/box.md`'s PR 5 row; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] The staff guides, English in `apps/server/src/guide/en/` and the Spanish twin of each in `apps/server/src/guide/es/`. Each sentence that describes the stop is cut, not reworded (a guide sentence earns its place by changing what staff do):
  - `box-status.md`: the section "When payments stop because of the clock" `{#clock-behind}` (EN lines 174-380; ES "Cuando se paran los cobros por la hora", 185-402) is deleted. In "Read the rows", the Red row's "or payments have stopped because the clock reads earlier than the last sale" (EN 24-25; ES 26-28) goes. In "Just after a start" `{#clock-at-start}` (EN 381-408; ES 403-432) and "Devices as clock witnesses" `{#clock-witnesses}` (EN 491-506; ES 527-543), every sentence about the stop goes; the `clock.disagrees` warning and the clock before 28 October 2024 stay. "Sales dated wrongly" `{#sales-dated-wrongly}` (EN 432-490; ES 460-526) goes; PR 2's paragraph in `{#clock-waiting}` covers the future-date refusal.
  - `till-notices.md`: the "Payments stopped: the server's clock reads earlier than its last sale" notice (EN 39-50; ES "No se puede cobrar: la hora del servidor es anterior a la última venta", from line 45) goes, and the clock paragraphs after it (EN 65-93) keep only what serves PR 1a's waiting notice and the clock before 28 October 2024.
  - `backup-recovery.md`: "If the backup holds sales dated more than a minute after the box's time, the box stops taking payments once the recovery finishes…" (EN 157-159; ES 172-174) goes. PR 4's sentence in the same file is a different one and stays.
  - Every link to a deleted section moves to PR 1b's `{#clock-waiting}` or `{#clock-at-start}`, or goes.
- [ ] The installer: `deploy/waitron.sh:320` (the comment) and `:328`, and `deploy/README.md:113-114`, lose the clause about the clock reading earlier than its last sale, keeping 9a's waiting clause.
- [ ] `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts scripts/waitron-sh.test.mjs`, and `grep -rn -e 'clock-behind' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' apps/server/src/guide deploy` prints nothing.

## PR 6 — delete the stop's code (three tasks, each builds)

Lands with PR 5 (above). Order: 18a, 18b, 18c.

### Task 18a: the server stops calling the stop

Delete what R5's last column marks dead in `apps/server`: the stop parts of `clock-watch.ts` (with its AEAT set, `setFromAuthority`), `clock-start-up.ts`'s stop branch, `till-box-clock-api.ts`'s and `box-health-api.ts`'s stop admissions (with the misdated list and download routes, D8), the `clock.behind_chain*` emails, reasons and the `clock.behind_chain` staff notice source. Rename `refuseWhileClockBehind` to `refuseUntilRecordable` across its callers. `fiscal.clock_drift` is hidden while waiting instead. Root `CLAUDE.md` C3's PR 6 step and C9's PR 6 part. Every caller of a seat method 18c deletes is changed here, so 18c builds; the list comes from this grep, run 2026-11-10 on the base (`grep -rnE '\b(clockBehindLatestRecord|clockStopState|openClockCheck|confirmClockStop|waitingClockCheck|closeClockCheckByItself|noteClockProvedWrong)\b' apps packages --include='*.ts'`, leaving out tests, `packages/fiscal-verifactu/src/`, the seat contract and `fiscal-none`):

- `clockBehindLatestRecord`: `bill-refunds.ts:219` (`clockStopsRefund`), `tender-refund-recovery.ts:36`, `bill-payments-loop.ts:244` (each pauses while waiting only), `boot.ts:3109` (the drift alert's "stopped" test becomes "waiting").
- `clockStopState`: `box-health.ts:145-198` (the Clock row reads the start check's state), `clock-correction.ts:86,161-162` (admission reads the start check's state and `clock.unusable`), `clock-start-up.ts:48-61`, `clock-watch.ts:54,360`, `till-box-clock-api.ts:165-167`.
- `waitingClockCheck`, `closeClockCheckByItself`: `box-health.ts:200-208`, `clock-watch.ts:59-60,295-305`.
- `openClockCheck`, `confirmClockStop`, `noteClockProvedWrong`: `clock-watch.ts:55-58,138,196-215`; `till-box-clock-api.ts:109-110,291` and `box-health-api.ts:244-245,291`. **Both route files mount nothing when the seat has no `confirmClockStop`** (`till-box-clock-api.ts:110`, `box-health-api.ts:245`), and PR 1a's and 1b's waiting confirmations live in those routes, so their mount condition moves to the start check before 18c deletes `confirmClockStop`.
- `misdatedRecords`, `misdatedDetail` (`box-health-api.ts:145-208`): deleted with their routes (D8).

The same grep, re-run after 18a, must print only the seat contract, `fiscal-none` and `packages/fiscal-verifactu/src/`.

Suites deleted whole: `clock-watch.anchor.test.ts` (492 lines, 12 cases), `clock-watch.elapsed.test.ts` (151, 5), `boot.clock-start-up.test.ts` (217, 2). Trimmed to their surviving cases: `clock-watch.test.ts` (876, 48), `clock-watch.correction.test.ts` (441, 17), `clock-start-up.test.ts` (183, 16), `clock-confirm.route.test.ts` (1,988, 45), `till-box-clock-api.test.ts` (1,126, 41), `clock-set.route.test.ts` (700, 22), `clock-correction.test.ts` (1,137, 69). (`zone-clock-stop-interaction.test.ts` and `clock-watch.restart.test.ts` are already gone, in Task 17b.) Lines and cases are today's, before PR 5's trims.

### Task 18b: tills and dashboard stop showing the stop

Delete the `clock.behind_chain` notice, refusal and dialog branches in `apps/till`, and the stop rows and alert words in `apps/dashboard` (`box-status-rows.ts`, `box-status-screen.ts`'s stop branches beside PR 1b's waiting ones, `alert-messages.ts`), with the till's and dashboard's clock-stop cases. Run after 18a, so the server has stopped sending a code before its words go.

### Task 18c: the fiscal module and the seat contract

Delete the seat methods `clockBehindLatestRecord`, `clockStopState`, `openClockCheck`, `confirmClockStop`, `waitingClockCheck`, `closeClockCheckByItself`, `noteClockProvedWrong` from `packages/fiscal/src/backend.ts`, its fake and `fiscal-none`, and their Veri\*Factu implementations: `clock-behind.ts`'s comparison (keeping `latestRecord` and `chainHeads`, which PR 2's mark reads; 2026-11-14: PR 2 as built reads `chainHeads` only, and COV-FISCAL deleted `latestRecord`), `clock-checks.ts`, the stop parts of `clock-confirmation.ts`, `clock-stop-incidents.ts` and `clock-behind-alerts.ts`, and `clock-misdated.ts` (the whole file, D8).

Suites deleted whole: `clock-behind.test.ts` (138 lines, 7 cases), `clock-behind.restart.test.ts` (558, 38), `clock-checks.test.ts` (718, 41), `clock-confirmation.test.ts` (1,083, 61), `clock-stop-restarts.test.ts` (96, 4), `clock-misdated.test.ts` (828, 24) and `clock-misdated-detail.test.ts` (443, 8). Trimmed: `clock-stop-incidents.test.ts` (771, 37), `clock-behind-alerts.test.ts` (133, 9; its unusable case stays), `clock-step.test.ts` (683, 29; its no-stop, `clock.corrected` and Task 2's `start` blocks stay). Case counts are today's, before PR 5's trims (finding 14; my run, below).

Documents: `conventions-data.md`'s sections "While the box's clock reads behind the latest fiscal record…" and "A confirmation of the clock lifts the stop…" become a dated pointer to this plan; then fix every claim this grep finds: `grep -rn -e 'clock-behind' -e 'behind_chain' -e 'records_misdated' -e 'behind the latest' -e 'minute ahead' -e 'minute behind' -e 'clock_checks' -e 'earlier than its last sale' -e 'earlier than the last sale' -e 'anterior a la última venta' -e "asks AEAT's time" CLAUDE.md docs/developers docs/backlog.md apps/server/src/guide deploy` (it reaches the §4 fixture rule C6 removed, its receipt in `testing-guide.md`, and any guide sentence Task 17c missed).

- [ ] Each task: the suites of every package it touches, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/staff-notice-codes.test.ts scripts/claude-md-pointers.test.ts scripts/classification-complete.test.ts`.

## Task 19: on the test box (the lane runs the PR's part before it lands)

On the Debian 13 test box once the watcher reports it back, or a preproduction box the owner names, with `WAITRON_FISCAL_TEST_SUBMISSIONS=enabled`. Record each command and its output in the PR description.

(2026-11-11: the till's dialog now uses the owner's words of that day. In the checks below, "Use this time" is now **This device**, "The server's time is right" is **The server**, and "The time is right" is **Yes**. The same day the "Words" table's keys `box_time.agrees_waiting`, `box_time.differs_keep` and `box_time.keep_server` were replaced by the dialog's questions `box_time.is_correct` and `box_time.which_correct` and its button `box_time.server`; none of the three keys exists.)

**PR 1a:**

1. **Every boot starts unsynchronised (R4).** Reboot. Compare `journalctl -u systemd-timesyncd -o short-iso | grep -m1 -i 'contacted\|synchroni'` with the server's first `clock_start.*` log line. **A failing reading of R4** shows the time service synchronised before the server's first look on every one of three boots.
2. **NTP blocked, web traffic allowed.** `nft add table inet a1420; nft add chain inet a1420 out '{ type filter hook output priority 0; }'; nft add rule inet a1420 out udp dport 123 drop`. With the clock right, `docker compose restart app`. **Expect:** a cash sale refused with the waiting words; then a till and a handheld at the true time, each with a staff member signed in, and within about 30 s payments resume with no tap and one `clock_start.confirmed` line with source `devices`. Set the clock 2 days ahead (`timedatectl set-ntp false; timedatectl set-time …; timedatectl set-ntp true`) and restart: **expect** the two devices not to confirm, and "Use this time" on one of them to produce one `clock.set` in `journalctl -t waitron-box` whose requester says `staff`, then the next sale dated right. Then `nft delete table inet a1420`.
3. **No internet at all.** Unplug the WAN; restart; one till only, signed in, its clock 10 minutes off the box's (set in the tablet's settings). **Expect:** the notice reading "1 of 2 so far"; the dialog offering both choices; "The server's time is right" lets the next sale through with no `clock.set`. Plug the WAN back in on a second run without tapping: **expect** payments to resume by themselves within about 75 s of the router being up. Time it.
4. **The clock service missing (D12).** `systemctl stop waitron-box.socket`; restart the app: **expect** waiting at every start, with D12's sentence on the Box status row (once 1b is in), and two signed-in tablets confirming it. Then `systemctl start waitron-box.socket`.
5. **Flat battery** (revision 2's step 1): power off at the wall for 10 minutes with the time service stopped and the WAN unplugged; **expect** waiting at power-on, not a sale dated 10 minutes early.

**PR 1c:** step 2's first half again, with the till and the handheld left at the PIN screen and nobody signed in: **expect** the PIN screen to show the waiting line with "1 of 2 so far" while only one is on, then payments to resume within about 30 s of the second with no tap, and one `clock_start.confirmed` line with source `devices`.

**PR 1d:** tests only; nothing to run on the box.

**PR 1b:** with the WAN unplugged, no till on, and the clock set 2 days ahead before the restart, an administrator uses "Check with this device's time" on Box status from a phone: **expect** one `clock.set` whose requester says `admin`, and the next sale taken and dated right.

**PR 2 (closes R12's evidence limit on the test service):** NTP blocked as in step 2; clock set a day ahead; an administrator presses "The date and time are right"; three cash sales; wait for filing. **Expect** each refused `1112`, the stop after the first, a fourth sale refused at the till; then "Use this time" from a till at the true time, a fifth sale taken and filed `Correcto` while the three stay refused, and no `fiscal.refusals_repeated`. Report AEAT's replies from the filing records.

**PRs 3-4:** press Make the series, block 443 and UDP 123, press Restore backup. **Expect** the waiting line and page, `failures` unchanged over five minutes, one log line a minute, the start-failure log not grown (`wc -c` before and after); unblock UDP 123 only and expect the restore to finish within about two minutes with no AEAT ask. Report one try's length from the log times.

## Deliberately unchanged, and limits

- **A venue whose network blocks the time protocol confirms by devices or a person at every start** (R4); with PIN-screen tablets (PR 1c) that needs nobody to tap. Nothing falls back to AEAT's time (owner: "NTP is the answer for now"); the existing `clock.sync_off` alert tells the administrator the time service is not synchronised.
- **A box whose clock service does not answer waits at every start and cannot be corrected from a till or the dashboard** (D12); it can be confirmed.
- **A synchronised time service is trusted whatever it says**, including one pointed at a wrong server; AEAT no longer cross-checks it at a start or a restore (D5), and a future-date refusal does not stop it (D9).
- **A box confirmed by devices or a person trades on its own clock** until the time service synchronises. Devices agree within 5 s and a person sees both clocks, so the clock is close unless the person confirms a wrong one. The research (52.1(a)) finds the file enough when only the time is wrong; a wrong date needs a corrective (52.1(b)), which A1407 issues only for the invoices AEAT refuses (D8). A wrong hour on the right date needs nothing.
- **Sales stamped ahead into a later day are refused by AEAT, one refusal each, and later sales keep filing** (D11). D9 stops payments once, for a box confirmed by devices or a person.
- **A wrong date AEAT accepts, or never sees as wrong, is not corrected** (D8; the owner accepted this at 15:06).
- **A box confirmed while up to 59 s fast can have sales just after its midnight refused as dated in the future**, until the time service synchronises: such a refusal sends it back to waiting (D9), at most once a night, since a person's check moves the mark. A person cannot correct an error under a minute from a till or the dashboard, because the correction refuses a set that close (`clock-correction.ts:233-236`, `agrees`); they confirm the clock as it stands. Two devices confirm only within 5 s, so a box they confirmed is at most that fast. Each refused sale goes to A1407 (reasoned, not run).
- **A clock that falls back while the box trades is no longer stopped after PR 5.** At most the existing `fiscal.clock_drift` warning shows (`time-health.ts:104`); the start check no longer asks once the internet has confirmed (D1 row 4), and nothing lists what it dates. A clock that drifts ahead while the box runs is not watched beyond D1 row 4 either (A798 slice 9c, backlog).
- **No AEAT run has tried a record stamped earlier than the record before it**; nothing published refuses it (R12), and the owner judged the proposed test not worth running (Q2).
- **No tax adviser's answer is cited.** Q2 rests on the owner's decision and on research that calls itself "research for the owner, not professional advice" (`docs/compliance/research/2026-11-06-adviser-clock.md`, line 6).
- **Before PR 5**, a clock that a confirmation or the sync leaves more than a minute behind the latest sale still meets today's stop; its existing "Check the time" and AEAT paths lift it as today.
- **The record remedies are not gated** (R7): production refuses them all. A1407's entry carries the rule for the day one is switched on.
- **Promotion and first setup keep their own series check**; the restore and setup pages keep their own clock check, because a person on a page can act. A box that becomes primary without a restart is gated by D1 until its time is confirmed.
- **Nothing measured on a real box yet**: R4's timing, the router path, the device confirmation and a real `1112` are Task 19's.

## Review responses (revision 4's two reviews)

| Finding | What revision 5 does | Where |
| --- | --- | --- |
| Second read 1 (Critical): the future-date stop comes back on the refused date and cannot be lifted | Reacts once, on a refusal of a record written since the last confirmation; never compares the clock with a refused date; a person's confirm ends it; tested on the refused date and after | D9, Task 10 case 2 |
| 2: correctly dated sales wait, and each hourly retry refuses one more sale | No new hold for `1112`, so no hourly retry; only the claim-time hold in `drain.ts` changes, so a chain already held still drains (the fresh review of revision 5) | D11, Task 10b |
| 3: the till's dialog offers one button | Both choices while the box waits and the clocks differ | D1 row 3b, Task 7a |
| 4: a box without its clock service waits at every start | Decided: it waits, and says why; the installer's words say so | D12 |
| 5: AEAT's reply date could confirm | Owner: "NTP is the answer for now" | Global constraints, R4 |
| 6: two tablets must be signed in | Owner: "Count PIN-screen tablets (Recommended)" | R11, Task 4b (PR 1c) |
| 7: PR 5 breaks three more server suites | Each handled; the restricted-start guard's control now counts the clock watch's look | R8, Task 17b, "Changed test checks" |
| 8: two of the four writers have no failing test if ungated | The four writers called directly while waiting, with a control | Task 6a (PR 1a) |
| 9: can a box kept in time by the internet go back to waiting? | No; stated once, owned by `start-clock-check.test.ts` | D3, Task 1 case 3 |
| 10: the host program every 15 s | The watch reads the shared one-minute reading; tested with the real cache | D2, Task 4 |
| 11: two agreeing devices after a future-date refusal untested | Tested: they do not end it; control in a plain waiting start | Task 10 case 4 |
| 12: should a restore that waits for the internet ever reach the start-failure page? | No. The owner asked for the uncounted retry (D7), and for this code the page offers only "connect, then Retry a normal boot" (`recovery-page.ts:286-298`), which the waiting page says and does every minute itself | Task 14 |
| 13: a box promoted without a restart | Intended: the start check runs whatever the role; the gate asks `filesRecords()` at each call, so such a box is gated until confirmed | D1, Task 6a |
| 14: Task 18c's case counts | Corrected to 38, 41, 61, 37 and 29 (my run, below) | Task 18c |
| Watcher 1: the stop must not strand a correct box | As finding 1. Not by the reply's arrival time: a refusal of a record written before a confirmation can arrive after it, and must not stop a box a person has just checked | D9 |
| Watcher 2: split PR 1 | PR 1a and PR 1b; at the watcher's clearance (17:28), 1a split again into 1a, 1c (Task 4b) and 1d (Task 6b). The till guide goes with 1c, the PR that changes the till's PIN screen (reading 3, confirmed) | PRs 1a-1d |
| Watcher 3: drop the new confirmation row | Dropped; a log line instead. A correction still writes the row every set writes | D3, Task 2 |

## Changed test checks

- PR 1a: the four suites R10 found failing under the gate (`boot.backup-network.test.ts`, `promote-endpoint-e2e.test.ts`, `handover-controlled.e2e.test.ts`, `handover-stepdown.real.test.ts`) gain a start whose time is confirmed (Task 6a); setup only, no assertion changes.
- PRs 1c and 1d: none expected; any existing test that has to change is a STOP.
- PR 2: none expected (`grep -rn 1112` finds no existing test of a `1112` run; a failure in an existing drain or alert suite is a STOP).
- PR 5: `packages/fiscal-verifactu/src/chain.clock-behind.test.ts` is deleted; `chain.earlier-time.test.ts` asserts the opposite (the owner's 2026-11-10 answer). Every other case Tasks 17a and 17b list (310 cases: 161 fiscal, 149 server) is deleted because the behaviour it asserts is removed, except three rewritten as Task 17b says: `hour-recovery-host.test.ts`'s restore case, `boot.clock-watch.test.ts`'s till check (setup only, every assertion kept), and `boot.restricted-quiet.test.ts`'s AEAT-clock pair, which becomes a clock-watch pair with its own control. Each is named in the PR.
- PR 6: the suites Tasks 18a, 18b and 18c list. Any OTHER existing test that has to change is a STOP.

## Size (estimates; lines added / removed)

Production and tests counted apart. Removals come from `wc -l` and case counts of the suites named above (counted 2026-11-09 on this base; the second read checked the line counts of the 20 suites and the 2,541-line figure): the six `clock-behind-stop.*` suites hold 2,541 lines and 59 cases; the stop-only fiscal files hold 1,327 production lines and their suites 5,216 test lines; the server's `clock-watch.ts`, `clock-start-up.ts` and `till-box-clock-api.ts` hold 919 production lines, part of which survives.

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **1a** start check, gate and the four writers' cases, signed-in devices, staff on tills (Tasks 1-4, 6a, 7a, 9a) | +295 / −5 (Task 1: 80; 2: 5; 3: 30; 4: 30; 6a: 60; 7a: 85 with words; installer words and the client's comment 5) | +390 (6a's helper, wiring and R10's four suites' setup about 70; the four writers' cases about 70; start check and devices about 90; watch about 40; dialog and route, with the window cases, about 120) | +65 / −15 (rules) |
| **1b** administrator, bell and Box status (Tasks 7b, 8, 9b) | +120 (7b: 40; 8: 80 with words) | +170 | +70 (the Box status guide section, both languages) |
| **1c** PIN-screen tablets report and show the waiting line (Task 4b) | +55 (the PIN-screen line 25 of it) | +70 | +15 (the till guide, both languages; C9's step) |
| **1d** the table of money routes (Task 6b) | none | about +680 (with 1a's writers' cases, replacing the 2,541 lines PR 5 deletes) | +1 / −1 (C1's guard clause) |
| **2** the future-date stop and no waiting behind it (Tasks 10, 10b) | +95 with words (10: 85; 10b: 10 in `drain.ts`) | +290 (10: 180; 10b: 110, with the held-before case) | +25 |
| **3** a synchronised restore names its series (Tasks 11-12) | +60 / −5 | +90 | +5 / −3 |
| **4** restore waits uncounted; page names the cause (Tasks 14-16) | +170 / −5 | +210 | +30 / −10 |
| **5** two functions answer "nothing"; `chain.ts` unchanged | +4 | +50 / about −8,550 (the 310 failing cases, by each suite's lines per case) | +35 / about −615 (the guides about −585 of it, both languages) |
| **6** delete the stop's code (18a, 18b, 18c) | +40 / about −2,330 (including the watch's AEAT set and `clock-misdated.ts`) | about −4,720 (the suites deleted whole, by `wc -l`; the four fiscal suites deleted whole here also lost cases in PR 5, which both rows count, so the true total is smaller) | +30 / −200 |

PRs 1a to 4 (1a, 1b, 1c, 1d, 2, 3 and 4) add about 795 production and 1,900 test lines. PRs 5-6 add about 44 production and 50 test lines, and remove about 2,330 production and 13,270 test lines. Against revision 4, PR 1 (400 production, 620 test) becomes 1a, 1b, 1c and 1d (470, 1,310): PIN-screen reports and line, the second dialog button, the device count, D12's words, the window cases and the writer tests, less Task 2's row; most of the test growth is Task 6b's table, re-estimated against the 59 cases it replaces. PR 2 grows by `drain.ts`'s change and its tests. The split of 1a's documents between 1a and 1c is reasoned, not counted.

## Review focus

1. AEAT is asked by no start check (Tasks 1, 4) and by no synchronised restore (Tasks 11-12); nothing sets the clock from AEAT outside the old stop.
2. Two devices confirm only from two addresses, within 5 s of the box and of each other, and set nothing (Task 1); one device never confirms; a PIN-screen tablet counts (Task 4b, PR 1c).
3. While waiting, every route in Task 6b's table refuses before any card reader, refund send or drawer job, every seat writer refuses (Task 6a), and the two loops pause; the table (PR 1d) lands before PR 5 deletes the stop's route suites.
4. No device, till or administrator confirmation reaches the series check (R5; Task 11 adds no read of confirmations).
5. No set happens while the time service is synchronised (Tasks 3, 7a, 7b; the host refuses as well).
6. While payments wait, staff can keep the server's time from a till whose clock differs (Task 7a), and an administrator with no till and no internet can confirm or correct the clock from their own device (Task 7b), with the dashboard offering it (Task 8).
7. PR 2's stop compares record positions, never the clock with a refused date; it ends on a person's check or the time service, and a box kept in time by the internet never goes back (D3, D9, Task 10).
8. PR 2's filing change is the claim-time hold in `drain.ts` alone: a run of `1112` takes no new hold (Task 10b's control with another code), while a chain already held drains through the unchanged hourly retry and release (Task 10b's held-before case).
9. PR 5 changes exactly two functions (`clockBehindChain`, `clockStopState`), no line of `chain.ts` or the rest of the fiscal core; the restricted-start guard keeps a control (Task 17b).
10. Task 18a's grep, re-run, prints only the seat contract, `fiscal-none` and the fiscal module, so 18c builds.
11. After Task 17c, `grep` finds no description of the stop in `apps/server/src/guide/` or `deploy/` in either language.
12. Nothing in any PR hunts for wrong times (D8, D10).

## Receipts for revision 5

Run by lane B on this branch's base, 2026-11-10:

- `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-behind.restart.test.ts src/clock-checks.test.ts src/clock-confirmation.test.ts src/clock-stop-incidents.test.ts src/clock-step.test.ts --reporter=verbose`, cases counted per file → `Tests 206 passed (206)`: 38, 41, 61, 37 and 29, the second read's figures (finding 14).
- `grep -rn "1112" packages/fiscal-verifactu --include='*.ts'` → only `test/drain-fixtures.ts:43`, a comment (PR 2's "Changed test checks").

Read, not run, for revision 5: `drain.ts:50-75,785-860,960-1030,1125-1150,1540-1580`, `submission-alerts.ts:75-150`, `chain.ts:155-180`, `clock-behind.ts:35-47`, `clock-step.ts:60-130`, `schema/clock-confirmations.ts`, `clock-correction.ts:60,80-100,140-240`, `till-box-clock-api.ts:150-175,240-340`, `box-time-dialog.ts:20-40,220-275`, `equipment-poll.ts:1-40`, `till-app.ts:2568-2580,3120-3150,5670-5690,18655-18680`, `device-api.ts:420-442`, `box-host-client.ts:1-50`, `clock-sync-alert.ts`, `alert-messages.ts:525-560`, `waitron.sh:318-400`, `deploy/README.md:110-125`, `waitron-box.socket`, `boot.ts:2028-2038,3050-3068`, `boot.restricted-quiet.test.ts:1-110,300-345`, `boot.clock-watch.test.ts:129-250`, `boot.box-health.test.ts:146-170`, `recovery-page.ts:280-300`, `verifactu-findings.md:1270-1290`, `questions.md:1747-1759`, `archive/queue-archived-2026-11-09.md:570-578`, and the owner's answer files named above.
