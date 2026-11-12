# A1482: "This device" on the Check this venue clock step — plan (one page)

Status: draft 1 for the Claude read and the watcher (fiscal clock rule; the owner lands #2693).
Every receipt below was **read at 5e00b17ae6, not run**, unless it says otherwise.

**The ask.** Owner, 2026-11-12 (questions.md, WATCHER 17:38): "add \"This device\" to #2693 now."
Owner, 2026-11-10 17:11, asked whether "the clocks differ" step may set the box's time from the
person's own device "under the setup password": "yes". Owner, 2026-11-12 15:28: "once they choose
the time, you can continue with the process". Owner, 2026-11-11 14:34 (A1506 rule 3): "if somebody
has confirmed the time on their device, then we trust that time and move forward". The step
(`renderClockProblem`, `packages/fiscal-verifactu/src/setup/clock-wait.ts:323-383`) gains a third
button: **[The server] [This device] [Both times are wrong]**.

## 1. What runs while each page is open, and the route

| Page | Server mode | `clockCorrection` there? | Who asks, and what proves it |
| --- | --- | --- | --- |
| First setup (`first-hour.ts`) | setup mode: `config.node === undefined` (`apps/server/src/boot.ts:1403`); no venue database, no fiscal seat, no alert or email duty | **No**: built only in the full start (`boot.ts:2508`) | the setup owner capability issued at claim, where the future administrator's email and password are typed (`setup-first-fiscal-api.ts:380-436`), checked by `host.owner.authorize` on every preparation call (`:478`); the administrator's id is reserved at claim (`first-setup-owner.ts:218`) but no account exists yet |
| Restore (`recovery-hour.ts`) | setup mode (`mountSetup`, `boot.ts:1460`) | **No** | the recovery source on each call: recovery key with the archive, bucket kit, staged id or Cloud point (`setup-recovery-preparation-api.ts:212-245`); no person signs in |
| Handover start (`recovery-hour.ts` inside `handover-screen.ts`) | full start on the spare, which is a **mirror**: its preparation route is mirror-only (`read-only-exemptions.ts:85-89`), mounted at `boot.ts:3825` in the same function that built `correction` | **Yes** | email, password and code of a `node.manage` holder, sent with every call (`handover-preparation.ts:146-170`, `node-operation-preparation.ts:199`) |

`POST /api/box/clock-set` cannot serve any of them: it needs a dashboard session with
`system.box_admin` (`box-health-api.ts:273-274,348-351`), it exists only in the full start, and on
a mirror the read-only gate refuses it (no clock row in `READ_ONLY_EXEMPTIONS`; gate at
`boot.ts:2217`).

**Chosen route (all three pages): a new proposal action on the path each page already uses.** The
page sends `{action: "clock-challenge"}` then `{action: "set-clock", browser: {challengeId,
instantMs}}` through the same `send` as `readClocks` (`clock-wait.ts:157-175`). So the authority is
exactly the one that already admits `compare-clocks` on that page (table above), and `onBox` comes
from the same `requestFromBox` each route already computes (`setup-first-fiscal-api.ts:474`,
`setup-recovery-preparation-api.ts:244`, `handover-preparation.ts:152`), the function
`refuseOnTheBox` uses (`box-health-api.ts:269-272`).

- **Module** (`packages/fiscal-verifactu/src/hour-setup-clock.ts`): `setFromBrowser` takes the
  page's challenge once (5 s, as `compare` does at `:90-130`), refuses `same_machine` when `onBox`,
  measures the offset at the round trip's midpoint with half the round trip as uncertainty (the
  `compare` arithmetic), refuses `agrees` within 30 s (`AGREEMENT_MS`, `hour-clock.ts:39`), and
  hands the offset to a new optional host seat `setBoxClock` on `ModuleOperationHost`
  (`packages/module/src/operation-preparation.ts:30`); no seat answers `host_unavailable`. Wired into
  `initial-hour-setup.ts:231-246` and `hosted-hour-recovery.ts:110-128`. The answer is data
  (`{status: "set", stepMs}` or `{status: "refused", reason}`), so the module names no server code.
