# A1420 PRs 3 and 4, revised: a person confirms the time for every new series, and the series check stops asking AEAT — plan revision

> **For agentic workers:** this replaces the "PR 3" and "PR 4" sections of
> `docs/superpowers/plans/2026-11-09-a1420-start-clock-corrects-itself.md` (revision 5), with its
> D5, D6's cause, D7's scope, R2's third bullet, C4, Task 19's "PRs 3-4" step and the size rows for
> PRs 3 and 4. It also amends one of that plan's "Global constraints" (below). Everything else in
> that plan stands. Implementers are dispatched as `subagent_type: "implementer"`. Fiscal clock
> rule: full review path, two Codex run-it reviews per PR, and the owner lands each PR.

**Status: draft 4, 2026-11-13.** Draft 2 (`2bd199bed6`, cleared by the watcher 08:55) let any
device on the venue's network confirm a restore's start with no sign-in. The owner replaced that
at 09:47 and 09:52 (below). Draft 3 (`d4d000487b`) rewrote PR 3 to the ruling; one fresh-context
read of it found 0 Critical, 5 Important, 6 Minor, all taken here: PR 3 is split into 3a and 3b,
the done screen keeps the node recovery key instead of a new pass, the typed key is built, a stored
confirmation replaces the 30-second one, and Confirm compares again when pressed. PR 3b's branch
already holds work built to draft 2; "What becomes of the built commits" says what to keep. Base:
main `f1deb720ed`, which holds #3025 (`8da04096ef`). The clock code PR 3 builds on is stacked,
unpushed, at `feat/a1506-2-till-time-wrong` (`d6a5e273fc`), which does not hold #3025; a line number
marked "stack" is on that commit, "branch" on PR 3b's head `42860d1df9`, and every other one on
`f1deb720ed`. Every receipt is read, not run, unless it says RUN.

**UNVERIFIED (no approval recorded): this plan's own choices**: the done screen holding the node
recovery key through the wait (D-key), carrying a select made under any second clock across the
same boot (D-carry), the refusal reason `confirmation_required`, which refusals wait (D-wait), the
waiting page's words, and dropping A1420's Task 16 (D6′). They stand until the watcher clears or
flips them.

**Amended constraint.** The A1420 plan's "The series check is untouched except for Q1. No device,
till or administrator confirmation is ever read by it (R5)" now reads: **"The series check changes
only as `2026-11-13-a1420-restore-series-check.md` says: it reads the time service, and a device's
time only once the person who proved themselves on that series step confirms it; never AEAT (from
PR 4), and never the start check's confirmations (its devices, tills or administrators)."**

## Why this revision

