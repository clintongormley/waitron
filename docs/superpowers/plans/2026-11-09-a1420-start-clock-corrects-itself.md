# A1420: a start whose clock is out puts it right and carries on — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`. Keep the ledger `docs/handoffs/2026-11-09-a1420-start-clock.md` current at the end of every task.

**What a person can do when this lands.** A restore finishes by itself when the box restarts to place it, in the cases that today leave the box on the start-failure page:

- The box's clock is more than 30 seconds from the tax agency's (AEAT's) time and the box's own time service is not keeping it right: the box sets its clock to AEAT's time, puts the usual "The box set its clock from the tax agency's time" alert in the dashboard bell and emails it, and finishes the restore.
- The box's time service says the clock is right but AEAT's time disagrees by more than 30 seconds: the box keeps its own time, finishes the restore, and alerts the administrators with both times.
- The box cannot get AEAT's time (it is offline, or AEAT is not answering): the box waits and tries again once a minute by itself, for as long as it takes. Those tries never count towards the three failed starts that bring up the start-failure page. Meanwhile the setup page and the box's own address say what the box is waiting for.
- Only when the clock cannot be set, or cannot be checked, does the start-failure page show, and then it says which of the two happened and what to press.

**Goal:** item A1420 in one PR, test first. **Base:** main `4bf305cd51` **plus PR #2532** (`fix/a1385-series-name-leftovers`, head `57c96e4b59`), which must land first: it adds the start-failure page's words for `sif.allocation_invalid` that this plan builds on. Line numbers below are on main `4bf305cd51` unless a line says "#2532"; match by name when a line has moved.

**Review weight: FULL.** Risk triggers: the clock check in front of invoice-series naming (a fiscal invariant) and a cross-package contract (`ModuleOperationHost`). Its plan gets a fresh-context review before any implementer is dispatched; `/finish-branch` runs the Codex run-it seat twice (the second sets this checklist aside). The PR **waits for the owner** to land it.

**Tech stack:** TypeScript; Vitest node tests (`--project node` in `packages/fiscal-verifactu`); `apps/setup` tests in real Chromium; `node:sqlite` venue databases through `useVenueDb`; the box's host service (`deploy/box/waitron-box.sh`) through `apps/server/src/box-host-client.ts`.

## Words used in this plan

- **AEAT's time**: the `Date` header of a web reply from AEAT's servers, read over a checked HTTPS connection. The start reads it from AEAT's filing address; the running server's clock watch reads it from AEAT's QR-check address (finding F2).
- **Host service**: the small program on the box's own system, outside Waitron's container, that can set the clock (`deploy/box/waitron-box.sh`). Waitron asks it over a socket.
- **Synchronised**: what the box's time service (systemd's `timedatectl`, field `NTPSynchronized`) says when it is keeping the clock right over the internet.
- **Seat**: a function the app hands a module so the module can ask the app for something without knowing how the app does it.
- **The count**: the number of failed starts in a row, kept in `recovery.json`; at three the box shows the start-failure page.

## Global constraints

