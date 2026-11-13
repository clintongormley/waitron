# A1420 PRs 3 and 4, revised: the series check stops asking AEAT for the time — plan revision

> **For agentic workers:** this replaces the "PR 3" and "PR 4" sections of
> `docs/superpowers/plans/2026-11-09-a1420-start-clock-corrects-itself.md` (revision 5), with its
> D5, D6's cause, D7's scope, R2's third bullet, C4, Task 19's "PRs 3-4" step and the size rows for
> PRs 3 and 4. It also amends one of that plan's "Global constraints" (below). Everything else in
> that plan stands. Implementers are dispatched as `subagent_type: "implementer"`. Fiscal clock
> rule: full review path, two Codex run-it reviews per PR, and the owner lands each PR.

**Status: draft 2, 2026-11-13.** Draft 1 (`c2134422e7`) had one fresh-context read (five Important,
nine Minor findings, all taken here). Needs the watcher's clearance. Base: main `c92d69ee86`. The
clock code it builds on is stacked, unpushed, at `feat/a1506-2-till-time-wrong` (`d6a5e273fc`); a
line number marked "stack" is on that commit. Every receipt is read, not run, unless it says RUN.

**UNVERIFIED (no approval recorded): this plan's own choices** — the unsigned device reading (Q1),
which refusals wait (D-wait), the waiting page (D-route), and dropping Task 16 (D6′). They stand
until the watcher clears or flips them.

**Amended constraint.** The A1420 plan's "The series check is untouched except for Q1. No device,
till or administrator confirmation is ever read by it (R5)" now reads: **"The series check changes
only as `2026-11-13-a1420-restore-series-check.md` says: it reads the time service and a device's
time measured on a page the box serves, never AEAT, and never a stored confirmation (the start
check's devices, tills or administrators)."**

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
  start-failure page: it waits. Every page of the box's usual address (the one the tills use) then
  shows a waiting page saying why. Opening it on any phone, computer or till tablet on the venue's
  network gives the box that device's time; if it agrees, the restore carries on by itself. The
  setup page that pressed "Restore backup" opens the waiting page by itself if it is still open.
- **PR 4.** Nothing asks AEAT's web server for the time any more. A box whose time service is
  synchronised names its series with no other clock, and a device whose time disagrees with it does
  not hold it up. Otherwise the page's device (never the box's own screen) is the second clock, as
  today.

