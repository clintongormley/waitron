# A10 — Clocking in and out: the working-time record staff actually use

2026-10-16: A182 part 2 replaces authored screen canvases, their editor and the generic card grid
with [fixed device screens](../../developers/design-system.md#fixed-device-screens). References below to those retired
interfaces describe this document's source snapshot. Menu Home Page, receipt configuration and
floor-plan editing remain separate.


Date: 2026-10-12. Updated 2026-10-14 with the owner’s self-approval and automatic-clock-out rulings.
Status: design agreed; A10-1 awaits the owner’s review before landing.

Update 2026-10-14: parts 1 and 2 are built. The remaining implementation is tracked in
[the workforce backlog](../../backlog/workforce.md). The original design below records the state
when this spec was agreed.

Update 2026-10-15: parts 1–4 have landed. The
[part 5 implementation plan](../plans/2026-10-15-a10-5-hours-screens-plan.md) covers the hours screens,
including own corrections in My Schedule. Parts 5–6 remain unbuilt.

Update 2026-10-15, part 5 implementation: the hours screens are built through the
[part 5 plan](../plans/2026-10-15-a10-5-hours-screens-plan.md). Export surfaces remain in part 6;
[the workforce backlog](../../backlog/workforce.md) tracks the remaining work.

Update 2026-10-15, part 6 planning: the reviewed
[export implementation plan](../plans/2026-10-15-a10-6-record-export-plan.md) covers PDF/CSV,
own and manager downloads, and the representatives’ version. Implementation remains open.

Update 2026-10-15, part 6 implementation: own and manager Hours now offer PDF/CSV downloads,
including the representatives' version, through the [part 6 plan](../plans/2026-10-15-a10-6-record-export-plan.md).
All six parts are built. Inspector remote access, advisor policy checks and payroll export remain
in [the workforce backlog](../../backlog/workforce.md).

## Why

Spanish law requires a daily record of each worker's start and end times, kept four years, from the
first day the deli employs anyone (Estatuto de los Trabajadores, art. 34.9). Waitron already has the
record's library (`packages/workforce`, `packages/workforce-es`): append-only, hash-chained time
entries, correction requests and approvals, worked-time totals and the Spanish export. Nothing in
`apps/` calls it: `clockIn`, `clockOut`, the break events and the correction functions in
`packages/workforce/src/clocking.ts` have no caller outside the package. Staff cannot clock in.

The backlog gated A10 on asking the labour advisor whether the digital-record decree is in force.
Research on 2026-10-12 answered that (below): it is not, and building to its draft is allowed today.

## Legal basis (researched 2026-10-12)

| Claim | Source | Their words |
| --- | --- | --- |
| Today's rule: a daily record kept four years | [ET art. 34 (consolidated)](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430) | «conservará los registros … durante cuatro años» |
| The digital decree is not published | BOE daily indexes 1 Apr 2025 – 12 Oct 2026, read through the BOE open-data interface; no title on the registro de jornada (control: Real Decreto 723/2026 was found by the same scan) | — |
| The draft requires a digital record | [Draft decree, Oct 2025](https://expinterweb.mites.gob.es/participa/listado/download/6cb63e79-48a8-4e99-9784-3a0b26ae6106) | «por medios digitales» |
| Inspectors get remote access | same | «de manera remota y presencial en los centros de trabajo» |
| The device is not in a public area | same | «no se ubique en zonas de acceso público» |
| In force 20 days after publication | same | «entrará en vigor a los veinte días de su publicación» |
| A technical order will set requirements | [Order consultation, Mar 2026](https://expinterweb.mites.gob.es/participa/listado/download/4d13dbda-6be7-4ad5-b224-4269a9f4fad4) | «la imposibilidad de manipulación indebida de los datos» |

Each quote was found by fetching the source's raw text and searching it. The draft (as summarised by
that research) also asks that each worker records their own times to the minute; that a change carries
the authorisation of both employer and worker and leaves «una huella clara e indeleble»; that workers
see their own record, their representatives see it with personal data minimised, and inspectors get
immediate remote access; that a summary goes with each payslip; and that the record can be exported.
The final text may differ: a revised draft exists that the research could not obtain.

## Decisions (owner, 2026-10-12)

1. **Clocking is part of signing in to a device whose profile allows it.** Device profiles gain a
   `clock-in` action beside the existing ones (`PROFILE_ACTIONS`, `packages/layouts/src/canvas.ts`).
   No dedicated device is required, and clocking from personal phones is out of scope.
2. **The day's first sign-in shows a big Clock in button** in the middle of the page, with **Cancel**
   beside it. Cancel does not clock them in but lets them use the till as normal; the next sign-in asks
   again. After clocking in, the person goes straight to work.
3. **After that, clock actions live behind the person's name in the top bar**, not as separate header
   buttons. The name gets a small dot for the clock state (clocked in; on a break) and opens a menu:
   Start break or End break, Clock out (or Clock in, if they cancelled), My hours, Log out. On a narrow
   handheld the name already folds into the top bar's More menu (`apps/till/src/widgets/tab-shell.ts`),
   and these items fold with it. **Clock out also logs out.** Log out alone leaves the person clocked
   in, for handing a till over mid-shift.
4. **Nothing optional sits between sign-in and work.** My hours is in that menu, never offered after
   sign-in ("mostly they'll want to get straight to the table layout or orders").
5. **A forgotten clock-out is closed automatically at the person's last activity** that business day:
   the latest of their till sign-ins, orders, payments and break events. It is marked as automatic,
   never as an entry the person made.
6. **Clocking in and out is required; nothing is guessed.** If a person clocked in but has no later
   activity, or had a rota shift and never clocked in, or worked on a till without clocking in, no
   time is invented. They get an email (when they have an address) saying they had a shift but did
   not clock in or out, and they fix it at their next clock-in.
7. **The person is still asked about every automatic or missing time** at their next clock-in, before
   the big button: "That's right" or "No, I left at …". "That's right" appends the worker's confirmation.
   A different time, or a missing one they supply, becomes a correction request that a manager
   approves in the dashboard or with a manager's PIN on the till. **Owner, 2026-10-14:** only an
   `admin` may approve their own request; every admin counts as the owner for this rule. A manager
   or supervisor who is not an admin needs another manager or admin. Store and hash self-approval
   in the entry, and show it in the record, hours screens and export; add no separate owner identity.
8. **A manager's change needs the worker's acceptance.** A manager proposes it in the dashboard; it
   counts once the worker accepts it at their next sign-in. If they disagree, both versions stay on
   record, marked as disputed, and the export shows that.
9. **An automatic clock-out is confirmed and counts as soon as it is written** (**Owner, 2026-10-14**).
   It stays marked automatic, with "confirmed by the worker" added once they answer; never show it
   as unconfirmed. If they do not answer, that time stands. A request for another time follows the
   correction process in decision 7; the automatic time stands until approval. Pay-period closure
   freezes the already counted hours. A later approved change appears against the closed period.
10. **The pay period is monthly by default**, set per venue, and closes on its own at the venue's
    day-change time (`dayCutover`) after its last day.

## What the record gains (library)

These change how the legal record is written, so the land takes the owner's sign-off (as
`docs/backlog/workforce.md` already says for A10).

- **A correction can add a missing entry**, not only retime an existing one. Today a correction must
  name the entry it corrects (`correction.target_not_found` otherwise, `clocking.ts`), so a forgotten
  clock-out cannot be recorded at all.
- **Who made an entry is part of it**: the worker, a manager, or `automatic` for decision 5.
  Automatic ends count immediately; worker acknowledgment is recorded separately. An admin’s
  self-approval is a stored, hashed fact, retained if their role later changes (owner, 2026-10-14).
- **The worker's acceptance is a step of its own.** A correction made by a manager has effect only
  after the worker's acceptance is appended; a disagreement is appended too and leaves both versions
  visible. A correction the worker requested has effect after the manager's approval, as today.
- **Every new kind of row is an append**, chained like the rest. Nothing edits or deletes a time entry.

## What people see

**Till and handheld**
- The first-sign-in page: any pending questions first (automatic clock-outs to confirm, missing
  times to supply, a manager's change to accept), then the big Clock in with Cancel.
- The name menu (decision 3), with the clock-state dot.
- My hours, from that menu: the current week or month, each day's times and total, and anything
  waiting for the person. A day can be fixed from here ("Fix my hours"), which makes a correction
  request.
- A manager approving at the till uses the existing manager-PIN step.

**Dashboard**
- My Schedule gains an Hours tab: the same as the till's My hours.
- A manager's Hours screen: each person's days in the period; open shifts; automatic clock-outs not yet
  acknowledged by the worker (their hours already count); corrections waiting for approval; changes waiting for the worker; disputes. Approve,
  decline, or propose a change.
- Export (below).

**Email** (decision 6), sent once per missing shift, through the venue's existing email set-up. A
person with no email address sees only the till question.

## Export and access

- The dashboard exports any date range, for everyone or one person, as a readable PDF and a CSV, with
  the fields the record needs (from `exportTimeRecord`, `packages/workforce-es/src/registro-jornada.ts`)
  and, per entry, who made it and whether it is automatic, confirmed by the worker, self-approved, corrected or disputed.
- **The representatives' version** is the same record without contact details or ID numbers (the
  draft's "personal data minimised"; the exact fields are a default the asesor may correct).
- **Inspectors' remote access** cannot be given while the box is reachable only on the venue's own
  network. Until remote access exists (Waitron Cloud), the record is exported on request. A backlog
  entry tracks remote read-only access.
- Four years' retention: time entries are never deleted (append-only); nothing in A10 removes them.

## Split into parts that land on their own

Each part is a branch with its own plan. Part 1 lands first and waits for the owner's sign-off; the
others build on it.

1. **Library.** Add-a-missing-entry corrections, who-made-it, `automatic`, the worker's acceptance and
   disagreement, pay periods, and the projection and export reading all of it. Fiscal-style care: the
   record cannot be repaired once written.
2. **Clocking on the till.** The `clock-in` profile action, routes (with the profile-action and zone
   map rows `CLAUDE.md` §3 requires), the first-sign-in page with Clock in and Cancel, and the name
   menu with its clock-state dot and break and clock-out items.
3. **End of day.** At the business day's end, close forgotten clock-outs at the last activity; find
   rota shifts with no clock-in and activity without a clock-in; send the emails; queue the questions
   for the next sign-in.
4. **Answering at sign-in, and corrections.** The pending-questions step before the big button, Fix my
   hours, manager approval on the till and in the dashboard, a manager's proposed change and the
   worker's acceptance or disagreement.
5. **Hours screens.** My hours on the till, the Hours tab in My Schedule, the manager's Hours screen.
6. **Export.** PDF and CSV for a range, everyone or one person, and the representatives' version.

## Out of scope

Clocking from personal phones; location tracking; fingerprint or face (data-protection decision of
2026-07-22: PIN or card only); the payroll export (waits on the gestoría's import format); inspectors'
remote access (needs remote access to the box); shift templates and availability.

## Open points

- **The final decree text.** If it is published, compare its fields with the export; the technical
  order may add requirements nobody can see yet.
- **What "personal data minimised" removes** for representatives: the default above is ours, not the
  asesor's.
- **Activity that counts as "last activity"**: sign-ins, orders, payments and breaks are the default.
  A cook who never touches a till has none after clocking in, so they fall under decision 6, not 5.