- **No table, column, index, trigger, migration or schema-file change** (A1308 hold). Nothing under `packages/*/src/schema/`, a `drizzle` folder, `migrations.manifest.json` or a migration set. If a step seems to need one, stop and report.
- **`hour-selection.ts` is not edited.** What the box chooses, records and refuses once the clock check has answered stays exactly as today. The change is in what the clock check answers at the start (Tasks 1, 2, 4).
- **The fiscal core is untouched**: `computeHuella`, the chain, invoice numbering, `registros_facturacion` and its triggers, `allocation.ts`, `confirmClockStep`, the clock-behind stop. After every task that touches `packages/fiscal-verifactu`, these pass **unedited**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/write-path.e2e.test.ts inmutabilidad`
- **Only the start that places a staged restore changes.** The setup page, the restore page, promotion and the running server's clock watch behave as today; the new seat is handed to the module only by the start (Task 6).
- **A test that has to be edited to pass is a STOP** unless "Changed test checks" lists it. Commit what passes and report.
- **User-visible words** are only those in "Words". English and Spanish change together; the person has no terminal and nobody else to ask (root `CLAUDE.md` §3).
- **No code or test for an event that cannot happen at a venue** (owner, 2026-11-08). Each branch below names the real situation that reaches it.
- Tests run with `AI_AGENT` and `CLAUDECODE` unset when output matters; server tests with `TESTCONTAINERS_RYUK_DISABLED=true`. Read the `Tests` count, never a pipe's exit status. Browser runs (`apps/setup`): check `memory_pressure | grep free` first.
- Every commit `git commit -s`, message in plain English. Every task ends with `pnpm format:check` and `pnpm exec eslint <changed files>`.

## What is true today (receipts)

**F1. Which start makes a series, which function compares the clocks, and what it raises.** Only a start that places a staged restore. `runEntry` runs `runStagedRestore` (`apps/server/src/node-entry.ts:627`) before `startServer` (`:662`). When the staged request carries a recovery context and operation, `runHeld` builds the entry runner (`apps/server/src/restore-request.ts:566-605`), which asks for a refresh (`apps/server/src/recovery-entry.ts:79`, `runner(…, { refresh: true })`); before placement the runner calls the module's `resumeRecovery` (`apps/server/src/recovery-preparation.ts:256-263`), and that runner admits only the `restore` action (`:134`). In `fiscal-verifactu`, `resume` compares clocks with no browser, as the box (`packages/fiscal-verifactu/src/hosted-hour-recovery.ts:140-150`, `clocks.compare(…, null, { onBox: true })`), unless the activation already committed (`:146`). `compare` (`hour-setup-clock.ts:90-140`) takes AEAT's time and the box's, and `compareHourClocks` (`hour-clock.ts:63-135`) decides; the activation then refuses at `hour-selection.ts:401-402` with `clockRefusal` (`hour-clock.ts:137-142`):
- (a) no internet clock answered → `sif.allocation_invalid`, `reason: "second_clock_missing"`;
- (b) the box's clock more than 30 seconds out → `sif.allocation_invalid`, `reason: "clock_disagreement"`.
- Also: a box clock before this Waitron version's release, or outside the naming range, refuses `clock_unconfirmed` **before** either of those (`hour-clock.ts:138-139`).
Promotion and first setup make their series from a person's page request on a running box (`hosted-hour-recovery.ts:71-77`, the page's `compare-clocks` proposal at `:112-127`), not at a start. *Ran:* `pnpm --filter @waitron/server exec vitest run src/hour-recovery-placement-2.test.ts -t "refreshes again"` → `Tests 1 passed` (that case runs the real start chain with only the internet answer stubbed: refused `second_clock_missing`, then admitted once it answers). The promotion and first-setup paths: read, not run.

**F2. The 30 seconds is measured against AEAT's own web server, not an internet time server and not another machine.** At the start the browser reading is always "unavailable" (`hour-setup-clock.ts:106-127`: with `browser === null` it records `reason: "challenge"`), so the only second clock is `observeInternetHourClock` (`hour-clock-internet.ts:40-159`), which sends a `HEAD` to `SOAP_ENDPOINTS[environment]` (`:73`) and reads its `Date` header (`:106-139`). `SOAP_ENDPOINTS` is AEAT's Veri*Factu filing address (`@waitron/verifactu` 0.2.1, `dist/endpoints.js:2-5`). The line is `AGREEMENT_MS = 30_000` (`hour-clock.ts:39`, used at `:122-124`). *Ran* a throwaway probe (`packages/fiscal-verifactu/src/probe-a1420.test.ts`, deleted after; `git status --short` then printed nothing): it called `observeInternetHourClock` with a stub that recorded the host it was asked for, then ran `createSetupHourClock({ internet })` with AEAT's answer 29 s ahead, 31 s ahead and unavailable, as `resume` does. Stated beforehand: if the second clock were another server, the first two lines would name it; if the line were not 30 s, the 29 s and 31 s rows would agree. It printed (`Tests 1 passed`):

```
env=production asked=www1.agenciatributaria.gob.es result=usable
env=preproduction asked=prewww1.aeat.es result=usable
internet offset=29000 canSelect=true refusal=-
internet offset=31000 canSelect=false refusal=clock_disagreement
internet offset=null canSelect=false refusal=second_clock_missing
```

So the owner's "keep our synchronised time" case is "the box's time service says it is synchronised and AEAT's web server's clock disagrees by more than 30 seconds". The clock watch's AEAT reading is a different AEAT host, the QR-check page (`packages/fiscal-verifactu/src/authority-time.ts:40`, `QR_ENDPOINTS`).

**F3. How failed starts are counted.** Each start writes one failure into `recovery.json` before its first step (`node-entry.ts:584-586`), so a hang counts too; a start that fails keeps that failure and records the code (`failStart`, `:591-620`, `withFailureCode` at `:618`). At three in a row the box serves the start-failure page (`RECOVERY_AT = 3`, `apps/server/src/recovery-state.ts:41-45`; the page branch at `node-entry.ts:549-581`, whose "Retry a normal boot" clears the count and exits). One failure today is taken back: a start refused because a **live** process holds the venue folder (`recordRefusal`, `:703-722`, through `withoutAttempt`, `recovery-state.ts:207-216`). That is where "do not count this one" goes. The process then exits (`node-entry.ts:770`) and Docker starts it again (`restart: unless-stopped`, `deploy/compose.yml:12`). *Ran:* `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts -t "LIVE process holds|third failed boot|BEFORE the server starts"` → `Tests 3 passed`. The page picks its words by code alone (`apps/server/src/recovery-surface.ts:140-147`) and keeps only the code (`RecoveryState.lastErrorCode`, `recovery-state.ts:10-26`); on #2532 `sif.allocation_invalid` has one entry (#2532 `apps/server/src/i18n/recovery-page.ts:286-299`).

**F4. The automatic clock set that exists today, and why the start cannot call it as it is.** The running server's clock watch sets the clock from AEAT's time only during the clock-behind stop (`setFromAuthority`, `apps/server/src/clock-watch.ts:239-278`). It goes through `clockCorrection().set` (`apps/server/src/clock-correction.ts:239-352`), which refuses `not_stopped` unless a stop holds (`:221-229`, `:247-248`), refuses `synchronised` when the host says so (`:250-252`), asks the host (`:294`), verifies the step within `VERIFY_MS = 2_000` (`:20`, `:308-309`) and records it through the fiscal backend's `confirmClockStep`, which writes the `clock.corrected` alert (`packages/fiscal-verifactu/src/clock-step.ts:59-178`, `recordCorrected` in `clock-stop-incidents.ts:59-80`); the correction hands that alert to the email duty (`clock-correction.ts:195-200`; wired at `boot.ts:2294`; `clock.corrected` is in `INCIDENT_EMAIL_CODES`, `box-alert-email.ts:40-45`). The host refuses too: `clock.set` answers `synchronised` when `NTPSynchronized=yes` (`deploy/box/waitron-box.sh:118-120`). *Ran:* `pnpm exec vitest run scripts/waitron-box-sh.test.mjs -t "already keeps"` → `Tests 1 passed`. The correction is built inside `bootServer` (`boot.ts:2283-2297`) on the open venue database, after the start's placement; at the moment the start compares clocks the venue database is still being placed and no fiscal backend, stop or email duty exists. So the start needs its own small path to the host (Tasks 5-6) and hands the alert to the next boot (Task 7). The host's socket is mounted into the whole container (`deploy/compose.yml:40`), so the start can reach it. Read, not run: the boot ordering.

**F5. How the box learns "synchronised".** `clock.status` runs `timedatectl show -p NTP -p NTPSynchronized` (`waitron-box.sh:58-62`, `:90-105`) and answers `synchronised`; the client reads it (`box-host-client.ts:149-174`); the server caches it for a minute (`boot.ts:3061-3062`). The client needs nothing from the server: `boxHostClient()` defaults to `/run/waitron-box/box.sock` (`box-host-client.ts:42`, `:144-147`), so the start can ask at its clock check. A laptop or a box without the host service answers `available: false` (`:9-14`). *Ran:* `pnpm exec vitest run scripts/waitron-box-sh.test.mjs -t "synchronised"` → `Tests 2 passed` (the status answer, under stubs).

**F6. The sources root `CLAUDE.md` §5 allows.** "The box sets its clock only through the host service, from AEAT, a till's time … or an administrator's own device — never from devices alone and never while it keeps time over the internet — and every step it verifies, or sees move the clock by over a second, is alerted and emailed." This plan sets the clock only from AEAT's time (F2), only through the host service, never while synchronised (the host refuses, and the start does not ask: Task 4), and alerts and emails every step (Task 7). **No new source is needed.** The topic file's narrower sentence, "The box sets its clock only inside a stop it already has" (`docs/developers/conventions-data.md:4486-4488`), is a design limit of A798-B slice 9b, not a §5 rule; Task 11 widens it to name this start.

**F7. What a person sees during a restore's restart.** After the restore button, the setup app shows its done screen (`apps/setup/src/setup-app.ts:1753`, `:1844`), which asks `/setup-api/status` every 1.5 seconds and keeps saying "The server is restarting to finish setup." while the box does not answer or answers a 5xx (`apps/setup/src/screens/done-screen.ts:100-147`). Between the restart and `startServer`, nothing answers on the box's port (read: `serveRecovery`, `apps/server/src/recovery-listener.ts:107-195`, is started only for the page).

**F8. A new state file is not backed up unless listed.** Backups carry only the state files `RECOVERY_FILES` lists (`apps/server/src/state-secrets.ts:16`; checked at `archive-entries.ts:20`). Task 6's notes file stays out of it.

## Decisions

**D1. Where the decision is made: in the module's `resume`, through a new start-only seat.** The clock comparison and AEAT's time live in `fiscal-verifactu`; the host service lives in `apps/server`; generic code may not read the regime's internals (`scripts/module-seams.test.ts`). So `ModuleOperationHost` gains an optional `startClock` seat (Task 3), and only the start's runner supplies it (Task 6). With no seat, `resume` behaves exactly as today, so every page path and every existing test is unchanged.

**D2. The branches in `resume`, with the seat present.** After its comparison:

| What the comparison found | What `resume` does | Real situation that reaches it |
| --- | --- | --- |
| AEAT agrees within 30 s | nothing new | the normal case |
| AEAT unavailable (network, timeout, TLS, unusable reply) | throws `sif.allocation_invalid` `second_clock_missing`, now with `internet: <why>` | box offline; AEAT down for maintenance |
| AEAT's reading not usable because the box's clock moved while it was asked (`clock-corrected`, `hour-clock-internet.ts:126-134`) | throws `sif.allocation_invalid` `clock_corrected` | the time service steps the clock just after the box boots |
| AEAT disagrees by more than 30 s, host says synchronised | compares again with the synchronised flag (Tasks 1-2), so the selection admits; tells the seat `disagreed` with both times | the owner's "likely a bug with AEAT" case |
| AEAT disagrees, host says not synchronised | asks the seat to set the clock by AEAT's offset; on `set`, compares again with a fresh AEAT reading and carries on; otherwise throws `sif.allocation_invalid` `clock_not_set`, `setRefusal: "host_unavailable" \| "refused" \| "unverified"` | NTP blocked at the venue but HTTPS allowed, clock drifted; time service switched off; a box booted with a wrong battery clock before its time service synced |
| AEAT disagrees, host does not answer | throws `clock_not_set`, `setRefusal: "host_unavailable"` | a box set up before the host service existed (`deploy/README.md:210`); a laptop in development |

A box clock before the release or outside the naming range with AEAT answering is a disagreement too (AEAT's time is never within 30 s of such a reading), so it takes the "set" row; offline, it takes the `second_clock_missing` row (the seat path throws that before `clockRefusal`'s `clock_unconfirmed`), so it waits for AEAT rather than counting. A synchronised box whose clock is before the release is not handled: no real box is synchronised to a time before its own software was made.

**D3. Retry while AEAT cannot be reached: once a minute, never counted, bounded by a wait.** When a start fails with `sif.allocation_invalid` `second_clock_missing`, `runEntry` takes the start's failure back (`withoutAttempt`, as for a live holder), serves a waiting page for `START_CLOCK_RETRY_MS = 60_000`, closes it, and exits; Docker starts the box again and the next start tries the placement again (the staged request is kept: A1385's M1, pinned by #2532's `hour-recovery-placement-3.test.ts`). So a try happens at most once a minute plus the time the restore's own checks take, for as long as AEAT is out of reach; it never spins, and it never reaches the start-failure page by itself. What the person sees meanwhile: the setup page's done screen adds "The box is waiting for the tax agency's time…" under its restarting line (Task 9, from the waiting page's 503 answer), and anyone opening the box's address sees the waiting page (Words). Between two waits, while the next try runs, the box's port does not answer; the done screen keeps the waiting line through that (Task 9). Cost, stated: each try repeats the restore's archive checks; the lane measures one try's length on the test box (Task 12) and reports it.

**D4. The start's step and disagreement reach the bell and the mailbox through the next boot.** The start writes a note to `<state>/start-clock-notes.json` (atomic write, mode 0600). `bootServer`, once the venue database and the email duty exist and before the backup supervisor starts, records each note through a new fiscal backend seat and deletes the file: a step becomes the existing `clock.corrected` (source `authority`, so its existing words "The box set its clock from the tax agency's time…" are true) and is handed to the email duty; a disagreement becomes the new `clock.authority_disagreed`. Recording a step before backups run keeps the backup clock-step hold right (`latestClockStep`, `clock-step.ts:179-198`). A disagreement note replaces an earlier one; step notes accumulate (each step really happened). Limits, stated in the code at the reader: a crash between the commit and the file's deletion records the notes again on the next boot (each note carries an id that the recorder checks first, so it does not); a box that never boots again after a step (reset, reinstall) never shows its alert, and the step shows only in the host's journal line, as for a step whose row is pending today (`docs/developers/conventions-data.md`, "A step whose row cannot be written").

**D5. The start-failure page chooses words by code and cause** (owner, 2026-11-07, option (b) of A1385 Q2). `recovery.json` gains `lastErrorCause`, a member of a closed set, set by `failStart` from the error's code and params and kept by `readRecoveryState` only when it is a member (as `holderKind` is, `recovery-state.ts:101-104`). Causes: `clock_host_unavailable`, `clock_set_failed`, `clock_moved`. Any other `sif.allocation_invalid` reason keeps #2532's words, which stay the fallback for `second_clock_missing` too (reached only if taking the failure back fails).

**D6. The disagreement alert is a bell alert for `system.manage`, not emailed** (Q1's default). It is a one-off record with `boxAt`, `authorityAt` and `differenceMs`, worded from the box's side (Words).

**D7. Requester the host logs:** `{"source":"authority","start":"restore"}`, so the host journal tells a start's set from the watch's.

## Owner questions

**Q1. Should the "AEAT disagreed with a synchronised clock" alert also be emailed?** Example: a box restores on Monday at 10:00; its time service says it is right, AEAT's server says 10:01:10; the box keeps 10:00, finishes, and puts an alert in the bell. *Recommended default (built):* bell only — you said "alert the admin", and nothing has gone wrong that needs action. *Alternative:* email it as well, like the clock-step alert; about 30 more lines (Spanish and English email words, `INCIDENT_EMAIL_CODES`).

## Words

| Where | English | Spanish |
| --- | --- | --- |
| Start-failure page, cause `clock_host_unavailable` — title | The box could not set its clock. | El equipo no pudo poner su reloj en hora. |
| Same — action | Its clock is more than 30 seconds from the tax agency's time, and the part of the box that sets the clock did not answer. Restart the box, then press “Retry a normal boot”. | Su reloj se aparta más de 30 segundos de la hora de Hacienda, y la parte del equipo que pone el reloj en hora no respondió. Reinicia el equipo y pulsa «Reintentar un arranque normal». |
| Start-failure page, cause `clock_set_failed` — title | The box could not set its clock. | El equipo no pudo poner su reloj en hora. |
| Same — action | Its clock is more than 30 seconds from the tax agency's time. The box asked to set it to that time, but the change did not take. Press “Retry a normal boot” to try again. | Su reloj se aparta más de 30 segundos de la hora de Hacienda. El equipo pidió ponerlo en esa hora, pero el cambio no se aplicó. Pulsa «Reintentar un arranque normal» para intentarlo de nuevo. |
| Start-failure page, cause `clock_moved` — title | The box could not check its clock. | El equipo no pudo comprobar su reloj. |
| Same — action | Its clock changed while the box was comparing it with the tax agency's time. Press “Retry a normal boot” to check again. | Su reloj cambió mientras el equipo lo comparaba con la hora de Hacienda. Pulsa «Reintentar un arranque normal» para comprobarlo de nuevo. |
| Waiting page (box's address while AEAT is out of reach) — title | The box is waiting for the tax agency's time. | El equipo está esperando la hora de Hacienda. |
| Same — body | It needs that time to finish the restore and could not get it. It tries again every minute by itself. If the box is not connected to the internet, connect it. | La necesita para terminar la restauración y no ha podido obtenerla. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Setup done screen, under "The server is restarting to finish setup." (`done.waiting_internet_clock`, new key) | The box is waiting for the tax agency's time to finish the restore. It tries again every minute by itself. If the box is not connected to the internet, connect it. | El equipo está esperando la hora de Hacienda para terminar la restauración. Lo vuelve a intentar solo cada minuto. Si el equipo no está conectado a internet, conéctalo. |
| Bell alert `clock.authority_disagreed` (`apps/dashboard/src/i18n/alert-messages.ts`) | When the box started, its clock ({boxAt:minute}) and the tax agency's time ({authorityAt:minute}) were {differenceMs:duration} apart. The box's time service says its clock is right, so the box kept it and carried on. Check the box's date and time on the Box status page. | Al arrancar, el reloj del equipo ({boxAt:minute}) y la hora de Hacienda ({authorityAt:minute}) se diferenciaban en {differenceMs:duration}. El servicio de hora del equipo indica que su reloj está bien, así que el equipo lo mantuvo y siguió. Comprueba la fecha y la hora del equipo en Estado del equipo. |
| Bell alert and email after a start's step | unchanged `clock.corrected` words: "The box set its clock from the tax agency's time: {direction} {stepMs}, from {before} to {after}." (and its `unverified` variant) | unchanged |
| Guide, replacing #2532's sentence after "If the clock check refuses, resolve its cause and try again." (`apps/server/src/guide/en/backup-recovery.md`, `es/…`) | If the box cannot get the tax agency's time when it restarts to finish the restore, it tries again every minute by itself; connect it to the internet if it is not. If it then shows a page saying it could not set or check its clock, do what that page says. | Si al reiniciarse para terminar la restauración el equipo no puede obtener la hora de Hacienda, lo vuelve a intentar solo cada minuto; conéctalo a internet si no lo está. Si después muestra una página que dice que no pudo poner en hora o comprobar su reloj, haz lo que indica esa página. |

The `{differenceMs:duration}` and `{…:minute}` placeholders are the alert formatter's existing ones (`clock.corrected` uses `{stepMs:duration}`); Task 7 checks the minute placeholder needs no offset parameter, as `clock.disagrees` uses none.

## Root `CLAUDE.md` §5, word for word (Task 11)

Replace (lines 927-929):

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation); a minute whose name is already in a history the box reads is not taken.

with:

> Setup/restore/promotion use five symbols for the box's UTC minute, after another machine's clock agrees within 30 seconds (no confirmation), except that the start placing a restore keeps the clock of a box whose time service says it is synchronised when AEAT's disagrees, and alerts the administrators; a minute whose name is already in a history the box reads is not taken.

And in the clock-setting entry's guard list (line 913-915), after `scripts/waitron-box-sh.test.mjs`, add `` `apps/server/src/start-clock.test.ts` `` (the start's set, under a stand-in host). The rule sentence itself does not change (F6).

## Tasks

Each task is test first: write the test, run it and watch it fail for the reason stated, then the smallest change that passes. Commands are run from the worktree root.

### Task 1: the clock comparison can trust a synchronised box (fiscal-verifactu)

Files: `packages/fiscal-verifactu/src/hour-clock.ts`, `hour-clock.test.ts`.

- [ ] Test: `compareHourClocks(observations, release, { boxSynchronised: true })` with AEAT 31 s ahead → `disagreement: true`, new field `boxTrusted: true`, `canSelectHour` true. Same without the option → `canSelectHour` false, `clockRefusal` `clock_disagreement` (the existing cases at `hour-clock.test.ts:40-98` stay unedited). With the option but AEAT unavailable → `canSelectHour` false, `second_clock_missing` (synchronised never stands in for a second clock). Fails today: no option, no field.
- [ ] Implement: an optional third parameter; `boxTrusted = boxSynchronised === true && secondClock && disagreement`; `canSelectHour` admits `disagreement` only when `boxTrusted`; the release and range checks are unchanged.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-clock.test.ts`, then the fiscal core command (Global constraints).

