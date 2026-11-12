# A1482: "This device" on the Check this venue clock step — plan (one page)

Status: draft 2 (after one fresh read), for the watcher. Fiscal clock rule; the owner lands #2693.
**Not approved by the owner**: the deferred alert, the setup note and the 30-second "agrees" below
are the lane's and the watcher's design only. Every receipt was **read at 5e00b17ae6, not run**.

**The ask.** Owner, 2026-11-12 (questions.md, WATCHER 17:38): "add \"This device\" to #2693 now."
Owner, 2026-11-10 17:11, asked whether "the clocks differ" step may set the box's time from the
person's own device "under the setup password": "yes". Owner, 2026-11-12 15:28: "once they choose
the time, you can continue with the process". Owner, 2026-11-11 14:34 (A1506 rule 3): "if somebody
has confirmed the time on their device, then we trust that time and move forward". Owner,
2026-11-12 18:03 (questions.md, WATCHER 18:03), asked "(1) offline always shows the step, or (2)
keep: only when they disagree": "2". So the step (`renderClockProblem`,
`packages/fiscal-verifactu/src/setup/clock-wait.ts:323-383`) still shows only when the clocks
disagree, and gains a third button: **[The server] [This device] [Both times are wrong]**.

## 1. What runs while each page is open, and the route

| Page | Server mode | `clockCorrection` there? | Who asks, and what proves it |
| --- | --- | --- | --- |
| First setup (`first-hour.ts`) | setup mode, `config.node === undefined` (`apps/server/src/boot.ts:1403`): no venue database, no fiscal seat, no alert or email duty | no: built only in the full start (`boot.ts:2508`) | the setup owner's pass issued at claim, where the future administrator's email and password are typed (`setup-first-fiscal-api.ts:380-436`), checked by `host.owner.authorize` on every preparation call (`:478`); the administrator's id is reserved at claim (`packages/provisioning/src/first-setup-owner.ts:218`), no account exists yet |
| Restore (`recovery-hour.ts`) | setup mode (`mountSetup`, `boot.ts:1460`) | no | the recovery source on each call: recovery key with the archive, bucket kit, staged id or Cloud point (`setup-recovery-preparation-api.ts:212-245`); nobody signs in |
| Handover start (`recovery-hour.ts` inside `handover-screen.ts`) | full start on the spare, a **mirror**: its preparation route is mirror-only (`read-only-exemptions.ts:85-89`), mounted at `boot.ts:3825` beside `correction` | yes | email, password and code of a `node.manage` holder, sent with every call (`handover-preparation.ts:146-170`, `node-operation-preparation.ts:199`) |

`POST /api/box/clock-set` serves none of them: it needs a dashboard session holding
`system.box_admin` (`box-health-api.ts:273-274,348-351`), exists only in the full start, and a
mirror's read-only gate refuses it (no clock row in `READ_ONLY_EXEMPTIONS`; gate at `boot.ts:2217`).

**Route: one new proposal action on the path each page already uses, and one setter.** The page
sends `{action: "clock-challenge"}` then `{action: "set-clock", browser: {challengeId, instantMs}}`
through the `send` that `readClocks` uses (`clock-wait.ts:157-175`), so each page keeps the authority
that admits its `compare-clocks`, and `onBox` comes from the same `requestFromBox` each route
computes (`setup-first-fiscal-api.ts:474`, `setup-recovery-preparation-api.ts:244`,
`handover-preparation.ts:152`) that `refuseOnTheBox` uses (`box-health-api.ts:269-272`).

- **Module** (`hour-setup-clock.ts`): `setFromBrowser` takes the challenge once (5 s, as `compare`
  does at `:90-130`), refuses `same_machine` when `onBox`, measures the offset at the round trip's
  midpoint with half of it as uncertainty, and hands it to a new optional host seat `setBoxClock` on
  `ModuleOperationHost` (`packages/module/src/operation-preparation.ts:30`); no seat answers
  `host_unavailable`. Wired into `initial-hour-setup.ts:231-246` and `hosted-hour-recovery.ts:110-128`.
  It answers data (`{status: "set"}` or `{status: "refused", reason}`), naming no server code.