- **Handover's seat** = `correction.set` with reason `start`, source `admin`, the signed-in person,
  and a new `agreesWithinMs: 30_000` input: today `agrees` means within 60 s
  (`clock-correction.ts:175-178`, `CLOCK_WITNESS_MARGIN_MS`, `packages/fiscal/src/clock-witnesses.ts:1`),
  so a device 31-60 s off would show the step and then be refused. Everything else is the existing
  set: turn, `stale`, target bounds, host status (`host_unavailable`, `synchronised`), anchors,
  verify within 2 s on the boot-time clock, row, `clock.corrected`, email (`clock-correction.ts:281-401`).
- **Setup and restore's seat** = a new `apps/server/src/setup-clock-set.ts` on `boxHostClient()`,
  reusing the pieces of `clockCorrection` it needs, extracted rather than copied: `stale`
  (`wallMovedAgainstSteady`, `:31-36`), target bounds (`:26-27`), status then `synchronised`
  (`:292-294`), set and verify (`:327-353`), one at a time. It writes no `clock_confirmations` row
  (no venue database exists) but a durable note `<state>/setup-clock-step.json` (named in
  `packages/store/src/state-layout.ts`, written with `writeFileDurable`); the venue's first full start
  raises `clock.corrected` from it (source `setup`, the administrator's name on first setup, none on
  restore), which the email duty mails to managers (`boot.ts:2517,3297`), and deletes the note. The
  host's own journal line is written whatever happens (`deploy/box/waitron-box.sh:129`).

## 2. Refusals (each says what happened and what each choice does; never "ask someone")

| Reason | EN line under the buttons | ES |
| --- | --- | --- |
| `synchronised` | The server keeps its time over the internet, so its time is right. Correct the time on this device, then reconnect to the server. | El servidor se pone en hora por internet, así que su hora es correcta. Corrige la hora de este dispositivo y vuelve a conectarte al servidor. |
| `same_machine` | This screen is on the server itself, so it cannot set the server's time. Open this page on a phone or computer. | Esta pantalla está en el propio servidor, así que no puede poner su hora. Abre esta página en un móvil o un ordenador. |
| `host_unavailable`, `refused` | The server could not set its clock. Press This device to try again, or connect the server to the internet so it can set its time itself. | El servidor no ha podido poner su reloj en hora. Pulsa Este dispositivo para volver a intentarlo, o conecta el servidor a internet para que se ponga en hora solo. |
| `unverified` | The server moved its clock but could not confirm it matches this device. Press This device to try again. | El servidor ha movido su reloj, pero no ha podido confirmar que coincida con este dispositivo. Pulsa Este dispositivo para volver a intentarlo. |
| `stale`, `pending_disproofs` | The server's clock changed while this was being checked. Press This device again. | El reloj del servidor ha cambiado mientras se comprobaba. Vuelve a pulsar Este dispositivo. |
| `target_invalid` | This device's date is not one the server can take. Correct the date and time on this device, then reconnect to the server. | La fecha de este dispositivo no es una que el servidor pueda tomar. Corrige la fecha y la hora de este dispositivo y vuelve a conectarte al servidor. |
| `agrees`, `not_stopped` | none: the page compares again and carries on | — |