### Task 2: a reading made with the flag keeps it (fiscal-verifactu)

Files: `hour-setup-clock.ts`, `hour-setup-clock.test.ts`.

- [ ] Test: `compare(key, env, null, { onBox: true, boxSynchronised: true })` with AEAT 31 s ahead, then `read(key)` → `canSelectHour` true; the same reading without the flag → `clock_disagreement`; a page-style compare (`onBox: false`, a browser sample) ignores nothing new. Also: `compare` answers `measuredAt` (`wallMs`, `monoMs`) of its box sample, which Task 4 needs. Fails today.
- [ ] Implement: `SetupClockClient` gains `boxSynchronised?: boolean`; `Reading` stores it; `compare` and `current` pass it to `compareHourClocks`.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hour-setup-clock.test.ts`, then the fiscal core command.

### Task 3: the start-clock seat in the module contract

Files: `packages/module/src/operation-preparation.ts` (type), `packages/provisioning/src/first-setup-runtime.ts` (`createModuleOperationHost` passes it through), `packages/provisioning/src/recovery-preparation-host.test.ts` or `apps/server/src/module-operation-host.test.ts` (whichever already pins the host's fields).

- [ ] Test: a host built with `startClock` carries it; one built without has no such key. Fails today.
- [ ] Implement, with one comment at the type saying only the start that places a staged restore supplies it:
  ```ts
  startClock?: {
    status(): Promise<{ synchronised: boolean } | null>; // null: the host service did not answer
    set(input: { offsetMs: number }): Promise<{ set: true } | { set: false; reason: "host_unavailable" | "refused" | "unverified" | "stale" }>;
    disagreed(note: { boxAt: string; authorityAt: string; differenceMs: number }): Promise<void>;
  };
  ```
- [ ] `pnpm --filter @waitron/provisioning exec vitest run src/recovery-preparation-host.test.ts` (or the server file), `pnpm --filter @waitron/module exec tsc --noEmit`, `pnpm exec vitest run scripts/module-seams.test.ts`.

### Task 4: the hour module's `resume` uses the seat (fiscal-verifactu)

Files: `hosted-hour-recovery.ts`, `hosted-hour-recovery.test.ts`; the reason literal `clock_not_set` and the param `setRefusal`/`internet` on `sif.allocation_invalid` in `packages/fiscal-verifactu/src/errors.ts` (the params type is `reason: string`, `errors.ts:64-67`; add the two optional params).

- [ ] Tests, each with a fake seat and a stubbed AEAT answer, through `FISCAL_OPERATIONS.configure!(host).resumeRecovery` then `prepare` as the existing cases do:
  1. AEAT 5 min ahead, `status` → `{ synchronised: false }`, `set` → `{ set: true }` and the stub's next answer agrees → `set` called once with `offsetMs` within 1 s of 300 000; `prepare` admits.
  2. AEAT 31 s ahead, `status` → `{ synchronised: true }` → `set` never called; `disagreed` called once with `boxAt`, `authorityAt` 31 s apart and `differenceMs` ≈ 31 000; `prepare` admits.
  3. AEAT 5 min ahead, `status` → `null` → throws `clock_not_set`, `setRefusal: "host_unavailable"`; `set` never called.
  4. `set` → `{ set: false, reason: "refused" }` → throws `clock_not_set`, `setRefusal: "refused"`. Same for `unverified`. `stale` → throws `clock_corrected`.
  5. AEAT unavailable `network` → throws `second_clock_missing` with `internet: "network"`; the seat is never asked. AEAT unavailable `clock-corrected` → throws `clock_corrected`.
  6. Set, then the fresh AEAT reading still disagrees → throws `clock_not_set`, `setRefusal: "unverified"`.
  7. No seat → today's refusals (the existing cases stay unedited; add none).
  Each fails today (no seat).
- [ ] Implement in `resume` only; the page proposals (`recovery`) do not read the seat.
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/hosted-hour-recovery.test.ts src/hour-resumption.test.ts src/hour-selection.test.ts`, then the fiscal core command.