- **The setter is the existing `clockCorrection`** (`apps/server/src/clock-correction.ts`) on every
  page, called with reason `start` and a new `agreesWithinMs: 30_000` input: `agrees` means within
  60 s today (`:175-178`, `CLOCK_WITNESS_MARGIN_MS`, `packages/fiscal/src/clock-witnesses.ts:1`),
  while the step shows past 30 s (`AGREEMENT_MS`, `hour-clock.ts:39`). So every page keeps its one
  turn, `stale`, target bounds, host status, set, 2-second verification and step recording
  (`:281-401`). **Handover:** boot's own `correction`, source `admin`, the signed-in person.
  **Setup and restore:** a second `clockCorrection` built in setup mode with an adapter: `host`
  `boxHostClient()`, `clock` `systemClock()`, `boot` `bootReader()`, `start` a fresh
  `startClockState()` (it starts `waiting`, `start-clock-check.ts:40-42`, so `start` is admitted;
  nothing confirms it by the internet in setup mode), `read`/`transaction` passing through,
  `clockStopState` absent (so `judge` answers no stop, `:165`, and the row reason stays `start`),
  no `onCorrected`, and `confirmClockStep` appending the step to the setup note (below) and
  answering `{confirmation: null, corrected}`. Its source is a new `setup` (person: the
  administrator's name on first setup, none on restore); the fiscal seat's own `confirmClockStep`
  already refuses a `setup` step (`assertPersonMatchesSource`, `clock-step.ts:23-33`).
- **The setup note** `<state>/setup-clock-step.json` (named in `packages/store/src/state-layout.ts`,
  `reset: "deleted"`, written with `writeFileDurable`) holds a list: each step, verified or not, is
  one entry with its own id, since `clockCorrection` records a step that moved the clock by over a
  second even when unverified (`:359-392`). The venue's first full start inserts one open
  `clock.corrected` per entry under that id (a repeat after a crash inserts nothing), then deletes
  the note; the email duty mails every open `clock.corrected` once the box is primary
  (`box-alert-email.ts:51-56,195-206,379`). Start again leaves the note: the step was made on this
  box. Setup abandoned, or a restore that never starts fully: the note stays until a full start
  or a reset; the host's journal line (`deploy/box/waitron-box.sh:129`, written only after its
  `target_invalid`, `requester_invalid`, `synchronised` and `busy` checks, `:111-127`) and
  `clock_correction.stepped` in Waitron's log are then the only record (Q4).

## 2. Refusals and words (a line says what happened and what to do; never "ask someone")

| Reason | EN | ES |
| --- | --- | --- |
| `synchronised`, `not_stopped` | The server keeps its time over the internet, so its time is right. Correct the time on this device, then reconnect to the server. | El servidor se pone en hora por internet, así que su hora es correcta. Corrige la hora de este dispositivo y vuelve a conectarte al servidor. |
| `witnessed` | The server has the tax agency's time and sets its clock from it by itself. If the times still differ in a minute, press This device again. | El servidor tiene la hora de Hacienda y se pone en hora con ella por sí solo. Si dentro de un minuto las horas siguen sin coincidir, vuelve a pulsar Este dispositivo. |
| `same_machine` | This screen is on the server itself, so it cannot set the server's time. Open this page on a phone or computer. | Esta pantalla está en el propio servidor, así que no puede poner su hora. Abre esta página en un móvil o un ordenador. |
| every other (`host_unavailable`, `refused`, `unverified`, `stale`, `pending_disproofs`, `target_invalid`) | The server could not set its clock from this device. Check this device's date and time, then press This device again. | El servidor no ha podido ponerse en hora con este dispositivo. Comprueba la fecha y la hora de este dispositivo y vuelve a pulsar Este dispositivo. |

`not_stopped` gets the internet line because the handover spare answers it when its start was
confirmed by the internet, before the host is asked (`clock-correction.ts:236-237`, called at `:289`,
host status at `:292`). `agrees`: no line; the page compares again and carries on. Button: "This
device" / "Este dispositivo" (the row's words, `clock-wait.ts:64,86`). Success: "The server's time
is now set from this device." / "La hora del servidor ya está puesta desde este dispositivo."
**`later` after a set** (today `clock-wait.ts` `later` names no next step): "The invoice series
cannot be created: the server's time is now earlier than a time already used for this venue's
invoice series, so this device's time is probably wrong. Correct the time on this device, reconnect
to the server and choose which time is correct again." / "No se pueden crear las series de
facturas: la hora del servidor es ahora anterior a una hora que ya se usó para las series de
facturas de este local, así que probablemente la hora de este dispositivo está mal. Corrige la
hora de este dispositivo, vuelve a conectarte al servidor y elige de nuevo qué hora es la
correcta." **Alert and email for source `setup`**: today any source but `staff` and `admin` falls to
"The box set its clock from the tax agency's time" (`box-alert-email.ts:136-158`,
`apps/server/src/i18n/box-emails.ts:91-92`; dashboard `alert-messages.ts:179-181`), and the params
type has no `setup` (`packages/fiscal-verifactu/src/errors.ts:420`). New: "The box's clock was set
from the device showing the setup or restore page{person}: {step}, from {before} to {after}." /
"El reloj del equipo se puso en hora con el dispositivo que mostraba la página de configuración o
restauración{person}: {step}, de {before} a {after}." (`{person}` ", by {name}" / ", por {name}"
on first setup.)

## 3. After the set

The page compares again by itself (`first-hour.ts:270-338`, `recovery-hour.ts:371-376`) and, Proceed
already pressed, makes the series with nobody pressing (A1466). **The §5 series rule passes because
the device now agrees; the set itself does not count.** Only readings taken after the step are
used: a held reading is refused `clock_corrected` once the wall clock moved over a second against
the steady clock (`hour-setup-clock.ts:75-79`), and a challenge issued before the step leaves the
browser reading `unavailable: challenge` (`:115,127`). The history checks still apply
(`hour-selection.ts:411-412,443`; Q1).