- **The owner, 2026-11-11 14:34** (lane B's queue, A1506, verbatim): "either: we can talk to ntp,
  so we fix it, or we must check the time manually, which we do with the device times"; on asking
  AEAT for its time: "Instead we rely on NTP."
- **The owner, 2026-11-13 09:47** (watcher's 09:49 note, verbatim): "It is a rare occasion when the
  internet will be down and we'll be unable to confirm the time automatically. We have two
  situations: one, a standard restart where we just want to confirmt that the box's time is still
  right (in which case having a match with the time from a device is probably sufficient, and
  changing the time to the device time can probably be done by any device user), and the other case
  is where we are doing something that requires starting a new invoice series, in which case we
  should never just accept another device's match automatically. instead, we should always ask for
  confirmation, and that confirmation should be protected."
- **The owner, 2026-11-13 09:52**, verbatim: "no, let's keep it at two devices then, and i agree
  with the rest". "The rest" is the watcher's 09:49 proposal (watcher's 09:52 note): (1) an
  ordinary start is unchanged; (2) any step that names a new series, when internet time cannot
  confirm the box, never accepts a device's match by itself: "The page shows both times and the
  person confirms (or sets the box from their device, #3025), and only a person who has already
  proved themselves on that page may do it: setup page (setup password for another device), restore
  page (recovery key / bucket kit / Cloud point holder), handover (node.manage), conflict switch
  (administrator). This also changes today's behaviour where a matching browser time on those pages
  carries on by itself."; (3) "the restore page's person confirms the time just before "Restore
  backup"; the start uses that confirmation provided the box has not been switched off since (its
  clock ran continuously, e.g. same boot). If it was switched off, the start waits and asks again in
  the SAME browser, which proved itself with the key; it does not ask for the key a second time.
  [...] Only if it cannot: fall back to asking for the recovery key again (~40 lines)"; (4) "Drop
  the unsigned waiting-page reading (old Q1 recommendation) and Q2 as written; no sign-in-free
  route names a series."

## Words used here

- **The series check**: before a box names a new invoice series (first setup, a restore, a
  promotion, a conflict switch), a second clock must agree with the box's within 30 seconds
  (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`). The series is named from
  the box's minute, so a wrong clock could repeat a name.
- **Internet clock**: today AEAT's web server (`hour-clock-internet.ts`); from PR 4 the host's own
  internet time keeper (the NTP protocol) answering "synchronised" (`deploy/box/waitron-box.sh:61-65,95`).
- **Proved on that page**: the proof each series step already checks on every request: the setup
  owner's pass (another device also types the setup password), the backup's node recovery key
  (restore; its series step refuses without it, `setup-recovery-preparation-api.ts:66-74`), a
  `node.manage` sign-in (handover), an administrator's dashboard session (conflict switch).
- **Confirm**: the person presses "Confirm the time" with the box's and their device's times on
  screen, the two within 30 seconds. Choosing **This device** (#3025) also counts (D-confirm).
- **The restore's start**: the start after "Restore backup", which places the copy and names the
  series before the server itself starts (`runStagedRestore`, `apps/server/src/node-entry.ts:696`,
  stack). "Restore backup" ends the setup process (`requestRestart`, `first-setup-launch.ts:91`,
  `SIGTERM`) and Docker starts it again (`restart: unless-stopped`, `deploy/compose.yml:12`).
- **Boot id**: Linux's `/proc/sys/kernel/random/boot_id`, new at every boot of the machine; read with
  `/proc/uptime` (time since boot, counting suspend) by `bootReader` (`apps/server/src/boot-reader.ts`).

## Established first: does the restore page's browser keep its proof across the restart?

**No, not today, even without a power cut.**

- **Where the proof lives.** In the request body: the restore page sends the node recovery key with
  every series-step call (`nodeRecoverySecret: this.#secret`, `packages/fiscal-verifactu/src/setup/recovery-hour.ts:278,334`;
  checked against the copy's stored verifier, `apps/server/src/operation-authentication.ts:63`),
  and "Restore backup" sends it again with the archive's recovery key or the bucket kit
  (`apps/setup/src/setup-app.ts:1820-1834`). The existing case "the real setup shell sends archive
  credentials in the request body" (`setup-app-recovery-credentials.test.ts`) pins that the key
  travels in the body; no route in `setup-recovery-preparation-api.ts` reads a cookie (read). The box remembers the page only in process memory: its clock challenges ("A bounded
  process-local cache grants nothing after eviction or restart", `hour-setup-clock.ts:85`) and its
  preparation sessions (`recovery-preparation.ts:308`). Both are gone when "Restore backup" ends the
  process.
- **The browser drops it at "Restore backup".** On success the app clears its request and shows
  the done screen (`setup-app.ts:1838-1839` archive, `:1913-1915` bucket, `:2012` Cloud), and the
  done screen is handed no recovery key (`setup-app.ts:2759-2768`; it is handed the break-glass
  secret, `:2762`, which proves nothing to a restore). **RUN** (throwaway test, not kept, in
  the docs worktree; `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/setup exec vitest run
  src/zz-probe-proof-after-restore.test.ts`, headless Chromium, `Tests 3 passed`): after an archive
  and a bucket "Restore backup" that the stand-in server accepted, a scan of every property of the
  app element and the done screen (six levels deep), `sessionStorage`, `localStorage` and
  `document.cookie` found none of the three planted secrets: `secretsInApp=[]
  secretsInDoneScreen=[] secretsInStorageOrCookie=[]`. Control: the same scan after a refused
  "Restore backup" printed `secretsInApp=["archive-key-PROBE"]`, so the scan sees a kept secret. A
  failing answer (the browser still holds its proof) would have printed a secret in one of the first
  two runs. Not seen by the scan: `#private` class fields. Cloud was read, not run (the key is a
  local of `#onCloudRestoreAction`, `setup-app.ts:1986-2012`).
- **What survives on the box.** The staged restore keeps the archive's recovery key and the node
  recovery key as files, each written with `writeFileDurable` at `0o600`
  (`apps/server/src/restore-request.ts:281,288`), and the copy holding the key's verifier. The
  series step's stored pick lives in the state folder's preparation file
  (`MODULE_PREPARATION_STATE_FILE`, `packages/provisioning/src/module-preparation-state.ts:29,67-69`).
  Read, not run: both survive the restart and a power cut as files.
- **So the "same browser" keeps the key it already holds** (D-key): the setup app stops dropping
  the node recovery key at "Restore backup" and hands it, in memory only, to the done screen; the
  box checks it against the staged copy of that key. The owner's fallback, typing the key again on
  the waiting page, is built too, for a browser that lost it (D-key).

**How the start tells that the clock ran on since the confirmation.** `bootReader().readBoot()`
answers `/proc/uptime` in milliseconds and the boot id together, and no boot id whenever
`/proc/uptime` cannot be read (`boot-reader.ts:21-52`); the clock watch already pairs readings by
boot id (`clock-watch.ts:302,402`; `docs/developers/conventions-data.md:4541`). A container sees its
host's boot id: in CI, a container running as uid 10001 "saw the host's boot id" (M5,
`conventions-data.md:5034-5037`). **RUN** (2026-11-13, a stand-in, not the box): two throwaway
`docker run --rm node:26-slim` containers, 2 s apart, on this Mac's Docker Linux machine, printed the
same `boot` (`7633832b-…`) and `/proc/uptime` going on from `174128.27` to `174130.52`, while
`performance.now()` started again at about 10 ms in each. A failing answer would have printed two
boot ids, or an uptime starting near zero. Control: `/proc/sys/kernel/random/uuid` read in the same
runs differed. The box's image runs `node:26-slim` (`deploy/Dockerfile:206`) on a Linux host. Not
run: a real power cut, and the box itself.

## What a person can do when this lands

- **PR 3a (lands first).** On the setup, restore, handover and conflict-switch pages, when no
  internet clock checks the box, a matching device time no longer carries on by itself: the page
  shows both times and the person presses **Confirm the time** (or **This device** when they
  differ). With an internet clock, nothing changes. The restore's start is unchanged (it still asks
  AEAT and fails towards the start-failure page when it cannot).
- **PR 3b.** The restore's start reuses the restore page's choice when the box has not been
  switched off since "Restore backup". If it has, the start waits instead of failing: the done
  screen that pressed "Restore backup" shows both times again and asks the same person to confirm,
  with no key typed; every other page on the box's address says the box is waiting and offers the
  node recovery key from the backup's paper to confirm from that device.
- **PR 4.** Nothing asks AEAT's web server for the time any more. A box whose time service is
  synchronised names its series with no confirmation; otherwise a confirmed device time, as in 3a.

**Order: PR 3a, PR 3b, then PR 4 soon after, all after A1420 PRs 5-6 (#2964, #3003), 1b, A1506
PRs 1-2 and A1420 PR 2, as A1506 orders them.** PRs 3b and 4 use `clockServiceSynchronised`
(`clock-service-reading.ts:25-33`, stack). PR 4 before 3b would send a restore at a venue that
blocks NTP but lets web traffic out (R4 in the A1420 plan) to the start-failure page, where today
AEAT lets it through. PR 3a stands alone.

## Receipts

**S1. Every caller of the series check.** `compare` always adds AEAT's reading
(`hour-setup-clock.ts:46,128`); a browser on the box's own screen does not count (`same_machine`).

| Caller | Who is there, proved how | Second clocks today | PR 3a / 3b | After PR 4 |
| --- | --- | --- | --- | --- |
| First setup page (`initial-hour-setup.ts:223-246` → `hour-preparation.ts:173-184`) | setup owner; another device types the setup password (`setup/first-hour.ts:65-66`) | browser, AEAT | AEAT, or browser + Confirm | time service, or browser + Confirm |
| First setup command (`initial-hour-setup.ts:93-115`, `browser: null`) | an operator at a terminal | AEAT | unchanged | time service only |
| Restore page (`hosted-hour-recovery.ts:110-128`) | holder of the node recovery key | browser, AEAT | AEAT, or browser + Confirm | time service, or browser + Confirm |
| **Restore's start** (`hosted-hour-recovery.ts:140-150`, `compare(…, null, { onBox: true })`) | nobody | AEAT | 3a: AEAT; 3b: the page's select if same boot (D-carry), AEAT, or a confirmation from the done screen or the typed key (D-key) | the same, time service for AEAT |
| Restore command (`restore-command.ts:393` → `recovery-entry.ts`) | an operator at a terminal | AEAT | unchanged | time service only |
| Handover page (`handover-screen.ts:198-235` → `handover-preparation.ts:146-170`) | `node.manage` sign-in | browser, AEAT | AEAT, or browser + Confirm | time service, or browser + Confirm |
| Conflict switch (`dashboard/conflict-recovery.ts:278-300`) | administrator | browser, AEAT | AEAT, or browser + Confirm | time service, or browser + Confirm |

The `/management-api/promote/preparation` route (`promote-api.ts:126`) has no client
(`git grep -n "management-api/promote"` finds only the route and `read-only-exemptions.ts:50,57`).

**S2. The stack.** `hour-clock-internet.ts` survives A1420 PR 6 (`git diff --stat
f46da9fc0e..d6a5e273fc` deletes `authority-time.ts` only). A1506 PR 2 adds `answersSynchronised`
(`e00b54d62c`) and `clockServiceSynchronised` (`cff47bdf73`), which count a host that does not
answer as not synchronised.

**S3. The time service can be read at the restore's start and by the restore command.**
`boxHostClient()` needs only `/run/waitron-box/box.sock` (`box-host-client.ts:43`, mounted by
`deploy/compose.yml:45`); every failure answers `available: false` (`:12-15`).

**S4. A refused restore keeps its staged request, and the same process can place it on a second
try (RUN, draft 2).** `hour-recovery-placement-3.test.ts -t "fresh-box Cloud restore refused at
placement"` → `Tests 1 passed | 31 skipped (32)`.

**S5. Each try repeats the copy's checks** (`restore-request.ts:536-553,584`), so a try is not cheap.

**S6. Tills cannot confirm.** Their device rows are in the copy not yet placed (A1420 R11), and
under the ruling no sign-in-free route names a series.

**S7. Server code cannot import the fiscal module** (`scripts/module-seams.test.ts:31`); both import
`@waitron/module`.

**S8. The start-failure page for `sif.allocation_invalid`** says, by code alone, to connect the box
to the internet and press "Retry a normal boot" (`apps/server/src/i18n/recovery-page.ts:298-311`).
A stored pick whose minute is now in use refuses on every try (`hour-selection.ts:410-411`).

**S9. #3025 landed** (`8da04096ef`, 2026-11-13 10:09). The setup, restore and handover clock step
can set the box's clock from the person's device: action `set-clock`, measured by `take`
(`hour-setup-clock.ts:113-139`), refused on the box's own screen and when earlier than a chosen
series time (`setBoxClockFrom`, `:63-74`), through the host's `setBoxClock`. In setup mode the
setter is `createSetupClockSet` (`apps/server/src/setup-clock-set.ts:92`), which notes every step in
`<state>/setup-clock-step.json`; the venue's first full start raises each as an alert and email
(`raiseSetupClockSteps`, `:183`). A step re-compares the clocks and, when they agree, the page
selects by itself (`recovery-hour.ts:408-419`; `clock-wait.ts:368-387`).

**S10. A restore staged without a recovery operation names no series by itself (read).** The
staged marker's operation, else `WAITRON_RECOVERY_OPERATION_FILE`, is the only operation
(`restore-request.ts:494-500`, branch); with neither, placement calls each module's restore hook
with none (`restore.ts:976-983`, branch), and the fiscal hook then refuses `sif.allocation_invalid`
`reauthentication_required` for a copy holding a live SIF (`allocated-lifecycle.ts:14-16,59`), or
leaves the series unchanged for one holding none (`:53-56`). With the operation file, it is the
restore command's path: an operator at a terminal, an internet clock only, nobody to confirm (S1).

**S11. Pressing a button more than 30 s after its comparison is refused today.** `select` reads
the comparison through `read`, which refuses `clock_stale` once the comparison is over 30 s old on
the steady clock (`current`, `hour-setup-clock.ts:108`, reached from `read`, `:205-213`; the fresh
read reports a probe that admitted 29 000 ms and refused 31 000 ms `clock_stale`; not rerun here).

## Decisions

**D5′ (replaces D5; PR 4). The second clocks.** The series check takes one of: **(1)** the time
service answering synchronised, read fresh through the host service at that comparison (at most
2 s, `DEFAULT_STATUS_MS`), never the shared one-minute reading; it carries on by itself; **(2)** a
device's time that the person proved on that page confirms (D-confirm), or at the restore's start a
carried select (D-carry) or a confirmation kept by the waiting app (D-key). AEAT is never read;
`hour-clock-internet.ts` and its test are deleted. A synchronised answer becomes an observation of
source `internet` equal to the box's clock with no uncertainty, so `compareHourClocks` keeps
judging. **While it is present, a device that disagrees does not refuse** (owner rule 1,
2026-11-11: "we trust NTP over everything else").

**D-confirm (PR 3a). A device's time counts only once the person confirms it.** `select` gains
`confirmed?: true`. When the comparison it names holds no usable `internet` observation,
`select` without it refuses `sif.allocation_invalid`, reason `confirmation_required`; the check
lives in the module (`hour-selection.ts`, beside `clockRefusal` at `:403`), so every page and every
host gets it. Each page already sends its proof with `select`, so "only a person who has already
proved themselves on that page" holds with no new sign-in. Pages: on agreement with no internet
clock, the step shows both times (`renderClockRows`, `clock-wait.ts:522`) and **Confirm the
time**. The press compares again (a fresh challenge and `compare-clocks`) and sends `select` with
`confirmed: true` only if that comparison still agrees with no internet clock; if it now
disagrees, the page shows the disagreement step instead. So a press minutes after the first
comparison is never refused `clock_stale` (S11). A successful **This device** counts as the
confirmation, so the re-comparison after it selects by itself as today (owner, 2026-11-12 15:28:
"once they choose the time, you can continue with the process"). The box's own screen still does
not count (`same_machine`). Disagreement stays as #3025 left it: The server / This device / Both
times are wrong. With an internet clock, pages carry on by themselves as today.

**D-carry (PR 3b). The restore's start uses the page's select while the box has not been switched
off.** A select writes the box's boot reading into the intent it stores (`{ bootId, uptimeMs,
wallMs }`, read through a new host member `readBoot?()`; no boot id → nothing written). At the
restore's start, `resume` builds a usable observation from it when the boot id now is the same and
not null, and the wall clock moved within 1 s of `/proc/uptime` since (the 1-second figure
`clock_corrected` already uses, `hour-setup-clock.ts`). It carries whatever admitted the select
(a confirmed device or an internet clock): both judged the box's clock right, and the clock has run
on unstepped since. A different or missing boot id, or a step, leaves the start to its other second
clocks and so to the wait. No time limit: the owner's condition is only "provided the box has not
been switched off since" (Q1).

**D-key (PR 3b). After a power cut the start asks the same browser, which keeps the key it
already holds.** On a successful "Restore backup" the setup app keeps the node recovery key from
the request, in memory only (never storage), and hands it to the done screen instead of dropping it
(`setup-app.ts:1838-1839,1913-1915,2012`); a refused request still drops it as today. The box
already keeps that key as a file through the restart and a power cut (`NODE_KEY`,
`restore-request.ts:288`, read at the start by `readStagedNodeKey`, `:518`, branch). While the start
waits, the waiting app's clock routes (`/restore-clock/challenge`, `/compare`, `/confirm`, `/set`)
take the key in the request body and compare it with that file, timing-safe, after the same
check `nodeKey` applies (`restore-request.ts:128-136`); a wrong or missing key answers 403
`promotion.break_glass_invalid`, the code the restore page already shows beside the key field
(`setup-app.ts:437`). **The same routes serve the typed key:** the waiting page shows a key field,
so a person whose browser lost the key (reload, closed tab, another device) types it from the
backup's paper — the owner's fallback (09:52: "fall back to asking for the recovery key again
(~40 lines)"), and what root `CLAUDE.md` §3 asks of a refusal: offer the sign-in there, never send
the person to somebody else. A key typed again is the same one secret, entered a second time only
when the browser lost it.

Weighed against a separate random pass (draft 3): a pass would be good for nothing but this wait,
where the key also opens a restore or promotion (`withRecoveryKeyAuthority`, allowed actions
`restore` and `promote`, `operation-authentication.ts:49`). But the same tab held the key until the
press, the box holds it as a file, and the typed fallback needs the key check anyway; the pass
would add a second check, a file and about 45 lines for no gain in this tab.

**The confirmation is stored, not timed.** The done screen (or the typed-key page) shows both
times, **Confirm the time**, and **This device** (set through `createSetupClockSet`, so the step is
noted and alerted as the restore page's are, S9). A press measures the device's time against a
fresh challenge and is kept only when the two agree within 30 s. The waiting app keeps it with the
box's boot reading (`{ bootId, uptimeMs, wallMs }`), as D-carry keeps a select, so it has no
30-second life: the start's next try uses it while the boot id is unchanged and the wall clock has
moved within 1 s of `/proc/uptime`. A new confirmation starts a try at the next 15-second look,
outside the once-a-minute limit.

**D-wait (replaces D7's scope; D7's source stands). UNVERIFIED.** At the restore's start, three
refusals wait, uncounted: `second_clock_missing`, `clock_disagreement`, `clock_corrected`.
`confirmation_required` cannot reach the start (it reads no `select`). `clock_stale`,
`clock_unconfirmed` and `minute_not_later` count as failures, as today. **The retry runs in the
same process**, a loop in `runEntry` around `runStagedRestore`. A try is not cheap (S5), so the loop
tries again only for a reason: every 15 seconds it looks for a confirmation kept since the last try
(D-key), which starts a try at once, or (PR 4) the time service answering synchronised. Other tries
happen at most once a minute: PR 3b keeps a try every 60 seconds with no reason, because only a try
tells whether AEAT answers now; PR 4 deletes it. If a try refuses again with a confirmation kept (a
step since it, or a power cut), the confirmation is dropped and the done screen asks again. Each try writes its attempt as today and the wait takes it back
(`withoutAttempt`), so a power cut during a wait is not counted. One log line per wait,
`server.start_waiting_for_clock` with the reason.

**The waiting page.** Every HTML page on the box's usual address answers 503 with a page that
explains (words below), and every other request answers 503 `server.waiting_for_clock`, as built.
It takes no device time from anyone without the key; with the key typed, it shows the same step as
the done screen (D-key).

**D6′. The start-failure page's cause. UNVERIFIED.** D6's only cause came from AEAT's
`clock-corrected` reason; that refusal now waits, and Task 16 is not built. The code-only words
for `sif.allocation_invalid` change: they name the page's own controls, traced for a page with and
without verifiers (SDD ledger ruling I1 on the branch: the built sentence names a restore button the
page does not have).

**The watcher's example: a standby promoted at 23:00 behind a firewall that blocks NTP.** The
person opens the spare's handover page on a phone and signs in (`node.manage`). Before PR 4, AEAT
(if web traffic leaves) carries on by itself (Q2); otherwise, and always after PR 4, the page shows the
phone's and the spare's times and the person presses Confirm the time, or This device when they
differ. On the spare's own screen the page says it does not count. After promotion, A1420's start
check holds payments until two tills or handhelds agree within 5 s or a person confirms (D1).

**#3025 has landed (`8da04096ef`), so:** (1) PR 3b's branch is stacked on `d6a5e273fc`, which does
not hold it; its rebase onto PR 3a meets #3025 in `hour-setup-clock.ts` (14a's `measureDeviceReading` replaces
`take`'s measuring too, `:113-127`), `hosted-hour-recovery.ts` (`set-clock` beside `resume`) and
`operation-preparation.ts` (`setBoxClock` beside the new members). (2) The waiting step's This
device reuses #3025's setup-mode setter and its note (S9), so no new setter. (3) Its refusal lines
stay; its `witnessed` line goes with #3003, as its finish note says; after PR 4 its `synchronised`
line is reached only if the box synchronises between a comparison and the press. (4) The A1482
sentence in root `CLAUDE.md` §5 that it is "not owner-approved" is now covered by the owner's 09:52
agreement ("or sets the box from their device, #3025"); PR 3a rewrites it (Sentences changed).

## Questions for the watcher (cases the ruling leaves open)

**Q1. How old may a same-boot select or confirmation be at the restore's start?** **Recommended:
no limit**, the owner's words ("provided the box has not been switched off since"). Cost: a clock
that keeps no internet time drifts while it runs; one confirmed days earlier may then be further
out than 30 seconds (reasoned, not measured). A minute already in a history the box reads is still
never taken. Alternative: past 24 hours, ask again on the done screen, about 5 lines.

**Q2. Between PR 3a and PR 4, does AEAT's agreeing time count as "internet time" that carries on
by itself? UNVERIFIED.** **Recommended: yes**, as today, until PR 4 swaps it for the time service,
and PR 4 lands soon after PR 3b. Cost: for that gap, a box that reaches AEAT names its series with
no person's confirmation even when NTP is blocked. Against: the owner's "we rely on NTP only, we
don't bother about AEAT" (2026-11-10); the other answer makes PR 3a also add the time service,
most of PR 4.

**Choices made without a question** (the watcher may flip each): D-carry carrying an
internet-admitted select too; `confirmation_required` as a reason under `sif.allocation_invalid`;
a confirmation kept only when the times agree; D-key keeping the key in the tab rather than a
separate pass; D-wait's reasons; D5′'s fresh read per comparison; D5′'s "a synchronised box
overrules a disagreeing device"; D-host's `timedatectl` for the setup command (PR 4); D6′ dropping
Task 16.

## Words (English and Spanish change together)

Series steps (PR 3a; `clockWaitStrings`, `clock-wait.ts`, so all four pages share them):

| Key | EN | ES |
| --- | --- | --- |
| confirmWhy | The server could not check its time over the internet. Check that both times below are right, then press Confirm the time. | El servidor no ha podido comprobar su hora por internet. Comprueba que las dos horas de abajo son correctas y pulsa Confirmar la hora. |
| confirm | Confirm the time | Confirmar la hora |

Done screen while the start waits (PR 3b; tills say "server", so does the setup app):

| Key | EN | ES |
| --- | --- | --- |
| done.waiting_for_clock | Before it creates the new invoice series, the server needs you to confirm its time again. Check that both times below are right, then press Confirm the time. If the server's time is wrong, press This device to set it from this device's time. | Antes de crear las series de facturas nuevas, el servidor necesita que vuelvas a confirmar su hora. Comprueba que las dos horas de abajo son correctas y pulsa Confirmar la hora. Si la hora del servidor está mal, pulsa Este dispositivo para ponerla con la hora de este dispositivo. |
| done.clock_confirmed | Time confirmed. This page shows when the server is ready. | Hora confirmada. Esta página te avisa cuando el servidor esté listo. |

The button's names are the setup app's own (`restore.submit`, `apps/setup/src/i18n/strings/restore.ts:70,253`).

Waiting page for every other visitor (PR 3b):

| Key | EN | ES |
| --- | --- | --- |
| title | The server is restoring your backup and is waiting to confirm its time. | El servidor está restaurando tu copia y espera a confirmar su hora. |
| why | So that no invoice series is ever repeated, it creates its new series only once its time is confirmed. It carries on by itself once it can check its time over the internet, or once its time is confirmed on the page where Restore backup was pressed. If that page is closed, enter the node recovery key from the backup's paper below to confirm the time from this device. | Para que ninguna serie de facturas se repita, solo crea sus series nuevas cuando su hora está confirmada. Sigue sola en cuanto pueda comprobar su hora por internet, o cuando se confirme su hora en la página donde se pulsó Restaurar la copia. Si esa página está cerrada, introduce abajo la clave de recuperación del nodo del papel de la copia para confirmar la hora desde este dispositivo. |

The key field reuses the restore page's label and its refusal line. Start-failure page: D6′. PR 4's setup
and command words: as draft 2 (unchanged, kept below in Task 13b′).

## PR 3a — a person confirms the time for every new series

A new branch, `feat/a1420-3a-confirm-series`, from a base holding both the stack and #3025 (main
once the stack's PRs have landed, as Order says; 14c′'s This device cases need #3025). Files:
`packages/fiscal-verifactu/src/` `hour-selection.ts`, `hosted-hour-recovery.ts`, `hour-preparation.ts`,
`conflict-recovery-contract.ts`, `setup/clock-wait.ts`, `setup/first-hour.ts`, `setup/recovery-hour.ts`,
`dashboard/conflict-recovery.ts`; root `CLAUDE.md` §5 (C3a).

### Task 14b′: `select` needs a confirmation without an internet clock (fiscal-verifactu)

- [ ] Tests first (`hour-selection.test.ts`, `hosted-hour-recovery.test.ts`, the `hour-preparation`
  cases): browser agrees, internet unavailable, no `confirmed` → `confirmation_required`; with
  `confirmed: true` → selected; internet usable and no `confirmed` → selected (control);
  `conflict-recovery-contract` parses `confirmed: true` and refuses any other value. Every existing
  case that selects on a browser alone with no usable internet adds `confirmed: true`; any other
  assertion change is a STOP.
- [ ] Implement in `hour-selection.ts`; `clockProblem` maps `confirmation_required` to a new
  `{ kind: "confirm" }` for the pages.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
  src/hosted-hour-recovery.test.ts src/hour-setup-clock.test.ts src/hour-clock.test.ts
  src/hour-selection.test.ts src/conflict-recovery-contract.test.ts src/conflict-recovery-routes.test.ts
  src/minute-selection-unknown-name.test.ts src/hour-recovery-preparation.relinquished.test.ts`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts
  inmutabilidad`, `pnpm --filter @waitron/composition exec vitest run
  src/allocation-configuration.test.ts`, and the 16 `apps/server` files that send `select` (`git
  grep -l 'action: "select"' -- 'apps/server/src/*.test.ts'`, at `f1deb720ed`:
  `boot.handover-chart-moved-on`, `conflict-payment-recovery`, `handover-activation-repair`,
  `handover-activation`, `handover-compare`, `handover-controlled.e2e`, `handover-dormant-setup`,
  `handover-minute-history`, `handover-preparation`, `hour-promotion`, `hour-recovery-host`,
  `hour-recovery-placement-1`, `-2`, `-3`, `hour-recovery-staged`, `live-conflict-recovery`), in
  groups sized to `memory_pressure | grep free`. Most stub the internet clock usable (for example
  `hour-promotion.test.ts:100`, `handover-preparation.test.ts:162`) and need no change; the run
  finds the cases that select without it.

### Task 14c′: setup, restore and handover pages show Confirm the time (fiscal-verifactu setup UI)

- [ ] Tests first (browser): `recovery-hour` (restore and its use inside the handover screen) and
  `first-hour`: agreement with no internet row shows both times and Confirm the time, and sends no
  `select` until pressed; the press sends a fresh `clock-challenge` and `compare-clocks`, then
  `select` with `confirmed: true` and the new comparison's id; a press 31 s after the first
  comparison (fake clock) still selects (the control for S11); a press whose fresh comparison now
  disagrees shows the disagreement step and sends no `select`; with an internet row the page
  selects by itself (control); after This device answers `set`, the re-comparison selects with
  `confirmed: true` and no press. Axe cases for the new state, both themes.
- [ ] Words (series steps), English and Spanish.
- [ ] `memory_pressure | grep free`, then `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/setup/clock-wait.browser.test.ts src/setup/first-hour.browser.test.ts
  src/setup/recovery-hour.browser.test.ts src/setup/recovery-hour.a11y.browser.test.ts
  src/setup/first-hour.a11y.browser.test.ts`.

### Task 14c2′: the conflict switch shows Confirm the time (fiscal-verifactu dashboard UI)

- [ ] Tests first: the same cases as 14c′ in the conflict-recovery dashboard suites (`git grep -l
  conflict-recovery -- 'packages/fiscal-verifactu/src/dashboard/*.test.ts'`), where today's
  `compare()` selects at once (`dashboard/conflict-recovery.ts:278-310`); its disagreement keeps
  today's refusal words (it has no This device).
- [ ] Words beside its own `conflict_recovery.*` strings, English and Spanish; C3a in root
  `CLAUDE.md`; `docs/developers/conventions-data.md` beside `:4166-4168` (D-confirm).
- [ ] The suites named, then `pnpm exec vitest run scripts/english-only.test.ts
  scripts/claude-md-pointers.test.ts`.

## PR 3b — a restore's start reuses the page's choice, and otherwise waits for the same person

Work on `feat/a1420-3-restore-waits`, rebased onto PR 3a (which brings #3025). Files:
`packages/module/src/` (device reading, host members), `packages/fiscal-verifactu/src/`
`hour-setup-clock.ts`, `hosted-hour-recovery.ts`, `hour-selection.ts`; `apps/server/src/`
`node-entry.ts`, `recovery-entry.ts`, `recovery-preparation.ts`, `restore-request.ts`,
`start-clock-waiting.ts`, `errors.ts`, `i18n/`; `apps/setup/src/` `setup-app.ts`,
`screens/done-screen.ts`, `i18n/strings/finish.ts`.

### Task 14a′: rebase, and the host's device reading becomes a kept confirmation (module, fiscal-verifactu)

- [ ] Rebase onto PR 3a. `take` (`hour-setup-clock.ts:113-127`) measures through
  `measureDeviceReading`; the #3025 suites pass unedited (the control that nothing changed).
- [ ] Rename `startClockReading?()` to `startClockConfirmation?()`, answering a kept confirmation
  (the measured reading and its boot reading) or null; one comment: "a confirmation the restore
  page's key holder made while the restore's start waits".
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
  src/hosted-hour-recovery.test.ts src/hour-setup-clock.test.ts src/hour-clock.test.ts`,
  `pnpm --filter @waitron/module exec vitest run src/device-clock.test.ts`.

### Task 14d′: a select or a kept confirmation stands while the boot is the same (module, fiscal-verifactu, server wiring)

- [ ] Tests first (`hosted-hour-recovery.test.ts`, through `configure!(host)` then
  `resumeRecovery` then `prepare`): internet unavailable, a select made with `readBoot` answering
  `{ id: "b1", ms: 1000 }` at wall `W`, start reading `{ "b1", 61 000 }` at `W + 60 000` →
  admitted; boot id `"b2"` → `second_clock_missing` (control: switched off); same id, wall
  `W + 62 000` → `second_clock_missing` (stepped); `readBoot` absent or id `null` at either end →
  `second_clock_missing`. The same four for a `startClockConfirmation` kept two minutes before the
  try (no 30-second life).
- [ ] Add `readBoot?(): { ms: number; id: string | null }` to `ModuleOperationHost`; the intent
  carries the reading; `resume` builds the observation from the intent or the confirmation (D-carry).
- [ ] Wire `readBoot: bootReader().readBoot` into `createSelectedRecoveryPreparation`'s host
  (`recovery-preparation.ts:234`), which both the restore page and the start build.
- [ ] The commands of 14a′, and `pnpm --filter @waitron/server exec vitest run
  src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts
  src/hour-recovery-staged.test.ts`.

### Task 14e′: the done screen keeps the node recovery key (setup app)

- [ ] Tests first (`setup-app-recovery-credentials.test.ts`): after a successful archive, bucket
  and Cloud "Restore backup", the done screen holds the node recovery key that was sent, and no
  other credential (the archive key, the kit); a refused request keeps none (the existing case);
  nothing reaches `sessionStorage`, `localStorage` or `document.cookie`.
- [ ] Implement in `setup-app.ts` (`:1838-1839,1913-1915,2012`) and a `nodeRecoveryKey` property on
  the done screen.
- [ ] `memory_pressure | grep free`, then `pnpm --filter @waitron/setup exec vitest run
  src/setup-app-recovery-credentials.test.ts src/screens/done-screen.test.ts`.

### Task 14f′: the waiting app takes a confirmation only with the key (server)

- [ ] Tests first (`start-clock-waiting.test.ts`): pages and `/api/*` as built. `POST
  /restore-clock/challenge`, `/compare`, `/confirm`, `/set` without the key or with a wrong one →
  403 `promotion.break_glass_invalid`; with the staged key: `compare` answers both times;
  `confirm` within 5 s of its challenge and agreeing → kept with the boot reading, and
  `confirmation()` answers it until the next try; disagreeing → not kept, answer `differs`; past
  5 s → not kept (control); from the box's own screen → not kept, `same_machine`; `set` calls the
  setter with the measured offset and answers its answer. The page shows the key field and, once a
  correct key is typed, the same step as the done screen. Render the page to a file and open it in
  the workspace's Playwright Chromium, both themes and phone width (§4). No plain-HTTP case: the app
  is routed only when the box's certificate passes its check (`recovery-listener.ts:151`).
- [ ] Implement: keep the shell; drop `/restore-clock/reading` and the time-sending script;
  `admitReading` becomes the key check, refusing by default, reading the staged key file; the
  setter is `createSetupClockSet`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-waiting.test.ts
  src/start-clock-waiting-page.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts
  scripts/personal-log-params.test.ts scripts/module-seams.test.ts scripts/english-only.test.ts`.

### Task 14g′: the restore's start waits for a kept confirmation (server)

- [ ] Tests (`node-entry.test.ts`, as built, renamed): keep cases 1-2 and the serve-before-take-back
  and close-failure cases. Case 3 becomes: no confirmation → the stub is called again at 60 000 ms
  and not before; a confirmation kept at 20 s → called at the next 15-second look; one kept 10 s
  after a try → called at the next look, not a minute later (the confirmation is not lost, the
  fresh read's Important 2); a try that refuses again drops the kept confirmation (control). The
  page runner's host has no `startClockConfirmation` (`createInteractiveRecoveryPreparation`).
- [ ] Implement in `runEntry` and the plumbing `recovery-entry.ts` → `recovery-preparation.ts`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/restore-request.test.ts
  src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`.

### Task 15′: the done screen asks the same person (setup app)

- [ ] Tests first (`done-screen.test.ts`): a poll answered 503 `server.waiting_for_clock` draws the
  clock step (both times, Confirm the time, This device) and never navigates; Confirm sends the key
  to `/restore-clock/confirm` and shows `done.clock_confirmed`; a later poll still answered
  `server.waiting_for_clock` after a refused try draws the step again; This device sends it to
  `/set`, then compares again; a 503 with another code waits (control); a 404 shows "ready"; after a
  bucket rebuild the device steps stay below the clock step. Axe case for the new state.
- [ ] `memory_pressure | grep free`, then `pnpm --filter @waitron/setup exec vitest run
  src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts`.

### Task 16″: words, rules and documents

- [ ] Start-failure words (D6′) and `recovery-surface.test.ts:618-633`. Docs:
  `docs/operations/hour-recovery.md` (the restore's start: same boot carries on; otherwise the done
  screen asks again, or the key on any page), `apps/server/src/guide/{en,es}/backup-recovery.md`
  (one paragraph each), `docs/developers/conventions-data.md` beside `:4166-4168` (D-carry, D-key,
  D-wait), root `CLAUDE.md` §5 (C3b).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts
  src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/claude-md-pointers.test.ts`.

## What becomes of the built commits (`d6a5e273fc..42860d1df9`)

| Commit | Built under draft 2 | Now |
| --- | --- | --- |
| `2e09d5e76a` 14a | `measureDeviceReading`, `AGREEMENT_MS`, `DeviceClockReading` in `@waitron/module`; `compare`'s `measured` argument; `startClockReading?()`; five cases | **Keep**, rebased onto 3a (14a′); member **renamed** and answers a kept confirmation; cases kept |
| `fc04219437` 14a review | 31-s-ahead case, comments | **Keep** |
| `436f1e4d38` 14b | waiting app: pages and `/api/*` 503, unsigned challenge and reading, inline script, 64 challenges, `admitReading` | **Change** (14f′): keep the shell, error code, words file's title, 64-challenge bound; **drop** the unsigned reading route and script; `admitReading` becomes the key check |
| `35f2b5413b` 14b review | dates on both times, reload when the restore ends, two readings, 1 KiB body limit, times outside the live region | **Keep** body limit (on the key routes) and the date format (moves to the done screen); **drop** the two-readings rule and the script's reload |
| `59998cbddc` 14b review 2 | clear on an unmeasured answer; noon-pinned page tests | **Drop** with the script |
| `195a75159d` 14c | `runEntry` loop: three reasons, attempt taken back, log line, 15-s looks, 60-s blind try, close before `startServer`; plumbing | **Keep**; **change** the reason to try (a kept confirmation starts one, 14g′) and the plumbing's name |
| `1c6b99d13f` 14c review | serve before taking the attempt back; a failed close keeps the refusal; required dependency in fixtures | **Keep** |
| `45d8cbdcaa` 15 | done screen opens `/` on `server.waiting_for_clock` | **Drop**: navigating reloads the page and throws away the key held in memory; replaced by 15′ |
| `e4032ae5e7` 15 review | after a rebuild, link the waiting page instead | **Drop** the link; **keep** the device steps on screen (15′) |
| `97eb0396f6` 16′ | start-failure words, guides, docs | **Change** (16″): words per D6′, docs to this design |
| `42860d1df9` 16′ review | narrowed comments and docs | **Change** with 16″; keep the recovery-page comment |

## PR 4 — the time service replaces AEAT in the series check

### Task 11′: the series check reads the time service (fiscal-verifactu)

- [ ] New `hour-clock-time-service.ts`: `observeTimeServiceHourClock(read, deps)` times the read on
  the wall and steady clocks and answers a usable `internet` observation at the box's time when
  `read()` is true, else `unavailable` `not_synchronised`. `createSetupHourClock` takes
  `timeService` in place of `internet` (`hour-setup-clock.ts:17,46`). Delete `hour-clock-internet.ts`
  and its test.
- [ ] `compareHourClocks`: no `disagreement` while a usable `internet` observation is present.
- [ ] Tests first: `hour-clock.test.ts`, a synchronised observation and a browser 5 minutes out →
  `canSelectHour` true; the same browser without it → `clock_disagreement` (control).
  `hour-setup-clock.test.ts`: `timeService` false or absent and no browser →
  `second_clock_missing`; true → admitted, and `select` needs no `confirmed` (D-confirm).
  Afterwards `git grep -n "hour-clock-internet\|observeInternetHourClock\|authenticatedHourHead" --
  '*.ts'` prints nothing.
- [ ] The fiscal-verifactu commands of 14b′.

### Task 12′: every host supplies the time service (module contract, server, provisioning)

- [ ] Add `timeServiceSynchronised?()` to `ModuleOperationHost` (absent answers false);
  `hostedHourPreparation` and `hostedHourRecovery` hand it to `createSetupHourClock`. Wire the
  builders (`git grep -n "createModuleOperationHost("`) with `clockServiceSynchronised`; the setup
  command's (`bin.ts:63`) with `timedatectl show -p NTPSynchronized --value`, false without it. In
  `runEntry`'s wait, replace the blind 60-second try with a look at the time service every 15 s.
- [ ] The restore command's line (Words of draft 2, below), and the same sentence in
  `deploy/README.md`'s restore command section (`:616-681`).
- [ ] Tests first: `module-operation-host.test.ts`; `restore-request.test.ts` (the start's host and
  the page's both read it); `node-entry.test.ts` (synchronised at a look → the stub is called; never
  synchronised and no confirmation → not called over ten minutes, the control for the blind try's
  removal); `restore-command.test.ts`; `first-setup-command.test.ts` (true reader names the series
  with no browser; false reader as control).
- [ ] `pnpm exec vitest run scripts/module-seams.test.ts`, the named suites, then the fiscal core
  command.

### Task 13′: move the test stubs (setup only)

- [ ] Every file `git grep -l "hour-clock-internet" -- '*.ts'` lists besides the deleted pair stubs
  the new module instead: path and export name change, the stub's observation stays. Run the
  fiscal-verifactu, provisioning and composition files locally, the server files in groups sized to
  free memory; CI runs the rest. Any other assertion change is a STOP unless "Changed test checks"
  lists it.

### Task 13b′: words, rules and documents

- [ ] Setup pages (`setup/clock-wait.ts:55-56,78-79`, `first-hour.ts:65-67,85-87`,
  `recovery-hour.ts:70-73,98-101`): `whySecondClock` becomes "So no invoice series is ever repeated,
  the server checks its time over the internet, or you confirm it against this device's time." /
  "Para que ninguna serie de facturas se repita, el servidor comprueba su hora por internet, o tú la
  confirmas con la hora de este dispositivo." In each `secondClockDo`, "Connect the box to the
  internet" becomes "Let the box keep its time over the internet" / "Conecta el servidor a internet"
  becomes "Deja que el servidor se ponga en hora por internet"; in each `secondClockEnds`, "once the
  box reaches the internet" becomes "once the box keeps its time over the internet" / "cuando el
  servidor tenga internet" becomes "cuando el servidor se ponga en hora por internet". Commands
  (English only): the setup command's line (`initial-hour-setup.ts:110`) becomes "Let the box keep
  its time over the internet, or set up from a phone or laptop on the venue's network."; the restore
  command prints, for a `sif.allocation_invalid` clock refusal, "The box could not confirm its time,
  so it made no invoice series. Let the box keep its time over the internet, or restore from the
  restore page on a phone or laptop on the venue's network."
- [ ] C4′ and the #3003 clause (below); `docs/operations/first-live-fiscal-setup.md:18-21,96-99,243-245`,
  `hour-recovery.md:124-126,189-191,233-245`, `conventions-data.md:4166-4168`.
- [ ] `memory_pressure | grep free`, then the setup browser suites of 14c′, and
  `scripts/english-only.test.ts`, `scripts/claude-md-pointers.test.ts`.

## Sentences changed, word for word

**C3a (new), PR 3a, root `CLAUDE.md` §5.** The written rule says a device's agreement needs no
confirmation; the owner's 09:47 ruling says the opposite, so PR 3a replaces

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock
> agrees within 30 seconds (no confirmation); a device that has just set the box's clock from that
> page is that machine (A1482 plan, cleared by the watcher 2026-11-12 18:33; not owner-approved); a
> minute whose name is already in a history the box reads is not taken.

with

> Setup/restore/promotion/conflict switch use five symbols for the box's UTC minute, after a second
> clock agrees within 30 seconds. An internet clock carries on by itself; another machine's clock
> counts only once the person proved on that page (setup password, the backup's node recovery key,
> a `node.manage` or administrator sign-in) confirms both times or sets the box's clock from that
> machine (owner, 2026-11-13: "we should never just accept another device's match automatically.
> instead, we should always ask for confirmation, and that confirmation should be protected"). A
> minute whose name is already in a history the box reads is not taken.

and adds `hour-setup-clock` to that rule's guard list.

**C3b, PR 3b.** After C3a's "confirms both times or sets the box's clock from that machine (owner,
…)." PR 3b inserts: "A restore's start uses the restore page's choice while the box's boot id is
unchanged; otherwise it waits until the node recovery key confirms again, held by the browser that
pressed Restore backup or typed on the waiting page." It adds `start-clock-waiting` to the guard
list. In the clock-setting rule (§5, "the restore page (under its recovery key or kit)"), PR 3b adds
after that phrase: ", the done screen or waiting page while that restore's start waits (under the
node recovery key)".

**C4′ (replaces C4), PR 4.** In C3a's text, "An internet clock carries on by itself" becomes "The
box's internet time service saying it is synchronised carries on by itself, and AEAT's time is not
read for it (owner, 2026-11-10, A1420 Q1: "Yes, time service stands in"; 2026-11-11: "Instead we
rely on NTP")".

**#3003's clause, deleted by PR 4.** #3003 says (commit `92c95072d4`, root `CLAUDE.md` §5 and
`conventions-data.md`): "**Waitron never reads AEAT's time except to warn of drift from its filing
replies and, until A1420 PR 4 lands, in the series check at setup, restore and promotion
(`hour-clock-internet.ts`)**". PR 4 deletes " and, until A1420 PR 4 lands, in the series check at
setup, restore and promotion (`hour-clock-internet.ts`)" in both files.

## Changed test checks (assertions the spec changes)

- PR 3a: every case that selects on a browser alone with no usable internet observation adds
  `confirmed: true` (the request changes, not the assertion); the browser suites that assert a page
  selects by itself on agreement now assert the Confirm press (`recovery-hour.browser.test.ts`,
  `first-hour.browser.test.ts`, the conflict-recovery dashboard suites).
- PR 3b: `recovery-surface.test.ts:618-633` asserts D6′'s words; the built `done-screen.test.ts`
  cases that assert `navigate("/")` or the waiting-page link are replaced (15′); the built
  `start-clock-waiting` cases for the unsigned reading are deleted with the route (14f′); the
  existing "drops the entered node key from a refused request" case is unchanged (a refusal still
  drops it).
- PR 4: `hour-clock-internet.test.ts` is deleted. Word assertions follow Task 13b′ in the files
  `git grep -l "Connect the box to the internet\|Conecta el servidor a internet\|the internet's" --
  '*.test.ts'` lists. A stub's AEAT reason (`"tls"`, `"network"`, `"offline"`) becomes
  `not_synchronised` where a case reads it back.

## On the test box (Task 19's "PRs 3-4" step, replaced)

**PR 3a:** block UDP 123 and TCP 443 outbound (`nft`, as Task 19 step 2). Restore from a laptop:
**expect** both times and Confirm the time, nothing selected before the press; wait two minutes,
press, **expect** the series chosen. Unblock TCP 443: **expect** no Confirm (AEAT carries on).

**PR 3b:** UDP 123 and TCP 443 blocked. (1) Restore from a laptop, confirm, "Restore backup":
**expect** placement with no wait (same boot). (2) Again, switching the box off and on after
"Restore backup" with the laptop's page left open: **expect** the done screen's clock step; any
other page at the box's address shows the waiting page with the key field; `failures` in
`recovery.json` unchanged over five minutes; one `server.start_waiting_for_clock` a minute. Press
Confirm the time: **expect** placement within about 15 s. (3) Again, closing the laptop's tab
before the box is back: on a phone, type the node recovery key on the waiting page and confirm:
**expect** placement. A wrong key: **expect** the refusal line beside the field. Report from the log
the time from each press to placement.

**PR 4:** (1) TCP 443 blocked, UDP 123 open: a restore with the box switched off after "Restore
backup" finishes with no wait and no press. (2) UDP 123 blocked, the box switched off, the page
closed: **expect** no try after the first for ten minutes; unblock UDP 123 and report the time to
placement. (3) The watcher's example at 23:00 with UDP 123 blocked: **expect** Confirm the time on
the phone's handover page, then the series named. (4) UDP 123 open and a laptop's clock 2 minutes
wrong: first setup names the series with no clock question.

## Size (estimates; production and tests apart)

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **3a** confirmation on every series page (Tasks 14b′, 14c′, 14c2′) | about +110 / −10 (14b′: 30; 14c′: 55 with words; 14c2′: 25 with words) | about +260 | +15 / −5 |
| **3b** same-boot carry, the wait, the key-held confirmation (Tasks 14a′, 14d′-g′, 15′, 16″) | about +520 / −60 (14a′: 60 kept; 14d′: 45; 14e′: 15; 14f′: 200 with the key form and words, of which about 100 kept; 14g′: 95, about 85 kept; 15′: 90 with words; 16″: 15) | about +1,050, of which about 700 already on the branch and reworked | +60 / −20 |
| **4** time service in, AEAT out (Tasks 11′-13b′) | about +120 / −175 | about +150 / −401; about 125 lines changed across the stub files | +30 / −20 |

Against draft 3's single PR 3 (+620 / −60 production and +1,150 tests, plus Q1's +80 / +100): the
key held by the done screen replaces the separate pass (about −30), the typed key is in 3b, and the
stored confirmation adds about 10.

## What becomes of A1420's Tasks 11-16

| Task | Now |
| --- | --- |
| 11 (synchronised option on the comparison) | replaced by 11′ |
| 12 (`startClock.synchronised` on the host) | replaced by 12′ (`timeServiceSynchronised`), 14a′ (`startClockConfirmation`) and 14d′ (`readBoot`) |
| 14 (wait on `network`/`timeout` only, exit and restart) | replaced by 14b′-c2′ (PR 3a: a confirmation on every series step) and 14a′, 14d′-g′ (PR 3b: the same-boot carry, the key-held confirmation, an in-process wait) |
| 15 (done screen line) | replaced by 15′: the done screen asks the same person |
| 16 (`lastErrorCause` `clock_moved`) | dropped (D6′) |