### Task 5: one way to step the clock through the host (apps/server, a move)

Files: new `apps/server/src/clock-host-step.ts` and `clock-host-step.test.ts`; `clock-correction.ts`.

- [ ] Test the new helper `stepClockThroughHost({ host, offsetMs, requester, wall, monotonic, boot })` → `{ verified, moved, stepMs, before, after, targetMs, answer }`: a host that lands within 2 s → verified; one that refuses with the clock unmoved → not moved; one that throws → treated as `lost` (as `clock-correction.ts:295-299`). Fails today (no file).
- [ ] Move lines `clock-correction.ts:285-311` into it and call it from `setInTurn`. `pnpm --filter @waitron/server exec vitest run src/clock-correction.test.ts src/clock-correction.backup-hold.test.ts src/boot.clock-correction.test.ts` passes **unedited** (a behaviour-preserving move).
- [ ] `pnpm --filter @waitron/server exec vitest run src/clock-host-step.test.ts`.

### Task 6: the start's seat, and handing it to the module (apps/server)

Files: new `apps/server/src/start-clock.ts`, `start-clock.test.ts`; `restore-request.ts` (`StagedRestoreDeps.startClock?`), `recovery-entry.ts`, `recovery-preparation.ts` (option passed to `createModuleOperationHost`), `node-entry.ts` (builds it with `boxHostClient()` and `deps.stateDir` for the call at `:627`).