## 4. CLAUDE.md §5 and the topic file (word for word)

- `CLAUDE.md:944`: after "a Box administration holder's own device," insert "the device showing the
  clock step of the setup page (under its owner's pass), the restore page (under its recovery key or
  kit) or the handover page (signed in as a `node.manage` holder), when that person chooses **This
  device** (owner, 2026-11-10: "yes"; 2026-11-12: "add \"This device\" to #2693 now"),"; after "is
  alerted and emailed" insert "(a step made before the venue exists, at its first full start)".
- `CLAUDE.md:963`: after "(no confirmation)" insert "; a device that has just set the box's clock
  from that page is that machine (owner, 2026-11-11: "if somebody has confirmed the time on their
  device, then we trust that time and move forward")".
- `conventions-data.md`, "The box sets its own clock": the intro (`:4707`) adds "and from the setup,
  restore and handover pages' clock step"; "Who may set it" (`:4757`) gains a bullet naming the
  route, each page's authority, the 30-second `agrees`, the setup adapter and note; Guards adds the
  new tests. Guides, EN and ES: `backup-recovery.md:177-181`, `servers.md:18-23,52-56`; runbook
  `docs/operations/first-live-fiscal-setup.md:46-51` (no staff guide page covers first setup).

## 5. Tests first, gates, size, tasks

- **T1, module** (fails today: no `set-clock`): `hour-setup-clock.test.ts`,
  `initial-hour-setup.test.ts`, `hosted-hour-recovery.test.ts` (set from a disagreeing browser;
  `same_machine`; a reused challenge; the action refused without the pass, key or sign-in).
- **T2, handover.** **First, before building, run and keep this test:** on a spare at
  `filing_assumed` and at `emergency_declared` (`packages/handover/src/states.ts:88`), a
  `clock.corrected` row written before activation is still open after activation and its restart
  (`handover-activation.ts:154`, `restarting`), and the box, now primary, queues its email. By
  reading only: the email duty re-reads open `clock.corrected` rows at each check and sends only on
  the primary (`box-alert-email.ts:195-206,379`, `boot.ts:3325`), so the email follows if the row
  survives; whether `venue.db` is replaced between preparation and activation is **unknown**
  (`handover-preparation.ts:56-74` says the copy is placed before preparation at `filing_assumed`;
  nothing read covers `emergency_declared`). If the row does not survive, stop and ask the watcher.
  Then `agreesWithinMs` (`clock-correction.test.ts`) and the seat (`handover-preparation.test.ts`).
- **T3, setup adapter and note**: `setup-clock-set.test.ts` (host stub: `synchronised`, `missing`,
  unverified-but-moved gives an entry, verified; two presses give two entries); first start gives
  one open `clock.corrected` per entry, none twice after a crash before the delete; the `setup`
  wording (EN/ES alert and email; `scripts/alert-codes.test.ts`); `scripts/state-layout.test.ts`.
- **T4, page**: `clock-wait.browser.test.ts`, `first-hour.browser.test.ts`,
  `recovery-hour.browser.test.ts`, `handover-screen.test.ts` (three buttons; set then series with
  no press; each refusal's line and the after-set `later` line, EN and ES).
- **T5, docs**: §4.
- Unedited and green: `packages/fiscal-verifactu/src/write-path.e2e.test.ts`,
  `inmutabilidad.test.ts`, `clock-step.test.ts`, `scripts/durable-writes.test.ts`.
- **Size (estimate):** about 420 production lines (no new setter) and 650 test lines, plus about
  50 lines of docs. Touches `packages/fiscal` and `fiscal-verifactu` types (`setup` source):
  full review path. Each task well under 100 tool calls.

## 6. Open questions (recommendation each)

- **Q1. Device earlier than a minute already used for this venue's series** (restore's history).
  Rule 3 trusts the time; series names must never repeat. **Recommended:** keep `minute_not_later`,
  with the after-set line in §2.
- **Q2. Restore set earlier than the backup's latest sale**: the first start meets today's
  clock-behind stop (`backup-recovery.md:172-175`) until A1506's C5 lands. **Recommended:** leave it
  to A1506.
- **Q3. The comparison's Internet row (AEAT's web server) agrees with the server while the device
  differs.** **Recommended:** hide **This device** then; A1420 PR 3 removes that reading (A1506 Q1,
  answered yes).
- **Q4. A step whose venue never starts fully** (abandoned setup, failed restore) is never alerted
  or emailed: no managers or mail exist. **Recommended:** accept; the host journal and Waitron's log
  keep it, and a later full start on this box alerts it.
- **Q5. Alert and email for setup and restore come at the first full start.** **Recommended:** yes;
  the alternative needs a database in setup mode.
- **Q6. First setup: the owner's pass alone, or the password again (`reconfirm`,
  `setup-first-fiscal-api.ts:457-470`)?** **Recommended:** the pass alone, as for the comparison;
  making the series already asks for the password again.
