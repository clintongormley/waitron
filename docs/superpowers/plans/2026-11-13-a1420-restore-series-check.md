# A1420 PRs 3 and 4, revised: the series check stops asking AEAT for the time — plan revision

> **For agentic workers:** this replaces the "PR 3" and "PR 4" sections of
> `docs/superpowers/plans/2026-11-09-a1420-start-clock-corrects-itself.md` (revision 5), with its
> D5, D6's cause, D7's scope, R2's third bullet, C4, Task 19's "PRs 3-4" step and the size rows for
> PRs 3 and 4. Everything else in that plan stands, its "Global constraints" included. Implementers
> are dispatched as `subagent_type: "implementer"`. Fiscal clock rule: full review path, two Codex
> run-it reviews per PR, and the owner lands each PR.

**Status: draft 1, 2026-11-13.** Needs one fresh-context read and the watcher's clearance. Base:
main `c92d69ee86`. The clock code it builds on is stacked, unpushed, at
`feat/a1506-2-till-time-wrong` (`d6a5e273fc`); a line number marked "stack" is on that commit.
Every receipt is read, not run, unless it says RUN.

## Why this revision

A1420's PR 3 let a synchronised box skip AEAT at a restore when AEAT could not be reached, and
PR 4 made a restore that could reach neither wait and retry. Two later rulings remove AEAT from
the series check altogether:

- **The owner, 2026-11-11 14:34** (lane B's queue, A1506, verbatim): "either: we can talk to ntp,
  so we fix it, or we must check the time manually, which we do with the device times"; on asking
  AEAT for its time: "I'm not sure that we should do this, because i don't think there is an actual
  API for this. You suggested a 3 request method previously which was a bad hack. Instead we rely
  on NTP."
- **The watcher's answer to A1506 Q1** (`waitron-campaign-b/questions.md`, "WATCHER 2026-11-12
  06:11 — A1506 plan: CLEARED"): "**Q1: yes.** The series check's request to AEAT's web page is
  the same one the owner called "a bad hack… Instead we rely on NTP". Add how a person gets past
  the wait when no page is open: the owner's "we must check the time manually, which we do with the
  device times", so a till's time confirms it. Example to write in: a standby promoted at 23:00
  behind a firewall that blocks NTP." **This is a watcher decision, not an owner approval.**

## Words used here

- **The series check**: before a box names a new invoice series (at first setup, a restore, a
  promotion or a conflict switch), a second clock must agree with the box's to within 30 seconds
  (`compareHourClocks`, `packages/fiscal-verifactu/src/hour-clock.ts:63`, `AGREEMENT_MS` `:39`).
  The series is named from the box's minute, so a wrong clock could repeat a name.
- **Time service / synchronised**: the host's own internet time keeper (the NTP protocol) and the
  `NTPSynchronized` flag the host service reads (`deploy/box/waitron-box.sh:61-65,95`).
- **The restore's start**: the start after "Restore backup", which places the copy and names the
  series before the server itself starts (`runStagedRestore`, `apps/server/src/node-entry.ts:696`,
  before `startServer` at `:731`). No page from the restore is talking to it.
- **A device reading** (new): the time of a phone, computer or till tablet showing a page the box
  serves, measured exactly as the setup pages measure their browser today: a challenge that lives
  5 seconds, half the round trip as the uncertainty (`hour-setup-clock.ts:103-127`).

## What a person can do when this lands

- **PR 3 (lands first).** A restore whose start cannot confirm its time no longer fails towards the
  start-failure page: it waits, and the box's address shows a page saying why. Opening that address
  on any phone, computer or till tablet on the venue's network gives the box that device's time; if
  it agrees, the restore finishes within a minute. The page that pressed "Restore backup" does the
  same by itself while it stays open.
- **PR 4.** Nothing asks AEAT's web server for the time any more. A box whose time service is
  synchronised names its series with no other clock, and a device whose time disagrees with it does
  not hold it up. Otherwise the page's device (never the box's own screen) is the second clock, as
  today.