**Order: PR 3, then PR 4, after A1420 PRs 5-6 (#2964, #3003) and A1506 PR 2, as A1506 orders
them.** Both PRs use `clockServiceSynchronised` (`clock-service-reading.ts:25-33`, stack), which
A1506 PR 2 adds (`cff47bdf73`). Each leaves main working alone. PR 3 adds a second clock (devices)
and the wait while AEAT is still asked. PR 4 removes AEAT; landed first, it would send a restore at
a venue that blocks the time protocol but lets web traffic out (R4 in the A1420 plan: a real case)
to the start-failure page, which today passes on AEAT.

## Receipts

**S1. Every caller of the series check and its second clocks.** `compare` always adds AEAT's
reading (`hour-setup-clock.ts:46,128`); a browser on the box's own screen does not count
(`:106-107`, `same_machine`).

| Caller | Who is there | Second clocks today | After PR 4 |
| --- | --- | --- | --- |
| First setup page (`initial-hour-setup.ts:223-246` → `hour-preparation.ts:173-184`) | the person setting up; another device needs the setup password (`setup/first-hour.ts:65-66`) | page's browser, AEAT | browser, time service |
| First setup command (`initial-hour-setup.ts:93-115`, `browser: null`; `packages/provisioning/src/first-setup-command.ts:28`, `onBox: true`) | an operator at a terminal (`docs/operations/first-live-fiscal-setup.md:224-245`) | AEAT only | time service only |
| Restore page (`hosted-hour-recovery.ts:110-128`) | holder of the backup's recovery source (`apps/server/src/setup-recovery-preparation-api.ts:212-245`) | browser, AEAT | browser, time service |
| **Restore's start** (`hosted-hour-recovery.ts:140-150`: `compare(…, null, { onBox: true })`, reached through `recovery-preparation.ts:248-257` and `recovery-entry.ts:79`) | nobody | AEAT only | time service, and from PR 3 a device reading |
| Restore command (`restore-command.ts:393` → `recovery-entry.ts` → `resumeRecovery`, run with `docker compose run`, `deploy/README.md:616-681`) | an operator at a terminal; no waiting page | AEAT only | time service only |
| Promotion: the handover page (`apps/setup/src/screens/handover-screen.ts:198-235` → `handover-preparation.ts:146-170`) | a person signed in with `node.manage` | browser, AEAT | browser, time service |
| Conflict switch (dashboard, `packages/fiscal-verifactu/src/dashboard/conflict-recovery.ts:278-300`) | an administrator | browser, AEAT | browser, time service |

The older `/management-api/promote/preparation` route (`promote-api.ts:126`) has no client in this
repository: `git grep -n "management-api/promote"` finds only the server's route and
`read-only-exemptions.ts:50,57`. **So no promotion runs without a page.** The series checks with
nobody at a page are the restore's start and the two commands.

**S2. The stack.** `hour-clock-internet.ts` survives A1420 PR 6: `git diff --stat
f46da9fc0e..d6a5e273fc` on the stack deletes `authority-time.ts` (105 lines) and leaves
`hour-clock-internet.ts`, `hour-setup-clock.ts`, `node-entry.ts`, `box-host-client.ts` and the
recovery files unchanged; `hour-setup-clock.ts:10,46` still imports and calls it (stack).
`clock-service-reading.ts` on main shares one time-service reading a minute
(`sharedClockServiceReading`); A1506 PR 2 adds `answersSynchronised` (`e00b54d62c`) and
`clockServiceSynchronised` (`cff47bdf73`), which count a host that does not answer as not
synchronised.

**S3. The time service can be read at the restore's start and by the restore command.**
`boxHostClient()` needs only the socket `/run/waitron-box/box.sock` (`box-host-client.ts:43`),
which compose mounts into the app service (`deploy/compose.yml:52`), so `docker compose run app`
gets it too; every failure answers `available: false`, never a throw (`:12-15`). Nothing in it
needs the started server. Setup mode has no boot reading; #3025 builds a `boxHostClient()` there
already (its plan §1).

**S4. A refused restore keeps its staged request, and the same process can place it on a second
try (RUN).** `env -u AI_AGENT -u CLAUDECODE TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/server exec vitest run src/hour-recovery-placement-3.test.ts -t "fresh-box Cloud restore
refused at placement"` → `Tests 1 passed | 31 skipped (32)`. The case calls `runStagedRestore` twice
in one process: refused `second_clock_missing`, then placed.

**S5. Each try repeats the copy's checks.** `runHeld` copies and validates the staged copy before
placement on every call: for a bucket copy `copyFile`, `validateDatabaseEntries` and
`writeStagedNodeCopy` (`restore-request.ts:536-542`) and a second `copyFile` (`:584`); for an archive
`validateArtifactFile` (`:549-553`). So a try is not cheap.

**S6. Tills can reach the waiting page but the box cannot authenticate them.** It is served on the
box's usual address and port. But their device rows are in the copy that is not placed yet, and
their clock reports travel with equipment reads that need that row (A1420 R11).

**S7. Server code cannot import the fiscal module.** `scripts/module-seams.test.ts:31` lists
`@waitron/fiscal-verifactu` among the regime packages that generic code must not import, and
`git grep -n 'from "@waitron/fiscal-verifactu' -- 'apps/server/src/*.ts'` finds no production
import. Both sides already import the contract package `@waitron/module` (`apps/server/src/alerts.ts`,
`packages/fiscal-verifactu/src/alerts.ts`).

**S8. What the start-failure page says today** for `sif.allocation_invalid`, by code alone: "It
checks its time against the internet first. Connect the box to the internet, then press “Retry a
normal boot”." (`apps/server/src/i18n/recovery-page.ts:298-311`), pinned by
`recovery-surface.test.ts:618-633`. The page also offers a restore (`recoveryApp({ restore })`,
`node-entry.ts:607-614`). A stored pick whose minute is now in use refuses on every try
(`hour-selection.ts:410-411`). The restore page already tells a person in that case to "Reload this
page and start the restore again: a new restore creates new invoice series"
(`setup/recovery-hour.ts:52,79`).

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
`timeServiceSynchronised?(): Promise<boolean>` (PR 4; absent answers false). The device reading's
shape, its measuring (moved out of `hour-setup-clock.ts:103-127`) and the 30-second figure
(`AGREEMENT_MS`, moved out of `hour-clock.ts:39`) live in `@waitron/module`, so the waiting app
and the fiscal module use one copy of each (S7). `compareHourClocks` stays the judge. The host's
builders, by `git grep -n "createModuleOperationHost("`: `node-operation-preparation.ts:143` (boot
passes its `boxHost`, `boot.ts:2502`), `recovery-preparation.ts:229` (`boxHostClient()`), and
provisioning's `first-setup-runtime.ts:95`, which the server feeds from `module-operation-host.ts:37`
and the setup command from `bin.ts:63`. The setup command runs on the host
(`first-live-fiscal-setup.md:236-240`), so it reads `timedatectl show -p NTPSynchronized --value`,
the host service's own read. On a machine without `timedatectl` it is not synchronised.

**D-wait (replaces D7's scope; D7's source stands). UNVERIFIED.** At the restore's start, three
refusals wait, uncounted. Each is cleared by an event at the venue:

| Reason | Venue event that clears it |
| --- | --- |
| `second_clock_missing` | the time service synchronises once the venue's network lets internet time through (from PR 4); a phone, computer or till tablet opens the waiting page; until PR 4, AEAT answering |
| `clock_disagreement` | a device whose time agrees opens the page, or the differing device's time is corrected; from PR 4, the time service synchronising |
| `clock_corrected` (the clock was stepped during the try, `hour-setup-clock.ts:78-79`) | the step itself, usually the time service synchronising; the next try sees no step |

`clock_stale`, `clock_unconfirmed` and `minute_not_later` count as failures, as today. A stale
reading happens inside one try. `clock_unconfirmed` (`hour-clock.ts:137-139`) also stands for a
bundle with no release stamp, which refuses on every try (`hour-release.ts:9-29`,
`hour-clock.ts:125-129`). `minute_not_later` at the naming range's end (`hour-selection.ts:443`)
never clears. At `:412` (the clock reads earlier than the stored pick) it would clear with time,
but the start-failure page's words send the person to a new restore instead (D6′). The owner's
words cover "no internet clock answered" (D7). The other two are added because the start-failure
page can offer nothing for them that the wait does not.

**The retry runs in the same process**, a loop in `runEntry` around `runStagedRestore`, not an exit
for Docker to restart: a device reading is measured on this process's steady clock and counts for
30 seconds (`hour-clock.ts:85-88`). S4 shows a second try in one process places the copy. **A try is
not cheap (S5), so the loop tries again only for a reason.** Every 15 seconds it looks for one: a
device reading from the last 30 seconds that agrees with the box, or (PR 4) the time service
answering synchronised. It tries at most once a minute. PR 3 also keeps a try every 60 seconds with
no reason, because only a try can tell whether AEAT answers now; PR 4 deletes that blind retry with
AEAT. So from PR 4 a recovered time service is seen within about 15 s, and a venue whose network
blocks internet time for a night makes no try at all until someone opens the page.

Each try writes its attempt as today (`node-entry.ts:653-655`); the wait takes it back with
`withoutAttempt`, as a start refused by a live holder does (`:785`). So a power cut during a wait is
not counted, and one during a try is. One log line per wait, `server.start_waiting_for_clock` with
the reason; nothing goes to the start-failure log.

**D-route: how a person gets past the wait with no page open (the watcher's ask). UNVERIFIED.**

- **(a) Chosen: the waiting page takes the device's time.** While the restore waits, the waiting
  app (from A1420's Task 14) answers **every** HTML page request on the box's usual address with the
  waiting page, and every `/api/*` request with 503 `server.waiting_for_clock`. So whatever address a
  person knows for the box, the dashboard's, a till's or setup's, shows the page. Its small inline
  script sends this device's time every 15 seconds: a challenge, then the device's `Date.now()`,
  measured by the shared measuring (D-host). A page on the box's own screen does not count
  (`requestFromBox`). The page shows both times and what to do. It sets nothing. The app stays up
  during each try and closes only when placement succeeds, before `startServer` binds the port. A
  till tablet's browser counts like any other: that is the watcher's "a till's time confirms it".
  The setup app's done screen, still open after "Restore backup", loads the waiting page when it
  sees `server.waiting_for_clock`, so the waiting page is the one sender.
- **(b) Not chosen: tills' own clock reports.** Tills can reach the waiting app, but the box cannot
  authenticate them before the copy is placed (S6).
- **(c) Not chosen: the till app sending readings by itself when it sees the wait.** It needs no
  person, but one device's clock would then name the series with nobody looking at the two times.
  Today the series check's device is always a page a person is looking at. The watcher can flip
  this.

**D6′. The start-failure page's cause. UNVERIFIED.** D6's only cause, `clock_moved`, came from
AEAT's `clock-corrected` reason. Under D-wait that refusal waits instead, and Task 16 is not built.
For `sif.allocation_invalid` after a restore, the page's code-only words point to its own restore
(S8), because a retry repeats a refusal of a stored pick (`minute_in_use`, `minute_not_later`). A
new restore picks again (see "Words"). The comment at `recovery-surface.test.ts:540-542` changes
with them.

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

**Q1. Who may give the restore's waiting page a device reading? UNVERIFIED.** **Recommended: anyone
on the venue's network, with no sign-in.** No account can be checked before placement: the people
are in the copy not yet placed. The setup password does not exist at a restore (#3025's plan §1: on
the restore page "nobody signs in"). Asking for the recovery key again is a second entry of the one
secret recovery may ask for (owner, 2026-09-23). A reading sets nothing, and a device whose own
clock is right cannot agree with a wrong box.

- **Bounds on unsigned requests.** The app keeps at most 64 open challenges, oldest dropped, as
  `hour-setup-clock.ts:35-58` bounds its sessions, and one latest reading.
- **Echoing the box's time.** A challenge answers only its id, not the box's time; the box's time
  is shown only in a reading's answer. A script on the network can still read it from one answer
  and send it back on the next, so a wrong clock could name a series; a name already in the history
  the box reads is still never taken.
- **Which device to bring.** At a venue that blocks internet time, a tablet on the venue's Wi-Fi
  alone keeps its time through the same blocked protocol, so it may have drifted as the box has. A
  phone that takes its time from its mobile network is the dependable device (reasoned, not
  measured).
- **A person who wants to stop waiting** can open the page on such a phone, or let internet time
  through on the venue's network. This plan gives no way out of the wait from the page: power-cycling
  the box starts the same wait again (D-wait takes the attempt back), so the start-failure page,
  with its restore, never comes.
- **Alternative:** the recovery key, as the restore page asks a second device today
  (`recovery-hour.ts:70-71`): about 40 more lines, and a till tablet then cannot do it.

**Q2. Should the waiting page also set the box's clock from the device when the two differ (#3025's
"This device")?** **Recommended: not in this plan**, with the cost stated. The restore page compared
the clocks moments before "Restore backup", and #3025 lets it set them there. So the box is wrong at
its start only after a power cut long enough to stop its clock (a flat clock battery, A1420 R1)
between that press and the restart, with internet time blocked. In that case "allow internet time
on the venue's network" is then the only way forward. That step may need whoever runs the network,
which sits badly with the rule that a refusal never sends the person to somebody else (root
`CLAUDE.md` §3). Today that case also ends on the start-failure page ("connect the box to the
internet"). Against: the owner's words on #2808: "if somebody has confirmed the time on their
device, then we trust that time and move forward" (lane B's queue, A1506). Who may set the clock
from an unsigned page is Q1's question with more at stake.

**Choices made without a question** (the watcher may flip each): D-wait's reasons; D5′'s fresh read
per comparison; D5′'s "a synchronised box overrules a disagreeing device"; D-host's `timedatectl`
for the setup command; D6′ dropping Task 16; D-route (c) not chosen.

## Words (English and Spanish change together)

Waiting page (PR 3). Tills show it, and tills say "server", so English says "server" here, and
Spanish "servidor" as the setup pages do:

| Key | EN | ES |
| --- | --- | --- |
| title | The server is restoring your backup and is waiting to confirm its time. | El servidor está restaurando tu copia y espera a confirmar su hora. |
| why | So that no invoice series is ever repeated, it makes its new series only once its time is confirmed. It carries on by itself as soon as it can check its time over the internet, or when the time of a phone, computer or till showing this page agrees with it. | Para que ninguna serie de facturas se repita, solo crea sus nuevas series cuando su hora está confirmada. Sigue solo en cuanto pueda comprobar su hora por internet, o cuando la hora de un móvil, ordenador o caja que muestre esta página coincida con la suya. |
| agrees | This device's time agrees with the server's. Keep this page open; the restore carries on by itself. | La hora de este dispositivo coincide con la del servidor. Deja esta página abierta; la restauración sigue sola. |
| differs | This device's time and the server's differ by more than 30 seconds. If this device's time is wrong, correct it in its settings; this page checks again by itself. If the server's time is wrong, allow internet time (the NTP time protocol) on the venue's network; the server then corrects its clock and carries on. | La hora de este dispositivo y la del servidor se diferencian en más de 30 segundos. Si la de este dispositivo está mal, corrígela en sus ajustes; esta página vuelve a comprobarla sola. Si la del servidor está mal, permite la hora de internet (el protocolo de hora NTP) en la red del local; el servidor corrige su reloj y sigue. |
| on box | This screen is on the server itself, so its time does not count. Open this page on a phone, computer or till on the venue's network. | Esta pantalla está en el propio servidor, así que su hora no cuenta. Abre esta página en un móvil, ordenador o caja de la red del local. |

Start-failure page, `sif.allocation_invalid` action (PR 3; title unchanged): "Restore the backup
again from this page: a new restore chooses new invoice series." / "Vuelve a restaurar la copia
desde esta página: una restauración nueva elige series de facturas nuevas."

PR 4, setup pages (`setup/clock-wait.ts:55-56,78-79`, `first-hour.ts:65-67,85-87`,
`recovery-hour.ts:70-73,98-101,414-418`): `whySecondClock` becomes "So no invoice series is ever
repeated, the box's time is compared with another device's, unless the box keeps its time over the
internet." / "Para que ninguna serie de facturas se repita, la hora del servidor se compara con la
de otro aparato, salvo que el servidor se ponga en hora por internet." In each `secondClockDo`,
"Connect the box to the internet" becomes "Let the box keep its time over the internet" /
"Conecta el servidor a internet" becomes "Deja que el servidor se ponga en hora por internet". In
each `secondClockEnds`, "once the box reaches the internet" becomes "once the box keeps its time
over the internet" / "cuando el servidor tenga internet" becomes "cuando el servidor se ponga en hora
por internet". Command lines (English only): the setup command's (`initial-hour-setup.ts:110`)
becomes "Let the box keep its time over the internet, or set up from a phone or laptop on the
venue's network."; the restore command prints, for a `sif.allocation_invalid` clock refusal, "The
box could not confirm its time, so it made no invoice series. Let the box keep its time over the
internet, or restore from the restore page on a phone or laptop on the venue's network."

## PR 3 — a restore's start waits for its time, and any device on the network can confirm it

Files across the tasks: `packages/module/src/` (reading shape, measuring, `AGREEMENT_MS`),
`packages/fiscal-verifactu/src/hour-setup-clock.ts`, `hour-clock.ts`, `hosted-hour-recovery.ts`;
`apps/server/src/` `node-entry.ts`, `recovery-entry.ts`, `recovery-preparation.ts`, new
`start-clock-waiting.ts`, `errors.ts` (`server.waiting_for_clock: {}`), `i18n/recovery-page.ts`;
`apps/setup/src/screens/done-screen.ts`.

### Task 14a: the module takes a device reading at the restore's start (module, fiscal-verifactu)

- [ ] Move `compare`'s browser measuring (`hour-setup-clock.ts:103-127`) into an exported
  `measureDeviceReading(issued, instantMs, received, onBox)` in `@waitron/module`, and
  `AGREEMENT_MS` beside it; `compare` and `compareHourClocks` import them. The existing
  `hour-setup-clock.test.ts` and `hour-clock.test.ts` cases pass unedited (the control that nothing
  changed).
- [ ] `compare` gains an optional fifth argument, `measured`: a reading already measured by the
  host. When `browser` is `null` and `measured` is given, it becomes the `browser` observation as
  it stands: usable, or `unavailable` `same_machine` when the reading was taken on the box's own
  screen. The challenge branch (`:106-127`) is skipped. `resume` (`hosted-hour-recovery.ts:147`)
  passes `host.startClockReading?.() ?? null` there. Its `{ onBox: true }` has no effect while
  `browser` is `null` (`:106`), so the box-screen judgement comes from the waiting app's
  `requestFromBox`, carried in the reading.
- [ ] Add `startClockReading?()` to `ModuleOperationHost`, with one comment: only the restore's
  start supplies it.
- [ ] Tests first (`hosted-hour-recovery.test.ts`, through `configure!(host).resumeRecovery` then
  `prepare`, as the existing cases do): AEAT unavailable and a fresh agreeing reading → admitted;
  the same reading 31 s old → `second_clock_missing` (control); a reading marked on the box →
  `second_clock_missing`; no member → today's refusal (existing cases unedited).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node
  src/hosted-hour-recovery.test.ts src/hour-setup-clock.test.ts src/hour-clock.test.ts`, then
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`.

### Task 14b: the waiting app (apps/server)

- [ ] Tests first (`start-clock-waiting.test.ts`): `GET /`, `GET /manage` and `GET /till/anything`
  with `Accept: text/html` → 503, `Retry-After: 60`, the waiting page in English, and in Spanish
  with `Accept-Language: es`. `GET /api/device/equipment` and `GET /setup-api/status` → 503
  `{ error: { code: "server.waiting_for_clock" } }`. `POST /restore-clock/challenge` answers an id
  and no box time. Its `/restore-clock/reading` within 5 s → the reading is kept, and the answer
  says whether it agrees and shows both times; past 5 s → not kept (control). From the box
  (`requestFromBox` stubbed true) → kept as on the box, with the "on box" words. A 65th challenge
  drops the first. Render the page to a file and open it in the workspace's Playwright Chromium in
  both themes and at phone width (§4: a string-rendered page has no other check).
- [ ] Implement: a Hono app, words in `i18n/recovery-page.ts`'s style, the script inline as
  `carry-on.ts:149-164` does, the reading through `measureDeviceReading`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/start-clock-waiting.test.ts`, `pnpm exec
  vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts
  scripts/module-seams.test.ts`.

### Task 14c: the restore's start waits and tries again only for a reason (apps/server)

- [ ] Tests first (`node-entry.test.ts`, a `runStagedRestore` stub, a fake `serveRecovery`, fake
  timers; end point: `runEntry` settled).
  1. Three `second_clock_missing` refusals, then success → `recovery.json`'s count after equals the
     count before, the start-failure log has the same length, three `server.start_waiting_for_clock`
     lines, and the waiting app was closed before `startServer`. Control (forced effect):
     `history_invalid` → the count rises by one and the log grows.
  2. Each D-wait reason waits; `clock_stale`, `clock_unconfirmed` and `minute_not_later` count
     (one table-driven case, the counted rows as controls).
  3. With no reading, the stub is called again at 60 000 ms and not before (PR 3's blind retry). An
     agreeing reading kept at 20 s calls it at the next 15-second look. A second agreeing reading
     10 s after a try does not call it before a minute has passed since that try. A disagreeing
     reading calls nothing (control for "only for a reason").
  4. The host handed to the module answers the waiting app's latest reading
     (`restore-request.test.ts`); the page runner's host has no `startClockReading`
     (`createInteractiveRecoveryPreparation`).
- [ ] Implement in `runEntry` (`node-entry.ts:693-760`) and pass the reading through
  `recovery-entry.ts:57` → `recovery-preparation.ts:229`.
- [ ] `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/restore-request.test.ts
  src/hour-recovery-placement-2.test.ts src/hour-recovery-placement-3.test.ts`.

### Task 15: the done screen hands over to the waiting page

- [ ] Test first: a poll answered 503 `server.waiting_for_clock` calls the screen's injected
  `navigate("/")` once; a 503 with any other code does not (control); a following poll that cannot
  connect changes nothing; a 404 (trading) shows "ready" as today.
- [ ] `memory_pressure | grep free` first, then `pnpm --filter @waitron/setup exec vitest run
  src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts`.

### Task 16′: words and documents

- [ ] The start-failure words (Words), `recovery-surface.test.ts:618-633` and its comment at
  `:540-542`. Docs: `docs/operations/hour-recovery.md:233-245` (the restore's start now waits; the
  page and the device), `apps/server/src/guide/{en,es}/backup-recovery.md` (one paragraph each),
  and `docs/developers/conventions-data.md` beside `:4166-4168` (one paragraph: the restore's start
  waits uncounted, tries again only for a reason, and takes a device reading). No §5 change:
  "another machine's clock agrees within 30 seconds" already covers a device.
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
  `second_clock_missing`; answering true → admitted. Afterwards `git grep -n
  "hour-clock-internet\|observeInternetHourClock\|authenticatedHourHead" -- '*.ts'` prints nothing.
- [ ] The two fiscal-verifactu commands of Task 14a.

### Task 12′: every host supplies the time service (module contract, server, provisioning)

- [ ] Add `timeServiceSynchronised?()` to `ModuleOperationHost`; `hostedHourPreparation` and
  `hostedHourRecovery` hand it to `createSetupHourClock`. Wire D-host's builders with
  `clockServiceSynchronised`; `bin.ts` with `timedatectl`. In `runEntry`'s wait, replace the blind
  60-second retry with a look at the time service every 15 seconds.
- [ ] The restore command's line (Words), and the same sentence in `deploy/README.md`'s restore
  command section (`:616-681`).
- [ ] Tests first: `module-operation-host.test.ts` (the setup host answers the fake host's flag);
  `restore-request.test.ts` (the start's host and the page's both read it); `node-entry.test.ts`
  (synchronised at a 15-second look → the stub is called; never synchronised and no reading → not
  called over ten minutes, the control for the blind retry's removal); `restore-command.test.ts`
  (a clock refusal prints the line; another refusal prints today's); a provisioning case where the
  setup command's reader answers true and the series is named with no browser, with a false reader
  as control (`first-setup-command.test.ts`).
- [ ] `pnpm exec vitest run scripts/module-seams.test.ts`, the named suites, then the fiscal core
  command.

### Task 13′: move the test stubs (setup only)

- [ ] Every file `git grep -l "hour-clock-internet" -- '*.ts'` lists besides the deleted pair
  (62 at `c92d69ee86`) stubs the new module instead: the path and the export name change, and the
  stub's observation stays. Run the fiscal-verifactu, provisioning and composition files locally,
  and the server files in groups sized to free memory. CI runs the rest. Any assertion that has to
  change is a STOP unless "Changed test checks" lists it.

### Task 13b′: words, rules and documents

- [ ] The setup words and the setup command's line (Words); C4′ and the #3003 clause below;
  `docs/operations/first-live-fiscal-setup.md:18-21,96-99,243-245` and
  `hour-recovery.md:124-126,189-191,233-245`; `conventions-data.md:4166-4168`.
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

**#3003's clause, deleted by PR 4.** #3003 now says (commit `92c95072d4`, in root `CLAUDE.md` §5
and `docs/developers/conventions-data.md`): "**Waitron never reads AEAT's time except to warn of
drift from its filing replies and, until A1420 PR 4 lands, in the series check at setup, restore and
promotion (`hour-clock-internet.ts`)**". PR 4 deletes " and, until A1420 PR 4 lands, in the series
check at setup, restore and promotion (`hour-clock-internet.ts`)" in both files, leaving
"**Waitron never reads AEAT's time except to warn of drift from its filing replies**".

## Changed test checks (assertions the spec changes)

- PR 3: `recovery-surface.test.ts:618-633` ("names a refused series in both languages") asserts the
  new words (S8).
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
setup page on a laptop, then close that page. **Expect** the box's usual address, at any page, to
show the waiting page; `failures` in `recovery.json` unchanged over five minutes; one
`server.start_waiting_for_clock` a minute; and the start-failure log the same size (`wc -c` before
and after). Open the address on a till tablet's browser at the true time. **Expect** the restore to
finish by itself, then payments to wait for A1420's start check. Report, from the log, the time
from opening the page to placement.

**PR 4:** (1) TCP 443 blocked, UDP 123 open: a restore with no page open finishes with no wait.
(2) UDP 123 blocked, no page open for ten minutes: **expect** no try in the log after the first;
then unblock UDP 123 and report the time to placement. (3) The watcher's example: UDP 123 blocked;
at 23:00 promote the spare from its handover page on a phone. **Expect** the series named with the
phone's time; on the spare's own screen, the line that it does not count. (4) UDP 123 open and a
laptop's clock 2 minutes wrong: first setup from the laptop names the series with no clock question.

## Size (estimates; production and tests apart)

| PR | Production | Tests | Docs |
| --- | --- | --- | --- |
| **3** wait and device reading (Tasks 14a-c, 15, 16′) | about +275 / −15 (14a: 40; 14b: 120 with words; 14c: 85; 15: 10; 16′: 20) | about +350 | +35 / −15 |
| **4** time service in, AEAT out (Tasks 11′-13b′) | about +120 / −175 (the deleted file is 159 lines) | about +150 / −401; about 125 lines changed across 62 stub files | +30 / −20 |

Against A1420's rows (PR 3: +60 production, +90 tests; PR 4: +170, +210): PR 3 grows by the
device reading, its page and the loop. PR 4 removes more than it adds. Task 13′ is mechanical but
touches many slow server suites; it is its own implementer task.

## What becomes of A1420's Tasks 11-16

| Task | Now |
| --- | --- |
| 11 (synchronised option on the comparison; `internet` param on the refusal) | replaced by 11′; no `internet` param |
| 12 (`startClock.synchronised` on the host) | replaced by 12′ (`timeServiceSynchronised`) and 14a (`startClockReading`) |
| 14 (wait on `network`/`timeout` only, exit and restart) | replaced by 14b-c: D-wait's reasons, in-process, tries only for a reason, plus device readings |
| 15 (done screen line) | replaced: the done screen loads the waiting page |
| 16 (`lastErrorCause` `clock_moved`) | dropped (D6′); the code-only words change instead |