- [ ] Tests for `createStartClock({ host, stateDir, wall, monotonic, boot })` with a stand-in host and a temporary folder:
  - `status()` → `{ synchronised }` from `clockStatus()`; `null` when the host answers `available: false`.
  - `set()` refuses `stale` when the wall clock has moved against the steady clock by more than 1 s since the seat was built for this call; asks `clockStatus()` again and answers `host_unavailable`/`refused` without asking `setClock` when the host says synchronised (the module asked moments before; the time service can sync in between); otherwise steps through Task 5's helper with requester `{"source":"authority","start":"restore"}`, and writes a step note when the step verified or moved more than 1 s (verified → `{ set: true }`; moved but unverified → note and `{ set: false, reason: "unverified" }`).
  - `disagreed()` writes a disagreement note, replacing an earlier one.
  - The notes file is written atomically, mode 0600, and is not in `RECOVERY_FILES` (F8).
- [ ] Test that the start's runner hands the seat to the module and the page's runner does not: `createRecoveryEntryRunner` with `startClock` → the module's host has it; `createInteractiveRecoveryPreparation` → it has none.
- [ ] Implement. `pnpm --filter @waitron/server exec vitest run src/start-clock.test.ts src/restore-request.test.ts src/hour-recovery-placement-2.test.ts src/node-entry.test.ts`. #2532's `src/hour-recovery-placement-3.test.ts` passes unedited.