**Order: PR 3, then PR 4, after A1420 PRs 5-6 (#2964, #3003) as A1506 orders them.** Each leaves
main working alone. PR 3 adds a second clock (devices) and the wait while AEAT is still asked.
PR 4 removes AEAT; landed first, it would send a restore at a venue that blocks the time protocol
but lets web traffic out (R4 in the A1420 plan: a real case) to the start-failure page, which today
passes on AEAT.

## Receipts

**S1. Every caller of the series check and its second clocks.** `compare` always adds AEAT's
reading (`hour-setup-clock.ts:46,128`); a browser on the box's own screen does not count
(`:106-107`, `same_machine`).

| Caller | Who is there | Second clocks today | After PR 4 |
| --- | --- | --- | --- |
| First setup page (`initial-hour-setup.ts:223-246` → `hour-preparation.ts:173-184`) | the person setting up; another device needs the setup password (`setup/first-hour.ts:65-66`) | page's browser, AEAT | browser, time service |
| First setup command (`initial-hour-setup.ts:93-115`, `browser: null`; `packages/provisioning/src/first-setup-command.ts:28`, `onBox: true`) | an operator at a terminal (`docs/operations/first-live-fiscal-setup.md:224-245`) | AEAT only | time service only |
| Restore page (`hosted-hour-recovery.ts:110-128`) | holder of the backup's recovery source (`apps/server/src/setup-recovery-preparation-api.ts:212-245`) | browser, AEAT | browser, time service |
| **Restore's start** (`hosted-hour-recovery.ts:140-150`: `compare(…, null, { onBox: true })`, reached through `recovery-preparation.ts:248-257` and `recovery-entry.ts:79`); also the restore command (`restore-command.ts:393`) | nobody | AEAT only | time service, and from PR 3 a device reading |
| Promotion: the handover page (`apps/setup/src/screens/handover-screen.ts:198-235` → `handover-preparation.ts:146-170`) | a person signed in with `node.manage` | browser, AEAT | browser, time service |
| Conflict switch (dashboard, `packages/fiscal-verifactu/src/dashboard/conflict-recovery.ts:278-300`) | an administrator | browser, AEAT | browser, time service |

The older `/management-api/promote/preparation` route (`promote-api.ts:126`) has no client in this
repository: `git grep -n "management-api/promote"` finds only the server's route and
`read-only-exemptions.ts:50,57`. **So no promotion runs without a page.** The only series check with
nobody present is the restore's start (and the restore command).

**S2. The stack.** `hour-clock-internet.ts` survives A1420 PR 6: `git diff --stat
f46da9fc0e..d6a5e273fc` on the stack deletes `authority-time.ts` (105 lines) and leaves
`hour-clock-internet.ts`, `hour-setup-clock.ts`, `node-entry.ts`, `box-host-client.ts` and the
recovery files unchanged; `hour-setup-clock.ts:10,46` still imports and calls it (stack).
`clock-service-reading.ts` on main shares one time-service reading a minute
(`sharedClockServiceReading`); the stack adds `answersSynchronised` and `clockServiceSynchronised`
(`clock-service-reading.ts:19-33`, stack), which count a host that does not answer as not
synchronised.

**S3. The time service can be read at the restore's start.** `boxHostClient()` needs only the socket
`/run/waitron-box/box.sock` (`box-host-client.ts:43`), which compose mounts into the app container
(`deploy/compose.yml:52`); every failure answers `available: false`, never a throw (`:12-15`).
Nothing in it needs the started server. Setup mode has no boot reading; #3025 builds a
`boxHostClient()` there already (its plan §1).

**S4. A refused restore keeps its staged request, and the same process can place it on a second
try (RUN).** `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/server exec vitest run src/hour-recovery-placement-3.test.ts -t "fresh-box Cloud restore
refused at placement"` → `Tests 1 passed | 31 skipped (32)`. The case calls `runStagedRestore` twice
in one process: refused `second_clock_missing`, then placed.

**S5. Tills cannot reach the box during the restore's start.** Their routes come with `startServer`
(`node-entry.ts:731`), which runs after `runStagedRestore` (`:696`), and their device rows are in the
copy that is not placed yet.

**S6. What the start-failure page says today** for `sif.allocation_invalid`, by code alone: "It
checks its time against the internet first. Connect the box to the internet, then press “Retry a
normal boot”." (`apps/server/src/i18n/recovery-page.ts:298-311`), pinned by
`recovery-surface.test.ts:618-633`.

## Decisions

**D5′ (replaces D5). The second clocks.** The series check takes one of: **(1)** the time service
answering synchronised, read fresh through the host service at that comparison (at most 2 s,
`DEFAULT_STATUS_MS`), never the shared one-minute reading, so it never rests on a flag from before
a time-service step; **(2)** a device's time: the page's browser as today, or at the restore's start
the latest device reading from the waiting page (D-route). AEAT is never read.
`hour-clock-internet.ts` and its test are deleted. A synchronised answer becomes an observation of
source `internet` equal to the box's clock with no uncertainty, so `compareHourClocks` keeps judging;
the pages' "Internet" row then shows the box's time, which is internet time. **While that
observation is present, a device that disagrees does not refuse** (owner rule 1, 2026-11-11: "we
trust NTP over everything else. If we're synced with NTP and the till has a bad time, then we
should fix that on the till, not on our server"). The owner's 2026-11-07 10:52 alert for a
synchronised box that a comparison clock disagrees with stays unbuilt, as D5 already read it and the
watcher confirmed.

**D-host.** `ModuleOperationHost` (`packages/module/src/operation-preparation.ts:30`) gains two
optional members: `startClockReading?()` (PR 3, only the restore's start supplies it) and
`timeServiceSynchronised?(): Promise<boolean>` (PR 4; absent answers false). Its builders, by
`git grep -n "createModuleOperationHost("`: `node-operation-preparation.ts:143` (boot passes its
`boxHost`, `boot.ts:2502`), `recovery-preparation.ts:229` (`boxHostClient()`), and provisioning's
`first-setup-runtime.ts:95`, which the server feeds from `module-operation-host.ts:37` and the
command from `bin.ts:63`. The command runs on the host (`first-live-fiscal-setup.md:236-240`), so
it reads `timedatectl show -p NTPSynchronized --value`, the host service's own read; on a machine
without `timedatectl` it is not synchronised.

**D-wait (replaces D7's scope; D7's source stands).** At the restore's start, every refusal a right
clock would clear waits, uncounted: `second_clock_missing`, `clock_disagreement`,
`clock_unconfirmed`, `clock_stale`, `clock_corrected` and `minute_not_later` (`hour-clock.ts:137-142`,
`hour-setup-clock.ts:77-79`, `hour-selection.ts:412,443`). The owner's words cover "no internet
clock answered" (D7). The rest are added because the start-failure page can offer nothing for them
that the wait does not: a disagreeing device or a slow clock is cleared by the time service or an
agreeing device. **The retry runs in the same process**, a loop in `runEntry` around
`runStagedRestore`, not an exit for Docker to restart: a device reading is measured on this
process's steady clock and counts for 30 seconds (`hour-clock.ts:85-88`). S4 shows a second try in
one process places the copy. Each try writes its attempt as today (`node-entry.ts:653-655`); the
wait takes it back with `withoutAttempt`, as a start refused by a live holder does (`:785`). So a
power cut during a wait is not counted, and one during a try is. One log line per wait,
`server.start_waiting_for_clock` with the reason; nothing goes to the start-failure log.

**D-route: how a person gets past the wait with no page open (the watcher's ask).**

- **(a) Chosen: the waiting page takes the device's time.** While the restore waits, the box's
  address serves a page (the waiting app, from A1420's Task 14) whose small inline script sends this
  device's time every 15 seconds: a challenge, then the device's `Date.now()`, measured by the same
  code as `compare`. A page on the box's own screen does not count (`requestFromBox`). The page shows
  both times and what to do. It sets nothing. The app stays up during each try and closes only when
  placement succeeds, before `startServer` binds the port, so the reading is at most about 15 s old
  when the try reads it. An agreeing reading starts the next try at once. A till tablet's browser
  counts like any other: that is the watcher's "a till's time confirms it". The setup app's done
  screen, still open after "Restore backup", sends the same readings by itself.
- **(b) Not chosen: tills' own clock reports.** No till can reach the box then, and their device
  rows are not placed yet (S5).
- **(c) Not chosen: the till app sending readings by itself when it sees the wait.** It needs no
  person, but one device's clock would then name the series with nobody looking at the two times.
  Today the series check's device is always a page a person is looking at. The watcher can flip
  this.

**D6′. The start-failure page's cause.** D6's only cause, `clock_moved`, came from AEAT's
`clock-corrected` reason. Under D-wait that refusal waits instead, so no clock reason reaches the
page from a restore's start, and Task 16 is not built. What can still reach it for this code is a
fault (`history_invalid`, `event_mismatch`, a `minute_in_use` with no wait, read in
`clock-wait.ts:142-154`), so the code-only words change to a fault's (see "Words"), and the comment
at `recovery-surface.test.ts:540-542` changes with them.

**The watcher's example: a standby promoted at 23:00 behind a firewall that blocks NTP.** Today the
person opens the spare's handover page on a phone and signs in. The phone's time and AEAT's (if web
traffic leaves) are the second clocks. After PR 4: the phone's time alone. If the spare's clock is
more than 30 s out, the page shows both times, and with #3025 "This device" sets it under the same
sign-in; then the series is named. On the spare's own screen the page says it does not count
(today's `onBox` line) and to use another phone or laptop. After promotion, A1420's start check holds
payments until two tills or handhelds agree within 5 s or a person confirms (D1). So the example
always has a page; the case with no page is the restore's start, which D-route covers.

**Meeting #3025 (A1482, open).** It adds "This device" to the same clock step, through a new
`setBoxClock` member on the same host (its plan §1). Whichever lands second: (1) merges the
`ModuleOperationHost` members; (2) keeps both refusal lines, though after PR 4 its `synchronised`
line is reached only if the box synchronises between a comparison and the press, since D5′ shows no
step for a synchronised box; (3) its `witnessed` line goes with #3003, as its finish note says. The
waiting page offers no set (Q2).

## Questions for the watcher (cases the rules leave open)

**Q1. Who may give the restore's waiting page a device reading?** **Recommended: anyone on the
venue's network, with no sign-in.** No account can be checked before placement: the people are in
the copy not yet placed. The setup password does not exist at a restore (#3025's plan §1: on the
restore page "nobody signs in"). Asking for the recovery key again is a second entry of the one
secret recovery may ask for (owner, 2026-09-23). A reading sets nothing, and a device whose own
clock is right cannot agree with a wrong box. The risk: a script on the venue's network that echoes
the box's own time back (the challenge carries it, as on the setup pages today) lets a wrong clock
name a series. A name already in the history the box reads is still never taken. Alternative: the
recovery key, as the restore page asks a second device today (`recovery-hour.ts:70-71`): about 40
more lines, and a till tablet then cannot do it.

**Q2. Should the waiting page also set the box's clock from the device when the two differ (#3025's
"This device")?** **Recommended: not in this plan.** The restore page compared the clocks moments
before "Restore backup", and #3025 lets it set them there. So the box is wrong at its start only
after a power cut long enough to stop its clock (a flat clock battery, A1420 R1) between that press
and the restart, with internet time blocked. Today that case also ends on the start-failure page
("connect the box to the internet"). The page says to allow internet time. Who may set the clock
from an unsigned page is the same question as Q1, with more at stake.

**Choices made without a question** (the watcher may flip each): D-wait's extra reasons; D5′'s fresh
read per comparison; D5′'s "a synchronised box overrules a disagreeing device"; D-host's
`timedatectl` for the command; D6′ dropping Task 16; D-route (c) not chosen.

## Words (English and Spanish change together)

Waiting page (PR 3; "box" in English, "servidor" in Spanish, as the setup pages):

| Key | EN | ES |
| --- | --- | --- |
| title | The box is restoring your backup and is waiting to confirm its time. | El servidor está restaurando tu copia y espera a confirmar su hora. |
| why | So that no invoice series is ever repeated, it makes its new series only once its time is confirmed. It carries on by itself as soon as it can check its time over the internet, or when the time of a phone, computer or till showing this page agrees with it. | Para que ninguna serie de facturas se repita, solo crea sus nuevas series cuando su hora está confirmada. Sigue solo en cuanto pueda comprobar su hora por internet, o cuando la hora de un móvil, ordenador o caja que muestre esta página coincida con la suya. |
| agrees | This device's time agrees with the box's. Keep this page open; the restore carries on within a minute. | La hora de este dispositivo coincide con la del servidor. Deja esta página abierta; la restauración sigue en menos de un minuto. |
| differs | This device's time and the box's differ by more than 30 seconds. If this device's time is wrong, correct it in its settings; this page checks again by itself. If the box's time is wrong, allow internet time (the NTP time protocol) on the venue's network; the box then corrects its clock and carries on. | La hora de este dispositivo y la del servidor se diferencian en más de 30 segundos. Si la de este dispositivo está mal, corrígela en sus ajustes; esta página vuelve a comprobarla sola. Si la del servidor está mal, permite la hora de internet (el protocolo de hora NTP) en la red del local; el servidor corrige su reloj y sigue. |
| on box | This screen is on the box itself, so its time does not count. Open this page on a phone, computer or till on the venue's network. | Esta pantalla está en el propio servidor, así que su hora no cuenta. Abre esta página en un móvil, ordenador o caja de la red del local. |

Start-failure page, `sif.allocation_invalid` action (PR 3): "Press “Retry a normal boot”. If the box
stops here again, this is a fault in Waitron." / "Pulsa «Reintentar un arranque normal». Si el
equipo vuelve a pararse aquí, es un fallo de Waitron." (title unchanged).

PR 4, setup pages (`setup/clock-wait.ts:55-56,78-79`, `first-hour.ts:65-67,85-87`,
`recovery-hour.ts:70-73,98-101,414-418`): `whySecondClock` becomes "So no invoice series is ever
repeated, the box's time is compared with another device's, unless the box keeps its time over the
internet." / "Para que ninguna serie de facturas se repita, la hora del servidor se compara con la
de otro aparato, salvo que el servidor se ponga en hora por internet." In each `secondClockDo`,
"Connect the box to the internet" becomes "Let the box keep its time over the internet" /
"Conecta el servidor a internet" becomes "Deja que el servidor se ponga en hora por internet". In
each `secondClockEnds`, "once the box reaches the internet" becomes "once the box keeps its time
over the internet" / "cuando el servidor tenga internet" becomes "cuando el servidor se ponga en hora
por internet". The command's line (`initial-hour-setup.ts:110`, English only) becomes "Let the box
keep its time over the internet, or set up from a phone or laptop on the venue's network."

## PR 3 — a restore's start waits for its time, and any device on the network can confirm it

Files across the tasks: `packages/module/src/operation-preparation.ts`,
`packages/fiscal-verifactu/src/hour-setup-clock.ts`, `hosted-hour-recovery.ts`; `apps/server/src/`
`node-entry.ts`, `recovery-entry.ts`, `recovery-preparation.ts`, new `start-clock-waiting.ts`,
`errors.ts` (`server.waiting_for_clock: {}`), `i18n/recovery-page.ts`; `apps/setup/src/screens/
done-screen.ts`, `i18n/strings/finish.ts`.

### Task 14a: the module takes a device reading at the restore's start (fiscal-verifactu, module)

- [ ] Move `compare`'s browser measuring (`hour-setup-clock.ts:103-127`) into an exported
  `measureDeviceReading(issued, instantMs, received, onBox)`; `compare` calls it. The existing
  `hour-setup-clock.test.ts` cases pass unedited (the control that nothing changed).
- [ ] Add `startClockReading?()` to `ModuleOperationHost`, with one comment: only the restore's
  start supplies it. `resume` (`hosted-hour-recovery.ts:147`) passes its answer as the browser
  observation instead of `null`.
- [ ] Tests first (`hosted-hour-recovery.test.ts`, through `configure!(host).resumeRecovery` then
  `prepare`, as the existing cases do): AEAT unavailable and a fresh agreeing reading → admitted;
  the same reading 31 s old → `second_clock_missing` (control); a reading marked on the box →
  `second_clock_missing`; no member → today's refusal (existing cases unedited).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
  src/hosted-hour-recovery.test.ts src/hour-setup-clock.test.ts src/hour-clock.test.ts`, then
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.

### Task 14b: the waiting app (apps/server)

- [ ] Tests first (`start-clock-waiting.test.ts`): `GET /` (HTML) → 503, `Retry-After: 60`, the
  words in English, and in Spanish with `Accept-Language: es`. `GET /setup-api/status` → 503
  `server.waiting_for_clock`. `POST /restore-clock/challenge` then `/restore-clock/reading` within
  5 s → the reading is kept and the answer says whether it agrees; past 5 s → not kept (control);
  from the box (`requestFromBox` stubbed true) → not kept and the "on box" words. Render the page to
  a file and open it in the workspace's Playwright Chromium in both themes and at phone width
  (§4: a string-rendered page has no other check).
- [ ] Implement: a Hono app, words in `i18n/recovery-page.ts`'s style, the script inline as
  `carry-on.ts:149-164` does, the reading through `measureDeviceReading`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-waiting.test.ts`, `pnpm exec
  vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

### Task 14c: the restore's start loops while it waits (apps/server)

- [ ] Tests first (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake
  timers; end point: `runEntry` settled). (1) Three `second_clock_missing` refusals, then success →
  `recovery.json`'s count after equals the count before, the start-failure log has the same length,
  three `server.start_waiting_for_clock` lines, and the waiting app was closed before `startServer`.
  Control (forced effect): `history_invalid` → the count rises by one and the log grows. (2) Each
  reason in D-wait waits (one table-driven case). (3) A kept reading wakes the next try before 60 s;
  without one the next try is at 60 000 ms and not before. (4) The host handed to the module
  answers the waiting app's latest reading (`restore-request.test.ts`); the page runner's host has
  no `startClockReading` (`createInteractiveRecoveryPreparation`).
- [ ] Implement in `runEntry` (`node-entry.ts:693-760`) and pass the reading through
  `recovery-entry.ts:57` → `recovery-preparation.ts:229`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/restore-request.test.ts
  src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`.

### Task 15: the done screen says what the box waits for, and sends its time

- [ ] Test first: a poll answered 503 `server.waiting_for_clock` shows the waiting line under the
  restarting line and sends one reading; a following poll that cannot connect keeps the line; a
  404 (trading) shows "ready" and drops it; a 503 with any other code sends nothing (control).
- [ ] `memory_pressure | grep free` first, then `pnpm --filter @waitron/setup exec vitest run
  src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts`.

### Task 16′: words and documents

- [ ] The start-failure words (Words), `recovery-surface.test.ts:618-633` and its comment at
  `:540-542`. Docs: `docs/operations/hour-recovery.md:233-245` (the restore's start now waits; the
  page and the device), `apps/server/src/guide/{en,es}/backup-recovery.md` (one paragraph each),
  and `docs/developers/conventions-data.md` beside `:4166-4168` (one paragraph: the restore's start
  waits uncounted and takes a device reading). No §5 change: "another machine's clock agrees
  within 30 seconds" already covers a device.
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts
  src/guide-content.test.ts`, `pnpm exec vitest run scripts/guide-links.test.ts
  scripts/claude-md-pointers.test.ts`.

## PR 4 — the time service replaces AEAT in the series check

### Task 11′: the series check reads the time service (fiscal-verifactu)

- [ ] New `hour-clock-time-service.ts`: `observeTimeServiceHourClock(read, deps)` times the read on
  the wall and steady clocks and answers a usable `internet` observation at the box's time when
  `read()` is true, else `unavailable` `not_synchronised`. `createSetupHourClock` takes
  `timeService` in place of `internet` (`hour-setup-clock.ts:17,46`). Delete `hour-clock-internet.ts`
  and `hour-clock-internet.test.ts` (#3003 has already deleted its other importer, S2).
- [ ] `compareHourClocks`: no `disagreement` while a usable `internet` observation is present.
- [ ] Tests first: `hour-clock.test.ts`, a synchronised observation and a browser 5 minutes out →
  `canSelectHour` true; the same browser without it → `clock_disagreement` (control).
  `hour-setup-clock.test.ts`: `timeService` answering false or absent and no browser →
  `second_clock_missing`; answering true → admitted; nothing in the package imports `node:https`
  for the clock (`git grep -n "node:https" packages/fiscal-verifactu/src` prints nothing).
- [ ] The two fiscal-verifactu commands of Task 14a.

### Task 12′: every host supplies the time service (module contract, server, provisioning)

- [ ] Add `timeServiceSynchronised?()` to `ModuleOperationHost`; `hostedHourPreparation` and
  `hostedHourRecovery` hand it to `createSetupHourClock`. Wire D-host's builders with the stack's
  `clockServiceSynchronised`; `bin.ts` with `timedatectl`.
- [ ] Tests first: `module-operation-host.test.ts` (the setup host answers the fake host's flag);
  `restore-request.test.ts` (the start's host and the page's both read it); a provisioning case
  where the command's reader answers true and the series is named with no browser, with a false
  reader as control (`first-setup-command.test.ts`).
- [ ] `pnpm exec vitest run scripts/module-seams.test.ts`, the named suites, then the fiscal core
  command.

### Task 13′: move the test stubs (setup only)

- [ ] Every file `git grep -l "hour-clock-internet" -- '*.ts'` lists besides the deleted pair
  (62 at `c92d69ee86`) stubs the new module instead: the path and the export name change, and the
  stub's observation stays. Run the fiscal-verifactu, provisioning and composition files locally,
  and the server files in groups sized to free memory. CI runs the rest. Any assertion that has to
  change is a STOP unless "Changed test checks" lists it.

### Task 13b′: words, rules and documents

- [ ] The setup words and the command's line (Words); C4 below; `docs/operations/
  first-live-fiscal-setup.md:18-21,96-99,243-245` and `hour-recovery.md:124-126,189-191,233-245`;
  `conventions-data.md:4166-4168`.
- [ ] `memory_pressure | grep free`, then `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/setup/clock-wait.browser.test.ts src/setup/first-hour.browser.test.ts
  src/setup/recovery-hour.browser.test.ts`, and `scripts/english-only.test.ts`,
  `scripts/claude-md-pointers.test.ts`.

## Sentences changed, word for word

**C4′ (replaces C4), PR 4, root `CLAUDE.md` §5.** Replace

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock
> agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box
> reads is not taken.

with

> Setup/restore/promotion use five symbols for the box's UTC minute, after the box's internet time
> service says it is synchronised or the clock of a device showing the box's page (never the box's
> own screen) agrees within 30 seconds (no confirmation); AEAT's time is not read for it (owner,
> 2026-11-10, A1420 Q1: "Yes, time service stands in"; 2026-11-11: "Instead we rely on NTP"); a
> minute whose name is already in a history the box reads is not taken.

and add `hour-setup-clock` to that rule's guard list ("hour-selection/hour-clock/hour-setup-clock/
minute-selection-unknown-name suites").

**#3003's sentence.** It adds "**Waitron never reads AEAT's time except to warn of drift from its
filing replies**" (stack `CLAUDE.md:976-977`, commit `1df81689fa`), and its title says it stops
asking the tax agency for the time. The series check still asks until this PR 4 (S2). Recommended:
#3003 adds ", and in the series check until A1420 PR 4 lands", and PR 4 deletes that clause.

## Changed test checks (assertions the spec changes)

- PR 3: `recovery-surface.test.ts:618-633` ("names a refused series in both languages") asserts the
  new words (S6).
- PR 4: `hour-clock-internet.test.ts` is deleted (the behaviour goes). Word assertions follow
  "Words" in the files `git grep -l "Connect the box to the internet\|Conecta el servidor a
  internet\|the internet's" -- '*.test.ts'` lists besides `recovery-surface.test.ts`:
  `initial-hour-setup.test.ts`, `minute-selection-unknown-name.test.ts`,
  `setup/clock-wait.browser.test.ts`, `setup/first-hour.browser.test.ts`,
  `setup/recovery-hour.browser.test.ts`, and provisioning's `cli-first-setup.test.ts`,
  `cli-owned-entry.test.ts`, `cli-same-hour-entry.test.ts`, `first-setup-command.test.ts`. A stub's
  AEAT reason (`"tls"`, `"network"`, `"offline"`) becomes `not_synchronised` where a case reads it
  back. Task 13′'s stub moves are setup only.

## On the test box (Task 19's "PRs 3-4" step, replaced)

**PR 3:** block UDP 123 and TCP 443 outbound (`nft`, as Task 19 step 2). Stage a restore from the
setup page on a laptop, then close that page. **Expect** the box's address to show the waiting page,
`failures` in `recovery.json` unchanged over five minutes, one `server.start_waiting_for_clock` a
minute, and the start-failure log the same size (`wc -c` before and after). Open the address on a
till tablet's browser at the true time. **Expect** the restore to finish within a minute of that,
then payments to wait for A1420's start check. Report both times from the log.

**PR 4:** (1) TCP 443 blocked, UDP 123 open: a restore with no page open finishes with no wait.
(2) The watcher's example: UDP 123 blocked; at 23:00 promote the spare from its handover page on a
phone. **Expect** the series named with the phone's time; on the spare's own screen, the line that
it does not count. (3) UDP 123 open and a laptop's clock 2 minutes wrong: first setup from the
laptop names the series with no clock question.

## Size (estimates; production and tests apart)

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **3** wait and device reading (Tasks 14a-c, 15, 16′) | about +255 / −10 (14a: 30; 14b: 110 with words; 14c: 70; 15: 25; 16′: 20) | about +320 | +35 / −15 |
| **4** time service in, AEAT out (Tasks 11′-13b′) | about +105 / −165 (the deleted file is 159 lines) | about +120 / −401; about 125 lines changed across 62 stub files | +25 / −20 |

Against A1420's rows (PR 3: +60 production, +90 tests; PR 4: +170, +210): PR 3 grows by the
device reading, its page and the loop. PR 4 removes more than it adds. Task 13′ is mechanical but
touches many slow server suites; it is its own implementer task.

## What becomes of A1420's Tasks 11-16

| Task | Now |
| --- | --- |
| 11 (synchronised option on the comparison; `internet` param on the refusal) | replaced by 11′; no `internet` param |
| 12 (`startClock.synchronised` on the host) | replaced by 12′ (`timeServiceSynchronised`) and 14a (`startClockReading`) |
| 14 (wait on `network`/`timeout` only, exit and restart) | replaced by 14b-c: every D-wait reason, in-process, plus device readings |
| 15 (done screen line) | kept, plus sending readings |
| 16 (`lastErrorCause` `clock_moved`) | dropped (D6′); the code-only words change instead |