Button "This device" / "Este dispositivo" (the row label's words, `clock-wait.ts:66,85`). Success
line, then the page carries on: "The server's time is now set from this device." / "La hora del
servidor ya está puesta desde este dispositivo." The setup pages say "server" (owner, 10 Nov).

## 3. After the set

The page runs its comparison again by itself (the `#run` path, `first-hour.ts:270-338`;
`recovery-hour.ts:371-376`) and, Proceed already pressed, makes the series with nobody pressing
(A1466). **The §5 series rule then passes because the device now agrees; the set itself does not
count.** Only readings taken after the step can be used: a held reading is refused `clock_corrected`
once the wall clock moved over a second against the steady clock (`hour-setup-clock.ts:75-79`), and a
challenge issued before the step is refused for the same reason (`:115`). The history checks still
apply: a minute already used is skipped or waited for, and a clock earlier than a recorded intent
is refused `minute_not_later` (`hour-selection.ts:411-412,443`); see Q2.

## 4. CLAUDE.md §5 and the topic file (word for word)

- §5 (`CLAUDE.md:944`): after "a Box administration holder's own device," insert "the device a
  setup, restore or handover page's clock step is open on, when the person there chooses **This
  device** (owner, 2026-11-10: "yes"; 2026-11-12: "add \"This device\" to #2693 now")," and after
  "is alerted and emailed" insert "(a step made before the venue exists, at its first full start)".
- §5 (`CLAUDE.md:963`): after "(no confirmation)" insert "; a device that has just set the box's
  clock from that page is that machine (owner, 2026-11-11: "if somebody has confirmed the time on
  their device, then we trust that time and move forward")".
- `docs/developers/conventions-data.md`, "The box sets its own clock": the intro (`:4707`) adds "and
  from the setup, restore and handover pages' clock step"; "Who may set it" (`:4757`) gains a fourth
  bullet naming the route, each page's authority, the 30-second `agrees`, and the setup note; its
  Guards line names the new tests.
- Guides, EN and ES twins: `backup-recovery.md:177-181` (restore, "correct this device's time"
  becomes the three choices), `servers.md:18-23,52-56` (handover), and the runbook
  `docs/operations/first-live-fiscal-setup.md:46-51` (first setup has no staff guide page; checked
  `apps/server/src/guide/en/`).

## 5. Tests first, gates, size, tasks

Failing first: `hour-setup-clock.test.ts` (set from a disagreeing browser; `same_machine`; `agrees`
at 30 s; challenge reuse refused); `initial-hour-setup.test.ts`, `hosted-hour-recovery.test.ts`
(the action exists, authority refused without the capability, key or sign-in);
`clock-correction.test.ts` (`agreesWithinMs`); `handover-preparation.test.ts` (row, alert and email
on the spare survive activation; unverified: nothing replaces `venue.db` between preparation and
activation, `handover-preparation.ts:56-74` says the copy is placed before preparation runs);
a new `setup-clock-set.test.ts` (host stub: `synchronised`, `missing`, `lost`, unverified, verified;
note written; first start raises one `clock.corrected` and deletes it); `clock-wait.browser.test.ts`,
`first-hour.browser.test.ts`, `recovery-hour.browser.test.ts`, `handover-screen.test.ts` (three
buttons; set then series with no press; each refusal's line, EN and ES). Unedited and green:
`packages/fiscal-verifactu/src/write-path.e2e.test.ts`, `inmutabilidad.test.ts`,
`clock-step.test.ts`, `scripts/state-layout.test.ts`, `scripts/durable-writes.test.ts`,
`scripts/alert-codes.test.ts`.

Size (estimate): about 550 production lines and 700 test lines, plus about 40 lines of docs.
Tasks (each well under 100 tool calls): **T1** module action and seat type; **T2**
`agreesWithinMs` and the handover seat in boot; **T3** `setup-clock-set.ts`, the note, the
first-start alert; **T4** the page: third button, success and refusal lines, both pages and the
handover wrapper; **T5** CLAUDE.md, topic file, guides, runbook.

## 6. Open questions (recommendation each; nothing invented)

- **Q1 (already with the owner, WATCHER-NEEDED 17:59): show the step whenever internet time is
  unavailable, even when the clocks agree?** Built "only when they disagree". If the answer is
  "always offline": the comparison must also report the host's `synchronised` (a seat call, not
  today's AEAT web-server reading), the step shows on agreement too, **The server** becomes "carry
  on with the server's time" instead of "correct this device", **This device** is refused `agrees`
  only within 2 s, and §5's "(no confirmation)" becomes "after the person chooses which time is
  right".
- **Q2. Device earlier than a minute this venue already used for series** (restore's history).
  Rule 3 trusts the time; series names must never repeat. **Recommended:** keep `minute_not_later`
  and its line; the device is then most likely wrong.
- **Q3. Restore set earlier than the backup's latest sale**: the first start meets today's
  clock-behind stop (`backup-recovery.md:172-175`) until A1506's C5 lands. **Recommended:** leave it to
  A1506; no carry-over from the page.
- **Q4. The comparison's Internet row (AEAT's web server) agrees with the server while the device
  differs.** **Recommended:** hide **This device** then; A1420 PR 3 removes that reading (A1506 Q1,
  answered yes).
- **Q5. Alert and email for a setup or restore step come at the first full start** (no venue,
  managers or mail before it). **Recommended:** yes; the alternative needs a database in setup mode.
- **Q6. First setup: the owner capability alone, or the password again (`reconfirm`,
  `setup-first-fiscal-api.ts:457-470`)?** **Recommended:** the capability alone, as for the
  comparison; the series step already asks the password again.