### Task 7: the notes become alerts at the next boot

Files: `packages/fiscal-verifactu/src/errors.ts` (new `clock.authority_disagreed: { boxAt: string; authorityAt: string; differenceMs: number }`), `clock-stop-incidents.ts` (`recordAuthorityDisagreed`, warning, `system.manage`), `packages/fiscal/src/backend.ts` (seat `recordStartClockNote?(tx, note)` answering the `clock.corrected` it recorded, or null), the `fiscal-verifactu` backend that implements it, `apps/server/src/boot.ts` (read the file, record each note in one transaction, hand each `clock.corrected` to `boxEmails.remember`, delete the file; before the backup supervisor), `apps/dashboard/src/i18n/alert-messages.ts` (Words), the module's area claim for the new code (follow `scripts/alert-codes.test.ts`'s failure message).

- [ ] Tests: `packages/fiscal-verifactu/src/clock-stop-incidents.test.ts` (a step note records `clock.corrected` with `source: "authority"`, `stepMs`, `before`/`after`; a disagreement note records `clock.authority_disagreed`; a note whose id is already recorded records nothing); new `apps/server/src/boot.start-clock-notes.test.ts` (a boot with a notes file records both, emails the step through the duty's `remember`, deletes the file; `latestClockStep` then answers the step; a boot with no file records nothing).
- [ ] `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/clock-stop-incidents.test.ts`, `pnpm --filter @waitron/server exec vitest run src/boot.start-clock-notes.test.ts`, `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`, `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts`, then the fiscal core command.

### Task 8: a start that cannot get AEAT's time waits, uncounted

Files: `apps/server/src/node-entry.ts`; new `apps/server/src/start-clock-waiting.ts` (the waiting app) and its test; `apps/server/src/errors.ts` (`server.waiting_for_internet_clock: {}`); the waiting page's words beside the recovery page's (`apps/server/src/i18n/recovery-page.ts`).

- [ ] Tests in `node-entry.test.ts`, with a `runStagedRestore` stub that throws `sif.allocation_invalid` `second_clock_missing`, a fake `serveRecovery` and fake timers:
  - the count after the start equals the count before it (fails today: it rises by one);
  - the waiting app is served, closed after 60 000 ms and not before, and the start then throws so the process exits;
  - three such starts in a row leave the box at `normal`, never `recovery`;
  - a start that throws `clock_not_set` still counts (unchanged path).
- [ ] Tests in `start-clock-waiting.test.ts`: `GET /` with `Accept: text/html` → 503, `Retry-After: 60`, the page's title and body in English and, with `Accept-Language: es`, Spanish; `GET /setup-api/status` → 503 JSON `{ error: { code: "server.waiting_for_internet_clock" } }`.
- [ ] Implement. Log `server.start_waiting_for_internet_clock` with the `internet` reason. `pnpm --filter @waitron/server exec vitest run src/node-entry.test.ts src/start-clock-waiting.test.ts`, `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/personal-log-params.test.ts`.

### Task 9: the setup page says what the box is waiting for

Files: `apps/setup/src/screens/done-screen.ts`, `done-screen.test.ts`, `apps/setup/src/i18n/strings/finish.ts` (English and Spanish).

- [ ] Test: a poll answered 503 with `server.waiting_for_internet_clock` shows the waiting line under the restarting line; a following poll that fails to connect keeps it; a 404 (the box trading) shows "ready" and drops it. Fails today.
- [ ] Implement. `pnpm --filter @waitron/setup exec vitest run src/screens/done-screen.test.ts src/screens/done-screen.a11y.test.ts` (browser: check free memory first).

### Task 10: the start-failure page names the cause

Files: `apps/server/src/recovery-state.ts` (`lastErrorCause`), `node-entry.ts` (`failStart` sets it), `recovery-surface.ts` (`operatorText` reads code then cause), `i18n/recovery-page.ts` (three causes, Words).

- [ ] Tests: `recovery-state.test.ts` (a cause outside the set is dropped on read; `withFailureCode` clears a stale cause; `sameState` compares it); `node-entry.test.ts` (`clock_not_set`/`host_unavailable` → `clock_host_unavailable`; `refused` and `unverified` → `clock_set_failed`; `clock_corrected` → `clock_moved`; `minute_in_use` → no cause); `recovery-surface.test.ts` (each cause's title and action in both languages; no cause → #2532's words, whose case "names a refused series in both languages" stays unedited).
- [ ] `pnpm --filter @waitron/server exec vitest run src/recovery-state.test.ts src/node-entry.test.ts src/recovery-surface.test.ts`.

### Task 11: documents

- [ ] Root `CLAUDE.md` §5 as above; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] `docs/developers/conventions-data.md` → "The box sets its own clock": the opening sentence names the start's set (from AEAT's time, outside any stop, only when the time service is not synchronised, recorded through the next boot); "Who may set it" gains the start; a short paragraph on the notes file and its two limits (D4). Grep the topic file for every other sentence that says the box sets its clock only during a stop, and fix each.
- [ ] Guides EN and ES (Words), `docs/operations/hour-recovery.md`'s paragraph from #2532 (`:199-212` there): the start now waits uncounted for AEAT, sets or keeps the clock, and names the cause; cite the new tests. `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] `docs/backlog.md` and its area file: delete A1420's entry if one exists; nothing else is filed (loose ends are fixed in this PR).

### Task 12: real clock offset on the test box (the lane runs this before landing)

On the Debian 13 test box once the watcher reports it back (`docs/operations/a951-host-evidence.md`), or another preproduction box the owner names. Install the branch: `sudo bash waitron.sh install <branch>` (`deploy/README.md:368-376`; preproduction only, since a branch image names no producer). Set up a preproduction venue and download a backup file.

1. **Clock out, not synchronised, AEAT answers.** Start a restore on the setup page and press Make the series (the clock is right at this point; staging runs no clock check, A1385 M2). On the host: `timedatectl show -p NTP -p NTPSynchronized`, `ls /usr/lib/systemd/ntp-units.d`, then stop the running listed unit (`sudo systemctl stop systemd-timesyncd`, or whichever is listed) and `sudo timedatectl set-time "@$(( $(date +%s) - 300 ))"`. Check `timedatectl show -p NTPSynchronized --value` prints `no` and `date -u` is five minutes behind `curl -sI https://prewww1.aeat.es/ | grep -i '^date'`. Press Restore backup. **Expect:** `journalctl -t waitron-box` shows `clock.set target=… requester={"source":"authority","start":"restore"}`; `date -u` within 2 s of AEAT's `Date`; the done screen reaches "The server is ready"; the bell shows "The box set its clock from the tax agency's time: moved forward 5 min…"; the email reaches the demo mailbox; `docker compose exec app cat /var/lib/waitron/state/recovery.json` shows `failures: 0` once the box has stayed up. **A failing run** shows the start-failure page, or no `clock.set` line, or `date -u` still five minutes out. Afterwards `sudo systemctl start systemd-timesyncd`.
2. **No AEAT.** Press Make the series on a new restore, then block outbound HTTPS from the host and its containers: `sudo nft add table inet a1420 && sudo nft add chain inet a1420 out '{ type filter hook output priority 0; }' && sudo nft add chain inet a1420 fwd '{ type filter hook forward priority 0; }' && sudo nft add rule inet a1420 out tcp dport 443 reject && sudo nft add rule inet a1420 fwd tcp dport 443 reject`. Press Restore backup. **Expect:** the done screen shows the waiting line; the box's address shows the waiting page; `recovery.json`'s `failures` stays at its value before the attempt over at least five minutes; `docker compose logs app | grep start_waiting_for_internet_clock` shows one line per try, about a minute apart (report a try's length from these timestamps). Then `sudo nft delete table inet a1420`; **expect** the restore to finish within about two minutes. **A failing run** shows `failures` rising and the start-failure page after the third try.
3. **Not run for real, stated in the PR:** the synchronised-but-AEAT-disagrees branch. AEAT's clock cannot be moved, and a stand-in server fails the checked HTTPS connection (`hour-clock-internet.ts:20`, `rejectUnauthorized: true`); Task 4 case 2 and Task 7 cover it with a stubbed AEAT answer.

Record each command and what it printed in the PR description.

## Deliberately unchanged, and limits

- The restore and setup pages keep refusing a disagreement on a synchronised box (the owner's rule was about the start; a person on a page can act). Promotion and first setup are untouched.
- Other `sif.allocation_invalid` reasons at the start (for example `minute_in_use`) keep #2532's words.
- A box whose clock is years out cannot complete AEAT's checked HTTPS connection (its certificate looks not yet valid or expired), so it waits as if offline until its time service puts the clock right. With the time service on (it is switched on at install), that is seconds after the box reaches the internet.
- A step back at the start can, for at most the 30 seconds a page's clock may have been fast when Make the series was pressed, make the activation refuse `minute_not_later` (`hour-selection.ts:431`); that start counts, and the next one passes. Not changed; read, not run.

## Changed test checks

None expected. Any existing test that has to change is a STOP.

## Size

Product code about 650 lines (Tasks 1-2: 45; 3: 25; 4: 80; 5: 20 net, 60 moved; 6: 120; 7: 120 with words; 8: 130 with words; 9: 25; 10: 85), tests about 1,300 lines, documents about 80. About 2,000 lines in all: one PR, a large one. If the reviewer wants it smaller, Tasks 1-7 (set and keep the clock) and Tasks 8-10 (wait uncounted, page words) split cleanly; the item asks for one.

## Review focus

1. A page path (setup, restore, promotion) never receives the seat, so its refusals are unchanged (Task 6's second test; Task 4 case 7).
2. Synchronised never stands in for a missing second clock (Task 1, third case).
3. The set path refuses rather than sets while the time service is synchronised, at both the module's and the seat's look (Tasks 4 and 6).
4. A waiting start leaves the count where it found it, and every other start still counts (Task 8).
5. A step at the start is recorded as `clock.corrected` before the backup supervisor runs (Task 7).
