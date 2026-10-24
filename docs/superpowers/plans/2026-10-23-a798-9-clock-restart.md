# A798-B slice 9 — payments restart by themselves once the clock is confirmed, and wrongly dated records go to the owner

> **Revision 7 (2026-10-24): round 4 folded** (`~/waitron-campaign-b/a798-9-rev/round4.md`, under
> `RULINGS-4.md`; finding by finding at the end; round 4 checked the fold below, which calls itself
> Revision 6). Every wrongly dated list is bounded by the check's OPENING `detail.heads`, never the
> closing's, so a correctly dated sale made after a stop ends is never listed; the "none disagreed
> during the stop" condition is gone; a check whose stop ends by itself waits, open, for a fresh
> witness instead of closing `unconfirmed` because AEAT was asked less than a minute before; the
> closing's `source` now names what confirmed the clock, and `elapsed` is only a closing that cannot
> tell. **No migration column changed**: the check's `detail` JSON gains `lastRecordId`, nothing else.
>
> **Revision 6 (2026-10-24): round 3 folded** (`~/waitron-campaign-b/a798-9-rev/round3.md`, under
> `RULINGS-3.md`; finding by finding at the end). Checks now open and close on the stop with the lift
> applied; a stop that ends by itself lists nothing unless something confirms the box's clock at
> that moment; every closing stores what its list needs. No migration column changed.
>
> **Revision 5 (2026-10-24): the owner's clock answers, with plan review round 1 folded.** This
> block governs. Everything below the line "As built before revision 4" is the plan slice 9's code
> was built from (revisions 1–3, kept for their receipts); where it disagrees with this block, this
> block wins. Revision 4 (`4a7db432a`) applied the owner's answers
> (`~/waitron-campaign-b/a798-9-rev/OWNER-ANSWERS.md`); revision 5 folds the round-1 review and its
> claim check (`round1.md`, `claim-check.md` beside it) under the runner's rulings (`RULINGS-1.md`),
> finding by finding at the end. The design is revision 7
> (`docs/superpowers/specs/2026-10-19-a798-degraded-trading-design.md` §4.9). The branch
> (`feat/a798-9-clock-restart`, PR #2025, worktree `waitron-feat-a798-9-clock-restart`) is rebased
> on `main` `d647f9288` and holds slice 9 as built (`9ab6751c8`, `faeedfb0b`); this revision changes
> that code, it does not start over.
>
> **The owner's answers are three pull requests' worth of work**, split so that selling never stops
> for a clock check before the box can be confirmed and corrected. **The parked PR's description
> says so in its first line** (the owner asked for it to be folded into #2025):
> - **Slice 9, this PR (#2025)** — this plan, complete and build-ready: during a clock-behind stop,
>   payments restart by themselves on AEAT's time or two agreeing tills or handhelds, or when an
>   administrator confirms that their own device agrees with the box; no button, no 24-hour cap;
>   when each stop began is recorded; every closing kept; the wrongly dated records listed with an
>   owner's task, also when a stop ends by itself (once a fresh witness confirms the box's clock;
>   a task saying the box cannot tell when one contradicts it); managers told by bell and email; devices and
>   browsers on the box itself never count. The box does not set its clock yet. **The slice's one
>   migration** (both new tables) is here.
> - **Slice 9b** — an OUTLINE, [2026-10-24-a798-9b-box-sets-its-clock.md](2026-10-24-a798-9b-box-sets-its-clock.md):
>   a service on the host lets the box set its own clock, and the box watches its time service.
> - **Slice 9c** — an OUTLINE, [2026-10-24-a798-9c-clock-check-at-start-and-change.md](2026-10-24-a798-9c-clock-check-at-start-and-change.md):
>   a clock check at every start and after every change of the clock, with selling stopped while it
>   waits. Depends on 9 and 9b.
>
> 9b and 9c each get their own full plan and plan review, against the spec, before their first
> dispatch. Each slice leaves `main` green and the box no worse than today: slice 9 only adds ways OUT
> of slice 8's stop (and a list for the owner); 9b adds the clock correction, still only inside a
> stop; 9c adds new stops only once both ways out exist, and never one nothing on the venue's network
> could lift (design §4.9 h).

## Owner FYI defaults (slice 9; 9b's and 9c's are in their outlines)

Every point the owner's answers left open, the default built, and why. Each can be overridden.

1. **Three pull requests (9, 9b, 9c), not one**, said in the first line of #2025's description.
   Why: each is large, and the stop at start must not land before the box can confirm and correct
   its clock.
2. **"An administrator" is whoever holds `person.admin`**, the permission the dashboard itself
   treats as admin (`canAdminister`, `apps/dashboard/src/dashboard-app.ts`); only the `admin` role
   holds it. As the owner asked (04:01). No new permission.
3. **Managers (`system.manage`) are the ones told**, by bell and email, as for the stop itself.
4. **Every check and every closing is kept in two new append-only tables**, `clock_checks` (when a
   stop or check began) and `clock_confirmations` (who or what closed it, both readings, the proof,
   the record it lifts past). `clock_stop_restarts` stays, written by nothing, for the go-live
   migration squash to drop. Why: it allows one row per record (`clock_stop_restarts_registro_uq`)
   and a second lift of the same record is now normal; its `person_id` cannot be empty either.
5. **The clock watch looks every 15 seconds**, stop or not (a few indexed reads: the latest record,
   the covering confirmation, the chain heads under a lift, the open check); AEAT is still asked at
   most once a minute, and only during a stop or while a check whose stop has ended waits for its
   witness (R6). Why: tills report every 15 seconds, and the start of a stop is recorded within 15
   seconds.
6. **AEAT's time outranks the devices.** AEAT agreeing with the box restarts payments even if two
   devices disagree (they get `clock.disagrees`); AEAT disagreeing blocks devices and the
   administrator for the rest of the stop in this slice, where the box cannot set its clock — slice
   8's own ways out (the clock put right, or real time passing the record) remain.
7. **An administrator confirms in two quick steps the browser makes by itself** — the box hands out
   a challenge, the browser answers with its own clock within five seconds — A679's and A947's
   pattern. The device agrees when within a minute after allowing half the round trip.
8. **Until slice 9b, an administrator whose device disagrees with the box is told so and cannot
   confirm**: "Your device and the box differ by more than a minute. If your device is right, the
   box's clock is wrong: connect the box to the internet so it can correct it."
9. **Wrongly dated follows the owner's 04:00 words**: every record written before the check
   OPENED (at most its node's entry in the check's `detail.heads`) and stamped more than a minute
   after the corrected time at the start of the stop — the time at closing less the boot-time
   clock's elapsed time since the stop began. Why the opening's heads are enough: no record is
   written while the stop holds (the chain append refuses first, `chain.ts:136-140` →
   `clock-behind.ts:166-173`, `clock.behind_chain`), and a record written after the stop ends is
   rightly outside the list (round 4, I1): under a lift it was written under fresh proof that the
   clock is right; after a stop that ended by itself it was written on the clock the closing's
   witness then confirms (or contradicts, and nothing is listed). A clock that was wrong while the
   check waited and right at its closing changed in between, which is slice 9c's change check. The corrected start is right only when the clock at
   closing is right, so a check closes only on a confirmation: by AEAT, two devices from two
   addresses or an administrator's device, during the stop (a lift) or, **when the stop ends by
   itself, after it** — the check stays open until a fresh witness answers, and the Box status page
   says it is waiting. **If a fresh witness then contradicts the box** (its clock may be the one that
   is wrong: a clock set back by mistake ends the stop by itself too), the check closes with nothing
   listed and the owner's task says the box cannot tell which sales were dated wrongly. If the
   machine restarted during the stop, the elapsed time is unknown and the list falls back to records
   stamped more than a minute after the closing time; the alert says it may be short. The boot id
   this relies on has not been read inside the app's container (Docker was down); slice 9b's M5 reads
   it, and if it differs there or cannot be read, every list is the short fallback. One owner's task
   (`clock.records_misdated`, open until marked handled) per closing that finds any, or that cannot
   tell; the list (invoice number and recorded time) on the Box status page. A record can appear in
   two lists.
10. **A further step back after a restart no longer stops payments for good**: payments stop again,
    and a fresh confirmation restarts them. Why: "regardless of the time difference, we need to
    restart selling".
11. **A second confirmation naming the same record while the first's alerts are open records no
    second alert** (the bell's open-alert key is the record's sale); the tables and the page keep both.
12. **A device's or administrator's time is self-reported.** Whatever their browser sends counts: a
    scripted request can send any time, and "nobody types a time" is true of the screen only. In
    this slice that can lift a stop, never set the clock. What limits it: devices must be enrolled
    and come from two different connection addresses (two browsers on one phone count once: the box
    listens on IPv4 only, `WAITRON_HTTP_HOST=0.0.0.0`, `deploy/Dockerfile:278`, so the phone's IPv6
    temporary addresses never reach it — round 4's `r4/listen-v4.mjs`: a server on `0.0.0.0` answered
    `127.0.0.1` and refused `::1`, `ECONNREFUSED`, while the control on `::` answered both; devices
    behind one NAT router count once for another reason — the router gives them one address — which
    fails safe); an
    administrator must be signed in and off the box; every closing is kept with its proof; records
    listed as wrongly dated go to the owner. Slice 9b adds an alert and an email for every clock
    change the box makes.
13. **A remote administrator reaching the box through the cloud tunnel is refused**, like the box's
    own screen: the tunnel delivers requests from loopback (`packages/tunnel/src/client.ts`, read).
    Fails closed; a backlog entry asks how to tell them apart.
14. **On a developer's laptop (`WAITRON_ENV=dev`) an administrator may confirm from the same
    machine**; everywhere else the box's own screen is refused. Devices on the box never count, even
    in development.
15. **The `clock.behind_chain_disproved` alert stays as built.**
16. **No new picture.** The LOOK tasks screenshot the built screens; picture 9 gets a dated pointer.

## Measured for revisions 4–7

Run on 2026-10-24, macOS (Darwin 25.6.0), Node v26.11.1, in this worktree. Logs and scripts under
`~/waitron-campaign-b/a798-9-rev/probe/` (mine) and `~/waitron-campaign-b/a798-9-rev/claim-check/`
(the claim check's).

- **T1 — what the server sees for a browser on the box itself** (`probe/onbox-peer.log`, and the
  claim check's re-run with header controls, `claim-check/onbox-rerun.log`). A real
  `@hono/node-server` on `0.0.0.0` answered each request with `getConnInfo(c).remote.address`,
  `requestFromBox(c)` and the same check given only a loopback interface. Fetched from the same Mac:
  via `127.0.0.1` → peer `127.0.0.1`, on the box `true`; via `192.168.10.101` → peer
  `192.168.10.101`, on the box `true`, **loopback-only `false`** — the failing case: a loopback-only
  check counts the box's own browser as another device. The re-run sent no header,
  `X-Forwarded-For: 192.0.2.7`, `X-Forwarded-For: 127.0.0.1`, and `Forwarded` with `X-Real-IP`, each
  both ways: the same answers. **What it does not show:** a request from another machine counting as
  "not the box". That rests on `app.request` with a supplied socket address (`192.0.2.50` → `false`,
  `claim-check/appreq.log`) and `apps/server/src/request-from-box.test.ts`. Not run inside Docker's
  host network.
- **T2 — why `clock_stop_restarts` cannot hold the new lifts** (`claim-check/sqlite-rerun.log`, run
  against the real `0010_clock_stop.sql`): a second row naming the same record printed `UNIQUE
  constraint failed: clock_stop_restarts.registro_id` (the blocker: FYI 10 needs several lifts of
  one record); `person_id` NULL printed `NOT NULL constraint failed: clock_stop_restarts.person_id`
  (a sentinel string inserts, since it has no foreign key). Mine (`probe/sqlite-probe.log`): a unique
  index takes two NULLs.
- **T3 — the built watch ignores a backward step** (`probe/backward-jump.log`):
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts -t "backward"` →
  `Tests 1 passed | 27 skipped (28)`. That case stays: slice 9c builds a separate guard for changes
  in both directions and leaves the watch's forward-jump disproof alone.
- **T4 — nothing could be measured on Linux.** `docker info` failed on its socket; `open -a Docker`
  failed with `-1712`; `docker desktop start` said it was running and the socket stayed absent. The
  owner's box was not touched.
- **T5 — the cap tests** (`claim-check/nocap.log`): with `RESTART_CAP_MS` replaced by
  `Number.MAX_SAFE_INTEGER`, `clock-behind.restart.test.ts` failed two cases, "covers a step back of
  exactly 24 hours and not a second more" (`:246`) and "caps the cover at 24 hours even when the
  accepted gap is wider" (`:256`); control `Tests 35 passed (35)`. Across every clock test file
  (`nocap-wide.log`) four `clock-stop-restart.test.ts` cases fail too: "refuses a 25-hour gap",
  "refuses 24 hours and one second", "judges the gap before the proof" and "a gap over 24 hours is
  refused as too far…".
- **T7 — round 3's model of the open-and-close rule** (`~/waitron-campaign-b/a798-9-rev/r3/list-model.mjs`,
  `r3/list-model.log`; a model of the plan's sentences, not product code). Revision 5's rule (open
  and close on the RAW comparison) printed, for the worked example with a sale every 5 minutes and a
  lift at 11:30: `checks opened: 2`, the lift's list `23 (10:05..11:55)`, then a second, `elapsed`
  closing listing `9 (11:35..11:55)` — four of them sales made under the lift with the confirmed
  clock. And for a clock set 30 minutes back by mistake, the stop ending by itself: `listed 5
  (09:35..09:55)`, all sold with a correct clock. Revision 6's rule (open and close on the stop with
  the lift applied; an `elapsed` closing lists only with a fresh agreeing witness), the same model
  with those two lines changed (`probe/r6/model-r6.mjs`, `model-r6.log`): A → `checks opened: 1`,
  one list `23 (10:05..11:55)`; B → `listed 0`; control C (the clock right, no confirmation, a
  witness agreeing when real time catches up) → `listed 23 (10:05..11:55)`.
- **T8 — round 4's model of the window after a stop ends** (`r4/model-window.mjs`, `model-window.log`;
  revision 6's rule with the watch checking every 15 s, 6 s past each quarter-minute, and sales at any
  moment; a model of the plan's sentences, not product code). Two customers paying at 11:54:02 and
  11:54:04, after the stop ends (11:54:00) and before the watch's closing (11:54:06): bounded by the
  closing's heads → `listed 25 (10:05:00..11:55:00); of them correctly dated: 2 [11:54:02, 11:54:04]`;
  bounded by the opening's heads → `listed 23 …; of them correctly dated: 0`. The clock set 30
  minutes back by mistake at 10:00 and put right at 10:10, AEAT agreeing at the closing, without the
  "none disagreed" condition: closing's heads → `listed 1 (10:10:00..10:10:00); of them correctly
  dated: 1`; opening's heads → `listed 0`. Control: T7's case C with checks in step with the sales →
  `listed 23 …; of them correctly dated: 0`, the same as the opening-heads run, so the window shows only
  when the checks are out of step. Revision 7 takes the opening's heads.
- **T6 — backups are pruned by the age in their names** (round 1, experiment 5):
  `pnpm --filter @waitron/server exec vitest run src/backup-sweep.test.ts -t "prunes by count AND age"`
  → `Tests 1 passed | 43 skipped (44)`; `pruneBackend` deletes a backup inside the count limit but
  past `retainDays` (`backup-sweep.ts:232-257`). Slice 9 sets no clock; slice 9b must answer it.
- **Reads, saved in `probe/man/`** (2026-10-24, man7.org and systemd's `main`): `capabilities(7)`
  CAP_SYS_TIME "Set system clock … set real-time (hardware) clock"; `time_namespaces(7)` "time
  namespaces do not virtualize the CLOCK_REALTIME clock"; `clock_gettime(2)` `CLOCK_BOOTTIME` "A
  nonsettable system-wide clock … also includes any time that the system is suspended";
  `random(4)` `boot_id`: "read-only files … the latter was generated once"; `timedatectl(1)`,
  `systemd.time(7)`, `systemd-timedated.service(8)` and `src/timedate/timedated.c` for slice 9b.

## What stays as built, and what changes

**Stays** (Tasks 1–4, 7's disproof, 10a, 11 below the line): judging witnesses, the witness store,
tills sending their clock, AEAT's time from the QR host and from replies, `clock.disagrees`,
`clock.unusable` in the bell, the clock-stop email, `clock.behind_chain_disproved`, and the cover's
one-step rule with its running maximum and fail-closed `heads` (decisions 8 and 21). The backup
verifier keeps `clock_stop_restarts`' two links until the squash drops the table, and learns the new
tables' links (Task R1b).

**Changes:**
1. The cover reads `clock_confirmations` instead of `clock_stop_restarts`, takes the latest
   confirmation (largest `seq`) naming the latest record, and has **no cap** (`RESTART_CAP_MS`,
   `too_far` and departure 6 go).
2. There is **no button and no route** `POST /api/box/clock-restart`. The clock watch confirms by
   itself when proof exists; an administrator (`person.admin`) may confirm that their own device
   agrees with the box (`POST /api/box/clock-challenge`, `POST /api/box/clock-confirm`).
3. `stepped_back` goes: after a further step back the stop is simply on again, and a fresh
   confirmation (a new row, a larger `seq`) lifts it.
4. Devices and browsers on the box itself never count, and an administrator on it is refused
   (except on a developer's laptop); two devices must come from two connection addresses.
5. The clock watch records when each clock-behind stop began (a `clock_checks` row), and it closes
   on a confirmation — during the stop (a lift), or after a stop that ended by itself, once a fresh
   witness answers — listing the wrongly dated records, or, when a fresh witness contradicts the
   box's clock, a task saying the box cannot tell; the restart and the list are emailed to managers.

## Words used in revisions 5–7

- The **stop proper** is slice 8's stop with the lift applied: `clockBehindChain` answers non-null.
  The **raw comparison** (the reading against the latest record, before any lift) stays "behind"
  for the whole time a lift covers, and is never used to open or close a check.
- A **check** is one row of `clock_checks`. Slice 9 writes checks with `reason: "behind_chain"`, one
  per clock-behind stop, when the clock watch first sees the stop proper; slice 9c adds the others. At most
  one check is **open** at a time: the check with the largest `seq` is open while no confirmation
  points at it, and opening while one is open answers the open one. An open check whose stop proper
  no longer holds is **waiting** for its witness (R6); it blocks nothing.
- A **confirmation** is one row of `clock_confirmations`. Its **source** names what confirmed the
  clock: `authority` (AEAT), `devices` (two or more tills or handhelds from two or more addresses
  that agree with each other) or `admin` (an administrator's own device); or `elapsed` — the stop
  ended by itself and a fresh witness then contradicted the box, or the stop came back after
  records were written while the check waited, so nothing confirmed the clock (`proof.closing.unconfirmed`
  is true exactly on these). It **closes** the open check (`check_id`; every confirmation from Task
  R4b on has one). It **names** a record when the confirmed clock read more than a minute behind
  the latest record; that row is the **lift** (the old "restart"). A confirmation of a waiting
  check names none: the stop had already ended.
- The **start of a stop**, corrected: the closing's `confirmed_at` less the boot-time clock's
  elapsed time since the check opened, when the boot id is the same at both ends; otherwise the
  closing's `confirmed_at`, flagged `partial`. The opening's boot reading and id are in the check's
  `detail`; the closing's, and the corrected start worked out from them, are stored in the
  confirmation's `proof.closing` when it is written, and every later read uses only those stored
  values.
- **On the box**: a request whose connection comes from loopback or one of the box's own interface
  addresses (`requestFromBox`, `apps/server/src/request-from-box.ts`), with the app on the host's
  network.
- **Wrongly dated**: a record written before the check OPENED (its `secuencia` at most its node's
  entry in the check's `detail.heads`) whose generation time is more than 60 000 ms after the stored
  corrected start of the stop — for every closing except an `elapsed` one, which lists nothing
  (R6). The closing's own `proof.heads` plays no part in the list (FYI 9 says why the opening's are
  enough); it stays on a lift because the cover reads it (R2, decision 21's fail-closed `heads`).

## Decisions revisions 5–7 make

R1. **The tables** (Veri\*Factu set, one generated migration after `0010_clock_stop.sql`), both
    `appendOnly(…, "ledger", LEDGER)` in `classification.ts`, both in
    `packages/migrations/migrations.manifest.json`'s append-only list:
    - `clock_checks`: `id` (`newId`), `seq` integer not null (unique), `node_id` → `nodes`,
      `opened_at` ts (the box's reading), `reason` text (CHECK in `start`, `change`,
      `behind_chain`, `disagrees`), `detail` json (slice 9: `{ clockAt, bootMs, bootId,
      lastRecordAt, lastRecordId, heads }`; `lastRecordId` added in revision 7 for R7's `saleId`,
      inside the JSON, so no column changes).
    - `clock_confirmations`: `id`, `seq` integer not null (unique), `node_id` → `nodes`,
      `box_clock_at` ts (the box's reading when judged, before any step), `confirmed_at` ts (the time
      adopted; equal to `box_clock_at` until 9b), `step_ms` integer not null (0 until 9b), `source`
      text (CHECK in `authority`, `devices`, `admin`, `elapsed`), `person_id` text null (no foreign
      key: `persons` is in identity's set, which this set does not require), `reason` text (CHECK in
      `start`, `change`, `behind_chain`, `disagrees`, `unusable`), `proof` json, `check_id` →
      `clock_checks` null (unique), `registro_id` → `registros_facturacion` null (plain index),
      `record_at` ts null. CHECKs: `(source = 'admin') = (person_id is not null)`;
      `(registro_id is null) = (record_at is null)`. Every value 9b and 9c will write is declared
      now: a later CHECK change is a table rebuild (CLAUDE.md §3's drizzle-kit traps).
    - `seq` is `coalesce(max(seq), 0) + 1` read in the writing transaction; one write transaction
      at a time makes it unique (`packages/store/src/write-queue.ts`, `begin immediate` on the one
      write connection), and the unique index refuses a duplicate loudly. A comment at each `seq`
      column says so, and that it holds only while one node writes these tables at a time over a
      copy of the whole database: if `ledger` rows were ever drained back from another node, `seq`
      would need to become per node. Why not time order: the clock is what is in doubt.
R2. **The cover** (`clock-behind.ts` `uncoveredBy`): the confirmation with the largest `seq` whose
    `registro_id` is the latest record's; then decision 21's `heads` checks, `record_at` equal to the
    latest record's time, `gap ≤ (record_at − confirmed_at) + 60 000`, and the running maximum
    (decision 8c), exactly as built. No cap — so a reading up to a minute further back than the
    confirmed time is covered, and 61 s is not (pinned in Task R2).
R3. **When the box confirms by itself during a stop** (the clock watch, every 15 s; AEAT HEAD at
    most once a minute, only during a stop or while a check waits, R6): the stop proper holds
    (`clockBehindChain` non-null, so a covering lift counts; not before 28-10-2024); no
    AEAT witness taken during the stop disagrees; and either an AEAT witness agrees (source
    `authority`, devices attached if two agree too) or, with no AEAT witness at all, devices from two
    or more connection addresses that agree with each other agree with the box, and no such group
    disagrees (source `devices`). Witnesses as built: fresh (five minutes, no step since), taken
    during the stop (`clock-stop-restart.ts:86-88`: the box read behind the latest record when the
    witness was taken), not after the reading. After a confirmation the witness store is cleared.
    The closing of a check that waits after its stop ended is R6's, not this one.
R4. **When an administrator may confirm**: `person.admin`; not on the box (refused `same_machine`
    before anything else, at the challenge and at the confirm), except when `config.devMode`; the
    stop proper holds, or a check waits (R6) — else `not_stopped`; no AEAT witness taken during the
    stop disagrees (for a waiting check: no fresh AEAT witness), and no group of devices from two
    addresses disagrees (`contrary_proof`); a fresh challenge (≤ 5 000 ms by the steady clock, used
    once, kept per management session as `createSetupHourClock` keeps its challenges); the device's
    time agrees (`|deviceAt − boxAtMidpoint| + elapsed/2 ≤ 60 000`), else `differs`. Refusals are
    `clock.confirm_refused { reason }`, HTTP 409, except a missing permission (403
    `authorization.not_permitted`). The admin's reading goes into `proof.admin` as `{ boxAt,
    witnessAt, uncertaintyMs }`.
R5. **The confirmation row** (both paths): `seq`, the node, `box_clock_at = confirmed_at =` the one
    reading, `step_ms 0`, the source, `person_id` for `admin` only, `reason` the open check's (always
    `behind_chain` in this slice), `proof` = `{ authority, devices, admin, heads, closing }` (`heads`
    as decision 10, on a lift only, for the cover — never for the list; `closing` = `{ bootMs,
    bootId, correctedStart, partial, unconfirmed }`, R6), `check_id` the open check — and when none
    is open (an administrator confirming before the watch's first 15-second look), the seat opens
    one first in the same transaction, so every closing has an opening's `detail.heads` —,
    `registro_id` and `record_at` the latest record's on a lift, null when a waiting check is
    confirmed. In the same transaction: `clock.behind_chain_restarted` for a lift, and, when any
    record is wrongly dated or the closing is `unconfirmed`, `clock.records_misdated`. **Which task
    writes what:** Task R3 writes the row without `proof.closing` (its tests assert none); Task R4a
    builds `correctedStart` and writes `proof.closing` on the closing of a check whose stop came
    back (R6); Task R4a2 writes it on the closing of a check that waits; Task R4b
    writes it on the confirmation path (`clock-confirmation.ts`) and opens a check first when none
    is open.
R6. **The start of a stop, its end, and a check that waits.** The clock watch, on each look:
    - **Opening.** If the **stop proper** holds (`clockBehindChain` non-null, so a covering lift
      counts; not before 28-10-2024) and no check is open, it opens one (`reason: "behind_chain"`,
      `detail` with the reading, the boot milliseconds and boot id from the boot reader — Task R8's
      `boot-reader.ts`, whose id is `null` wherever the milliseconds do not come from `/proc/uptime`
      (round 4, M12), as on macOS — the latest record's time and id, and the chain heads). If the
      stop proper holds and a check is open whose `detail.heads` are behind the chain's heads now
      (a node's head past its stored entry, or a node missing from it), a record was written since
      it opened — which the chain append allows only at a reading where the stop proper did not hold
      (`chain.ts:136-140` → `clock-behind.ts:166-173`) — so its stop ended while it waited and a new
      stop has begun: in one transaction the watch closes it `elapsed` with `unconfirmed: true` and
      opens a new check, or the new stop's ahead-stamped records, written after the old opening,
      would be in no list. With the heads unmoved, the open check is this stop's.
    - **A lift.** A confirmation that lifts the stop (R3, R4) closes the open check. While its lift
      covers, the stop proper does not hold, so no new check opens, and real time later passing the
      ahead-stamped record writes nothing (round 3, C1).
    - **A check that waits** (round 3, I1; round 4, I1, M5, M7). If a `behind_chain` check is open and
      the stop proper no longer holds with no confirmation having closed it, the check **waits**: it
      blocks nothing (payments run; CLAUDE.md §5). The corrected start is right only when the clock
      at closing is, and the clock may have ended the stop by being set back by mistake, so the
      check closes only on a fresh witness. On each look the watch asks AEAT at most once a minute
      (the same limit as during a stop) and judges the fresh witnesses — five minutes old at most
      and no step of the clock since, as built, so a reading taken before the clock was put right
      does not count; R3's during-the-stop filter does not apply — AEAT first (FYI 6): a fresh AEAT
      witness agreeing closes it with source `authority` (devices attached if two agree too) and
      lists; a fresh AEAT witness disagreeing closes it `elapsed`, `unconfirmed: true`, listing
      nothing; with no fresh AEAT witness, a group of devices from two addresses agreeing, and none
      disagreeing, closes it with source `devices` and lists, and a disagreeing group closes it
      `elapsed`, `unconfirmed`; with nothing fresh it writes nothing and the check stays open. An
      administrator's agreeing device closes it too (R4, source `admin`). None of these names a
      record or records a restarted alert. **If no witness ever comes** (no internet, fewer than two
      devices, no administrator), the check stays open for as long as that lasts, the Box status
      page says the stop has ended and the clock is not yet confirmed (R11), and nothing else is
      blocked. A disagreement noted during the stop plays no part in this closing (it still blocks a
      lift during the stop, R3 and FYI 6): only the witnesses fresh when the check closes decide
      (round 4, M5; the model's case D3, T8).
    - Every closing stores `proof.closing` (Words) at the moment it is written, from the boot
      reader the seat is handed on every path — the watch's and the administrator's route alike
      (R10). A watch restarted mid-stop (the process restarted, same boot) finds the open check and
      keeps its stored start; one restarted while a check waits finds it waiting.
R7. **The alerts.** `clock.behind_chain_restarted` (warning, as built) gets params `{ confirmationId,
    confirmedBy, person, clockAt, lastRecordAt }`, `confirmedBy` worded by a list registered as
    `clock_confirmed_by`: `authority` "the tax agency's time" / "la hora de Hacienda", `devices` "two
    tills or handhelds" / "dos cajas o terminales", `admin` "an administrator's own device" / "el
    dispositivo de un administrador". `clock.records_misdated` (error; origin
    `jobOrigin("dashboard")`; `saleId` the earliest wrongly dated record's sale; params
    `{ confirmationId, count, from, to, partial, unconfirmed }`), area `box`, `system.manage`: the
    module claims the prefix `clock.records_misdated` beside `clock.behind_chain`. An `elapsed`
    (`unconfirmed`) closing still records it, with `count: 0`, `from` the check's opening reading and
    no `to`, as the owner's task: "the stop that began at {from} ended by itself, but nothing
    confirmed the box's clock, so the box cannot tell which sales were dated wrongly". Its `saleId` is
    the sale of the latest record when the check opened (`detail.lastRecordId`; every record has a
    sale, `registros.ts:49-50`; round 4, M8). That is never null for a `behind_chain` check, which
    opens only with a latest record (`clockBehindChain` answers null without one,
    `clock-behind.ts:149-154`); a slice 9c check opened on an empty chain would record it with no
    sale. Either way, a second such task naming the same sale (or none) while the first is open is
    dropped — `recordIncident` ends in `.onConflictDoNothing()` (`packages/core/src/incidents.ts:95-107`)
    and the open-incident key reads a null sale as `''` (`packages/db/src/schema/incidents.ts:64-70`)
    — so it folds into the open task, which already says the box cannot tell; both closings stay in
    `clock_confirmations`. No restarted alert for a closing that names no record (an `elapsed` one,
    or a waiting check's: nothing restarted payments but the clock itself).
R8. **The emails.** The managers' email duty also sends, once per incident id per process, an email
    for each open `clock.behind_chain_restarted` and `clock.records_misdated`. Words in Task R11.
R9. **On the box, and one witness per address.** `GET /api/device/equipment` notes a device's clock
    only when the request is not on the box, and with the connection's address; the admin routes
    refuse a request that is. Both read `requestFromBox`, injectable (`DeviceApiDeps.requestFromBox`,
    `BoxHealthApiDeps.requestFromBox`), as `promote-api.ts` does. `ClockWitness` gains an optional
    `address`; `judgeClockWitnesses` counts a group of agreeing (or disagreeing) devices by distinct
    address as well as distinct id: two device ids from one address are one witness.
R10. **The seat** (`packages/fiscal/src/backend.ts`): `restartAfterClockStop` is replaced by
    `confirmClockStop(tx, { reading, boot, witnesses, nodeId, admin? })`, and it gains
    `openClockCheck(tx, { reading, boot, … })`, `closeClockCheckByItself(tx, { reading, boot,
    witnesses })` (R6's waiting check: closes on a fresh witness, else writes nothing) and
    `misdatedRecords(tx, confirmationId)` (stored values only: the closing's `proof.closing` and its
    check's `detail.heads`); `boot` is `{ ms, id }` from one server-side boot reader
    (`apps/server/src/boot-reader.ts`, Task R8: `/proc/uptime` and the boot id, the id `null`
    whenever the milliseconds do not come from `/proc/uptime`) that the watch and the confirm route
    both use; `clockStopState` answers `proof: "none" | "contrary" |
    "ready" | "confirmed"` instead of `offer`, plus the confirmation that covers (source, person,
    `confirmedAt`); and `waitingClockCheck(tx, reading)` answers `{ checkId, openedAt } | null` for
    R6's waiting check — a method of its own, because `clockStopState` answers null whenever the
    reading is not behind the latest record (`packages/fiscal/src/backend.ts:276-282`), which is
    exactly when a check waits. All optional; only Veri\*Factu has them.
R11. **The Box status page**: the Clock row's words (no button), including a check that waits (R6);
    "Check with this device's time" for `person.admin` holders during a stop or while a check waits;
    the dialog; and a "Sales dated wrongly" section per open
    `clock.records_misdated`, listing invoice number and recorded time, read by `GET
    /api/box/clock-misdated` (`system.manage`, write-lock turn with no drain, like the health read).

## Changed test checks (revisions 5–7)

Each goes in a commit of its own whose message begins `Changed test checks (A798 slice 9 r6):`
(round 4, M14: one prefix throughout) and lists each `file:line` with before and after; the PR
names them.

**On `main` already** (a whole-shape list gaining entries, the owner's standing exception
2026-09-27, or a check the owner's answers change):
1. The append-only and schema guards that list tables gain `clock_checks` and `clock_confirmations`
   (Task R1). Expected from a grep for `clock_stop_restarts`: `scripts/append-only-triggers.test.ts`,
   `scripts/schema-constraints.test.ts`, `packages/fiscal-verifactu/src/schema-ownership.test.ts`,
   and whichever of `packages/fiscal-verifactu/src/outage-upgrade.test.ts` (`:32` filters the table)
   and `apps/server/src/hour-recovery-staged.test.ts` (`:81` drops it) pins a table list. Run them
   after generating; ONLY a failure naming one of the two new tables may be answered with a declared
   entry. Anything else is a STOP.
2. `packages/fiscal-verifactu/src/alerts.test.ts` (`FISCAL_ALERTS` `toEqual`) gains the
   `clock.records_misdated` claim (Task R4b).

No permission changes: `person.admin` exists, so the `ADMIN_ONLY` set pinned at
`packages/identity/src/permissions.test.ts:33-37` is untouched.

**On this branch only** (slice 9 as built, never on `main`; the owner's answers change what they
check), each in the task named:
- the cap: `packages/fiscal-verifactu/src/clock-behind.restart.test.ts:246` ("covers a step back of
  exactly 24 hours and not a second more": with no cap, `T − 24 h − 1 s` is recorded) and `:256`
  ("caps the cover at 24 hours even when the accepted gap is wider") (Task R2, T5);
  `clock-stop-restart.test.ts`'s "refuses a 25-hour gap", "refuses 24 hours and one second",
  "judges the gap before the proof" and "a gap over 24 hours is refused as too far…", and
  `clock-restart.route.test.ts`'s "refuses a restart 25 hours behind…" — gone with their files'
  moves (Tasks R3, R8);
- `clock-stop-restart.test.ts` → `clock-confirmation.test.ts` (Task R3); `clock-restart.route.test.ts`
  → `clock-confirm.route.test.ts`, its still-true cases moved (Task R8);
  `backend.clock-stop.test.ts` (Task R5);
- the restarted alert's params: `clock-stop-incidents.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`,
  `apps/dashboard/src/widgets/alerts-bell.test.ts:129-160`, `apps/dashboard/src/screens/alerts-screen.test.ts:90-106`
  (Tasks R4b2, R4c);
- the restart route and code in the dashboard: `apps/dashboard/src/api/client.test.ts:3255-3258`
  (`restartClockPayments`, `/api/box/clock-restart`), `apps/dashboard/src/i18n/codes.test.ts:744-749`
  (`clock.restart_refused`'s words; `codes.ts:1287` moves to `clock.confirm_refused`, CLAUDE.md §3:
  every copy of a deleted code goes in the same change) (Task R12a);
- every `too_far` and `stepped_back` case in `apps/dashboard/src/screens/box-status-rows.test.ts`
  and `box-status-screen.test.ts`, and the restart button and dialog cases in
  `box-status-screen.test.ts` and `box-status-screen.a11y.test.ts` (Tasks R12a, R12b);
- `apps/server/src/boot.box-health.test.ts:160` and `apps/server/src/box-health.test.ts:333`: the
  old `offer` (Task R10);
- `packages/fiscal-verifactu/src/backup-verification-history.test.ts`: two new "rejects internally
  damaged" rows, nothing changed (Task R1b).

**Must pass unedited:** `packages/fiscal-verifactu/src/write-path.e2e.test.ts` (the golden huella)
and `inmutabilidad.test.ts`; every other test on `main`. One that would need an edit not listed
above is a STOP.

## Global constraints (revision 5, beside the ones below the line)

- **The fiscal core is untouched**: `computeHuella`, `chain.ts`, `registro-row.ts`, invoice-number
  and series allocation, `registros_facturacion`'s immutability, `recordSale`, `recordCorrection`,
  `recordSubstitution`, A679's `hour-*.ts`. After every task touching `packages/fiscal-verifactu`,
  `packages/fiscal` or `packages/core`: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  inmutabilidad src/write-path.e2e.test.ts` passes, and
  `git diff main -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/registro-row.ts packages/core/src 'packages/fiscal-verifactu/src/hour-*' ':!packages/core/src/*.test.ts'`
  prints nothing.
- **One migration** (Task R1). After it, `git diff main --name-only -- '*/drizzle/*'
  packages/migrations` names only that migration, its snapshot, the journal and the manifest.
  `0010_clock_stop.sql` is never edited (CLAUDE.md §3).
- **No time from a device or AEAT is stamped on a record**: the box's clock stamps every record, and
  this slice sets no clock.
- **Nothing external blocks a sale** (CLAUDE.md §5): this slice adds only ways out of slice 8's stop,
  and a list.
- **No push between Tasks R5 and R10**: the seat's methods change in R5 and `apps/server` catches up
  by R10, so the pre-push hook's typecheck would fail in that span. Nothing in a campaign lane
  pushes mid-plan anyway; finish-branch pushes after R15.
- Every refusal test asserts the domain code and params, with a row count before and after; every
  refusal has a control that goes through. Server tests that record sales follow slice 8 decision 13
  (`docs/developers/testing-guide.md`).
- English only outside translation files (`scripts/english-only.test.ts`; review greps the diff).
- `apps/dashboard` runs in real headless Chromium: `memory_pressure | grep free` first.
- Implementers are dispatched as `subagent_type: "implementer"`; each task well under 100 tool calls;
  one past about 150 stops at a passing or cleanly red point, commits, and hands over.

## Review focus (revisions 5–7)

1. **No proof, no lift; contrary proof, no lift; AEAT outranks devices** (Tasks R3, R9).
2. **The wrongly dated list follows the stop's start, is bounded by the check's OPENING heads, and
   never lists a correctly dated sale in the cases the plan tests** (round 4, I1): a confirmation 90
   minutes late lists from the stop's start; sales made under a lift are never listed; a sale made
   after a stop ends by itself and before its closing is never listed (T8); a stop that ends by
   itself waits for a fresh witness — lists when one agrees, says it cannot tell when one
   disagrees, stays open (and says so) when none comes, and is not closed early by the once-a-minute
   limit; a clock set back by mistake and put right lists nothing (T8, D3); the list read later
   equals the alert's count; a restarted watch keeps the stored start; a machine restart falls back
   and says so (Tasks R4a, R4a2, R4b, R9). What the tests do not reach: a clock that was wrong while
   a check waited and right at its closing (FYI 9; slice 9c's change check).
3. **A 400-day gap lifts once proved; a further step back stops again; a fresh confirmation lifts
   again** (Tasks R2, R3) — the running maximum and fail-closed `heads` still proved by deletion.
4. **The box's own clock never counts**: a device on the box is not a witness; two device ids from
   one address are one witness; an administrator on the box is refused, at the challenge and at the
   confirm (Tasks R6a, R6b, R8).
5. **Only `person.admin` confirms by hand**; a manager gets 403 (Task R8).
6. **The fiscal core and the golden huella untouched.**

**Codex seat 1 (with this checklist).** Boot a server (`serverFixture`) on a venue whose clock is 400
days behind its latest sale: `GET /api/box/health` → stopped, `proof: "none"`, one open
`behind_chain` check; two equipment reads from two LAN devices at two addresses (`requestFromBox`
seam false) at the box's time → within one watch check the stop lifts, one `clock_confirmations`
row (`source: "devices"`) closing the check, `clock.behind_chain_restarted` and
`clock.records_misdated` open; `POST /api/pay` cash → 200; the misdated list names the 400-day-ahead
sale. Then: as a manager, `POST /api/box/clock-challenge` → 403; as an admin from the box (seam
true) → 409 `same_machine`. Delete, one at a time, the on-box check in `device-api.ts`, the
`person.admin` gate, the distinct-address count, the AEAT-disagrees block, the `seq` ordering in the
cover, the elapsed correction of the stop's start and the opening-heads bound of the list (swap in
the closing's); name the failing test.

**Codex seat 2 (checklist set aside).** Make the box lift without proof, or list a record wrongly:
one device's header sent from two browsers on one machine; two device cookies sending forged
matching headers from two addresses (expected: it lifts — FYI 12 says so; check it is recorded with
its proof); an admin `deviceAt` sent by `curl`; a challenge replayed or answered after six seconds;
an admin request carrying `X-Forwarded-For` from a LAN address while connected over loopback; a
confirmation row hand-inserted with `registro_id` set and `record_at` null; a step back after a lift,
then two devices; two confirmations racing; the server restarted mid-stop; a sale paid in the
seconds after a stop ends by itself (expected: never listed); a check left waiting with AEAT
unreachable (expected: open, payments running, the Box status page saying so).

## Tasks (revisions 5–7)

Run in order. Each: failing test first, watch it fail for the stated reason, minimal code, run
again, guards, commit (`git commit -s`, plain-English message; explicit paths, never `git add -A`).

### Task R1: The migration — `clock_checks` and `clock_confirmations`

**Files:** create `packages/fiscal-verifactu/src/schema/clock-checks.ts`,
`packages/fiscal-verifactu/src/schema/clock-confirmations.ts`,
`packages/fiscal-verifactu/src/clock-confirmations.test.ts`; modify the schema index the module's
migration descriptor reads (find it beside `schema/clock-stop-restarts.ts`'s export),
`packages/fiscal-verifactu/src/classification.ts`, `packages/migrations/migrations.manifest.json`;
generated: `packages/fiscal-verifactu/drizzle/0011_*.sql`, its snapshot and `_journal.json`.

- [ ] **Step 1: Failing tests** (`useVenueDb`, the module's migration set, the shape of
  `clock-stop-restarts.test.ts`): a full row of each table inserts, every declared `reason` and
  `source` value accepted; an `update` and a `delete` of each is refused by the append-only trigger
  (assert the code the existing restarts test asserts); `source: "admin"` with no `person_id`,
  `source: "devices"` with one, `source: "clock"`, `reason: "later"`, `registro_id` without
  `record_at` → each refused (CHECK), row count unchanged; a second row with the same `seq` →
  `UNIQUE constraint failed`; two confirmations with the same `check_id` → refused; two with the
  same `registro_id` → both kept; `check_id` naming no check, `node_id` naming no node → refused at
  the insert (CLAUDE.md §3: a key is proved by writing through it). Control: a valid row of each
  after each refusal inserts.
- [ ] **Step 2: Run, watch them fail** (`Cannot find module './schema/clock-confirmations.js'`):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-confirmations.test.ts`.
- [ ] **Step 3: Schema in TypeScript** (every key, unique index and CHECK declared there, CLAUDE.md
  §3; the `seq` comment of R1), then `pnpm --filter @waitron/fiscal-verifactu db:generate`. Read the
  generated SQL: it must only CREATE two tables and their indexes — no rebuild of an existing table.
  Anything else: STOP.
- [ ] **Step 4: Run** the new test → PASS; then the guards CLAUDE.md §3 names for a migration:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts
  scripts/journal-monotonic.test.ts scripts/append-only-migration-sets.test.ts
  scripts/classification-complete.test.ts scripts/apply-migrations-callers.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/module-graph-honesty.test.ts
  scripts/migration-upgrade.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  inmutabilidad src/schema-ownership.test.ts src/outage-upgrade.test.ts src/clock-stop-restarts.test.ts`
  and `pnpm --filter @waitron/server exec vitest run src/hour-recovery-staged.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run`. Read every failure: only a list missing one
  of the two new tables may be answered (declared change 1, its own commit). `person_id` needs
  nothing in `scripts/id-columns-are-references.test.ts`: that guard reads only transferred tables.
- [ ] **Step 5: Commit** (implementation; then declared change 1 alone).
  `git commit -s -m "Two append-only tables keep every clock check and every closing of one"`.

### Task R1b: The backup check learns the new tables' links

**Files:** `packages/fiscal-verifactu/src/backup-verification-history.ts` (`LINKS`, beside `:433-434`,
which stay), `packages/fiscal-verifactu/src/backup-verification-history.test.ts` (the fixture's
capture gains a check and a confirmation naming the sale's record; the "rejects internally damaged
%s" table, beside `:293-294`).

- [ ] **Step 1: Failing cases**: "confirmation record parent" (`update clock_confirmations set
  registro_id='missing'` — through a copy, as the existing rows do), "confirmation node parent",
  "confirmation check parent", "check node parent" → `invalid`.
- [ ] **Step 2: Run, watch them fail** (`passed` where `invalid` is expected):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-history.test.ts`.
- [ ] **Step 3: Implement** the four `LINKS` rows: `["clock_confirmations", "node_id", "nodes",
  "id"]`, `["clock_confirmations", "registro_id", "registros_facturacion", "id"]`,
  `["clock_confirmations", "check_id", "clock_checks", "id"]`, `["clock_checks", "node_id", "nodes",
  "id"]`; read how the verifier treats a nullable column first, and add a case that a confirmation
  with `registro_id` NULL passes.
- [ ] **Step 4: Run** → PASS, every existing case unedited. Commit
  `"The backup check refuses a copy whose clock checks or confirmations name a missing node, record or check"`.

### Task R2: The cover reads the confirmations, with no cap

**Files:** `packages/fiscal-verifactu/src/clock-behind.ts` (`uncoveredBy`; delete `RESTART_CAP_MS`),
`packages/fiscal-verifactu/src/clock-behind.restart.test.ts` (branch-only).

- [ ] **Step 1: Failing tests.** The file's restart-row helper inserts a `clock_confirmations` row
  (`seq` next, `source: "devices"`, `reason: "behind_chain"`, `proof: { heads }`). Every existing case
  keeps its readings and answers except the two cap cases (T5): `:246` becomes "covers a reading a
  minute further back than the confirmed time, not 61 s": confirmed at `T − 24 h`, a sale at
  `T − 24 h − 60 s` recorded, at `T − 24 h − 61 s` refused; `:256` becomes "a 400-day gap is
  covered": confirmed at `T − 400 days`, a sale at `T − 400 days + 1 min` recorded, its
  `anterior_huella` the first's `huella`. New cases: (a) a confirmation with `registro_id` null
  covers nothing; (b) two confirmations naming the latest record — the second (larger `seq`) with a
  too-large head → the stop stays (the latest governs, and fails closed); (c) a lift, sales at
  R + 1 min and R + 10 h, the clock back to R + 30 min → `clock.behind_chain`; a new confirmation at
  R + 30 min (larger `seq`, `heads` read now) → a sale at R + 31 min recorded.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind.restart.test.ts`.
- [ ] **Step 3: Implement** R2.
- [ ] **Step 4: Run** it and `src/clock-behind.test.ts src/chain.clock-behind.test.ts
  src/clock-behind-alerts.test.ts src/staff-notices.test.ts src/backend.clock-behind.test.ts
  inmutabilidad src/write-path.e2e.test.ts src/chain.test.ts src/chain.concurrency.test.ts` → PASS;
  the fiscal-core check prints nothing.
- [ ] **Step 5: Proofs by deletion**, each restored: order by `seq asc` → case (b) records; drop the
  running maximum → case 3b records (S11); drop the `heads` bound → case 8b's too-large head records
  (S12); a 24 h cap put back → the 400-day case refuses; the margin dropped → the 60 s case refuses.
- [ ] **Step 6: Commit** in two: the implementation with the new cases, then the two changed cap
  cases alone (`Changed test checks (A798 slice 9 r6): …:246 and :256, the cap is gone`).

### Task R3: The confirmation rule

**Files:** `git mv packages/fiscal-verifactu/src/clock-stop-restart.ts
packages/fiscal-verifactu/src/clock-confirmation.ts` and its test to `clock-confirmation.test.ts`;
`packages/fiscal-verifactu/src/errors.ts` (`clock.confirm_refused { reason: "not_stopped" |
"contrary_proof" | "differs" | "same_machine" | "challenge" }`; `clock.restart_refused` deleted —
pre-live, CLAUDE.md §3). Witness fixtures gain `address`.

- [ ] **Step 1: Failing tests** (the old file's fixtures; witnesses with `boxAt` behind `T`; an open
  `behind_chain` check written first by `openClockCheck`, Task R4a — until then by a raw insert):
  1. no witness → `clockStopState.proof "none"`, `confirmClockStop` automatic → `{ confirmation:
     null }`, rows unchanged;
  2. two agreeing devices from two addresses → `"ready"`; automatic → one row (`source "devices"`,
     `person_id` null, `reason "behind_chain"`, `check_id` the open check, `registro_id` the latest,
     `proof.heads` equal to `chainHeads` read just before); a sale at the reading → recorded;
     `clockStopState.proof` then `"confirmed"`;
  3. the same two device ids from ONE address → `"none"`, nothing written;
  4. AEAT agreeing plus two devices DISagreeing → confirmed, `source "authority"`; AEAT disagreeing
     (10 minutes old, no step) plus two agreeing devices → `"contrary"`, nothing written;
  5. admin agreeing (`|diff| + uncertainty = 60 000`) → row `source "admin"`, `person_id` set,
     `proof.admin` stored; 60 001 → refused `differs`; with AEAT disagreeing → `contrary_proof`;
     with two devices from two addresses disagreeing → `contrary_proof`; not stopped →
     `not_stopped`; each refusal writes nothing;
  6. a 400-day gap with proof → confirmed (no cap);
  7. witnesses taken before the stop → `"none"`;
  8. after a lift, a sale, then a reading 2 min behind it → `"none"` (the stop is on again); a fresh
     check opens; fresh devices → a second row, larger `seq`, same `registro_id`, closing the new check;
  9. a reading before 28-10-2024 → `clock.unusable` for admin, `null` state.
- [ ] **Step 2: Run, watch them fail**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/clock-confirmation.test.ts`.
- [ ] **Step 3: Implement** R3, R4 and R5 without `proof.closing`, without opening a check when
  none is open, and without alerts or a list (Tasks R4a2, R4b, R4b2); the rows this task writes carry
  no `proof.closing`, and no case here asserts one.
- [ ] **Step 4:** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`
  → PASS; typecheck the package; the fiscal-core check.
- [ ] **Step 5: Proofs by deletion**: the AEAT-disagrees block → case 4's second half writes; the
  admin bound `≤` → `<` → case 5 refuses at exactly 60 000; the during-the-stop filter → case 7
  writes. Commit `"The box confirms its clock during a payment stop on AEAT's time, two agreeing devices or an administrator's device, and keeps each confirmation"`.

### Task R4a: When a stop began

**Files:** create `packages/fiscal-verifactu/src/clock-checks.ts` (`openClockCheck`,
`openCheck(tx)`, `correctedStart(check, closing)`) and `clock-checks.test.ts`.

- [ ] **Step 1: Failing tests**: opening a `behind_chain` check stores R6's detail, `lastRecordId`
  included; opening again while it is open answers the same row (count 1); with a newer closed check
  above an older open one (a restored database), nothing is open; **under a covering lift (the raw
  comparison still behind, the stop proper not) `openClockCheck` from the watch's rule writes
  nothing** (round 3, C1). **The stop back after the check waited** (R6; round 4, I1): a check open,
  a sale recorded while the stop proper did not hold (the chain's head now past `detail.heads`), the
  stop proper holding again → one `elapsed` confirmation closing the old check with
  `proof.closing.unconfirmed: true` and one new check whose `detail.heads` include that sale, in one
  transaction; the control, the stop proper holding with the heads unmoved → the open check answered,
  nothing written. `correctedStart`: the same boot id, opened at boot 1 000 000 ms and closed at boot
  6 400 000 ms with `confirmed_at` 11:30 → 10:00 (the review's worked example); different boot ids,
  or a `null` one → the closing's time and `partial: true`; a boot clock that went backwards, or a
  `NaN` reading (`elapsedClock`'s answer to a failed later read, `apps/server/src/clock-watch.ts:27-46`)
  → the same fallback.
- [ ] **Step 2: Run, watch them fail** (`Cannot find module './clock-checks.js'`):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-checks.test.ts`.
- [ ] **Step 3: Implement.** Step 4: the fiscal-core check; commit
  `"The box records when each clock stop began"`.

### Task R4a2: A stop that ends by itself, and a check that waits for its witness

**Files:** `packages/fiscal-verifactu/src/clock-checks.ts` (`closeClockCheckByItself`,
`waitingClockCheck`), `clock-checks.test.ts`.

- [ ] **Step 1: Failing tests** (R6's waiting check; rows only — the list is Task R4b's):
  `closeClockCheckByItself` while the stop proper still holds writes nothing; under a covering lift
  it writes nothing (round 3, C1); with the stop proper ended and a fresh AEAT witness agreeing → one
  confirmation, `source "authority"`, `registro_id` null, `step_ms 0`, `proof.closing` stored with
  `unconfirmed: false`, closing the check; with no AEAT witness and two devices from two addresses
  agreeing → `source "devices"`, the same shape; AEAT agreeing and two devices disagreeing →
  `authority` (FYI 6). **Round 3's case B** (the clock correct, set 30 minutes back by mistake at
  10:00, sales every 5 minutes, the stop ending by itself when the wrong clock reaches the last
  sale): (i) a fresh AEAT witness disagreeing → an `elapsed` confirmation, `proof.closing.unconfirmed:
  true`; (ii) a disagreeing device group from two addresses and no AEAT witness → the same; (iii)
  **no fresh witness at all → nothing written, the check still open, `waitingClockCheck` answers it**
  (round 4, M7: the check waits rather than closing `unconfirmed`); (iv) a witness taken before a
  step of the clock (stale under "no step since") → as (iii). Control: the clock right and an AEAT
  witness agreeing → closed `authority`, `unconfirmed: false`. `waitingClockCheck` answers null
  while the stop proper holds and when no check is open.
- [ ] **Step 2: Run, watch them fail** (`closeClockCheckByItself is not a function`): as Task R4a.
- [ ] **Step 3: Implement.** Step 4: the fiscal-core check; commit
  `"A clock check whose stop ended by itself closes only on a fresh witness"`.

### Task R4b: The wrongly dated list and its alert (the fiscal half)

**Files:** `packages/fiscal-verifactu/src/clock-stop-incidents.ts` (`clock.records_misdated`, R7),
create `packages/fiscal-verifactu/src/clock-misdated.ts` (`misdatedRecords(tx, confirmationId)`:
invoice series and number, generation time and offset, record id, ordered by time; reads only the
closing's stored `proof.closing` and its check's `detail.heads`, never a clock and never the
closing's `proof.heads`), `clock-confirmation.ts` (write `proof.closing`; open a check first when
none is open, R5) and `clock-checks.ts` (record `clock.records_misdated` at each closing that finds
any or is `unconfirmed`), `alerts.ts` (the claim), `errors.ts` (params); tests
`clock-misdated.test.ts`, `clock-stop-incidents.test.ts`; declared change 2 in its own commit. The
dashboard's words are Task R4c.

- [ ] **Step 1: Failing tests.**
  1. **The worked example (round 1, C1):** the clock 2 h ahead from 08:00 to 10:00 real time, so
     sales stamped 10:00–12:00; at 10:00 the clock put right and the stop opens (boot clock B); an
     administrator confirms at 11:30 (boot B + 90 min) → listed: every sale stamped after 10:01;
     not listed: one stamped at 10:00:30. The confirmation row carries `proof.closing`.
  1b. **No check open yet:** the same, with the administrator confirming before any check was
     opened → one check opened and closed in the same transaction; the list is case 1's, bounded by
     that check's `detail.heads`.
  2. **A stop that ends by itself**: the same sales, no confirmation; real time passes 12:00 and an
     AEAT witness then agrees → a closing with `source "authority"` naming no record, and
     `clock.records_misdated` with the same list; no `clock.behind_chain_restarted`. With an AEAT
     witness disagreeing instead → an `elapsed` closing and `clock.records_misdated` with `count: 0`,
     `unconfirmed: true`, `from` the opening reading, no `to`, and `saleId` the sale of the record
     named by the check's `detail.lastRecordId` (round 4, M8).
  2b. **After the lift (round 3, C1, the model's case A):** the lift at 11:30, then a sale every 5
     minutes until 13:00 → exactly one `clock.records_misdated` (23 records, 10:05–11:55); none of the
     sales made under the lift (11:35–11:50 real time) is ever listed.
  2c. **The list does not move (round 3, I2):** two sales recorded after the closing, then
     `misdatedRecords` read again → exactly the records the alert counted (it takes no clock; the
     route-level version with the boot reader moved is in Task R10).
  3. **A watch restarted mid-stop** (same boot id): the open check's stored start is used — the list
     is case 1's.
  4. **A machine restart mid-stop** (different boot id) → only sales stamped after the closing time
     plus a minute, `partial: true`.
  5. The boundary: records at corrected start `+ 60 000 ms` (not listed) and `+ 60 001 ms`
     (listed); a record written after the check opened (past its `detail.heads`) not listed.
  5b. **A sale between the stop's end and the closing (round 4, I1, T8's W):** case 2's sales, the
     stop ending by itself at 11:54:00, two sales recorded at 11:54:02 and 11:54:04, AEAT agreeing at
     11:54:06 → 23 listed (10:05–11:55), neither of the two. Fails first against a list bounded by
     the closing's heads (25).
  5c. **Set back by mistake and put right (round 4, M5, T8's D3):** the clock correct, set 30 minutes
     back at 10:00 (the stop opens), an AEAT witness disagreeing during the stop, the clock put right
     at 10:10, a sale at 10:10:02, AEAT agreeing at 10:10:06 → a closing with `source "authority"`,
     not `unconfirmed`, and nothing listed (no `clock.records_misdated`). Fails first against a rule
     that still asks that nothing disagreed during the stop (`unconfirmed`).
  6. A second `unconfirmed` closing naming the same sale while the first's task is open → still one
     open `clock.records_misdated`; both closings in `clock_confirmations` (R7).
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-misdated.test.ts src/clock-stop-incidents.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit** `"Sales dated wrongly during a clock stop are listed for the owner, bounded by when the stop began"`,
  then declared change 2 alone; after it `pnpm exec vitest run scripts/alert-codes.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run` → PASS.

### Task R4b2: The restarted alert, and the disproof reading the new table

**Files:** `packages/fiscal-verifactu/src/clock-stop-incidents.ts` (restarted params R7;
`recordDisproofs` picks confirmations naming a record whose `[confirmed_at, record_at)` holds
`trustedUntil`), `clock-confirmation.ts` (record the restarted alert for a lift only),
`errors.ts` (params); test `clock-stop-incidents.test.ts`.

- [ ] **Step 1: Failing tests.** 1. A lift records `clock.behind_chain_restarted` carrying
  `confirmedBy` and `person` (`null` unless admin); an administrator's confirmation of a waiting
  check, and an `elapsed` closing, record none. 2. The built disproof case, re-pointed at a
  confirmation row, still records one `clock.behind_chain_disproved` with `from`/`to` by time.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-incidents.test.ts`.
- [ ] **Step 3: Implement.** Step 4: the fiscal-core check; commit
  `"The restart alert says what confirmed the clock, and the disproof reads the confirmations"`.

### Task R4c: The alerts' words in the dashboard

**Files:** `apps/dashboard/src/i18n/alert-messages.ts` (words; list `clock_confirmed_by` in
`ALERT_WORDS`), tests `apps/dashboard/src/i18n/alerts.test.ts`,
`apps/dashboard/src/widgets/alerts-bell.test.ts:129-160` and
`apps/dashboard/src/screens/alerts-screen.test.ts:90-106` (params rebuilt; branch-only).

- [ ] **Step 1: Failing tests**: `alertMessage` in EN and ES for each `confirmedBy`, an unknown value,
  `partial` true and false, and `unconfirmed` (no `—`, no `{` left, and no "0 sales"); the bell and
  the alerts screen render a restarted, a misdated and an `unconfirmed` misdated alert.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alerts-bell.test.ts src/screens/alerts-screen.test.ts`
  (Chromium: memory first).
- [ ] **Step 3: Implement.** Words: `clock.records_misdated` EN "{count} sales were recorded with a
  time later than the real time (from {from:minute} to {to:minute}). They stay as recorded. Go
  through them with your tax adviser; the list is on the Box status page." / ES "Se registraron
  {count} ventas con una hora posterior a la real (de {from:minute} a {to:minute}). Quedan como se
  registraron. Revísalas con tu asesor; la lista está en Estado del equipo." With `partial`, a
  sentence after it: "The box restarted during the stop, so the list may be short." / "El equipo se
  reinició durante la parada, así que puede faltar alguna." With `unconfirmed`, instead: "The
  payment stop that began at {from:minute} ended by itself, but nothing confirmed the box's clock, so
  the box cannot tell which sales were dated wrongly. Check the box's clock, and go through the sales
  since then with your tax adviser." / "La parada de cobros que empezó a las {from:minute} terminó
  sola, pero nada confirmó la hora del equipo, así que el equipo no puede saber qué ventas tienen la
  fecha mal. Comprueba la hora del equipo y revisa con tu asesor las ventas desde entonces."
  `clock.behind_chain_restarted` EN
  "Payments restarted on the box's clock ({clockAt:minute}), earlier than the last sale
  ({lastRecordAt:minute}), once {confirmedBy:clock_confirmed_by} confirmed it." / ES "Se reanudaron
  los cobros con la hora del equipo ({clockAt:minute}), anterior a la última venta
  ({lastRecordAt:minute}), al confirmarla {confirmedBy:clock_confirmed_by}."
- [ ] **Step 4:** `pnpm exec vitest run scripts/alert-codes.test.ts scripts/english-only.test.ts` →
  PASS. Commit `"Words for the restart and the wrongly dated sales in the bell"`.

### Task R5: The seat

**Files:** `packages/fiscal/src/backend.ts` (R10's types and methods; `ClockRestart*` types
deleted), `packages/fiscal/src/index.ts`, `packages/fiscal-verifactu/src/backend.ts`,
`packages/fiscal-verifactu/src/backend.clock-stop.test.ts`, the fake's and `fiscal-none`'s tests.

- [ ] **Step 1: Failing tests**: Veri\*Factu's backend answers `clockStopState`, `confirmClockStop`,
  `openClockCheck`, `closeClockCheckByItself`, `waitingClockCheck` and `misdatedRecords` as Tasks
  R3–R4b2 do; `NoneBackend` and `FakeFiscalBackend` have none of them; `"restartAfterClockStop" in backend` is false.
- [ ] **Step 2: Run, watch them fail**: `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/backend.clock-stop.test.ts`.
- [ ] **Step 3: Implement.** Step 4: `pnpm --filter @waitron/fiscal exec vitest run
  src/no-regime-vocabulary.test.ts`; `pnpm exec vitest run scripts/module-seams.test.ts
  scripts/workspace-cycles.test.ts` → PASS. The workspace typecheck waits for Task R10 (no push in
  between). Commit `"The fiscal seat confirms the clock, records when a stop began, and lists wrongly dated records"`.

### Task R6a: One witness per address

**Files:** `packages/fiscal/src/clock-witnesses.ts` (`address?` on `ClockWitness`; groups counted by
distinct address and distinct id), `packages/fiscal/src/clock-witnesses.test.ts`,
`apps/server/src/clock-witnesses.ts` (`noteDevice(deviceId, address, deviceMs, arrived)`; the latest
reading per device id), its test.

- [ ] **Step 1: Failing tests**: two ids agreeing from one address → no group; from two addresses →
  a group of two; three ids over two addresses → a group counted as two; a disagreeing group from one
  address → no `devicesDisagreeing`; a witness with no address (an older caller) counts by id alone.
  `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/clock-witnesses.test.ts`.
- [ ] **Step 2: Implement**; then `pnpm --filter @waitron/fiscal mutation` (local only; memory
  first) — at or above the break of 90, every surviving mutant in `clock-witnesses.ts` killed or
  named. Commit `"Two tills count as two witnesses only from two different addresses"`.

### Task R6b: A device on the box is never a witness

**Files:** `apps/server/src/device-api.ts` (`requestFromBox` dep; note the clock only when false,
with the connection's address from `getConnInfo`), `apps/server/src/device-equipment-api.test.ts`,
`apps/server/src/boot.ts` (pass `seams.requestFromBox`).

- [ ] **Step 1: Failing tests** — **refusal 1 of the owner's two**: an equipment read with
  `x-waitron-device-clock` on the box (`requestFromBox: () => true`) → `noteDevice` not called; from
  a LAN device (`false`) → called once with its address. Through the real check: an `app.request`
  with `env.incoming.socket.remoteAddress` `192.168.10.20` and injected interfaces naming it → not
  called; `192.168.10.31` → called (the shape of `request-from-box.test.ts`).
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/device-equipment-api.test.ts`.
- [ ] **Step 3: Implement.** Existing cases that note a clock through `app.request` (no socket, so
  "on the box", claim check T7) gain `requestFromBox: () => false` in their setup — a setup change,
  no assertion. Proof by deletion: drop the check → the on-box cases fail. Commit
  `"A till or browser running on the box itself never counts as a clock witness"`.

### Task R7: (dropped by the runner's ruling on round 1, I1 — `person.admin` is used; no permission is added)

### Task R8: The administrator's confirmation routes

**Files:** `apps/server/src/box-health-api.ts` (delete the restart route; add `POST
/api/box/clock-challenge` and `POST /api/box/clock-confirm`, both `person.admin`; `STATUS` gains
`"clock.confirm_refused": 409`; deps `requestFromBox`, `devMode`, a challenge keeper, the steady
clock, and the boot reader, passed to `confirmClockStop` so the administrator's closing stores
`proof.closing` too — round 3, I2), create `apps/server/src/clock-challenges.ts` (+ test) and
**`apps/server/src/boot-reader.ts`** (+ `boot-reader.test.ts`; created here because this task is
its first user, round 4 M4; Task R9's watch uses the same one), `apps/server/src/boot.ts`;
`git mv apps/server/src/clock-restart.route.test.ts apps/server/src/clock-confirm.route.test.ts`.

**The boot reader** (round 4, M12): `readBoot(): { ms, id }`. It reads `/proc/uptime` itself (an
injectable file reader, as the watch's `uptimeMs` reads it, `apps/server/src/clock-watch.ts:23-25`)
and, only when that gave a finite number, `/proc/sys/kernel/random/boot_id`; whenever the
milliseconds come from anywhere else — `performance.now()`, the fallback `elapsedClock` uses
(`clock-watch.ts:27-46`), or `NaN` from a failed later read — `id` is `null`, so a process restart
can never pair two different counters under one boot id; `null` makes R4a's `correctedStart` take
the `partial` fallback.

- [ ] **Step 1: Failing tests** (own database; slice 8 decision 13's clock rules):
  1. a manager (`system.manage`, no `person.admin`) → 403 on both routes; no session → 401; a till
     PIN session → 401 `management_session.required`;
  2. **refusal 2 of the owner's two**: an admin on the box (seam true, `devMode` false) → challenge
     refused `clock.confirm_refused { reason: "same_machine" }`; a confirm with a challenge obtained
     off the box but sent from the box → refused the same; nothing written. Controls: off the box →
     200 and a row; on the box with `devMode` true → 200;
  3. a challenge answered after 5 001 ms (injected steady clock), twice, or unknown → `challenge`;
  4. a device 61 s off → `differs`; AEAT disagreeing noted → `contrary_proof`; not stopped →
     `not_stopped`; a body that is not `{ challengeId: string, deviceAt: safe integer }` → 400
     `management.request_invalid`;
  5. after a 200: `POST /api/sales` cash → 200; marking `clock.behind_chain_restarted` handled →
     a second sale 200 (moved from the old file);
  6. two confirms at once with two challenges → one row, the second `not_stopped` (moved, re-aimed);
  7. the administrator's confirmation row carries `proof.closing` with the injected boot reading;
  8. **a check that waits** (R6): the stop ended by itself, no witness → an administrator's agreeing
     device → 200, a row with `source "admin"` naming no record, closing the check, the list
     recorded, no `clock.behind_chain_restarted`; with no stop and no open check → `not_stopped`;
  9. `boot-reader.test.ts` (failing first, `Cannot find module './boot-reader.js'`): `/proc/uptime`
     readable → its milliseconds and the boot id; unreadable → `performance.now()`'s and `id: null`;
     readable at first, then a read failing → `ms` `NaN` and `id: null`; the boot id file unreadable
     with `/proc/uptime` readable → `id: null`.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/clock-confirm.route.test.ts src/clock-challenges.test.ts src/boot-reader.test.ts`.
- [ ] **Step 3: Implement** R4. One `withTransaction` per request; the on-box check first.
- [ ] **Step 4:** typecheck; `pnpm exec vitest run scripts/module-seams.test.ts
  scripts/write-path-tables.test.ts`; proofs by deletion of the on-box check (case 2 fails) and of
  the permission (case 1 fails). Commit
  `"An administrator can confirm the box's clock with their own phone or computer, never from the box's own screen"`.

### Task R9: The clock watch records stops and restarts payments by itself

**Files:** `apps/server/src/clock-watch.ts` (every 15 s; R6's opening, including the stop back after
records were written while a check waited; the HEAD at most once per 60 s during a stop;
`confirmClockStop` in a transaction when `clockStopState.proof` is `"ready"`; `store.clear()` after a
confirmation; logs `clock_watch.stop_opened`, `clock_watch.confirmed { confirmationId, source }`;
the boot reader from Task R8, injectable; `PENDING_MAX`'s comment, "a day of minutely checks"
(`clock-watch.ts:48-49`), corrected to the new interval), `apps/server/src/clock-witnesses.ts`
(`clear()`), `apps/server/src/boot.ts` (hand the watch Task R8's boot reader), tests
`clock-watch.test.ts`, `clock-witnesses.test.ts`, `boot.clock-watch.test.ts`.

- [ ] **Step 1: Failing tests, the round-3 case first** (round 3, C1; the model's case A through the
  real watch over a real database, injected wall and boot clocks, and an AEAT fake that agrees with
  the box after the lift): the clock 2 h ahead 08:00–10:00, a sale every 5 minutes, put right at
  10:00, an administrator's confirmation at 11:30, sales every 5 minutes until 13:00 → after the
  lift, 20 watch checks while it covers open no check; real time passing the ahead-stamped record at
  12:00 writes no closing and no second `clock.records_misdated`. **Proof by deletion** (round 4,
  M6): the watch's test switched back to the raw comparison → the "opens no check" assertion fails
  (a second check opens at the first look after the lift), and, because the AEAT fake agrees after
  the lift, a second closing and a second `clock.records_misdated` follow when real time passes
  12:00 — without that fake the second check would only wait, open, and list nothing. Then: the
  first look that sees a stop opens one check with the reading, boot reading and boot id; the next
  look opens none; ready → one confirm call, the store cleared; none → no call; a failing confirm
  logs `clock_watch.check_failed` and the next look runs; four looks in a minute make at most one
  HEAD; a watch built afresh over a database with an open check opens none and later closes it with
  the stored start; `stop` during a confirm waits for it.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts src/clock-witnesses.test.ts src/boot.clock-watch.test.ts`.
- [ ] **Step 3: Implement.** Step 4: `src/boot.failed-start.test.ts` PASS. Commit
  `"The box records when a clock stop began and restarts payments by itself as soon as AEAT or two tills confirm its clock"`.

### Task R9b: The clock watch closes a check that waits, and only on a fresh witness

**Files:** `apps/server/src/clock-watch.ts` (R6's waiting check: `waitingClockCheck`, then
`closeClockCheckByItself` on each look; the HEAD widened to "during a stop or while a check waits",
still at most once per 60 s — as built it is asked only when the stop read is non-null,
`clock-watch.ts:164-173`; log `clock_watch.check_closed { confirmationId, source }`), tests
`clock-watch.test.ts`, `boot.clock-watch.test.ts`.

- [ ] **Step 1: Failing tests** (injected wall, boot and steady clocks; an AEAT fake):
  1. **The limit does not close a check early** (round 4, M7): during a stop AEAT is asked at T
     (it disagrees: the clock is behind); the clock is put right at T + 20 s (a step, so that
     reading is no longer fresh); the look at T + 30 s makes no HEAD (under a minute) and writes
     nothing — the check still open, no `unconfirmed` closing; the first look at or after T + 60 s
     asks AEAT, which agrees → one closing, `source "authority"`, not `unconfirmed`, nothing listed
     (T8's D3: the clock was behind, so nothing was stamped ahead). Fails first against revision 6's
     rule, which closed `unconfirmed` at T + 30 s.
  2. **No witness ever comes:** the stop ends by itself, the AEAT fake answers `null` (unreachable),
     no devices: 40 looks (10 minutes) → no closing, the check open, one HEAD a minute, a sale
     through `POST /api/sales` → 200 (the waiting check blocks nothing), and `GET /api/box/health`
     names the waiting check's start (Task R10's field; until R10 lands, assert
     `waitingClockCheck`); then two devices from two addresses agree → one closing, `source
     "devices"`.
  3. A fresh AEAT witness disagreeing while the check waits → one `elapsed` closing, `unconfirmed`.
  4. **The stop back while the check waits** (R6): the stop ends, a sale is recorded, the clock
     steps back again → at the next look the old check closes `elapsed` (`unconfirmed`) and one new
     check opens; with no sale in between → no closing, the same check open.
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts src/boot.clock-watch.test.ts`.
- [ ] **Step 3: Implement.** Step 4: `src/boot.failed-start.test.ts` PASS. Commit
  `"A clock check whose stop ended by itself waits for AEAT's next answer, two tills or an administrator"`.

### Task R10: The Box status read and the wrongly dated list

**Files:** `apps/server/src/box-health.ts` (`clockStop` view: `proof`, the covering confirmation with
the person's display name, `misdatedOpen: [{ confirmationId, count, partial, unconfirmed }]`
(round 4, M3); and beside `clockStop`, `clockCheckWaiting: { since } | null` from the seat's
`waitingClockCheck`, R6 and R10 — its own field, because `clockStop` is null whenever the reading is
not behind, which is exactly when a check waits),
`apps/server/src/box-health-api.ts` (`GET /api/box/clock-misdated`), `apps/server/src/boot.ts`,
tests `box-health.test.ts`, `clock-confirm.route.test.ts`; and two branch-only lines that pinned the
old offer, which the owner's removal of the button retires (round 3, M4; `git show origin/main:<file>
| grep -c 'offer: "no_proof"'` printed 0 for both, so neither is on `main`):
`apps/server/src/boot.box-health.test.ts:160` (`toMatchObject({ offer: "no_proof", restart: null })`
→ `{ proof: "none", confirmation: null }`) and `apps/server/src/box-health.test.ts:333`
(`{ offer: "no_proof" } as ClockStopView` → `{ proof: "none" }`), each in its own `Changed test
checks (A798 slice 9 r6):` commit.

- [ ] **Step 1: Failing tests**: health during a stop → `proof "none"`, then `"ready"` with device
  labels, then `"confirmed"` with source and person; after a stop that ended by itself with no
  witness → `clockStop` null and `clockCheckWaiting.since` the check's opening reading, then null
  once a witness closes it; an `unconfirmed` incident → `misdatedOpen` carries `unconfirmed: true`
  and `count: 0`; `GET /api/box/clock-misdated` → the listed records with invoice number and time,
  `system.manage` only, and an empty list once the incident is marked handled; **read again with the
  injected boot reader moved an hour on and two sales recorded since → the same records** (round 4's
  note on R4b case 2c: the route is where a boot clock could leak in); both answer on a full disk
  with a change waiting (the existing full-disk case's shape).
- [ ] **Step 2: Run, watch them fail**:
  `pnpm --filter @waitron/server exec vitest run src/box-health.test.ts src/clock-confirm.route.test.ts`.
- [ ] **Step 3: Implement.** Then `pnpm --filter "...@waitron/fiscal" --workspace-concurrency 4
  typecheck` exits 0 (Task R5's deferred check). Commit
  `"The Box status read says what proof the box has, who confirmed the clock, and which sales are dated wrongly"`.

### Task R11: The managers' emails for a restart and for wrongly dated sales

**Files:** `apps/server/src/box-alert-email.ts` (open incidents of the two codes, once per incident id
per process; the time placeholders gain `from`/`to` in the venue's offset),
`apps/server/src/i18n/box-emails.ts`, tests `box-alert-email.test.ts`,
`box-alert-email.duty.test.ts`.

**Words.** `clock.behind_chain_restarted`: subject EN "Payments restarted at {venue}" / ES "Se
reanudaron los cobros en {venue}"; text EN "The box's clock was confirmed by {confirmedBy} and
payments started again. Sales recorded with a later time than the real one are listed on the Box
status page (in the dashboard, Settings → Box status)." / ES "La hora del equipo se confirmó con
{confirmedBy} y se volvió a cobrar. Las ventas registradas con una hora posterior a la real están en
Estado del equipo (en el panel de gestión, Ajustes → Estado del equipo)." `clock.records_misdated`:
subject EN "Sales dated wrongly at {venue}: check them with your tax adviser" / ES "Ventas con fecha
incorrecta en {venue}: revísalas con tu asesor"; text EN "{count} sales were recorded with a time
later than the real time, from {from} to {to}. They stay as recorded. The list is on the Box status
page; go through it with your tax adviser and then mark the alert as handled." / ES "Se registraron
{count} ventas con una hora posterior a la real, de {from} a {to}. Quedan como se registraron. La
lista está en Estado del equipo; revísala con tu asesor y después marca el aviso como atendido."
With `partial`, R4c's sentence after it. **An `unconfirmed` incident** (round 4, I2; R7's `count: 0`,
no `to`) takes its own subject and text instead, matching R4c's bell sentence: subject EN "Sales
may be dated wrongly at {venue}: check them with your tax adviser" / ES "Puede haber ventas con
fecha incorrecta en {venue}: revísalas con tu asesor"; text EN "The payment stop that began at
{from} ended by itself, but nothing confirmed the box's clock, so the box cannot tell which sales
were dated wrongly. Check the box's clock, and go through the sales since then with your tax
adviser; then mark the alert as handled." / ES "La parada de cobros que empezó a las {from} terminó
sola, pero nada confirmó la hora del equipo, así que el equipo no puede saber qué ventas tienen la
fecha mal. Comprueba la hora del equipo y revisa con tu asesor las ventas desde entonces; después
marca el aviso como atendido." The clock-stop email's "What to do" drops "which says whether payments can be restarted" for
"where an administrator can confirm the clock with their own phone; with the internet or two tills
switched on, the box does it by itself".

- [ ] Failing tests: one email per manager per open incident, none for a handled one, a second
  check sends nothing; the words in both languages with no `{` left; **an `unconfirmed` incident
  (`count: 0`, no `to`) → the "may be dated wrongly" subject and the "cannot tell" text in both
  languages, and neither "0 sales" / "0 ventas" nor an empty "to"** (fails first against a single
  `clock.records_misdated` text). Commands:
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`;
  then `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts
  scripts/errors-reachable.test.ts scripts/english-only.test.ts`. Commit
  `"Managers get an email when payments restart by themselves and when sales are dated wrongly"`.

### Task R12a: The Clock row and the wrongly dated section

**Files:** `apps/dashboard/src/api/client.ts` (types; `clockMisdated()`; `restartClockPayments`
deleted), `apps/dashboard/src/api/client.test.ts` (`:3255-3258` → the new routes),
`apps/dashboard/src/i18n/codes.ts` (`:1287`: `clock.restart_refused` → `clock.confirm_refused`, one
generic sentence: "The clock could not be confirmed. Look at the Box status page." / "No se ha
podido confirmar la hora. Mira Estado del equipo."), `apps/dashboard/src/i18n/codes.test.ts`
(`:744-749`), `apps/dashboard/src/screens/box-status-rows.ts`,
`apps/dashboard/src/screens/box-status-screen.ts` (the section), `apps/dashboard/src/i18n/strings.ts`
(EN and ES; every `box_status.clock.restart.*` and `refused.*` key deleted), tests
`box-status-rows.test.ts`, `box-status-screen.test.ts`.

Words: during a stop, `none` "Waiting for proof that the clock is right: the tax agency's time, or
two tills or handhelds." / "Esperando una prueba de que la hora es correcta: la de Hacienda, o la de
dos cajas o terminales."; `contrary` "Other clocks say the box's clock is wrong." / "Otros relojes
dicen que la hora del equipo está mal."; `ready` "Proof found: payments restart within a few
seconds." / "Hay prueba: los cobros se reanudan en unos segundos."; `confirmed` "Payments restarted
at {time}, confirmed by {who}." / "Cobros reanudados a las {time}, confirmado por {who}."; a check
that waits (R6, the health read's `clockCheckWaiting`) "The payment stop that began at {time} has
ended, but nothing has confirmed the box's clock yet. The box asks the tax agency once a minute; two
tills or handhelds, or an administrator's own device, can confirm it too." / "La parada de cobros
que empezó a las {time} ha terminado, pero nada ha confirmado aún la hora del equipo. El equipo
pregunta a Hacienda cada minuto; también pueden confirmarla dos cajas o terminales, o el
dispositivo de un administrador." Section
title "Sales dated wrongly" / "Ventas con fecha incorrecta", columns invoice / time recorded, the
line "Go through these with your tax adviser, then mark the alert as handled in the bell." /
"Revísalas con tu asesor y después marca el aviso como atendido.", and with `partial` or
`unconfirmed` the R4c sentences.

- [ ] Failing tests for each state, the waiting check, the section with two records, `partial`,
  an `unconfirmed` entry (round 4, M3: the "cannot tell" sentence, no table, no "0"), and none once
  handled.
  Command: `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts
  src/screens/box-status-screen.test.ts src/api/client.test.ts src/i18n/codes.test.ts` (Chromium:
  memory first). Then `pnpm exec vitest run scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts
  scripts/help-tooltip-mode.test.ts scripts/pinned-actions-column.test.ts`. Commit.

### Task R12b: The administrator's dialog

**Files:** `apps/dashboard/src/screens/box-status-screen.ts`, `apps/dashboard/src/api/client.ts`
(`clockChallenge()`, `clockConfirm()`), `apps/dashboard/src/dashboard-app.ts` (hand the screen
`canConfirmClock` from `#sessionPermissions.includes("person.admin")`, as `canAdminister` is
handed), strings, tests `box-status-screen.test.ts`, `box-status-screen.a11y.test.ts`.

Behaviour: a `secondary` "Check with this device's time" / "Comprobar con la hora de este
dispositivo" on the Clock row during a stop or while a check waits (R6), only for `person.admin`. Opening it asks for a challenge
and shows "The box's clock says {box}. This device says {device}." Agreeing (within a minute): "They
agree. Confirm that the box's clock is right?" with Cancel and Confirm (`primary`, loading while
sent); Confirm asks a FRESH challenge and answers it at once with `Date.now()`. Differing: the FYI 8
sentence and Close only. A refusal shows its sentence on its own line above the buttons
(`same_machine`: "This screen is the box itself, so its clock is the box's own. Confirm from your
phone or another computer." / "Esta pantalla es el propio equipo, así que su hora es la del equipo.
Confírmalo desde tu móvil o desde otro ordenador."). Success closes and refreshes; a refusal
refreshes too. No staged input, so no draft scope.

- [ ] Failing tests: no button without the permission or without a stop or a waiting check; the
  button while a check waits; the two times; Confirm sends
  a fresh challenge and its answer; `same_machine` shown at open; Escape closes; axe in both themes
  for the closed row, the open agreeing dialog and the refusal. Command as R12a plus the a11y file.
  Commit `"An administrator can confirm the box's clock from the Box status page with their own device"`.

### Task R13: The guides

**Files:** `apps/server/src/guide/en/box-status.md`, `apps/server/src/guide/es/box-status.md`,
`apps/server/src/guide/en/till-notices.md`, `apps/server/src/guide/es/till-notices.md`. Replace
every sentence about the Restart payments button, the 24-hour limit and "one restart per record" —
EN `box-status.md` about `:137-219` (`{#clock-behind}`, `{#clock-witnesses}`) and the ES twin;
`en/till-notices.md:33` ("or a manager restarts payments") and `:58`; `es/till-notices.md:38`
("hasta que un encargado reanude los cobros") and its twin of `:58` — with: payments restart by
themselves once the tax agency or two tills or handhelds confirm the clock, or an administrator
confirms with their own phone or computer — never from the box's own screen; no limit on how far
back; a later step back stops payments again until the clock is confirmed again; sales stamped later
than the real time are listed for the tax adviser, also when the stop ends by itself — once the tax
agency, two tills or handhelds or an administrator's device confirm the clock (the Box status page
says while it waits); or, when one of them says the box's clock is wrong, a task saying the box
cannot tell which sales were dated wrongly. Keep each
heading's `{#id}` in both languages. Run `pnpm --filter @waitron/server exec vitest run
src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`. Commit.

### Task R14a: CLAUDE.md, the developer docs and the design system

CLAUDE.md §1: a behaviour change retires every receipt about the old behaviour. First re-run, and
read every hit:
`/usr/bin/grep -rn -i -E "24[ -]hours?|24 horas|restarts? payments|Restart payments|Reanudar los cobros|reanud(e|ó|ación|a)|clock-restart|set the clock|whoever installed|manager's restart|restartAfterClockStop|stepped_back|too_far|clock_stop_restarts|hand-set clock"`
with `--exclude-dir=node_modules --exclude-dir=coverage --exclude-dir=dist --exclude-dir=reports`
over `docs`, `apps/*/src`, `packages`, `deploy` and `CLAUDE.md` (without the excludes it read build
output: 1025 hits, 149 in a coverage summary, round 3 M10; with the first three alone it still read
one line each of `packages/fiscal/reports/mutation/index.html` and
`packages/fiscal/reports/stryker-incremental.json`, git-ignored by `.gitignore:27`, round 4 M10 —
593 hits, 591 with `reports` excluded too, run 2026-10-24 at `e074a6b06`; `git grep` with an
`apps/*/src` pathspec matched no `apps/` file).
- `CLAUDE.md` §5, the clock-stop rule: its bold first sentence (`:893-895`, "unless a manager's
  restart covers the reading") and the restart sentence (`:905-910`) become "…unless a confirmation
  of the clock covers the reading" and "A confirmation of the clock (`clock_confirmations`: AEAT's
  time, two agreeing devices from two addresses, or an administrator's own device, never one on the
  box) lifts it for one step back, with no limit on the gap; once a record is written under it every
  reading is held to the minute against the latest time written since. Guards:
  `packages/fiscal-verifactu/src/clock-behind.restart.test.ts` and
  `packages/fiscal-verifactu/src/clock-confirmation.test.ts`, weaker than the rule — they cover the
  readings they name." `:910` links to `conventions-data.md#a-managers-restart-lifts-the-stop-for-one-step-back`:
  if that heading is retitled, change the link in the same commit (`scripts/claude-md-pointers.test.ts`
  skips anchors). Run `pnpm exec prettier --check CLAUDE.md` and `pnpm exec vitest run
  scripts/claude-md-pointers.test.ts`.
- `docs/developers/conventions-data.md`, the clock-stop section from `:3552` to its end (about
  `:3792`), the restart part from `:3656`: the receipt for R1–R6, T1–T8 — the route, `RESTART_CAP_MS`,
  `too_far` and `stepped_back` paragraphs rewritten.
- `docs/developers/design-system.md` (about `:5397`, `:5442-5445`): the Restart payments button →
  the administrator's dialog and the wrongly dated section.
- Commit, docs only.

### Task R14b: The asesor questions, the backlog and the pointers

- `docs/compliance/asesor-questions.md`: Q51 (the "why it matters", the Spanish text and the
  interim treatment: automatic, no cap, an administrator's own device, AEAT first) and Q52
  (pointer). If Q51's heading is retitled, change the two links to its anchor in the same commit:
  `asesor-questions.md:9` and `docs/backlog.md:4613`. A **new question at the next free number on
  `main` at build time** (other lanes add questions; do not assume one): records listed as dated
  wrongly — what must the business do about invoices whose generation time was later (or earlier)
  than the real time; nothing is rewritten; is a note to AEAT, a correction invoice, or nothing
  expected? Spanish text, as the others; "This records a question; no enquiry has been sent."
- `docs/backlog.md`: the A798-B entry (the owner's answers sentence and the slice 9 sentence; 9b and
  9c named as open, outlines); and these follow-up entries — "Two devices can fake a restart's proof"
  (`:4627`) → FYI 12's wording; "Two restarts whose named records belong to one sale share a bell
  alert" (`:4631`) → FYI 11; "The box sends AEAT's QR host a HEAD at every clock-watch check"
  (`:4640`) → once a minute during a stop or while a check waits for its witness; "An AEAT disagreement blocks a restart…" (`:4650`) → FYI 6;
  "A restart under which no sale was recorded raises no 'disproved' alert" (`:4654`) and "After a
  'disproved' alert, the restart still covers…" (`:4657`) → "confirmation" for "restart"; "A
  malformed restart row covers nothing, for ever … refused `stepped_back`" (`:4662`) → a malformed
  confirmation covers nothing, and a fresh confirmation can lift; "AEAT's time for a restart comes
  from its QR validation host" (`:4617`) and its detail heading in `docs/backlog/box.md` (about
  `:897`) → "for a confirmation". New short entries: FYI 11, 12 and 13; "`clock_stop_restarts` is
  written by nothing: drop it, and its two backup-check links, in the go-live migration squash
  (A760)"; "a future cloud or proxied primary sees every request as the box's own" (design §4.9 h).
- Dated pointers, not rewrites: `docs/superpowers/specs/2026-10-21-b3-usb-installer-design.md`'s
  closing list (about `:1080`, "no hand-set clock, keeping A798's decision") — §10 already has one;
  `docs/backlog/mockups/b3-usb-installer/question.txt:42` ("NO hand-set clock");
  `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md` (about `:925`, "no
  set-the-clock action"); `docs/backlog/mockups/a798-degraded-trading/README.md`'s line for
  picture 9; `docs/compliance/verifactu-findings.md`.
- Left for slice 9b's own words: `deploy/README.md`'s time-sync paragraph, and the "connect the box
  to the internet … or call whoever installed it" sentences in `apps/dashboard/src/i18n/strings.ts`
  (about `:3260`, `:6606`), `alert-messages.ts` (`clock.unusable`) and `box-emails.ts`
  (`clock.unusable`), which stay true until the box can set its own clock.
- Commit, docs only, `"Docs: payments restart by themselves once the clock is confirmed; the wrongly dated sales go to the tax adviser"`.

### Task R15a / R15b: LOOK in English, then Spanish

As Tasks 18a/18b below the line, with these states: a stop with no proof (no button for a manager);
the same for an administrator (the button); the dialog agreeing, differing, and refused on the box;
after a confirmation (amber row, who and how); a check that waits after its stop ended; the wrongly
dated section with three sales, with `partial`, and an `unconfirmed` entry; the bell on `clock.behind_chain_restarted` (each `confirmedBy`) and
`clock.records_misdated`. Light and dark, 1280 and 390. Write what you saw, sheet by sheet; fix with a
test where one can catch it.

## Revision 5, finding by finding (round 1 and the claim check, under `RULINGS-1.md`)

- **C1** (the list follows the stop's start, also when it ends by itself): `clock_checks` rows for
  `behind_chain` stops with the boot clock and boot id (R1, R6), `elapsed` closings, the corrected
  start (Words, FYI 9), Tasks R4a, R4b cases 1–4, R9; `behind_chain`, `disagrees` and `elapsed`
  declared in R1.
- **C2** (one refusal code): slice 9c's outline keeps `clock.behind_chain` with a `reason`, names
  every exact-match site and the mid-payment test; the false "every reader goes through one
  function" sentence is struck there and in the design.
- **I1**: `person.admin`; Task R7 dropped; no permission declared change.
- **I2**: Task R1b.
- **I3**: R9 and Task R6a (distinct addresses); FYI 12; slice 9b's outline alerts and emails every
  clock change; (d) — refusing a devices- or admin-sourced set that moves the clock back past the
  latest record — not adopted: it would leave a start check with no lift where there is no internet
  (I4); 9b's outline says so. (e) in 9b's outline.
- **I4**: design §4.9 h narrowed, with each case's answer; 9c's outline decides each (no
  unliftable stop).
- **I5, I6**: slice 9b's outline. **I7, I8**: slice 9c's outline (and FYI 14 here for the laptop).
- **I9**: 9b and 9c are outlines with their own plan and review to come.
- **M1**: Task R12a. **M2**: Tasks R13, R14a, R14b. **M3**: R14 split. **M4**: R1's `seq` comment.
  **M5, M6, M7**: 9c's and 9b's outlines; M6's `disagrees` declared in R1. **M8**: header and FYI 1.
  **M9**: 9b's outline. **M10**: Global constraints. **M11**: Stays; R14b's backlog entry.
  **M12**: T1 narrowed.
- **Claim check**: F1 → T5 and Task R2; F2, F3 → "the next free number on `main` at build time";
  W1, W10, W12, W13, W14 → design §4.9 and 9b's outline; W2 → T2, FYI 4, design §4.9 i; W3 → 9c's
  outline; W4 → Tasks R13, R14a, R14b and the widened grep; W5 → R1b; W6 → the changed-checks list;
  W7 → no permission change now (`ADMIN_ONLY` untouched); W8 → Task R1 step 4; W9 → T1; W11 → 9b's
  outline; W15 → noted in this commit's message (the earlier message is not rewritten); W16 → B3's
  citations now name sections, fixed in this commit; W17 → R14a, R14b; W18 → the design's default 14
  says D7 concerns invoice numbers, and R14b no longer adds a D7 pointer; W19 → the build-plan step
  dropped (done in `4a7db432a`). U3 → 9b's outline measurement M8.

## Revision 6, finding by finding (round 3, under `RULINGS-3.md`)

- **C1** (a lift followed by a second check listing the sales made under it): Words ("stop proper"),
  R6, Tasks R4a, R4b case 2b and R9's first case with its proof by deletion; receipt T7.
- **I1** (a stop ending by itself after a wrong backward step): R6's `elapsed` list rule, R7's
  `unconfirmed`, FYI 9, Task R4a cases (i)–(iii), R4c's words; the design's "the time at closing,
  which is right" struck (§4.9 f).
- **I2** (the closing's readings stored nowhere): `proof.closing` (Words, R5, R6), the shared boot
  reader on both paths (R10, Task R8 case 7, Task R9's `boot-reader.ts`), `misdatedRecords` on stored
  values (Task R4b case 2c). **No migration column changed**: `proof` is the existing json column.
- **M1** (I3 d): kept out of slice 9; an owner question in 9b's outline, whose FYI 4 now names the
  window 9c opens. **M2**: the design's count (§4.9 b). **M3**: 9c's FYI 7. **M4**: Task R10 and the
  changed-checks list. **M5**: FYI 9. **M6**: 9c's outline (a promotion writes `start`). **M7**:
  design §4.9 h. **M8**: FYI 5 and Task R9. **M9**: Task R4c. **M10**: Task R14a. **M11**: 9b's
  outline. **M12**: FYI 12.

## Revision 7, finding by finding (round 4, under `RULINGS-4.md`)

- **I1** (an `elapsed` closing listed correctly dated sales made between the stop's end and the
  closing): every list is bounded by the check's OPENING `detail.heads` (Words, FYI 9 with the
  receipt — the chain append refuses while the stop proper holds, `chain.ts:136-140` →
  `clock-behind.ts:166-173` — R5, R10's `misdatedRecords`, Task R4b case 5 and the new case 5b);
  the closing's `proof.heads` stays on a lift for the cover only (Words, R5); Review focus 2
  corrected and narrowed; receipt T8. Two consequences: a confirmation with no open check opens one
  first (R5, Task R4b case 1b), and a check whose stop came back after records were written while it
  waited closes `unconfirmed` and a new one opens (R6, Tasks R4a and R9b case 4), or the new stop's
  records would be in no list.
- **I2**: R11's `unconfirmed` subject and text, and its failing-first test.
- **M1**: R3 reads "the stop proper holds". **M2**: FYI 9 ("or that cannot tell"), Changes 5, R13's
  guide words, the header's slice summary; the design's §4.9 f and §8 item 9. **M3**: R10's
  `misdatedOpen` carries `unconfirmed`; R12a tests it. **M4**: `boot-reader.ts` created in Task R8;
  R5 says which task writes `proof.closing` (R4a2 on the waiting closing, R4b on the confirmation
  path; R3's rows have none). **M5**: the "none disagreed during the stop" condition dropped (FYI 9,
  R6, design §4.9 f); Task R4b case 5c is the model's D3. **M6**: R9's first case gains an AEAT fake
  agreeing after the lift and restates what its proof by deletion prints. **M7**: a check whose stop
  ends by itself waits, open, for a fresh witness — the next allowed HEAD, two devices, or an
  administrator (R4, R6, Tasks R4a2, R8 case 8, R9b); with none it stays open and the Box status
  page says so (R10, R12a, R9b case 2). To let an administrator or two devices close it, a closing's
  `source` now names what confirmed the clock and `elapsed` is only a closing that cannot tell
  (Words); R1's `source` CHECK already allows every value. **M8**: R7 — `saleId` from the check's
  `detail.lastRecordId` (added to R1's `detail` JSON, no column), and what the open-incident key does
  with a repeat; Task R4b cases 2 and 6. **M9**: design §4.9 b and 9c decision 2. **M10**: Task R14a's
  grep. **M11**: 9b's outline. **M12**: R6, R10 and Task R8's boot reader. **M13**: FYI 12. **M14**:
  `r6` throughout. Round 4's note that R4b case 2c could not move a boot clock: case 2c restated, and
  the route-level read with the boot reader moved added to Task R10.
- **Tasks split to stay small**: R4a → R4a and R4a2; R4b → R4b and R4b2; R9 → R9 and R9b.
- **No migration column changed** (R1): `detail` and `proof` are the existing JSON columns.

---

## As built before revision 4 (revisions 1–3; kept for their receipts)


_The plan's title before revision 4: A798-B slice 9 — devices report their clock, `clock.disagrees`, `clock.unusable` in the bell, the manager's restart, and the clock-stop email._

> **Revision 3 (2026-10-23).** Folds in the narrow round-3 check
> (`~/waitron-campaign-b/a798-9-plan-review/round3.md`, logs in `r3/`: I1, I2, M1–M6), marked
> **[r3 …]**. Under a restart each reading is now held to the LATEST TIME among the records written
> under it (a running maximum), so a clock walking back 59 s at a time stops at its second step; and
> the anchor of "written under it" is a map of every chain's head, which fails closed for any value a
> correct writer never stores (decisions 8c, 10, 21). Receipts: "Measured for revision 3"
> (`~/waitron-campaign-b/a798-9-plan-probe/r3/`).
>
> **Revision 2 (2026-10-23).** Folds in plan review round 1
> (`~/waitron-campaign-b/a798-9-plan-review/round1.md`: C1, I1–I7, M1–M12) and its claim check
> (`claim-check.md` beside it: FALSE 1–5, TOO WIDE 1–3, UNVERIFIED 1–2) under the coordinator's
> rulings. Each change names its finding in brackets, for example **[C1]**; claim-check rows are
> **[CC n]**, by the row number in that file. New receipts are under "Measured for revision 2"
> (`~/waitron-campaign-b/a798-9-plan-probe/r2/`). The biggest change: a restart now covers ONE
> backward step; after the first record written under it, every record is held to the one-minute
> rule against the latest time among the records written under it (decision 8; revision 3).
>
> **No migration.** The table this slice writes, `clock_stop_restarts`, and the index the stop reads
> were created by slice 8 (`packages/fiscal-verifactu/drizzle/0010_clock_stop.sql`). Nothing here
> adds or changes a table, an index or a trigger. If a task finds it needs one, STOP and report: it
> changes the lane's scheduling.
>
> **Parked for the owner** (build plan Part 1, row 9): the restart lifts the payment stop and lets
> one record be written with a generation time earlier than the record before it, and the box asks
> AEAT's web server for its time. It does **not** touch what is hashed (`computeHuella`, in
> `@waitron/verifactu`, outside this repository), the chain's links (`chain.ts`), numbering, series
> allocation, the alta and anulación builders or `registros_facturacion`'s immutability. The lift
> lives entirely in `packages/fiscal-verifactu/src/clock-behind.ts`, which `attemptAppend` already
> calls (P6–P9, Q1–Q8). The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
> and `inmutabilidad.test.ts` pass **unedited**. If a task finds it must change either, `chain.ts`,
> or anything else on that list, STOP and report.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation, then run it again.
> Implementers are dispatched as `subagent_type: "implementer"`. Tasks run in their numbered order.
> Every task ends with the root guards and its own files green; the one exception inside a task is
> the commit just before a declared `Changed test checks` commit, which that commit turns green
> straight after.
>
> **Existing assertions [CC 42, CC 43].** This plan changes exactly these existing assertions,
> declared here so no implementer has to decide one. Each goes in the task named, in a commit of its
> own whose message begins `Changed test checks (A798 slice 9):` and lists each `file:line` with its
> before and after; the pull request names them. Each pins behaviour this slice deliberately
> changes, or is a guard's hand-kept file list that the coordinator ruled may gain an entry.
> 1. `packages/fiscal-verifactu/src/alerts.test.ts:7-10` (`FISCAL_ALERTS` `toEqual`): `events`
>    **gains** `{ prefix: "clock.behind_chain", area: "box", permission: "system.manage" }` after the
>    `fiscal.` claim (Task 7). Reason: decision 13's claim. A whole-shape list gaining one entry, every
>    existing entry kept: the owner's standing exception (2026-09-27).
> 2. `scripts/alert-codes.test.ts:24-41` (`INCIDENT_CODE_SOURCES`) **gains**
>    `"packages/fiscal-verifactu/src/clock-stop-incidents.ts"` (Task 7). Reason: the guard's
>    hand-kept list of files that record incidents; its first case (`:100-106`) fails for any
>    unlisted file calling `recordIncident(`, as design §4.8 c foresaw.
> 3. `scripts/ongoing-alert-codes.test.ts:12-17` (`ONGOING_CODE_SOURCES`) **gains**
>    `"apps/server/src/clock-disagrees-alert.ts"` (Task 4). Reason: the hand-kept list of files whose
>    ongoing alert codes must have words; without it the guard never sees `clock.disagrees`. The
>    guard's logic is unchanged (ruled allowed) **[CC 42 (d)]**.
> 4. `apps/server/src/box-health.test.ts:98-123` (the whole-shape `toEqual` of `collectBoxHealth`):
>    **gains** `clockStop: null` (Task 9b). Reason: decision 12's new field; the claim check printed
>    this case failing with `+ "clockStop": null` (`c14-box-health-shape.log`) **[CC 42 (a)]**.
> 5. `apps/server/src/box-alert-email.test.ts:45`: `expect(isBoxEmailCode("clock.behind_chain")).toBe(false)`
>    becomes `.toBe(true)` (Task 12). Reason: this slice gives that code email words **[CC 42 (b)]**.
> 6. `apps/server/src/box-alert-email.test.ts:15-24` ("words %s in %s with the venue's name"): the
>    `boxEmailMessage(code, language, "Corner Bistro")` call gains a params argument from one fixture
>    (`{ clockAt: "2025-03-14T08:12:00.000Z", offsetMinutes: 60, lastRecordAt:
>    "2026-10-18T21:40:00.000Z", lastRecordOffsetMinutes: 120 }`), and the expected subject and text
>    also replace `{clockAt}` with `14/03/2025 09:12` and `{lastRecordAt}` with `18/10/2026 23:40`.
>    The `not.toContain("{")` checks stay. Before: venue only; after: venue and the two times (Task
>    12). Reason: the new placeholders (decision 16) **[CC 42 (c)]**.
> 7. `apps/server/src/box-alert-email.duty.test.ts:381-392` ("emails no module notice without email
>    words"): its example `notice("clock.behind_chain")` becomes `notice("printer.jobs_waiting")`, a
>    real notice code that still has no email words; `fiscal.records_unsent` stays (Task 12). Reason:
>    `clock.behind_chain` gains words, so it can no longer stand for a code without them
>    **[CC 42 (b), CC 43]**.
> 8. `apps/dashboard/src/screens/box-status-rows.test.ts:534` (the Clock row's detail for
>    `driftSeconds: -3600`): `fill("box_status.clock.compared", { …, seconds: "3600" })` becomes
>    `fill("box_status.clock.compared_behind", { …, seconds: "3600" })` (Task 13). Reason: decision
>    17; the 2 s cases at `:156` and `:602` keep `compared` unchanged.
>
> Test **setup** changes are allowed where a task names them, never an assertion: a stub's methods;
> the dashboard's `BoxHealth` fixtures (`quietHealth` and its siblings in
> `apps/dashboard/src/screens/box-status-*.test.ts`) gaining `clockStop: null`, which the type
> requires. Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> **Base.** Every `file:line` below was read at `main` `de73c6144` (2026-10-23), this branch's base
> (`feat/a798-9-clock-restart`, worktree `waitron-feat-a798-9-clock-restart`); that base holds slice
> 8 (#2012) and slice 10 (#2019). Every claim about how the box, the engine, a library or AEAT
> behaves cites a probe in "Measured for this plan" or "Measured for revision 2", run that day on
> macOS (Darwin 25.6.0), Node v26.11.1, from scratch files under
> `~/waitron-campaign-b/a798-9-plan-probe/` (scripts in `scripts/` and `r2/scripts/`, logs beside
> them) and two throwaway worktrees of `de73c6144` made with `git worktree add --detach` and
> `pnpm install --frozen-lockfile --offline` (`Done in 3.6s` each, `install.log`,
> `r2/install.log`), both removed afterwards. A claim marked **(read)** comes from reading code, not
> running it. Nothing was measured on Linux, on a real box, or against AEAT's production hosts.

**Words used in this plan.**
- The **stop** is slice 8's: open while a reading of the box's clock is more than 60 000 ms earlier
  than the **latest record** — the one record that `latestRecord(tx)` answers: the largest
  `fecha_hora_huso_gen_registro` in `registros_facturacion`, any chain, any kind, ties broken by
  the larger `id` (decision 8a) **[I7]**. The **raw comparison** is that test alone, before any
  restart is taken into account.
- The **gap** is the latest record's time less the reading, in milliseconds.
- A **restart** is one row of `clock_stop_restarts`
  (`packages/fiscal-verifactu/src/schema/clock-stop-restarts.ts`): who, when, the reading accepted
  (`clock_at`), the record it names (`registro_id`, unique), that record's time (`record_at`) and
  the proof, which also carries `heads`: for every chain in the database when the restart was made,
  its node and the largest `secuencia` it held (decisions 10 and 21) **[C1, r3 I2]**. The
  **accepted gap** is `record_at − clock_at`.
- A record **written under a restart** is a record, in any chain, whose `secuencia` is larger than
  its node's entry in the restart's `heads` (0 for a node the map does not name), and, when a later
  restart exists, not larger than that later restart's entry. That is write order per chain, which
  is the chain code's own order (`chain.ts:150`, `:225`; review round 3, read), not time order.
  The **latest time written under it** is the largest generation time among those records
  **[r3 I1]**.
- A restart **covers** a reading when all four hold (decision 8): its `heads` are well formed and
  none is larger than its chain's current head (decision 21) **[r3 I2]**; it names the latest record;
  the gap is at most `min(accepted gap + 60 000, 86 400 000)` ms **[M1]**; and, once a record has been
  written under it, the reading is no more than 60 000 ms earlier than the latest time written under
  it **[C1, r3 I1]**.
- A **witness** is a reading of another clock taken by the box: a **device witness** (a till's or
  handheld's own clock, sent on its equipment read) or an **AEAT witness** (AEAT's time from the
  drain's submission reply or from the HEAD of decision 1). Each carries `boxAt`, the box's own
  wall clock at the moment the comparison refers to, `witnessAt`, the other clock's time at that
  moment, and `uncertaintyMs`.
- **Proof** for a restart is an AEAT witness that agrees with the box, or two different devices that
  each agree with it, taken during this stop and fresh (decisions 4–6). **Contrary proof** is an
  AEAT witness that disagreed at any time during this stop, or two devices that agree with each
  other and both disagree with the box (decision 5) **[I5]**.
- **Disproved**: after a restart, AEAT's time or a forward jump of the box's clock shows the accepted
  clock was wrong (design §4.8 b, "If the clock it accepted later proves wrong").

**Goal:** while payments are stopped for the clock, a manager on the Box status page sees whether the
box has fresh proof its clock is right and, only with such proof and a gap of at most 24 hours, can
restart payments; the restart allows one step back in the chain and no second one; it is kept in
the append-only table and the bell; the box keeps checking and says so if the accepted clock later
proves wrong; devices report their clock, so the bell warns when two of them agree the box's clock
is off; the bell shows a clock before 28-10-2024; and the managers get the clock-stop email once per
stop.

**Architecture:** seven pieces.
1. **Judging witnesses** (`packages/fiscal/src/clock-witnesses.ts`, Task 1): a pure function both
   the server's `clock.disagrees` alert and the module's restart use, so the two can never judge
   the same readings differently. Under mutation testing **[M12]**.
2. **Keeping witnesses** (`apps/server/src/clock-witnesses.ts`, Task 2): an in-memory store of the
   latest device readings and AEAT readings, handing out fresh agreeing ones taken on the box's
   current clock, and every AEAT disagreement until the stop ends **[I5]**.
3. **Feeding it**: the till sends its clock on every equipment read (Task 3); the drain's submission
   comparison and a once-a-minute HEAD to AEAT's QR validation host during a stop feed AEAT
   witnesses (Tasks 4, 10a, 10b).
4. **The module's restart** (`packages/fiscal-verifactu`, Tasks 5–7): one `latestRecord(tx)` that
   every caller uses **[I7]**; `clockBehindChain` honours a covering restart (the lift) and
   re-engages on a second step back **[C1]**; `clockStopState` says what the Clock row shows;
   `restartAfterClockStop` writes the row; `clock-stop-incidents.ts` records the two alerts.
5. **The seat** (Task 8): four optional `FiscalBackend` methods; only Veri\*Factu has them.
6. **Server** (Tasks 9a–12): the restart route, the Box status read's `clockStop`, the clock watch
   duty (AEAT HEAD, disproof), the `clock.disagrees` and `clock.unusable` alerts, the email.
7. **What people see** (Tasks 13–19): the dashboard words, the Clock row and its dialog, the guides,
   the docs, LOOK, the backlog.

**Tech stack:** TypeScript, `node:sqlite` behind drizzle 0.45.4, Hono, Lit, Vitest 4.1.12 (Node for
`packages/*` and `apps/server`; real headless Chromium for `apps/till`, `apps/dashboard` and part of
`packages/fiscal-verifactu`), Stryker for `packages/fiscal`.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §4.3 (the new alerts), §4.5 items 3–4, **§4.8 b** (who can fix it, and how), §4.8 c (the
alerts and the email), §4.8 d (what clears the stop), §5, §6 ("Decisions revision 5 makes" 7, 11,
12, 13, 15), §7, **§8 item 9**, §9 question 4 and its answer (a), §10's two asesor questions, §12
experiment 7. Pictures: `docs/backlog/mockups/a798-degraded-trading/9-clock-behind-manager.png`
(the Reloj row with and without proof, the dialog, the email). Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1,
row 9 (fiscal invariants, auth; FULL; no migration; parked; depends on 7, 8 and 10, all landed).
Slice plans it builds on: [slice 8](2026-10-22-a798-8-clock-behind-stop.md) (the stop, the seat's
`clockBehindLatestRecord`/`refuseWhileClockBehind`, the table) and
[slice 10](2026-10-23-a798-10-emails-and-install.md) (the email duty, decision 9 "Room for slice
9"). Backlog: A798-B (`docs/backlog.md:4631-4649`) and the entries that name slice 9: "The clock
stop's email is slice 9's" (`:4651-4656`), "The backup verifier does not know
`clock_stop_restarts`' links" (`:4724-4726`), "The Box status page's Clock row drops the drift's
sign…" (`:4769-4773`), "Which alert area `clock.unusable` belongs to" (`:4830-4833`). Asesor
questions Q51 and Q52 (`docs/compliance/asesor-questions.md`, "Not built: it is slices 8 and 9" at
`:3637-3638` and "Not built: it is slice 9" at `:3678`).

### What "the minimum-date checks" are, for this slice

Design §8 item 9 names "the minimum-date checks". Revision 4's slice list had one slice for "Clock
checks (minimum date, chain, devices, `clock.*` alerts)" (`git show b86335d94` of the design, its
removed line `8.`); revision 5 split it. What is built today, by grep at `de73c6144`
(`/usr/bin/grep -rn 'clock.unusable' packages apps --include='*.ts'`, less tests): the refusal
before the reader and at the issue reading (slice 3, `first-issue-date.ts:14-25`), the staff notice
(slice 4, `staff-notices.ts:7-19`), the till's sentence (`apps/till/src/i18n/codes.ts:774`), the Box
status rows (`box-status-rows.ts:47`, `:56`), the dashboard's resolution words (`codes.ts:1271`)
and the email (slice 10, `apps/server/src/i18n/box-emails.ts:22`). **Not built: the bell's alert**
— design §4.3 lists `clock.unusable` (error) among the new alerts, and no alert source answers it
(the files naming `clock.unusable` and the files naming `AlertSource` have none in common; CC 60).
Slice 3 handed that alert, and the question of its area, to "the slice that raises it as an alert
(slice 9)" (`docs/backlog.md:4830-4833`; slice 3 plan `:2363-2365`). That is this slice's
minimum-date work (Task 11; decision 15).

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-9-plan-probe/`.

- **P1 — AEAT's pre-production submission host, unauthenticated, gives no time**
  (`p1-head-soap.log`). `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP?waitron_clock=probe1'`
  at `Fri, 23 Oct 2026 09:34:45 GMT` (`date -u` before and after) printed `HTTP/2 302`,
  `location: https://sede.agenciatributaria.gob.es/Sede/errores/erro4033.html`, `content-length: 0`,
  and **no `date:` line**. A GET (`p4-get-soap.log`) printed the same. The failing case would have
  printed a `date:` line. The claim check reproduced both at 09:59:35 UTC (CC 1).
- **P2 — the repository's existing internet time reading came back empty against pre-production**
  (`p2-internet-clock.log`). `observeInternetHourClock` (`packages/fiscal-verifactu/src/hour-clock-internet.ts:40-159`,
  A679's hour-code setup, the only code in the repository that reads AEAT's time from a header,
  CC 6) imported straight from the `.ts` file and run for `"preproduction"` printed
  `{"source":"internet","result":"unavailable","reason":"response",…}`: it follows only
  same-origin redirects (`:98-104`), and P1's redirect leaves the origin. The claim check ran it
  three more times, logging each hop: the same answer each time, and its control, the same function
  sent to the QR host, answered `usable` (CC 5). So it was unavailable in each of four runs on
  2026-10-23 — not "always" **[CC 7]**. Outside this slice; Task 19 files it.
- **P3 — AEAT's pre-production QR validation host does give its time** (`p3-head-qr-control.log`).
  `curl -sS -o /dev/null -D - -I --max-time 10 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR'`
  printed `HTTP/2 200` and `date: Fri, 23 Oct 2026 09:35:02 GMT`; `date -u` right after printed
  `Fri Oct 23 09:35:02 UTC 2026`. No `age`, `cache-control` or `x-cache` header. Reproduced (CC 2).
- **P5 — the same host through the repository's own TLS-verified HEAD** (`p5-qr-head.log`,
  `p5-qr-head.mjs`). `authenticatedHourHead` (`hour-clock-internet.ts:12-38`: HEAD,
  `rejectUnauthorized: true`, no client certificate) on `QR_ENDPOINTS.preproduction`, three times
  with one random `waitron_clock` value reused for all three (CC 3): each `status 200`, `date`
  present and round-tripping, `age`/`cache-control`/`x-cache` null, round trips 177–206 ms, and
  the box's midpoint less the header's instant `858`, `52` and `229` ms. The control, the submission
  host, printed `soap 302 date: null`. The claim check's rerun, with the Mac's clock +0.028 s from
  `time.apple.com`, gave gaps of 71, 221 and 361 ms (CC 3). **What this does and does not show:**
  AEAT's public web server in pre-production states the time to within a second over a verified TLS
  connection with no certificate of ours. Nothing about production's
  `www2.agenciatributaria.gob.es` (not contacted) and nothing about the reply to a
  certificate-authenticated `consultar`.
- **P11 — a certificate-authenticated `consultar` reply was NOT measured** **[CC 10, CC 11, CC 12]**.
  - No certificate was used. My first search (`gtimeout 60 find ~ -maxdepth 5 …`) stopped at its
    60-second limit before reaching the campaign folders and printed only the two mitmproxy files;
    that sentence was wrong. Re-run with the claim check's pruning
    (`find ~ -maxdepth 5 \( -name node_modules -o -name Library -o -name 'My Drive' -o -name .Trash -o -name CloudStorage \) -prune -o \( -name '*.p12' -o -name '*.pfx' \) -print`,
    `r2/q11-p12-find.log`), it printed 22 files: `~/.mitmproxy/mitmproxy-ca.p12` and
    `mitmproxy-ca-cert.p12`, 18 under `~/waitron-campaign/a795-probes` and `a795-review`, and 2
    under `~/waitron-campaign-e/receipts` — fixtures made by earlier probes. None was opened, so
    none is known to be, or not to be, an AEAT certificate.
  - Pre-production accepts "no test NIFs, no test certificates, no self-signed certificates"
    (`docs/compliance/getting-to-production.md:287`).
  - The `verifactu` repository's live workflow holds an AEAT certificate as a CI secret
    (`~/workspace/repos/verifactu/.github/workflows/live-aeat.yml:79-80`, `AEAT_TEST_P12_BASE64`)
    and runs only from that repository's `main` (`:66`). Its monthly scheduled run files; a manual
    run takes a `mode`, and mode `consult` (also the script's default, `scripts/live-aeat.mjs:2388`)
    sends one `consultar` and returns before any submission (`:2440-2451`). Its `fetch` wrapper
    (`:2426-2431`) already holds each reply but prints no header, so one added line printing the
    reply's `Date` header in consult mode would measure it. This slice neither ran that workflow nor
    changed that repository (the coordinator's ruling); Task 19 files the one-line change.
- **P6–P8 — a restart row honoured in `clockBehindChain` alone lets the chain accept a record earlier
  than the one before it** (`p6-restart-chain.log`; the first prototype
  `scripts/prototype-clock-behind.diff`). Records through `VerifactuBackend` and `recordSale` at
  +120: after a restart naming the `21:40Z` record with `clock_at 07:12Z`, a sale at `07:13` was
  recorded with its `anterior_huella` equal to the previous `huella`, `verifyBackupFiscalChains`
  answered `true`, and an invoice dated `2026-10-19` linked to one dated `2026-10-20` was recorded
  (P7); the control with no restart row refused (P8). The claim check reproduced every line, showed
  that the verifier answers `false` when one `anterior_huella` is changed (CC 18), and that without
  the prototype every one of these sales is refused (CC 16). **This first prototype was wrong in
  one way:** it let later steps back go unnoticed (the review's E5, below; revision 2's Q1).
- **P9 — the fiscal core's suites with that first prototype** (`p9-fiscal-suites-with-prototype.log`):
  `Test Files 8 passed (8)`, `Tests 65 passed (65)`, unedited. Superseded by Q8 for the revised lift.
- **P10 — a second open incident with the same code and origin is dropped** (`p10-incident-dedupe.log`):
  two `recordIncident` calls with `jobOrigin("dashboard")` and one code left 1 row; after it was
  acknowledged a third was kept (2). The claim check repeated it with the real code
  `clock.behind_chain_restarted`: the kept row holds only the FIRST call's params, so nothing is
  merged — the second is simply not recorded (CC 27, CC 28) **[CC 28, CC 29]**. Decision 13 now
  keys each restart's alerts apart (Q10).
- **G1 — greps at `de73c6144`.** `behind_chain_restarted`, `behind_chain_disproved`,
  `restart_refused`, `clockStopState` and `x-waitron-device-clock`: no match under `packages`,
  `apps` or `scripts`; `clock.disagrees` searched as plain text (`grep -F`): no match (CC 58). The
  restarts table is written by nothing outside `clock-stop-restarts.test.ts` (CC 59). Every sentence
  naming slice 9 outside the A798 plans: `docs/backlog.md:4646`, `:4651`, `:4653`, `:4724`, `:4772`,
  `:4832`, and `docs/compliance/asesor-questions.md:3678` (CC 61).
- **R1 — reads this plan leans on (read).** The latest record is read with its offset, not its id
  (`clock-behind.ts:18-25`); the chain check is `attemptAppend`'s first statement (`chain.ts:137`);
  the strip's notice, the bell's alert, the named check and the drift suppression all reach
  `clockBehindChain` (`staff-notices.ts:27`, `clock-behind-alerts.ts:11`, `clock-behind.ts:46`,
  `boot.ts:2220-2226`; CC 23). The backup verifier keeps `clock_stop_restarts` immutable between
  copies (`backup-verification-history.ts:27-29`, `:482`); only its `LINKS` (`:424-433`) lack the
  table's keys. The chain verifier checks no time order (`backup-verification-chain.ts:94-138`). The
  equipment read is device-guarded and answers in write-lock turns (`apps/server/src/device-api.ts:397-427`);
  the till's client sends it with no header (`apps/till/src/api/client.ts:3459-3466`, `:4748-4764`);
  CORS allows only `content-type` and the dev device header (`apps/server/src/cors.ts:17`). A header
  on the equipment GET passes every till test, a query parameter fails one (CC 30). A word-list slot
  is written `{param:listName}` (`packages/dashboard-kit/src/alert-messages.ts:94-115`;
  `{hold:printer_hold}` at `apps/dashboard/src/i18n/alert-messages.ts:321`), and
  `apps/dashboard/src/i18n/alerts.test.ts:257-273` refuses a slot naming an unregistered list
  **[I1, CC 46]**. A non-`AppError` in a route answers `500 server.internal`
  (`packages/server-kit/src/error-boundary.ts:48-49`).

### The review's experiments this revision leans on

From `~/waitron-campaign-b/a798-9-plan-review/r1/` (not re-run here):
- **E1** — `{proof:list}` printed `Proof: —.`; `{proof:clock_proof}` with a list registered as
  `clock_proof` printed the words **[I1]**.
- **E2** — on a table with a unique index, a second insert targeted or untargeted printed
  `changes: 0`; a plain insert printed `UNIQUE constraint failed: r.registro_id` **[I2]**.
- **E3** — two `withTransaction` calls started together ran one after the other (`first begins`,
  `first ends`, `second begins`); one opened inside another's body was refused `write lock: a body
  asked for the lock it is already holding` **[I2]**.
- **E4** — two sales at the same instant: `order by … desc` named secuencia 2, `… desc, id asc`
  named secuencia 1 **[I7]**.
- **E5** — with the first prototype: a restart, sales at R + 1 min, R + 10 h (17:12) and R + 30 min
  (07:42) were all recorded, 9 h 30 min backwards between the last two **[C1]**.

## Measured for revision 2

Run on 2026-10-23, macOS, Node v26.11.1, in a throwaway worktree of `de73c6144`
(`~/waitron-campaign-b/a798-9-plan-probe/r2/wt`, removed with `git worktree remove --force`; free
memory 81%). Logs and scripts under `~/waitron-campaign-b/a798-9-plan-probe/r2/`.

- **Q1 — the revised lift stops a second step back** (`q-restart-r2.log`; the prototype
  `prototype-clock-behind-r2.diff`, `clock-behind.ts` only: `latestRecord` with the `id` tie-break,
  and `restartCovers` with the 24 h cap and the newest-written-record rule; the test
  `scripts/zz-restart-r2.test.ts`). A sale at `T = 21:40Z`, a restart naming it with `clock_at
  R = 07:12Z` and `recordsBefore: 1`, then sales at R + 1 min, R + 10 h, R + 30 min, R + 10 h − 59 s
  and R + 10 h − 2 min printed
  `["recorded","recorded","clock.behind_chain","recorded","clock.behind_chain"]` — the review's case
  (07:42 after 17:12) is refused, the margin (17:11:01 after 17:12) still sells. The rows kept:
  secuencia 1–4 at `21:40`, `07:13`, `17:12`, `17:11:01`.
- **Q7 — proof by deletion of the new rule** (`q7-mutation-no-newest-check.log`): the same case with
  the newest-written-record check deleted printed
  `["recorded","recorded","recorded","recorded","recorded"]` and rows at `07:42` after `17:12`: the
  review's E5 again. So that check, and nothing else, refuses the second step.
- **Q2 — its control, a clock moving forward** (`q-restart-r2.log`): after the restart, R + 1 min,
  R + 10 h, R + 10 h + 5 min → `["recorded","recorded","recorded"]`.
- **Q3 — the first step and its margin**: before any record under the restart, R − 61 s →
  `clock.behind_chain`, R − 59 s → `recorded`; then R + 1 min → `recorded`; then R − 59 s →
  `clock.behind_chain` (two minutes before the one record written under the restart).
- **Q4 — the cap is exactly 24 hours [M1]**: a restart accepted at exactly 24 h; a sale at
  T − 24 h − 1 s → `clock.behind_chain`; at T − 24 h → `recorded`.
- **Q5 — one total order for "latest" [I7]**: two sales at the same instant; `latestRecord` named
  one of them (which one follows the random ids; review round 3's X1 saw the other **[r3 M2]**); a
  restart naming the OTHER same-second record left the sale refused
  (`clock.behind_chain`); a restart naming `latestRecord()`'s record let it through (`recorded`).
- **Q6 — a restart row whose proof lacks `recordsBefore` covers nothing**: the sale was refused.
  (Revision 2's anchor; revision 3 replaces it, S6–S10.)
- **Q8 — the fiscal core's suites with the revised prototype** (`q8-fiscal-suites-r2.log`):
  `pnpm exec vitest run inmutabilidad src/write-path.e2e.test.ts src/clock-behind.test.ts src/chain.clock-behind.test.ts src/clock-behind-alerts.test.ts src/staff-notices.test.ts src/backend.clock-behind.test.ts src/clock-stop-restarts.test.ts src/chain.test.ts src/chain.concurrency.test.ts`
  in `packages/fiscal-verifactu` → `Test Files 10 passed (10)`, `Tests 87 passed (87)`, the golden
  huella test and `inmutabilidad` among them, unedited.
- **Q9 — kitchen screens never start the equipment poll [CC 35]** (`q9-kds-poll.log`). A throwaway
  case in `apps/till/src/till-app.test.ts` (Chromium), with `vi.spyOn(EquipmentPoll.prototype,
  "start")`: a `kds_station` device booted as the existing case at `:1921-1961` boots it, then 500 ms
  of waiting → `station shown true lock shown false poll starts 0`; the control, a till signed in by
  the lock screen's `logged-in` event → `poll starts 1`. The path (read): the poll starts only in
  `#enterSignedIn` (`till-app.ts:5082`), reached from `#onLoggedIn` (`:4934-4938`, the lock screen's
  sign-in), `#enterSwitchedProfile` (`:9620`) and the Retry button of the empty-service-zone section (`:17853`,
  `data-retry-device-zones`, inside `#activeTabBody`) **[r3 M6]**; a
  `kds_station` boot sets `deviceMode` and the station screen without a sign-in (`:4110-4128`), as
  the existing test says ("A KDS never logs in", `till-app.test.ts:8252`). So kitchen screens are
  not witnesses (decision 3). If a later change makes them poll, their readings would count like any
  device's, which the design allows ("devices that spoke in the last five minutes", §4.5 item 3).
- **Q10 — each restart's alerts kept apart by the named record's sale [CC 28, CC 29]**
  (`q10-incident-per-sale.log`): two sales recorded; `recordIncident` with one code and
  `jobOrigin("dashboard")`, `saleId` the first sale ("Ana"), then the second ("Marc"), then the
  first again: 2 open rows, Ana's and Marc's. The repeat on the first sale was dropped (the control).
  `registros_facturacion.sale_id` is `notNull` (`schema/registros.ts:49-50`), so every named record
  has a sale; the bell never shows an incident's sale (`apps/server/src/alerts.ts:63-76`, read).
- **Q11 — the certificate search, re-run**: see P11.

## Measured for revision 3

Run on 2026-10-23, macOS, Node v26.11.1, in a throwaway worktree of `de73c6144`
(`~/waitron-campaign-b/a798-9-plan-probe/r3/wt`, `pnpm install --frozen-lockfile --offline`
"Done in 3.5s", removed with `git worktree remove --force`). Prototype:
`r3/prototype-clock-behind-r3.diff` (`clock-behind.ts` only: `latestRecord`, `storedHeads`,
`latestWrittenAfter`, and the cover with the bound check, the 24 h cap and the running maximum).
Test: `r3/scripts/zz-restart-r3.test.ts`, run as
`TESTCONTAINERS_RYUK_DISABLED=true env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run src/zz-restart-r3.test.ts --silent=false`
in `packages/fiscal-verifactu`; log `r3/s-restart-r3.log`, `Tests 17 passed (17)`. Restart rows carry
`{ heads }` read from the database as decision 10 says.
- **S1 (Q1 again)**: `[R+1m, R+10h, R+30m, R+10h−59s, R+10h−2m]` →
  `["recorded","recorded","clock.behind_chain","recorded","clock.behind_chain"]`.
- **S2 (forward control)**: `[R+1m, R+10h, R+10h+5m]` → all `recorded`.
- **S3 (first step)**: `[R−61s, R−59s, R+1m, R−59s]` →
  `["clock.behind_chain","recorded","recorded","clock.behind_chain"]`.
- **S4 (cap)**: `[T−24h−1s, T−24h]` → `["clock.behind_chain","recorded"]`.
- **S5 — the review's twelve-step walk [r3 I1]**: restart, `R + 1 min`, `R + 10 h`, then
  `R + 10 h − 59 s × 1 … 12` → `recorded` ×3 (the first 59 s step sells), then `clock.behind_chain`
  ×11 — the second 59 s step is refused. The failing case is S11.
- **S11 — proof by deletion of the running maximum** (`r3/s11-mutation-last-written.log`): the
  "latest time written under it" read ordered by `secuencia` instead of by time (revision 2's rule)
  → S5 prints `recorded` ×14, the walk admitted, as the review's X12 printed.
- **S6 — a JSON `null` proof [r3 I2]** (raw SQL `proof = 'null'`): a sale at `R + 1 min` →
  `clock.behind_chain`, no `TypeError` (the review's X4 printed `TypeError: Cannot read properties of
  null` with revision 2's prototype).
- **S7 — each impossible stored value fails closed [r3 I2]**: a proof with no `heads`, `heads` an
  array, a value `"1"`, `-1`, `0.5`, `1e12` (larger than the chain's head), an empty map, and a map
  naming a node with no records → each `clock.behind_chain` at `R + 1 min`.
- **S12 — proof by deletion of the bound check** (`r3/s12-mutation-no-bound.log`): with "a head
  larger than its chain's current head covers nothing" deleted, the `1e12` row → `recorded`.
- **S8 — a restored database [r3 I2]**: the latest record on a second node's chain at `T`, the
  box's chain empty, `heads` from the database (one entry, the older chain); the box sells
  `[R+1m, R+10h, R+30m, R+10h+1m]` → `["recorded","recorded","clock.behind_chain","recorded"]`.
- **S9 — the row names another node**: `heads` right, `node_id` the second node →
  `[R+1m, R+10h, R+30m]` → `["recorded","recorded","clock.behind_chain"]`. The rule does not read the
  row's `node_id`, so a wrong one cannot widen it (the review's X6b admitted the step with revision
  2's anchor).
- **S10 — `heads` leaving out the older chain** (`{}` on S8's database): `R + 1 min` →
  `clock.behind_chain` — the older chain's records count as written under the restart, the named
  record among them, so the stop stays.
- **S13 — the tie-break's proof by deletion made reliable [r3 M2]** (`r3/s13-tiebreak.log`): two
  sales at one instant, eight runs, picking the latest by `… desc, id desc` and by `… desc, id asc`:
  the two picks differed in all eight (`differ true`). So a deletion that makes ONE caller order by
  `id asc` always picks the other record, and Task 5 case 7 fails every run.
- **S14 — the fiscal core's suites with the revised prototype** (`r3/s14-fiscal-suites-r3.log`):
  Q8's command → `Test Files 10 passed (10)`, `Tests 87 passed (87)`, the golden huella test
  (`write-path.e2e.test.ts`) and `inmutabilidad` among them, unedited.
- **S15 — what the route logs for a refused duplicate insert [r3 M4]** (`r3/p-unique-error.log`):
  `node:sqlite`'s refusal of a second row on a unique column is a plain `Error`
  (`{"code":"ERR_SQLITE_ERROR","errcode":2067}`, `UNIQUE constraint failed: r.registro_id`).
  `isAppError` is `value instanceof AppError` (`packages/shared/src/errors.ts:97-99`) and `codeOf`
  answers `"unknown"` for anything else (`packages/server-kit/src/error-code.ts:7-9`, read), so the
  boundary logs `errorCode: "unknown"`, not the index.

---

## Departures from the design

1. **AEAT's time comes from a HEAD to AEAT's QR validation host, not from a `consultar` reply's
   `Date` header.** Design §8 item 9: "AEAT's time from a read-only query's `Date` header, measured
   in pre-production first"; §4.8 b names the library's `consultar`. Measured: the submission host
   gives no time without our certificate (P1), and a certificate-authenticated reply could not be
   tried here (P11). The QR host is AEAT's own, read-only, needs no certificate, and gave its time
   over verified TLS to within a second (P3, P5). Decision 1; Task 19 files the `consultar`
   measurement with the one-line change that would make it.
2. **AEAT proof must be fresh (five minutes)**, as the design asks only of devices. AEAT contrary
   proof does NOT expire: per the design, any AEAT disagreement seen during the stop blocks a restart
   for the rest of that stop (decision 4) **[I5]**.
3. **The dashboard writes times as `2026-10-19 09:14`**, not `19/10/2026 09:14` (picture 9), as
   slice 7's departure 7 and slice 8's departure 4 chose (`formatIsoMinute`).
4. **The email carries no link**; it names the page by its menu path (slice 10 decision 11).
5. **The restart's bell alert names its proof by kind** ("the tax agency's time", "two devices or
   more", both), not the proof's figures; the figures are in the table and the dialog (decision 13).
6. **The 24-hour cap is exact, margin included [M1].** The design caps the restart "at most 24
   hours behind"; with the stop's one-minute margin on top, the first step back could reach 24 h
   59 s. The cover is capped at exactly 24 h (Q4).

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **AEAT's time for a restart, two ways.** (a) The drain's existing comparison with a submission
   reply's `TimestampPresentacion` (`apps/server/src/time-health.ts:49-101`, fed at `boot.ts:2657`)
   also becomes an AEAT witness: its instant is the timestamp plus 500 ms and its uncertainty half
   the round trip plus 500 ms, since the timestamp is read to the second (`time-health.ts:58-60`),
   as A679 widens its header time (`hour-clock-internet.ts:138-139`) **[M2]**. (b) A new read: an
   HTTPS `HEAD` to `QR_ENDPOINTS[environment]` (`@waitron/verifactu`'s `dist/endpoints.js:27-30`;
   `DeploymentEnvironment` is `"production" | "preproduction"`, so every box has one, CC 4) through
   the existing `authenticatedHourHead` (verified TLS, no client certificate, a fresh random
   `waitron_clock` query each time against caches), with A679's header checks (a `Date` that
   round-trips, no `Age`, no cache hit, no positive `max-age`; `hour-clock-internet.ts:106-122`) and
   a 5 s deadline; instant `date + 500`, uncertainty `500 + roundTrip / 2` (`:138-139`). The new
   reader lives in a new file and changes no A679 file. **Not built:** reading a `consultar` reply's
   `Date` header (P11). **Not measured:** the production QR host. Cost if the owner wants only
   `consultar`: (b) goes, and AEAT proof exists only while records wait to be sent.
2. **When the HEAD runs:** at most once a minute, by the clock watch (Task 10b), only while the raw
   comparison is behind, the box files records (`filesRecords`, `boot.ts:1528-1529`, false on a
   demo or prepare box, CC 50) and it is the primary. Cost: up to 1 440 HEAD requests a day to AEAT's
   public host for as long as a stop lasts.
3. **How a device reports its clock:** a request header `x-waitron-device-clock`, the browser's
   `Date.now()` taken as the till builds its equipment read (`getDeviceEquipment`), every 15 s
   while the poll runs. The server takes its own wall and steady readings when the request arrives
   — the first thing the handler does — and notes the sample only once `requireDevice` has passed,
   so a wait behind the write lock is not counted as clock difference **[M3]**. A value that is not
   a safe integer is ignored. CORS's `allowHeaders` gains the header. Kitchen screens never start the
   poll (Q9) and so are not witnesses. Why a header: the equipment URL stays unchanged, which one
   till test pins (CC 30). Cost: the request's own travel time counts as clock difference; on a LAN
   it is far under the minute margin.
4. **Which witnesses count [I5].** The latest reading per device and every AEAT reading are kept in
   memory with the box's wall and steady clocks at the comparison's midpoint **[M2]**.
   - A device witness, and an AEAT witness that agrees or says nothing, is handed out only while it
     is at most five minutes old by the steady clock AND the box's wall clock has moved with the
     steady clock since, to within 1 000 ms (A679's tolerance, `hour-clock.ts:56`, CC 51).
   - An AEAT witness that DISAGREES (decision 5) and was taken during the stop is kept as contrary
     proof, with no age limit and through clock steps, until the clock watch sees the raw comparison
     no longer behind (the stop's end), when the store forgets it: design §4.8 b, "Any evidence the
     other way … and the restart is not offered". A server restart forgets every witness (design §7).
   - **Alternative for the owner:** let an AEAT disagreement lapse when the box's clock is stepped
     after it, since it was evidence about the clock before the step. Not built: it departs from
     the design's words.
5. **What agrees:** a witness agrees when `|witnessAt − boxAt| + uncertaintyMs ≤ 60 000`; it
   disagrees when `|witnessAt − boxAt| − uncertaintyMs > 60 000`; otherwise it says nothing. A
   device's uncertainty is 0. Two devices agree with each other when their differences from the box
   are within 60 000 ms of each other. **A group of devices is a set in which every pair agrees with
   each other [M11];** the largest group wins, and among groups of the same size the one whose
   newest `boxAt` is latest. With devices at +2 h, +2 h 50 s and +2 h 100 s the largest group has
   two (the ends do not agree).
6. **"Gathered after the stop began"** is judged per witness: its `boxAt` was itself more than a
   minute earlier than the latest record's time. The stop's start is not stored (design §7).
7. **`clock.disagrees`:** an ongoing alert from the server (devices are the core's), area `box`,
   permission `system.manage`, severity `warning`, `since: null`, `screen: "box-status"`, raised
   whenever a group of two or more fresh devices all disagree with the box, stop or no stop. Params
   `{ count, deviceAt, boxAt }`: the group's size, its mean device time projected to the read, and
   the box's time at the read. Staff see nothing: A364 still holds for every clock that is not behind
   the last record (design §6).
8. **The lift, and the one step back it allows [C1].**
   - **8a. One latest record [I7].** `latestRecord(tx)` in `clock-behind.ts` orders by
     `fecha_hora_huso_gen_registro desc, id desc` and is the only way any code finds the latest
     record: `clockBehindChain`, `clockStopState` and `restartAfterClockStop` call it. The
     disproof does not need it: it picks restarts by their `[restarted_at, record_at)` window
     (decision 14) **[r3 M5]**. `id` is a random UUID (`newId`, `packages/db/src/schema/columns.ts:178`), so the tie-break
     is arbitrary but total and stable.
   - **8b. The cover.** `clockBehindChain` answers `null` when the raw comparison is behind and a
     restart covers the reading (Words). Every reader of the stop then lifts together: the strip,
     the bell's `clock.behind_chain`, the named check on every money route, the chain check inside
     the append, the drift suppression and the email's episode. No edit to `chain.ts` (Q1–Q8).
   - **8c. One step back, then the ordinary rule.** Before any record is written under the restart,
     the first step may go up to a minute further back than accepted (Q3, S3). Once one is written,
     each reading is held to the ordinary one-minute rule against the **latest time written under
     the restart** — a running maximum over those records, exactly the ordinary rule applied to
     them **[r3 I1]**. So a second step back of more than a minute stops payments again (Q1, S1), and
     so does a clock walking back 59 s at a time, at its second step (S5; it is not the record
     written just before that counts, which revision 2 used and S11 shows admits the walk). The
     Clock row then says `stepped_back`; a second press of the same record is refused
     `stepped_back` (decision 9). The same holds for the chain's own check, so no record can be
     written past it.
   - **8d. What the refusal names then.** When the stop is open because of 8c, `clock.behind_chain`'s
     `lastRecordAt` and `lastRecordOffsetMinutes` are those of the record holding the latest time
     written under the restart; otherwise the latest record's. (Not probed: S1 checks only the code;
     Task 5 case 2 pins the params.)
   - **What the owner chose under question 4, as built:** "The first sale after the restart steps the
     chain back by up to 24 hours; later sales carry times earlier than the last sale until real time
     passes it." Later sales do carry times earlier than the NAMED record, but never more than a
     minute earlier than the latest sale written under the restart. The pull request says so.
9. **The restart's checks, in this order**, each refusing `clock.restart_refused { reason, … }`
   (HTTP 409) unless it says otherwise:
   1. a reading before 28-10-2024 → `clock.unusable` itself (design §4.8 d);
   2. the raw comparison not behind → `reason: "not_stopped"`;
   3. `recordId` in the request is not `latestRecord(tx)`'s → `"record_changed"`;
   4. a restart already names the latest record: if it covers the reading, the answer is that first
      restart, `replayed: true`, HTTP 200, no row and no alert; if not, `"stepped_back"` with
      `{ personId, restartedAt }` of the first;
   5. gap more than 24 hours (`> 86 400 000` ms; exactly 24 h is allowed, Q4) → `"too_far"`;
   6. contrary proof (decisions 4–5) → `"contrary_proof"`;
   7. no proof → `"no_proof"`.
   The same function answers the Box status page's offer, so the page offers exactly what the press
   would accept at that moment.
10. **What a restart row holds:** `node_id` the box's node, `person_id` the manager, `restarted_at`
    and `clock_at` both the route's one reading, `registro_id` and `record_at` the latest record,
    `proof` the agreeing witnesses only — `{ authority: { boxAt, witnessAt, uncertaintyMs } | null,
    devices: [{ deviceId, boxAt, witnessAt }], heads: { [nodeId]: largestSecuencia } }` — `heads`
    read in the restart's transaction as `select node_id, max(secuencia) from registros_facturacion
    group by node_id`, one entry per chain the database holds **[r3 I2]**. Why in `proof`: it is the
    one free JSON column and this slice adds no migration. Decision 21 says what a wrong value
    does. The insert is a plain insert, with no conflict clause **[I2]**: two presses
    cannot overlap (one write transaction at a time, E3), so the second meets decision 9.4 first; a
    duplicate that ever reached the insert would be refused by the unique index and answer
    `500 server.internal` (E2; `error-boundary.ts:48-49`), never a silent drop.
11. **The seat gains four OPTIONAL methods** on `FiscalBackend`, beside slice 8's two:
    `clockStopState`, `restartAfterClockStop`, `noteClockProvedWrong`, `readAuthorityTime`. Only the
    Veri\*Factu backend has them; the server treats a missing method as "nothing to restart, no AEAT
    time". Measured: four optional methods typecheck across all 28 packages that depend on
    `@waitron/fiscal`, test files included, where one required method gave 499 errors (CC 36). No
    name or string in `packages/fiscal` holds a word of its vocabulary guard
    (`no-regime-vocabulary.test.ts:57-71`; comments are blanked first): the record id is `recordId`
    there, never `registroId`.
12. **The route** is `POST /api/box/clock-restart`, body `{ recordId }`, in `box-health-api.ts`
    beside Liberar, `system.manage`, ONE `withTransaction` holding the authorization (a direct
    `authorizeManager(tx, …)` call — never `authorizeSystemManager` (`box-health-api.ts:25-36`),
    which opens its own transaction **[M7]**), the reading, the seat's checks, the row and the alert.
    A body that is not an object, or a `recordId` that is not a non-empty string, is refused
    `management.request_invalid { field: "recordId" }` (400; `packages/shared/src/errors.ts:58`). A
    till's device or PIN session gets `management_session.required` (401): the design keeps the
    restart off the till. It answers `{ restart: { personName, restartedAt, clockAt, lastRecordAt },
    replayed }`. The Box status read gains `clockStop: ClockStopView | null`, read in a write-lock
    turn with no drain like the rest of that read (`box-health.ts:68-69`). On a full disk the press
    is refused `storage.disk_full`, as any write is.
13. **The two recorded alerts, one per restart [CC 28, CC 29, M8].**
    `clock.behind_chain_restarted`: severity `warning`, origin `jobOrigin("dashboard")`, `saleId` the
    named record's sale, `detectedAt` the restart's reading, params `{ restartId, person, clockAt,
    lastRecordAt, proof }` with `person` the display name at that moment and `proof` one of
    `"authority"`, `"devices"`, `"authority_and_devices"`, worded by `{proof:clock_restart_proof}`
    with a word list registered as `clock_restart_proof` **[I1]**. `clock.behind_chain_disproved`:
    severity `error`, origin `jobOrigin("fiscal_filing")`, `saleId` the named record's sale, params
    `{ restartId, from, to }` (decision 14). Because the open-incident index keys on source, device,
    code and sale (P10), giving each restart's alerts its named record's sale keeps every restart's
    and every disproof's alert apart, each with its own person and times (Q10); restarts name
    different records (the unique index), so their sales differ except when two named records
    belong to one sale (an alta and its own anulación; no route issues an anulación today, slice 8
    decision 4), which Task 19 records. The Veri\*Factu module claims the prefix `clock.behind_chain`
    for area `box` under `system.manage`; the longest claim wins over the core's `clock.`
    (`apps/server/src/alerts.ts:37-46`). Both are written by `clock-stop-incidents.ts`, which throws
    nothing (the alert guard reads every dotted literal in a listed file as a recorded code,
    `scripts/alert-codes.test.ts:90-97`). Both codes are declared in the Veri\*Factu error registry
    with their params, as recorded codes are (`errors.ts:117`) **[M5]**.
14. **Disproof, kept by the clock watch** (`apps/server/src/clock-watch.ts`, every minute, primary
    only, unref'd timer, first tick a minute after start, each next armed after the last finished,
    `stop` waiting for a tick in flight — the shape of `box-alert-email.ts:84-235`; on both
    `undoOnFailure` and the close list `boot.ts:2859-2882` **[I3]**):
    - a **jump**: between two ticks the wall clock moved more than 60 000 ms further than the
      steady clock; `trustedUntil` is the earlier tick's wall time plus the steady time since
      (2026-10-23: the elapsed-time clock is /proc/uptime on Linux, so a resume from suspend is not
      a jump — `docs/developers/conventions-data.md`, "A jump");
    - **AEAT disagrees**: an AEAT witness that disagrees, noted since the last tick; `trustedUntil`
      is that witness's `boxAt` — the wrong clock's reading when AEAT contradicted it **[I4]**.
    Either calls `noteClockProvedWrong(tx, { trustedUntil, reason })`. For each restart **in force**
    at `trustedUntil` (`restarted_at ≤ trustedUntil < record_at`) with no `clock.behind_chain_disproved`
    yet (acknowledged or not, matched by `params.restartId`), it records one with **`from` the
    EARLIEST and `to` the LATEST generation time among the records written under that restart when
    the disproof is observed [I4, r3 M1]** — by time, not write order: the first record written can
    be later than the second (review round 3's X9: secuencia 2 at `07:13:00`, secuencia 3 at
    `07:12:02`). A restart under which no record was written gets no alert, since no sale carries its
    clock; the watch logs `clock_watch.disproved_unused { restartId }`. A backward step is not
    disproof; it stops payments again (decision 8c). Nothing else changes (design, decision 13):
    **after a disproof the restart still covers**, so sales recorded later fall after `to`, and no
    second alert is recorded for that restart (it already has one). The guide says so and Task 19
    records it **[r3 M1]**.
15. **`clock.unusable` in the bell.** The module's clock source (`clockBehindSource`, the name kept)
    answers `clock.unusable` instead of `clock.behind_chain` while the reading is before
    28-10-2024: error, area `box`, `system.manage`, `since: null`, `screen: "box-status"`, params
    `{ clockAt }`. It is an ongoing source, so the core's `clock.` claim for recorded incidents does
    not decide its area — settling slice 3's open question. Judged at offset 0, as the source already
    reads (`clock-behind-alerts.ts:11`; the alert context has no offset, `packages/module/src/alerts.ts:29-32`),
    so in the first hour or two of 28-10-2024 local time the bell can say "before" where the till
    does not. Under a 2001 clock the bell shows one red alert, not two; the drift alert stays
    suppressed there (`clockBehindChain` does not apply the minimum date; review "found sound").
16. **The clock-stop email** goes through slice 10's duty: the episode keeps the params of the notice
    that started it, `boxEmailMessage(code, language, venue, params?)` fills `{clockAt}` and
    `{lastRecordAt}`, each written `dd/mm/yyyy hh:mm` in its own offset. One email per stop: the
    episode ends when the notice goes — the clock is fixed, real time passes the record, or a restart
    lifts it.
17. **The Clock row says which way.** Past a minute, "…the box was {seconds} s ahead" or "…behind"
    (`box_status.clock.compared_ahead` / `_behind`; `driftSeconds` is box less AEAT,
    `time-health.ts:96`); within a minute today's "{seconds} s apart". The bell's seconds can still
    differ from the row's; that stays open.
18. **The dialog** is a `wt-dialog` opened from the Clock row's **Reanudar los cobros** (EN **Restart
    payments**), shown only while `clockStop.offer` is `"offered"`. It holds no staged input, so it
    takes no draft scope. Its confirm button is drawn primary, disabled and loading while its request
    is sent. A refusal shows its reason's sentence on its own line above the buttons, leaves the
    button enabled (design-system → Forms), **and refreshes the page** (`liveData.refresh`), so the
    row behind the dialog and its reason line match the box **[M9]**; a success closes the dialog and
    refreshes. The words for each reason live in `apps/dashboard/src/i18n/strings.ts` as
    `box_status.clock.refused.<reason>`, picked by the dialog from the error's `reason`;
    `apps/dashboard/src/i18n/codes.ts` gives `clock.restart_refused` one generic sentence for any
    other surface **[M6]**. Without an offer the row shows why in words, never a disabled button.
19. **The backup verifier learns the table's two links**
    (`["clock_stop_restarts", "node_id", "nodes", "id"]`,
    `["clock_stop_restarts", "registro_id", "registros_facturacion", "id"]`).
20. **Parked**, as the build plan's row 9 says.
21. **The anchor of "written under a restart" is a map of every chain's head, and it fails closed
    [r3 I2].** Revision 2 stored one count for "the box's own chain"; the rule then had to know which
    node sells, which the append's own check cannot be told (`refuseWhileClockBehind` gets only the
    reading, and `chain.ts` is not edited), and a wrong value or a wrong `node_id` widened the cover
    (the review's X5, X6b). Instead the row stores `heads`, every chain's largest `secuencia` at the
    restart (decision 10), and the rule never reads the row's `node_id`. One definition, used by the
    writer and the reader alike. The cover is NOTHING — the stop stays, and nothing throws — unless
    `proof` is a non-null, non-array object whose `heads` is a non-null, non-array object in which
    every value is a safe integer `≥ 0` and no value is larger than its node's current largest
    `secuencia` (0 for a node with no records). A node the map leaves out counts from 0, so its
    records all count as written under the restart, which can only narrow the cover (S10). Since
    `clock_stop_restarts` is append-only, a bad row is harmless for ever: it covers nothing and
    cannot be corrected or removed, and the next stop is a new latest record with no row. Measured:
    S6–S10, S12. Cost: one `group by node_id` read of `registros_facturacion` per covered reading
    (the cover runs only while the raw comparison is behind), on a database with a handful of
    chains.

## Behaviour this slice changes

1. While the stop is open and a manager restarts with proof, every action slice 8 stops works again;
   the next record carries the box's clock, earlier than the named record's (P6b, P7), and every
   record after it is held to the one-minute rule against the latest time among the records written
   under the restart (S1, S5).
2. New in the bell: `clock.disagrees`, `clock.unusable`, `clock.behind_chain_restarted`,
   `clock.behind_chain_disproved`. Under a clock before 28-10-2024 the bell shows `clock.unusable`
   instead of `clock.behind_chain`.
3. New route `POST /api/box/clock-restart`; `GET /api/box/health` gains `clockStop`.
4. The till sends `x-waitron-device-clock` on its equipment read.
5. During a stop the box makes a `HEAD` to AEAT's QR validation host once a minute.
6. The managers get the clock-stop email once per stop.
7. The Clock row says ahead or behind past a minute; it gains the restart offer and the dialog.
8. The backup verifier refuses a copy whose `clock_stop_restarts` names a missing node or record.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths; never `git add -A`; never `git add -p` (interactive). Do not push.
- **The fiscal core rule.** Not edited: `@waitron/verifactu` (outside the repo), `chain.ts`,
  `registro-row.ts`, `backend.ts`'s record methods, `packages/core/src/record-*.ts`, the series and
  numbering code, A679's `hour-*.ts` files, the golden test and `inmutabilidad.test.ts`. After every
  task touching `packages/fiscal-verifactu`, `packages/fiscal` or `packages/core`:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  passes, and
  `git diff main -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/registro-row.ts packages/core/src 'packages/fiscal-verifactu/src/hour-*' ':!packages/core/src/*.test.ts'`
  prints nothing.
- **No migration.** `git diff main --name-only -- '*/drizzle/*' packages/migrations` prints nothing.
- **Module seams:** no file under `apps/server/src` imports `@waitron/fiscal-verifactu` outside
  `testing/` (`scripts/module-seams.test.ts`); the server reaches the module through
  `FiscalBackend`.
- **Transactions:** the restart route opens exactly one `withTransaction`; queries on it are awaited
  in turn, never `Promise.all`. The read paths (box health, alert sources, notices) only read.
- **Error codes:** new `clock.restart_refused` (thrown) and the recorded `clock.behind_chain_restarted`
  and `clock.behind_chain_disproved`, all three in the Veri\*Factu registry
  (`packages/fiscal-verifactu/src/errors.ts`, beside `clock.unusable` at `:360`) with their params
  **[M5]**. `clock.restart_refused` is thrown only from `clock-stop-restart.ts`, never from a file
  listed in `scripts/alert-codes.test.ts`. New ongoing code `clock.disagrees` (server). Every alert
  code has EN and ES words in `apps/dashboard/src/i18n/alert-messages.ts`. No other new code: a bad
  body reuses `management.request_invalid`.
- **Words:** general code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/dashboard/src/i18n/*`, `apps/till/src/i18n/*`, `apps/server/src/i18n/box-emails.ts` and
  `apps/server/src/guide/es/`. Each task greps its own diff:
  `git diff main -U0 -- apps packages ':!*/i18n/*' ':!apps/server/src/guide/es/*' | /usr/bin/grep -nE '^\+.*(cobr|venta|hora del|encargado|equipo|reanud|prueba)'`
  prints nothing.
- **Tests:** database tests use `useVenueDb` (CLAUDE.md §4). A refused write asserts the domain code
  and its params, never `toBeInstanceOf(Error)`. Every "nothing written" is a row count before and
  after. Every refusing case has a control that goes through. Server files that record sales follow
  slice 8 decision 13 (`docs/developers/testing-guide.md`): setup records one sale at the real
  clock; each case reads NOW from the database; every write uses a clock built from NOW; a case that
  must write on another clock gets a database of its own. Witness and watch tests take injected
  `wall` and `monotonic` functions, never fake timers over the database.
- Coverage 98/98/98/95 in every touched package; no exclude, no ignore comment.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`; root guards
  `pnpm exec vitest run scripts/<guard>.test.ts`. Read the `Tests` count every time. Unset
  `AI_AGENT` and `CLAUDECODE` to see a passing test's console output. Every task runs
  `pnpm exec prettier --check` on the files it touched (a file under `docs/` prints
  `"ignored": true` with `pnpm exec prettier --file-info <file>` instead).
  `TESTCONTAINERS_RYUK_DISABLED=true` for every local run. CI runs the package suites and coverage.
- `apps/till`, `apps/dashboard` and the browser half of `packages/fiscal-verifactu` run in real
  headless Chromium: check `memory_pressure | grep free` first; run beside another session's browser
  run only when free memory is well above 15%.
- **No test contacts AEAT.** The HEAD reader is tested against a local HTTPS server with a test
  authority, as `hour-clock-internet.test.ts:354-395` does (CC 54).

## Review focus

1. **A restart without proof, against contrary proof, or past 24 hours.** Expected: refused with its
   reason, nothing written (Task 6 cases 2–6; Task 9a cases 1–3). Proof by deletion for each check.
2. **A witness that should not count.** Older than five minutes; taken before a step of the box's
   clock; taken before the stop; one device twice; an AEAT disagreement older than five minutes
   still counting against (Tasks 1, 2, 6).
3. **The one step back [C1].** A covering restart sells; a second step back of more than a minute
   after a record is written stops again, and so does a clock walking back 59 s at a time, at its second
   step **[r3 I1]**; a malformed restart row covers nothing **[r3 I2]**; a forward-moving clock keeps selling; the strip, the bell,
   the named check and the chain check agree (Task 5; Task 9b case 2).
4. **One latest record [I7].** Two records in one second: the restart, the stop and the page name
   the same one (Task 5 case 7).
5. **The bell is not the record.** Marking `clock.behind_chain_restarted` handled leaves payments
   running (Task 9b case 1); two restarts give two alerts (Task 7 case 4).
6. **A second restart of the same record** is answered with the first, writes no row and no alert;
   after a further step back it is refused `stepped_back` (Task 6 cases 7–8; Task 9a case 5).
7. **Two simultaneous presses [I2]** through the real route: one row, one alert, one `replayed:
   false`, one `replayed: true` (Task 9a case 6).
8. **Disproof.** A forward jump while a restart is in force, and an AEAT reading that disagrees,
   record one `clock.behind_chain_disproved` per restart with its own `from` and `to`, and nothing
   else (Tasks 7, 10b).
9. **The fiscal core.** The golden test and `inmutabilidad` unedited and green; `chain.ts` and the
   hour-code files untouched.
10. **Devices cannot be the source of a time.** No device or AEAT time is ever stamped on a record
    (grep in Task 9a Step 5).
11. **A device that lies.** Two devices can fake proof; the restart still needs a `system.manage`
    holder's press and a gap of at most 24 hours. Recorded as a known limit (Task 19).

## Review path

**FULL** (build plan row 9: fiscal invariants, auth): per-task reviews, the full `/finish-branch`
wave, and two Codex run-it reviews side by side. The fresh-context plan-against-spec read runs
before implementers start. The slice is **parked** for the owner.

**The pull request description says**, in its first lines: it is parked (a manager's restart lets
ONE record carry a time earlier than the record before it; every later record is held to the
one-minute rule against the latest time among the records written under the restart — the reading of the owner's question-4 answer
that was built, decision 8); the box asks AEAT's QR validation host for its time during a stop;
no migration; `chain.ts`, the golden test and `inmutabilidad` unchanged; AEAT's time comes from the
QR host's `Date` header, not from `consultar`, which was not measured (departure 1, P11).

**Codex seat 1 (with this plan's checklist).** Experiments decided up front:
- Boot a server (`serverFixture` of `apps/server/src/boot.disk-full-wiring.test.ts`) on a venue with
  a sale recorded, its clock 14 hours behind it: `GET /api/box/health` as a manager →
  `clockStop.offer: "no_proof"`; two `GET /api/device/equipment` from two devices with
  `x-waitron-device-clock` equal to the box's time → `"offered"`; `POST /api/box/clock-restart` →
  200, one row in `clock_stop_restarts`; `POST /api/pay` cash → 200; the same press again → 200
  `replayed: true`, still one row; mark the bell's restart alert handled → pay again → 200.
- The same with the two devices 2 hours ahead of the box → `"contrary_proof"`, and the bell shows
  `clock.disagrees`; with the record 25 hours ahead → `"too_far"`.
- Delete, one at a time, the cover in `clockBehindChain`, the newest-written-record rule, the
  24-hour cap, the during-the-stop check and the freshness filter; name the test that fails for
  each.

**Codex seat 2 (told to set the checklist aside).** Find a way to restart without proof or to write
a record further back than the rules allow: replay a device header from an old request; send one
device's header from two browsers; step the box's clock back by 30 s, 61 s and 2 min after a restart;
restart, sell for an hour, then step back 30 min **[C1]**; restart, sell, then walk the clock back
59 s per sale **[r3 I1]**; store a restart row with a hand-made `heads` (too large, negative, a
string, `null`) and sell **[r3 I2]**; restart, let real time pass the record,
then step back; race two presses; restart under a clock before 28-10-2024; two records in one second.

---

### Task 1: Judging witnesses (packages/fiscal)

**Files:**
- Create: `packages/fiscal/src/clock-witnesses.ts`, `packages/fiscal/src/clock-witnesses.test.ts`
- Modify: `packages/fiscal/src/index.ts` (exports), `packages/fiscal/stryker.config.json` (`mutate`
  gains `src/clock-witnesses.ts` **[M12]**: its list is `src/clock.ts` and `src/backend.ts` today,
  and `packages/fiscal`'s mutation runs locally only, `docs/developers/ci-and-gates.md:397`)

**Interfaces:**
```ts
export const CLOCK_WITNESS_MARGIN_MS = 60_000;
export interface ClockWitness {
  readonly kind: "authority" | "device";
  /** The device's id; "authority" for AEAT readings. */
  readonly id: string;
  /** The box's wall clock at the moment the comparison refers to, ISO 8601. */
  readonly boxAt: string;
  /** The witness's clock at that moment, ISO 8601. */
  readonly witnessAt: string;
  readonly uncertaintyMs: number;
}
export interface ClockWitnessVerdict {
  /** Witnesses that agree with the box (decision 5), the latest per id. */
  readonly agreeing: readonly ClockWitness[];
  /** Authority witnesses that disagree, the latest first. */
  readonly authorityDisagrees: readonly ClockWitness[];
  /** The largest group (every pair agrees with each other) of two or more devices that all disagree with the box. */
  readonly devicesDisagreeing: readonly ClockWitness[];
}
export function judgeClockWitnesses(witnesses: readonly ClockWitness[]): ClockWitnessVerdict;
```

- [ ] **Step 1: Write the failing tests** (`clock-witnesses.test.ts`, plain Node):
  1. a device 60 000 ms off agrees; 60 001 ms off disagrees; an authority 59 000 ms off with
     uncertainty 1 000 agrees, with 1 001 says nothing; 61 001 off with uncertainty 1 000 disagrees;
  2. two devices +2 h and +2 h 0 min 59 s → `devicesDisagreeing` both; +2 h and +2 h 1 min 1 s → none;
     one device +2 h alone → none;
  3. three devices +2 h, +2 h 30 s, −3 h → the group of two;
  4. **[M11]** three devices +2 h, +2 h 50 s, +2 h 100 s → a group of two (the ends do not agree),
     the one with the latest `boxAt` among equal sizes;
  5. the same device id twice → only the later `boxAt` counts;
  6. no witnesses → empty verdict.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal exec vitest run src/clock-witnesses.test.ts` → fails to resolve
  `./clock-witnesses.js`.
- [ ] **Step 3: Implement.** Pure; no clock read.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`
  → PASS; `pnpm --filter @waitron/fiscal typecheck` exits 0; then
  `pnpm --filter @waitron/fiscal mutation` (local only; memory first) → the score at or above the
  break of 90 (`stryker.config.json`'s `thresholds`); every surviving mutant in
  `clock-witnesses.ts` killed by a new case or named in the report.
- [ ] **Step 5: Proofs by deletion**: `≤` → `<` → case 1 fails; drop the uncertainty widening → case
  1's authority case fails; drop the pairwise check → cases 2 and 4 fail.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal/src/clock-witnesses.ts packages/fiscal/src/clock-witnesses.test.ts packages/fiscal/src/index.ts packages/fiscal/stryker.config.json
  git commit -s -m "The fiscal seat's package can say whether other clocks agree with the box's, within a minute"
  ```

### Task 2: The server keeps witnesses

**Files:**
- Create: `apps/server/src/clock-witnesses.ts`, `apps/server/src/clock-witnesses.test.ts`

**Interfaces:**
```ts
export interface ClockWitnessStore {
  /** `arrived`: the box's wall and steady readings when the request arrived (decision 3). */
  noteDevice(deviceId: string, deviceMs: number, arrived: { wallMs: number; monoMs: number }): void;
  /** `at`: the box's wall and steady readings at the comparison's midpoint (decision 4). */
  noteAuthority(sample: { authorityMs: number; uncertaintyMs: number; at: { wallMs: number; monoMs: number } }): void;
  /** Fresh agreeing-or-silent witnesses (≤ 5 min, no step since) and every kept AEAT disagreement. */
  witnesses(): ClockWitness[];
  /** AEAT witnesses noted since the last call, for the clock watch's disproof. */
  takeNewAuthority(): ClockWitness[];
  /** The stop has ended: forget the kept AEAT disagreements. */
  endStop(): void;
}
export function createClockWitnessStore(deps?: { wall?: () => number; monotonic?: () => number }): ClockWitnessStore;
```

- [ ] **Step 1: Write the failing tests** with injected `wall` and `monotonic`:
  1. a device noted, read 299 s later → one witness with `boxAt` the ARRIVAL time, `witnessAt`,
     `uncertaintyMs: 0`; 301 s later → none;
  2. a device noted, then the wall clock steps forward 2 s against the steady clock → none; 900 ms
     → kept;
  3. the same device noted twice → one witness, the later;
  4. `NaN`, `1.5` and a string coerced — none noted;
  5. an agreeing AEAT witness 301 s old → gone; **a disagreeing one 10 min old and after a 2 s step
     → still handed out [I5]**; after `endStop()` → gone;
  6. `takeNewAuthority` returns each authority sample once.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-witnesses.test.ts`.
- [ ] **Step 3: Implement**, using Task 1's `judgeClockWitnesses` to tell a disagreeing AEAT sample.
- [ ] **Step 4: Run** → PASS; typecheck `@waitron/server`.
- [ ] **Step 5: Proof by deletion**: remove the step check → case 2 fails; remove the age check →
  case 1 fails; apply the age check to disagreements too → case 5 fails.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/clock-witnesses.ts apps/server/src/clock-witnesses.test.ts
  git commit -s -m "The box keeps other clocks' readings: fresh ones as proof, and every disagreement from AEAT until the stop ends"
  ```

### Task 3: Tills and handhelds report their clock on the equipment read

**Files:**
- Modify: `apps/till/src/api/client.ts` (`getDeviceEquipment`, `:3459-3466`: pass the header; let
  `#request` (`:4748`) take extra headers without changing any other call),
  `apps/server/src/device-api.ts` (the GET at `:397-427`: take the box's wall and steady readings
  first, note the header after `requireDevice`; `deps.clockWitnesses?: Pick<ClockWitnessStore,
  "noteDevice">` beside `notices` at `:133`), `apps/server/src/cors.ts` (`allowHeaders` gains
  `"x-waitron-device-clock"`), `apps/server/src/boot.ts` (create the store once; hand it to
  `mountDeviceApi` at `:1839`)
- Test: `apps/till/src/api/client.test.ts` (a new case beside `:3446`), `apps/till/src/till-app.test.ts`
  (a new case beside `:1921`), `apps/server/src/device-api.test.ts` (new cases), `apps/server/src/cors.test.ts`
  (a new case)

- [ ] **Step 1: Write the failing tests.**
  - Till client: `getDeviceEquipment` sends `x-waitron-device-clock` equal to `String(Date.now())`
    at the call (`vi.spyOn(Date, "now")`), with no `content-type` and no body; the existing case at
    `:3446` passes unedited (CC 30).
  - Till app: a `kds_station` device booted as `:1921-1961` does never starts the equipment poll
    (`vi.spyOn(EquipmentPoll.prototype, "start")` → 0 calls), and a till signed in starts it once —
    Q9 as a kept test, so a later change that makes kitchen screens poll is seen **[CC 35]**.
  - Server: a device's equipment read with `x-waitron-device-clock: <ms>` → `noteDevice` called
    once with the device's id, that number and the arrival readings; the arrival readings are taken
    before `requireDevice` (an injected `wall` that advances on each call shows the first value);
    without the header, or with `abc`, → not called; an unpaired request → refused as today and not
    called.
  - CORS: a preflight from an allowed origin asking for `x-waitron-device-clock` → the answer's
    `access-control-allow-headers` contains it.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/till-app.test.ts -t "equipment"`
  (Chromium: memory first; the kds case passes already — it pins today's behaviour);
  `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/cors.test.ts`.
- [ ] **Step 3: Implement** decision 3.
- [ ] **Step 4: Run** → PASS; typecheck both packages; `pnpm --filter @waitron/till exec vitest run src/till-app.nfc.test.ts src/widgets/equipment-dialog.nfc.test.ts`
  → PASS unedited.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/till/src/api/client.ts apps/till/src/api/client.test.ts apps/till/src/till-app.test.ts apps/server/src/device-api.ts apps/server/src/device-api.test.ts apps/server/src/cors.ts apps/server/src/cors.test.ts apps/server/src/boot.ts
  git commit -s -m "Tills and handhelds send their own clock with each equipment read, and the box keeps it as a witness"
  ```

### Task 4: `clock.disagrees`, and AEAT's submission comparison as a witness

**Files:**
- Create: `apps/server/src/clock-disagrees-alert.ts`, `apps/server/src/clock-disagrees-alert.test.ts`
- Modify: `apps/server/src/time-health.ts` (`createAuthorityClockStatus.observe` gains an optional
  `onSample`: for each comparison it keeps, `{ authorityMs: timestamp + 500, uncertaintyMs:
  (received − sent) / 2 + 500, at: the midpoint's wall and steady readings }` **[M2]**),
  `apps/server/src/boot.ts` (the source in `serverAlertSources` at `:2213`; `onSample` →
  `witnesses.noteAuthority`), `apps/dashboard/src/i18n/alert-messages.ts` (`clock.disagrees`'s
  words, Task 12's text)
- Modify (declared change 3, own commit): `scripts/ongoing-alert-codes.test.ts`
- Test: `apps/server/src/time-health.test.ts` (new cases; existing ones pass unedited)

- [ ] **Step 1: Write the failing tests.** Source: two fresh devices +2 h → one alert
  `{ key: "clock.disagrees", code: "clock.disagrees", severity: "warning", since: null, screen:
  "box-status", params: { count: 2, deviceAt, boxAt } }`, area `box`, permission `system.manage`;
  one device → none; two devices within a minute of the box → none. Time health: an observed reply
  calls `onSample` once with `timestamp + 500`, half the interval plus 500 and the midpoint; a reply
  with no timestamp calls nothing.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-disagrees-alert.test.ts src/time-health.test.ts`.
- [ ] **Step 3: Implement**; add the words.
- [ ] **Step 4: Declared change 3** in its own commit, after which
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts` → PASS
  (proof: drop the words → `ongoing-alert-codes` FAILS naming `clock.disagrees`; restore).
- [ ] **Step 5: Commit, in two.**
  ```bash
  git add apps/server/src/clock-disagrees-alert.ts apps/server/src/clock-disagrees-alert.test.ts apps/server/src/time-health.ts apps/server/src/time-health.test.ts apps/server/src/boot.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "Managers are warned when two devices agree the box's clock is more than a minute off, and AEAT's replies count as a witness"
  git add scripts/ongoing-alert-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 9): the ongoing alert guard reads the clock-disagrees source"
  ```

### Task 5: The lift — one latest record, one step back

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind.ts` (decisions 8 and 21; the shape is
  `~/waitron-campaign-b/a798-9-plan-probe/r3/prototype-clock-behind-r3.diff`; export `latestRecord`,
  `storedHeads` and `latestWrittenAfter`, which Tasks 6 and 7 reuse)
- Create: `packages/fiscal-verifactu/src/clock-behind.restart.test.ts`

The test inserts restart rows directly (the writer is Task 6), as `clock-stop-restarts.test.ts:20-37`
does, with `proof: { heads }` read from the database as decision 10 says (or hand-made for the
impossible values), and records through `VerifactuBackend` and `recordSale` as
`chain.clock-behind.test.ts:31-55` does. S1–S10 are its cases.

- [ ] **Step 1: Write the failing tests:**
  1. a record at `T`; a sale at `R = T − 14.5 h` → `clock.behind_chain`; a restart naming it
     (`clock_at R`, `record_at T`, `heads` from the database); a sale at `R + 1 min` → recorded, its
     `anterior_huella` the first's `huella`;
  2. **[C1]** after the restart: `R + 1 min`, `R + 10 h`, `R + 30 min`, `R + 10 h − 59 s`,
     `R + 10 h − 2 min` → recorded, recorded, `clock.behind_chain`, recorded, `clock.behind_chain`
     (S1); the third refusal's params name the record holding the latest time written under the
     restart (`lastRecordAt` `R + 10 h`, decision 8d);
  3. **[C1] control:** `R + 1 min`, `R + 10 h`, `R + 10 h + 5 min` → all recorded (S2);
  3b. **[r3 I1] the twelve-step walk:** `R + 1 min`, `R + 10 h`, then `R + 10 h − 59 s × 1 … 12` →
     recorded, recorded, recorded, then `clock.behind_chain` for each of the eleven after it: the
     second 59 s step is refused (S5);
  4. the first step: before any record under the restart, `R − 61 s` refused, `R − 59 s` recorded;
     then `R + 1 min` recorded and `R − 59 s` refused (Q3);
  5. **[M1]** a restart accepted at exactly 24 h: `T − 24 h − 1 s` refused, `T − 24 h` recorded (Q4);
  6. `clockBehindChain`, the staff-notice source and `clockBehindSource` agree at `R` (nothing) and
     at `R − 2 min` (the stop);
  7. **[I7]** two records at the same instant: `latestRecord` names one; a restart naming the other
     leaves the stop on; one naming `latestRecord()`'s lifts it (Q5);
  8. a restart naming a record that is no longer the latest (real time passed it) does not lift a
     new stop; a reading before 28-10-2024 with a restart → `refuseWhileClockBehind` still throws
     `clock.unusable`;
  8b. **[r3 I2] the anchor fails closed and never throws**, each a sale at `R + 1 min` →
     `clock.behind_chain`: a proof stored as JSON `null` (raw SQL); a proof with no `heads`; `heads`
     an array; a value `"1"`, `-1`, `0.5` and one larger than its chain's head; an empty map; a map
     naming a node with no records (S6, S7);
  8c. **[r3 I2] two chains**: the latest record on an older chain of a second node, the box's chain
     empty — `R + 1 min`, `R + 10 h`, `R + 30 min`, `R + 10 h + 1 min` → recorded, recorded,
     `clock.behind_chain`, recorded (S8); the same with the row's `node_id` the other node → the
     same answers (S9); `heads` leaving out the older chain → `clock.behind_chain` at `R + 1 min`
     (S10);
  9. an invoice dated a day earlier than the record it links to (P7) → recorded, and
     `verifyBackupFiscalChains` over a backup copy answers `true`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind.restart.test.ts` →
  every case that expects `recorded` after a restart fails `clock.behind_chain`; 7 fails to import
  `latestRecord`.
- [ ] **Step 3: Implement** `latestRecord`, `storedHeads` and the cover (one unique-index read, one
  `group by node_id` read of the chains' heads, and one read per chain of the latest time after its
  stored head, served by `registros_node_secuencia_idx`; all only when the raw comparison is
  behind). Nothing in it may throw for any stored `proof`.
- [ ] **Step 4: Run** the new file and Q8's list → PASS; the fiscal-core check of Global constraints
  prints nothing.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run, each failure named in the report:
  order the "latest time written under it" read by `secuencia` instead of by time → case 3b
  prints `recorded` for every step (S11); delete the rule altogether → case 2 records `R + 30 min`
  (Q7); delete the bound check → case 8b's too-large head is `recorded` (S12); drop the margin from
  the cover → case 4's `R − 59 s` is refused; drop the cap → case 5's `T − 24 h − 1 s` is recorded;
  make `clockStopState` (Task 6) or the test's second reader order by `id asc` while
  `latestRecord` keeps `id desc` → case 7 fails on every run, since two distinct ids always order
  differently (S13) **[r3 M2]**. (Deleting the tie-break outright is not a reliable proof: the
  engine's pick then matches the larger id only some of the time, review round 3's X14.)
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind.ts packages/fiscal-verifactu/src/clock-behind.restart.test.ts
  git commit -s -m "A manager's restart lifts the payment stop for one step back; any later step back of more than a minute, even in small steps, stops it again"
  ```

### Task 6: The restart rule and its writer

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-restart.ts`, `packages/fiscal-verifactu/src/clock-stop-restart.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (`clock.restart_refused` with its params)

**Interfaces** (the shared types move to `@waitron/fiscal` in Task 8; shapes do not change):
```ts
export type ClockRestartOffer =
  | "offered" | "no_proof" | "contrary_proof" | "too_far" | "stepped_back" | "restarted";
export interface ClockStopState {
  clockAt: string; offsetMinutes: number; lastRecordAt: string; lastRecordOffsetMinutes: number;
  recordId: string; gapMs: number;
  restart: { personId: string; restartedAt: string; clockAt: string } | null;
  offer: ClockRestartOffer;
  proof: { authority: ClockWitness | null; devices: ClockWitness[] };
  contrary: { authority: ClockWitness | null; devices: ClockWitness[] };
}
export async function clockStopState(tx, reading, witnesses: readonly ClockWitness[]): Promise<ClockStopState | null>;
export async function restartAfterClockStop(tx, input: {
  reading; witnesses: readonly ClockWitness[]; personId: string; nodeId: string; recordId: string;
}): Promise<{ restart: { id: string; personId: string; restartedAt: string; clockAt: string; lastRecordAt: string; proofKind: "authority" | "devices" | "authority_and_devices" }; replayed: boolean }>;
```
Both call `latestRecord(tx)` **[I7]**. `clockStopState` answers `null` when the raw comparison is not
behind and when the reading is before 28-10-2024; `offer` is `"restarted"` when a restart covers the
reading. Only witnesses taken during this stop count (decision 6). `restartAfterClockStop` runs
decision 9's checks in order and writes decision 10's row with a plain insert. **It records no
alert**: Task 7 adds that, so this task never makes the alert guard red **[M4]**.

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, a record at `T`, witness fixtures with
  `boxAt` behind `T`):
  1. two devices agreeing, gap 14.5 h → `offer: "offered"`; restart → one row with decision 10's
     columns, `proof.heads` equal to `select node_id, max(secuencia) … group by node_id` read just
     before the press (one entry per chain), `replayed: false`; a sale at the reading → recorded;
  1b. **[r3 I2] a restored database through the writer**: an older chain on a second node holds the
     latest record, the box's chain is empty; the restart written by `restartAfterClockStop` (not by
     hand); then a sale at the reading → recorded; then a reading 30 min behind that sale →
     `clock.behind_chain`. A writer that stored only the box's chain, or counted all records as one
     number, fails this case or case 1;
  2. **no proof** (no witnesses; one device; an AEAT witness that says nothing) → `"no_proof"`;
     restart refused `clock.restart_refused { reason: "no_proof" }`, row count unchanged;
  3. **contrary proof**: two agreeing devices plus an AEAT witness that disagrees → `"contrary_proof"`;
     the same with the AEAT disagreement 10 minutes old and no step since → `"contrary_proof"`
     **[I5]**; two agreeing devices plus a group of two at +2 h → `"contrary_proof"`; each refused,
     nothing written;
  4. **a 25-hour gap** with proof → `"too_far"`, refused; exactly 24 h → offered; 24 h + 1 s →
     `"too_far"` **[M1]**;
  5. witnesses taken before the stop (`boxAt` within a minute of `T`) → `"no_proof"`;
  6. `recordId` of an older record → `"record_changed"`; a reading not behind → `"not_stopped"`;
     a 2001 reading → `clock.unusable`;
  7. **a second restart of the same record** → answers the first (`replayed: true`, same id, the
     first's `personId` when a second manager presses), row count still 1;
  8. after the first and a record written under it, a reading 2 min behind that record →
     `"stepped_back"` with the first's `{ personId, restartedAt }`, and `clockStopState.offer` the same.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-restart.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`
  → PASS; typecheck the package; the fiscal-core check prints nothing.
- [ ] **Step 5: Proofs by deletion**, one at a time: the 24-hour check → case 4 fails; the contrary
  check → case 3 fails; the during-the-stop filter → case 5 fails; the replay branch → case 7 fails
  (the second insert is refused by the unique index: `UNIQUE constraint failed`, E2).
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/clock-stop-restart.test.ts packages/fiscal-verifactu/src/errors.ts
  git commit -s -m "Veri*Factu offers a restart of payments only with fresh proof and at most 24 hours behind, and keeps each one"
  ```

### Task 7: The two recorded alerts, one per restart

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-stop-incidents.ts`, `packages/fiscal-verifactu/src/clock-stop-incidents.test.ts`
- Modify: `packages/fiscal-verifactu/src/alerts.ts` (the claim, decision 13),
  `packages/fiscal-verifactu/src/errors.ts` (the two recorded codes with their params **[M5]**),
  `packages/fiscal-verifactu/src/clock-stop-restart.ts` (calls the restarted writer; gains
  `noteClockProvedWrong(tx, { trustedUntil: Date; reason: "jump" | "authority" }): Promise<{ recorded: string[]; unused: string[] }>`),
  `apps/dashboard/src/i18n/alert-messages.ts` (the two codes' EN and ES sentences, Task 12's text,
  and the word list `clock_restart_proof` registered in `ALERT_WORDS`, `:351` **[I1]**),
  `apps/dashboard/src/i18n/alerts.test.ts` (new cases)
- Modify (declared changes 1 and 2, own commit): `packages/fiscal-verifactu/src/alerts.test.ts`,
  `scripts/alert-codes.test.ts`

- [ ] **Step 1: Write the failing tests.**
  1. A restart records one `clock.behind_chain_restarted` (warning, `dashboard` origin, `sale_id`
     the named record's sale, params decision 13) in the restart's transaction; a refused restart
     records none; a replay records none.
  2. `noteClockProvedWrong` with `trustedUntil` inside a restart's `[restarted_at, record_at)`, after
     records written under it at `R + 1 min`, `R + 2 s` and `R + 90 s` (written in that order),
     records one `clock.behind_chain_disproved` with `from` `R + 2 s` and `to` `R + 90 s` — the
     earliest and latest by time, not the first and last written **[I4, r3 M1]**; a second call records none (also after the first is
     acknowledged); `trustedUntil` after `record_at` or before `restarted_at` → none; a restart with
     no record written under it → none, answered in `unused`; nothing in `registros_facturacion` or
     `clock_stop_restarts` changes (counts).
  3. **[I1]** `alertMessage("clock.behind_chain_restarted", { person: "Ana", clockAt, lastRecordAt,
     proof: "authority" }, "en")` equals the sentence with "the tax agency's time" in it, and the
     Spanish the same with "la hora de Hacienda"; the text contains no `—` (E1 printed `Proof: —.`
     for the wrong slot). Also `"devices"`, `"authority_and_devices"` and an unknown value.
  4. **[CC 28, CC 29]** two restarts of two different records (a stop, a restart, the clock set
     forward past the first record, a sale, a new stop, a second restart): two
     `clock.behind_chain_restarted` rows, each with its own `person`, `clockAt`, `lastRecordAt` and
     `restartId`; a disproof with both in force → two `clock.behind_chain_disproved` rows, each with
     its own `from` and `to`. The control: the same two inserts with one `sale_id` leave one row
     (Q10's shape), so the test can tell.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-incidents.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` (Chromium: memory first).
- [ ] **Step 3: Implement**; the claim in `FISCAL_ALERTS.events`; the words and the list.
- [ ] **Step 4: Commit the implementation**, then the declared changes 1 and 2 in their own commit;
  after it `pnpm exec vitest run scripts/alert-codes.test.ts` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/alerts.test.ts` and
  `pnpm --filter @waitron/composition exec vitest run` → PASS.
  ```bash
  git add packages/fiscal-verifactu/src/clock-stop-incidents.ts packages/fiscal-verifactu/src/clock-stop-incidents.test.ts packages/fiscal-verifactu/src/alerts.ts packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/clock-stop-restart.ts apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/alerts.test.ts
  git commit -s -m "Each restart of payments, and each restarted clock that later proved wrong, reaches the managers' bell with its own person and times"
  git add packages/fiscal-verifactu/src/alerts.test.ts scripts/alert-codes.test.ts
  git commit -s -m "Changed test checks (A798 slice 9): the fiscal alerts claim clock.behind_chain for the box area, and the alert guard lists the file that records it"
  ```

### Task 8: The fiscal seat offers the restart

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (decision 11's four optional methods, the shared types
  `ClockStopState`, `ClockRestartOffer`, `ClockRestart`, `AuthorityTimeSample`),
  `packages/fiscal/src/index.ts`, `packages/fiscal-verifactu/src/backend.ts` (delegates, beside
  `:160-176`), `packages/fiscal-verifactu/src/clock-stop-restart.ts` (uses the shared types)
- Test: `packages/fiscal-verifactu/src/backend.clock-stop.test.ts` (new); a case each in the fake's
  and `fiscal-none`'s tests that the methods are absent

- [ ] **Step 1: Write the failing tests**: the Veri\*Factu backend answers `clockStopState` and
  `restartAfterClockStop` as Task 6 does (one stopped case, one offered restart);
  `NoneBackend.clockStopState` and `FakeFiscalBackend.clockStopState` are `undefined`.
- [ ] **Step 2: Run and watch them fail** (`clockStopState is not a function`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `pnpm --filter "...@waitron/fiscal" --workspace-concurrency 4 typecheck` exits 0
  (every package that depends on `@waitron/fiscal`, CC 36); `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts`
  → PASS; `pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal/src/backend.ts packages/fiscal/src/index.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/clock-stop-restart.ts packages/fiscal-verifactu/src/backend.clock-stop.test.ts
  git commit -s -m "The fiscal seat can say whether payments may be restarted for the clock, and restart them"
  ```
  (Add the fake's and none's test files once they hold their cases.)

### Task 9a: The restart route **[I6]**

**Files:**
- Modify: `apps/server/src/box-health-api.ts` (the route, decision 12; `STATUS` gains
  `"clock.restart_refused": 409`, `"clock.unusable": 409`, `"management.request_invalid": 400`),
  `apps/server/src/boot.ts` (hand the route the backend, the witness store and the clock)
- Create: `apps/server/src/clock-restart.route.test.ts` (its own database; slice 8 decision 13's rules)

- [ ] **Step 1: Write the failing tests** (sales on a clock built from NOW; witnesses noted straight
  into the store the app was built with):
  1. **no proof, no restart**: the press → 409 `clock.restart_refused { reason: "no_proof" }`;
     `POST /api/sales` still 409 `clock.behind_chain`;
  2. **contrary proof**: two devices +2 h → refused `contrary_proof`, nothing written;
  3. **a 25-hour gap** with two agreeing devices → refused `too_far`;
  4. **[M7]** without `system.manage` (a supervisor) → 403; no session → 401; a till's PIN session
     cookie → 401 `management_session.required`; body `{}`, `{ recordId: 7 }` and `{ recordId: "" }`
     → 400 `management.request_invalid { field: "recordId" }`; nothing written in any;
  5. **a second restart of the same record** → 200 `replayed: true`, `restart.personName` the first
     manager's, one row, one restarted alert;
  6. **[I2] two simultaneous presses**: `Promise.all` of two `POST`s with the same `recordId` → one
     200 `replayed: false`, one 200 `replayed: true`, one row, one `clock.behind_chain_restarted`.
     Proof by deletion: delete decision 9.4's replay branch → the second press answers
     `500 server.internal` (the engine's unique refusal is not an `AppError`, so the boundary logs
     only `errorCode: "unknown"`, S15 **[r3 M4]**), and the case fails on its status; restore.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-restart.route.test.ts src/box-health-api.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck; `pnpm exec vitest run scripts/module-seams.test.ts scripts/write-path-tables.test.ts`
  → PASS.
- [ ] **Step 5: Check** that no device or AEAT time is stamped anywhere:
  `git diff main -- apps packages | /usr/bin/grep -nE '^\+.*(witnessAt|deviceMs|authorityMs).*(instant|issuedAt|generadoEn)'`
  prints nothing.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/box-health-api.ts apps/server/src/boot.ts apps/server/src/clock-restart.route.test.ts
  git commit -s -m "Managers can restart payments from the dashboard when the box has fresh proof its clock is right"
  ```

### Task 9b: The Box status read's `clockStop`, and what the restart lifts **[I6]**

**Files:**
- Modify: `apps/server/src/box-health.ts` (`BoxHealth.clockStop`; `BoxHealthReaders` gains
  `clockStop?: (db) => Promise<ClockStopView | null>`; device ids to labels from `devices`, the
  restart's person to a display name), `apps/server/src/boot.ts` (wiring at `:2304-2330`)
- Modify (declared change 4, own commit): `apps/server/src/box-health.test.ts:98-123`
- Test: `apps/server/src/clock-restart.route.test.ts` (more cases), `apps/server/src/box-health.test.ts`
  (new cases)

- [ ] **Step 1: Write the failing tests:**
  1. **marking the bell's alert handled leaves payments running**: offered → press → 200; a cash
     `POST /api/sales` succeeds; `POST /management-api/alerts/incidents/:id/handled`
     (`apps/server/src/alerts-api.ts:89`) on the `clock.behind_chain_restarted` incident → 200; the
     same sale again succeeds; `GET /management-api/alerts` lists no `clock.behind_chain`;
  2. **[C1]** after the press and a sale, the box's clock 30 min behind that sale →
     `POST /api/sales` 409 `clock.behind_chain` and `GET /api/box/health`'s `clockStop.offer`
     `"stepped_back"`;
  3. after the press, `GET /api/device/equipment` has no `clock.behind_chain` notice;
  4. `GET /api/box/health` → `clockStop.offer` `"no_proof"`, then `"offered"` with two device
     labels after two equipment reads, then `"restarted"` with `restart.personName`;
  5. the box health read answers on a full disk with a change waiting (the shape of
     `box-health.test.ts`'s full-disk case), `clockStop` included.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-restart.route.test.ts src/box-health.test.ts`.
- [ ] **Step 3: Implement**; `:98-123` now fails on `clockStop: null` only.
- [ ] **Step 4: Commit the implementation, then declared change 4 alone**, after which both files
  PASS.
  ```bash
  git add apps/server/src/box-health.ts apps/server/src/boot.ts apps/server/src/clock-restart.route.test.ts apps/server/src/box-health.test.ts
  git commit -s -m "The Box status read says whether payments can be restarted, with the proof and who restarted them"
  ```
  For the second commit, make only the `:98-123` edit after the first, then
  `git add apps/server/src/box-health.test.ts` and
  `git commit -s -m "Changed test checks (A798 slice 9): the box health read carries clockStop"`.

### Task 10a: AEAT's time from its QR validation host **[I6]**

**Files:**
- Create: `packages/fiscal-verifactu/src/authority-time.ts`, `packages/fiscal-verifactu/src/authority-time.test.ts`
  (decision 1 (b); imports `authenticatedHourHead` from `./hour-clock-internet.js` and changes nothing
  there)
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`readAuthorityTime` →
  `readAuthorityTime(this.deploymentEnvironment)`)

- [ ] **Step 1: Write the failing tests**, against a local HTTPS server with a test authority (the
  shape of `hour-clock-internet.test.ts:354-395`; the URL injected): a `Date` header → a sample
  `{ authorityMs: date + 500, uncertaintyMs: 500 + roundTrip / 2, at: midpoint }`; no `Date`, a 302 to
  another origin, `Age: 3`, a TLS name mismatch, and a server that never answers (5 s deadline) →
  `null`; each call sends a different `waitron_clock` value. With no URL injected it asks
  `QR_ENDPOINTS[environment]` (asserted on the URL handed to an injected request, never by
  contacting AEAT).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/authority-time.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; the fiscal-core check (with `hour-*`) prints nothing.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/authority-time.ts packages/fiscal-verifactu/src/authority-time.test.ts packages/fiscal-verifactu/src/backend.ts
  git commit -s -m "Veri*Factu can read AEAT's time from its QR validation site over a verified connection"
  ```

### Task 10b: The clock watch **[I6, I3, I4]**

**Files:**
- Create: `apps/server/src/clock-watch.ts`, `apps/server/src/clock-watch.test.ts`,
  `apps/server/src/boot.clock-watch.test.ts` (the shape of `boot.clock-behind-wiring.test.ts`:
  `serverFixture`, `vi.mock("./clock-watch.js")` capturing the start and the `stop`)
- Modify: `apps/server/src/boot.ts` (start in trading mode; `stop` onto `undoOnFailure` as soon as
  it exists, and into `closeAll([...])` at `:2859-2882` before `streamHost.stop()`)

- [ ] **Step 1: Write the failing tests** (`clock-watch.test.ts`, with injected wall, steady clock,
  timer, `stopState`, `readAuthorityTime`, `noteClockProvedWrong` and the witness store):
  1. during a stop and filing, one HEAD per tick and the sample noted; not stopped, or not filing,
     or not primary → no HEAD; the raw comparison no longer behind → `store.endStop()` called;
  2. a forward jump of 61 s between ticks → `noteClockProvedWrong` once with `trustedUntil` the
     earlier tick plus the steady time; 59 s → not called; a backward jump → not called;
  3. **[I4]** a disagreeing AEAT witness noted since the last tick, whose `boxAt` is 40 s before the
     tick → called with `reason: "authority"` and `trustedUntil` that `boxAt`, not the tick's time
     (a version using "now" fails this case);
  4. `noteClockProvedWrong` answering `unused: [id]` → one `clock_watch.disproved_unused` log line;
  5. a failing call logs `clock_watch.check_failed` and the next tick still runs;
  6. **[I3]** `stop` while a tick is in flight resolves only after it finishes; after `stop`,
     advancing the injected timer runs no HEAD and no `noteClockProvedWrong`.
  `boot.clock-watch.test.ts`: `server.close()` calls the captured `stop` once; a start that fails
  after the watch began calls it too (`undoOnFailure`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-watch.test.ts src/boot.clock-watch.test.ts`.
- [ ] **Step 3: Implement** decisions 2 and 14.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/clock-watch.ts apps/server/src/clock-watch.test.ts apps/server/src/boot.clock-watch.test.ts apps/server/src/boot.ts
  git commit -s -m "During a payment stop the box asks AEAT for its time each minute, and tells managers if a restarted clock proves wrong"
  ```

### Task 11: `clock.unusable` in the bell

**Files:**
- Modify: `packages/fiscal-verifactu/src/clock-behind-alerts.ts` (decision 15),
  `apps/dashboard/src/i18n/alert-messages.ts` (`clock.unusable`'s words, Task 12's text)
- Test: `packages/fiscal-verifactu/src/clock-behind-alerts.test.ts` (new cases; the existing ones use
  2025–2026 readings and pass unedited, CC 45)

- [ ] **Step 1: Write the failing tests**: a `2001-01-01T11:00:00.000Z` reading with a record →
  exactly one alert `{ key: "clock.unusable", code: "clock.unusable", severity: "error", since:
  null, screen: "box-status", params: { clockAt } }`; the same with no records → the same one;
  `2024-10-28T00:00:00.000Z` with no records → none.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind-alerts.test.ts`.
- [ ] **Step 3: Implement**; add the words.
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`
  → PASS (`clock-behind-alerts.ts` is on the ongoing guard's list, CC 44).
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind-alerts.ts packages/fiscal-verifactu/src/clock-behind-alerts.test.ts apps/dashboard/src/i18n/alert-messages.ts
  git commit -s -m "Managers see a box clock set before 28 October 2024 in the bell"
  ```

### Task 12: The words — refusals and the email (the alert sentences went in with Tasks 4, 7, 11)

**Files:**
- Modify: `apps/dashboard/src/i18n/codes.ts` (one generic sentence for `clock.restart_refused`
  **[M6]**), `apps/dashboard/src/i18n/strings.ts` (`box_status.clock.refused.<reason>`, EN and ES),
  `apps/server/src/i18n/box-emails.ts` (`clock.behind_chain`), `apps/server/src/box-alert-email.ts`
  (decision 16)
- Modify (declared changes 5, 6 and 7, own commit): `apps/server/src/box-alert-email.test.ts:15-24`
  and `:45`, `apps/server/src/box-alert-email.duty.test.ts:381-392`
- Test: `apps/server/src/box-alert-email.test.ts`, `apps/server/src/box-alert-email.duty.test.ts`
  (new cases)

**Words.**
- `clock.disagrees` (Task 4): EN "{count} devices agree that the time is {deviceAt:minute}, but the
  box's clock reads {boxAt:minute}. Check the box's date and time on the Box status page." / ES
  "{count} dispositivos coinciden en que son las {deviceAt:minute}, pero el equipo marca
  {boxAt:minute}. Comprueba la fecha y la hora del equipo en Estado del equipo."
- `clock.unusable` (Task 11): EN "The box's clock reads {clockAt:minute}, before 28 October 2024, so
  no sale can be recorded for the tax agency. Connect the box to the internet; if its clock does not
  correct itself, ask whoever installed it to set it." / ES "El equipo marca {clockAt:minute}, antes
  del 28 de octubre de 2024, así que no se puede registrar ninguna venta en Hacienda. Conecta el
  equipo a internet; si la hora no se corrige sola, pide a quien lo instaló que la ponga."
- `clock.behind_chain_restarted` (Task 7, design §4.8 c): EN "{person} restarted payments on the
  box's clock ({clockAt:minute}), earlier than the last sale ({lastRecordAt:minute}). Proof:
  {proof:clock_restart_proof}." / ES "{person} reanudó los cobros con la hora del equipo
  ({clockAt:minute}), anterior a la última venta ({lastRecordAt:minute}). Prueba:
  {proof:clock_restart_proof}." List `clock_restart_proof`: `authority` "the tax agency's time" /
  "la hora de Hacienda"; `devices` "the clocks of two devices or more" / "la hora de dos
  dispositivos o más"; `authority_and_devices` "the tax agency's time and two devices or more" /
  "la hora de Hacienda y de dos dispositivos o más"; otherwise "recorded on the box" / "anotada en
  el equipo" **[I1]**.
- `clock.behind_chain_disproved` (Task 7, design §4.8 b): EN "Sales recorded between {from:minute}
  and {to:minute} were dated by a clock that proved wrong. They stay as recorded; ask your tax
  adviser." / ES "Las ventas registradas entre {from:minute} y {to:minute} se fecharon con un reloj
  que resultó estar mal. Quedan como se registraron; consúltalo con tu asesor."
- `clock.restart_refused` in `codes.ts`: EN "Payments cannot be restarted now. Look at the Box status
  page." / ES "Ahora no se pueden reanudar los cobros. Mira Estado del equipo."
- `box_status.clock.refused.<reason>`: `no_proof` "There is no fresh proof that the box's clock is
  right." / "No hay ninguna prueba reciente de que la hora del equipo sea correcta."; `contrary_proof`
  "Other clocks say the box's clock is wrong." / "Otros relojes dicen que la hora del equipo está
  mal."; `too_far` "The box's clock is more than 24 hours behind the last sale." / "La hora del
  equipo está más de 24 horas por detrás de la última venta."; `stepped_back` "Payments were already
  restarted, and the box's clock has gone back since. Get the clock checked." / "Ya se reanudaron los
  cobros y la hora del equipo ha retrocedido desde entonces. Haz que revisen la hora.";
  `record_changed` "The last sale changed. Look at the page again." / "La última venta ha cambiado.
  Vuelve a mirar la página."; `not_stopped` "Payments are not stopped." / "Los cobros no están
  parados."
- Email `clock.behind_chain` (design §4.8 c, departure 4): subject EN "Payments stopped at {venue}:
  the box's clock reads earlier than its last sale" / ES "No se puede cobrar en {venue}: la hora del
  equipo es anterior a la última venta"; text EN "The box's clock ({clockAt}) reads earlier than its
  last recorded sale ({lastRecordAt}). Since then no device can take payment. Orders can still be
  taken and sent to the kitchen. What to do: • If the box's clock is wrong (usual after a power
  cut): connect the box to the internet so it corrects itself, or call whoever installed it. • If
  you think the box's clock is right: look at the Box status page (in the dashboard, Settings → Box
  status), which says whether payments can be restarted." / ES the design's body, with "[Abrir
  Estado del equipo]" replaced by "(en el panel de gestión, Ajustes → Estado del equipo)".

- [ ] **Step 1: Write the failing tests**: the email with `{clockAt: "2025-03-14T08:12:00.000Z",
  offsetMinutes: 60, lastRecordAt: "2026-10-18T21:40:00.000Z", lastRecordOffsetMinutes: 120}` →
  "14/03/2025 09:12" and "18/10/2026 23:40" in both languages; the duty sends one email per stop per
  manager with those times, keeps the first notice's params when a later read's `clockAt` differs,
  and sends again after the notice went and came back; the dashboard's `clock.restart_refused`
  sentence in both languages.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`.
- [ ] **Step 3: Implement.** Then `box-alert-email.test.ts:15-24` and `:45`, and
  `box-alert-email.duty.test.ts:381-392`, fail as the claim check printed (`c15-email-words.log`).
- [ ] **Step 4: Commit the implementation, then declared changes 5, 6 and 7 alone**, after which:
  `pnpm --filter @waitron/server exec vitest run src/box-alert-email.test.ts src/box-alert-email.duty.test.ts`
  → PASS, and `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts`
  → PASS.
  ```bash
  git add apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/strings.ts apps/server/src/i18n/box-emails.ts apps/server/src/box-alert-email.ts apps/server/src/box-alert-email.test.ts apps/server/src/box-alert-email.duty.test.ts
  git commit -s -m "Words for the restart refusals, and the managers' email when payments stop for the clock"
  ```
  The new cases go in that first commit; then edit `:15-24`, `:45` and `:381-392` as declared and
  commit them with `git commit -s -m "Changed test checks (A798 slice 9): clock.behind_chain has email words with both times"`,
  each before and after in the body.

### Task 13: The Clock row — the offer, the reasons, and which way the clock is off

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`BoxHealth.clockStop` beside `:1715`;
  `restartClockPayments(recordId)` beside `freeBoxSpace` at `:4183`),
  `apps/dashboard/src/screens/box-status-rows.ts` (decision 17's line; while `clockStop` is not null,
  a detail line with the proof — "Tax agency: matches (checked {time})", "Devices: {count} read
  {time}" — and a line for any offer other than `"offered"`: `box_status.clock.refused.<offer>`'s
  words, or "Payments restarted by {person} at {time}" for `"restarted"`),
  `apps/dashboard/src/i18n/strings.ts` (EN and ES)
- Modify (declared change 8, own commit): `apps/dashboard/src/screens/box-status-rows.test.ts:534`
- Test: `apps/dashboard/src/screens/box-status-rows.test.ts` (new cases; fixtures gain `clockStop: null`)

- [ ] **Step 1: Write the failing tests**: a drift of +90 s → `compared_ahead`, −90 s →
  `compared_behind`, 2 s → `compared`; `clockStop` with each offer → the row's detail lines;
  `"restarted"` → the row amber, not red, with who and when; the restart offer never on a row whose
  `clock.unusable` notice is on.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-rows.test.ts`.
- [ ] **Step 3: Implement.** `:534` now fails (it expects `compared`); leave it red.
- [ ] **Step 4: Commit the implementation and the new cases**, then declared change 8 alone:
  ```bash
  git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/box-status-rows.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/box-status-rows.test.ts
  git commit -s -m "The Box status page's Clock row shows the proof the box has, why payments cannot be restarted, and which way the clock is off"
  ```
  Then edit `:534` as declared, run the file → PASS, `git add` it and
  `git commit -s -m "Changed test checks (A798 slice 9): the Clock row says the box was behind for a drift of -3600 s"`.

### Task 14: The restart dialog

**Files:**
- Modify: `apps/dashboard/src/screens/box-status-screen.ts` (the button on the Clock row, shown only
  for `"offered"`; the `wt-dialog`, decision 18), `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/box-status-screen.test.ts`, `apps/dashboard/src/screens/box-status-screen.a11y.test.ts`
  (new cases, both themes)

**Words** (design §4.8 b): title "Restart payments?" / "¿Reanudar los cobros?"; rows "The box reads"
/ "El equipo marca", "The last sale reads" / "La última venta marca", "Tax agency" / "Hacienda"
("matches (checked {time})" / "coincide (comprobado {time})"), "Devices" / "Dispositivos" ("{count}
read {time}" / "{count} marcan {time}"); body "If you restart, the next sales carry the box's clock,
earlier than the last sale's. No recorded sale is changed. It is noted that you did it." / "Si
reanudas, las ventas siguientes llevarán la hora del equipo, anterior a la de la última venta. No se
cambia ninguna venta registrada. Queda anotado que lo has hecho tú."; buttons "Cancel" / "Cancelar"
and "Restart payments" / "Reanudar los cobros".

- [ ] **Step 1: Write the failing tests**: no button unless `"offered"`; the dialog shows both
  times and the proof lines; Confirm sends `restartClockPayments(recordId)` with the page's
  `clockStop.recordId`, is disabled and loading while it waits, closes on success and refreshes
  (`liveData.refresh`, as Liberar does at `:222`); a refusal shows `box_status.clock.refused.<reason>`
  on its own line above the buttons, leaves Confirm enabled **and calls `liveData.refresh`**
  **[M9]**; Cancel and Escape close with no request; axe passes for the row with the button and the
  open dialog in light and dark.
- [ ] **Step 2: Run and watch them fail** (Chromium: memory first).
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/box-status-screen.test.ts src/screens/box-status-screen.a11y.test.ts`.
- [ ] **Step 3: Implement.** No hand-drawn field; `wt-dialog` and `wt-button` only.
- [ ] **Step 4: Run** → PASS; `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts scripts/help-tooltip-mode.test.ts`
  → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/dashboard/src/screens/box-status-screen.ts apps/dashboard/src/screens/box-status-screen.test.ts apps/dashboard/src/screens/box-status-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
  git commit -s -m "The Box status page asks a manager to confirm a restart of payments, showing both times and the proof"
  ```

### Task 15: The backup verifier learns the restarts' links

**Files:** `packages/fiscal-verifactu/src/backup-verification-history.ts` (`LINKS`, `:424-433`),
`packages/fiscal-verifactu/src/backup-verification-history.test.ts` (two new rows in the "rejects
internally damaged %s" table, `:283-296`, and a restart row in the fixture's capture)

- [ ] **Step 1: Write the failing cases**: "restart node parent" (`update clock_stop_restarts set
  node_id='missing'`) and "restart record parent" (`… set registro_id='missing'`) → `invalid`.
- [ ] **Step 2: Run and watch them fail** (`passed` where `invalid` is expected):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-history.test.ts`.
- [ ] **Step 3: Implement** decision 19.
- [ ] **Step 4: Run** → PASS, every existing case unedited.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/backup-verification-history.ts packages/fiscal-verifactu/src/backup-verification-history.test.ts
  git commit -s -m "The backup check refuses a copy whose payment restarts name a missing node or record"
  ```

### Task 16: The guides

**Files:** `apps/server/src/guide/en/box-status.md` and `apps/server/src/guide/es/box-status.md`
(`{#clock-behind}`: a third way out; `{#emails}`: the clock-stop email; a new `{#clock-witnesses}`
section after `{#clock-behind}`); `apps/server/src/guide/en/till-notices.md` and its twin
(`:31-57`).

What they say, in the guides' plain style (`~/.claude/docs-writing-style.md`):
- **Restart payments** as the third way out: only when the clock is right and the last sale's time
  was wrong; the page offers it only with fresh proof (the tax agency's time, or two devices, within
  a minute, in the last five minutes, since payments stopped), never after the tax agency disagreed
  during the stop, and at most 24 hours behind; who can (people who manage the system); what it does
  and never does (no recorded sale changes; the next sale carries an earlier time than the last; it
  is noted who did it); it allows one step back only — if the clock goes back again by more than a
  minute behind the latest sale made since the restart, even a little at a time, payments stop
  again and the page says to get the clock checked **[C1, r3 I1]**; a second press shows the first;
  if the accepted clock later proves wrong, the bell says which sales are affected and to ask the
  tax adviser, and that sales made after that alert are not added to it **[r3 M1]**. Rewrite "Wait … This is the only way out when the clock is
  right…" (EN `:118-120`), which this slice makes false.
- `{#clock-witnesses}`: tills and handhelds send their clock to the box (kitchen screens do not);
  the bell warns when two agree the box is off; staff see nothing for that.
- `{#emails}`: the list gains "its clock reads earlier than its last sale, so payments have
  stopped".
- `{#clock-behind}`'s paragraph on a clock before 28 October 2024: the bell now says so too.

- [ ] **Step 1: Write** all four files; ids shared.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` → PASS.
- [ ] **Step 3: Commit.**
  ```bash
  git add apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md
  git commit -s -m "Guides: restarting payments with proof the clock is right, devices as clock witnesses, and the clock-stop email"
  ```

### Task 17: Developer docs, CLAUDE.md and the compliance file

**Files:** `CLAUDE.md` §5 (the clock-stop rule slice 8 added); `docs/developers/conventions-data.md`;
`docs/compliance/asesor-questions.md` (`:3637-3638`, `:3678`); `docs/compliance/verifactu-findings.md`

- [ ] **Step 1: CLAUDE.md §5.** Add to the clock-stop rule, keeping it a rule **[M10, C1]**: "A
  manager's restart (`clock_stop_restarts`) lifts it for ONE step back: once a record is written
  under it, every reading is held to the minute against the latest time among the records written
  under it, and the stop reads that table only through `clockBehindChain`; a row whose stored chain
  heads are malformed covers nothing **[r3 I1, I2, M3]**. Guards:
  `packages/fiscal-verifactu/src/clock-behind.restart.test.ts` and
  `packages/fiscal-verifactu/src/clock-stop-restart.test.ts`, weaker than the rule — they cover the
  readings they name." Run `pnpm exec prettier --check CLAUDE.md` and
  `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (it reads backticked paths starting with
  a top-level directory, `:31-61`, which is why both are full paths).
- [ ] **Step 2: conventions-data.md**: the receipt — decision 8 (one latest record, the cover, the
  one step back), decision 9's order, decisions 4–6, Q1–Q8, and that AEAT's time is the QR host's
  `Date` header (P3, P5) while `consultar`'s was not measured (P11).
- [ ] **Step 3: asesor-questions.md**: Q51's "Not built: it is slices 8 and 9" and Q52's "Not built:
  it is slice 9" become dated pointers "Built by A798-B slices 8 (#2012) and 9 (#…), 2026-10-…;
  parked for the owner. One step back per restart; later records are held to the minute." No
  question text changes.
- [ ] **Step 4: verifactu-findings.md**: a dated pointer that slice 9 adds the restart.
- [ ] **Step 5: Commit.**
  ```bash
  git add CLAUDE.md docs/developers/conventions-data.md docs/compliance/asesor-questions.md docs/compliance/verifactu-findings.md
  git commit -s -m "CLAUDE.md and docs: a manager's restart lifts the clock stop for one step back, and where its proof comes from"
  ```

### Task 18a: LOOK in English

**Files:** a throwaway `apps/dashboard/src/zz-clock-restart.look.test.ts`, never committed;
screenshots to `~/waitron-campaign-b/a798-9-shots/`. A fix is committed with the file it touches.

- [ ] **Step 1: Write the throwaway look test**, shaped like slice 8's Task 17a (light and dark ×
  1280 and 390, the language a parameter): the Box status page during a stop with (a) no proof,
  (b) contrary proof from three devices (picture 9's top), (c) an offer with AEAT and two devices
  (picture 9's bottom row), (d) the dialog open, (e) the dialog with a `too_far` refusal under it,
  (f) after a restart, the amber row with who and when, (g) `stepped_back`; the bell open on
  `clock.disagrees`, two `clock.behind_chain_restarted` and a `clock.behind_chain_disproved`; the
  bell on `clock.unusable`. `page.screenshot` to a gitignored `__screenshots__/a798-9/` path; one
  contact sheet per theme and width with `sharp`; copy to `~/waitron-campaign-b/a798-9-shots/`.
- [ ] **Step 2: Run** `-t en` and LOOK beside picture 9: the proof lines readable and never broken
  mid-time at 390; the button on the row and the dialog's buttons; the refusal on its own line
  above them; the bell's sentences, with the proof's words and no dash. Write what you saw, sheet by
  sheet.
- [ ] **Step 3: Fix and re-run**, each fix with a test that would have caught it where one can.

### Task 18b: LOOK in Spanish

- [ ] **Step 1: Run** `-t es` and LOOK as 18a; the longer Spanish sentences fit at 1280 and wrap
  cleanly at 390.
- [ ] **Step 2: Fix and re-run**, then `-t en` once.
- [ ] **Step 3: Remove the throwaways**; `git status --short` shows none.

The till is unchanged on screen (it only sends a header), so no till LOOK.

### Task 19: Backlog

**Files:** `docs/backlog.md` (A798-B, `:4631-4649`, and the entries it names), `docs/backlog/box.md`,
`docs/backlog/fiscal.md`

- [ ] **Step 1: The A798-B entry**: "slice 9 (devices report their clock; `clock.disagrees` and
  `clock.unusable` in the bell; a manager's restart of payments with fresh proof, at most 24 hours
  behind and one step back, kept in `clock_stop_restarts`, with its bell alerts and the disproof
  check; the clock-stop email; parked for the owner) is #<PR>."
- [ ] **Step 2: Delete** the entries this slice finishes: "The clock stop's email is slice 9's"
  (`:4651-4656`); "The backup verifier does not know `clock_stop_restarts`' links" (`:4724-4726`);
  "Which alert area `clock.unusable` belongs to" (`:4830-4833`). Replace "The Box status page's
  Clock row drops the drift's sign, and an open clock-drift alert's seconds can differ from the
  latest read" (`:4769-4773`) by its open half: "**An open clock-drift alert's seconds can differ
  from the Clock row's.** The bell reads less often than the page. Left open by A798-B slice 7."
- [ ] **Step 3: Short open entries**, each "Left open by A798-B slice 9 (#…)":
  - "**AEAT's time for a restart comes from its QR validation host, not from a `consultar` reply.**
    Whether a certificate-authenticated `consultar` reply carries a `Date` header is not measured.
    The `verifactu` repository's live workflow can measure it without filing: a manual run in its
    `consult` mode sends one `consultar` (`scripts/live-aeat.mjs:2440-2451`), and one added line in
    its `fetch` wrapper (`:2426-2431`) writing `response.headers.get("date")` to its output would
    print it. The production QR host was not tried either." (decision 1; P11) **[CC 12]**
  - "**Two devices can fake a restart's proof.** A device's clock reading is whatever it sends; the
    restart still needs a manager's press and a gap of at most 24 hours."
  - "**Two restarts whose named records belong to one sale share a bell alert.** The open-alert
    index keys a restart's alerts by that sale (slice 9 decision 13), so the second is not recorded
    while the first is open; the table keeps both. Only an alta and its own anulación share a sale,
    and no route issues an anulación today." **[CC 28, CC 29]**
  - "**`clock.unusable` in the bell is judged at offset 0**, so in the first hours of 28 October 2024
    local time the bell can say the clock is before that day where the till does not."
  - "**During a stop the box sends AEAT's QR host a HEAD once a minute**, for as long as the stop
    lasts." (decision 2)
  - "**An AEAT disagreement blocks a restart for the rest of the stop, even after the clock is
    stepped.** The owner may prefer it to lapse at a step (slice 9 decision 4)." **[I5]**
  - "**A restart under which no sale was recorded raises no 'disproved' alert** when its clock later
    proves wrong; the box logs it." (decision 14)
  - "**After a 'disproved' alert, the restart still covers and later sales are not added to the
    alert.** Its `{to}` is the latest sale when the disproof was seen; sales made afterwards on the
    same clock appear in no alert. Whether a disproof should stop payments again is for the owner
    (slice 9 decision 14)." **[r3 M1]**
  - "**A malformed restart row covers nothing, for ever.** `clock_stop_restarts` is append-only, so a
    row whose stored chain heads are wrong cannot be corrected; it lifts no stop (slice 9 decision
    21)." **[r3 I2]**
- [ ] **Step 4: Outside A798, in `docs/backlog/fiscal.md`**: "**A679's internet time reading came
  back unavailable against pre-production in each of four runs on 2026-10-23.**
  `observeInternetHourClock` asks the submission host, which answered a certificate-less request with
  a redirect to another site and no `Date` header, and the reading follows only same-origin
  redirects (A798-B slice 9 plan, P1 and P2; production not tried). Found while planning A798-B
  slice 9." **[CC 7]** Add a one-line pointer to it in `docs/backlog.md`'s fiscal area.
- [ ] **Step 5: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`.
  ```bash
  git add docs/backlog.md docs/backlog/box.md docs/backlog/fiscal.md
  git commit -s -m "Backlog: A798-B slice 9 lets a manager restart payments with proof the clock is right; what it leaves open"
  ```

---

## Overlap with open pull requests (checked 2026-10-23)

`gh pr diff <n> --name-only` (and, for #1990, whose diff is too large for that command,
`gh api repos/clintongormley/waitron/pulls/1990/files --paginate`; lists in the probe folder,
`pr-<n>-files.txt`; the review's G found the same lists):
- **#1990** (`feat/a947-4a-minute-names`, fiscal, owner lands; 191 files): shares
  `apps/server/src/boot.ts` (Tasks 3, 4, 9a, 9b, 10b), `packages/fiscal-verifactu/src/backup-verification-history.ts`
  and its test (Task 15), `packages/fiscal-verifactu/src/errors.ts` (Tasks 6, 7), `CLAUDE.md` and
  `docs/developers/conventions-data.md` (Task 17) and `docs/backlog.md` (Task 19). It changes
  `hour-clock.ts` and `hour-setup-clock.ts`, which this slice does not touch, and not
  `hour-clock-internet.ts`, which Task 10a imports.
- **#2003** (`feat/a758-7-collect-at-counter`, 32 files): shares `apps/till/src/api/client.ts` (Task
  3) and `docs/backlog.md` (Task 19); it also changes `apps/till/src/till-app.ts`, which this slice
  does not, and this slice adds a case to `apps/till/src/till-app.test.ts`, which it does not change.
- **#2010** (`chore/a974-test-helper-identifiers`, 5 files) and **#1986**
  (`fix/a974-core-comments-english`, 2 files): share only `docs/backlog.md`.

## Self-review against the spec

- §8 item 9's scope: the device reading (Task 3), AEAT's time (Tasks 4, 10a, 10b; departure 1), the
  restart route behind `system.manage` with fresh proof and the 24-hour cap writing
  `clock_stop_restarts` (Tasks 6, 9a), the two recorded alerts (Task 7), the Reloj row and dialog
  (Tasks 13, 14); plus the clock-stop email (Task 12) and the minimum-date alert (Task 11).
- §8 item 9's tests: no proof, no restart — Task 6 case 2, Task 9a case 1; contrary proof — Task 6
  case 3, Task 9a case 2; a 25-hour gap — Task 6 case 4, Task 9a case 3; a second restart answered
  with the first — Task 6 case 7, Task 9a case 5; marking the bell's alert handled leaves payments
  running — Task 9b case 1.
- §4.5 item 3: `clock.disagrees` with two devices that spoke in the last five minutes (Tasks 2, 4).
- §4.8 b: proof gathered after the stop began (decision 6), any AEAT evidence the other way blocks
  (decision 4), the one backward step a restart puts in the chain (decision 8; "a clock that keeps
  moving back is not one to trust"), what it never changes (Q1–Q8), disproof (Tasks 7, 10b), the
  table read directly (decision 8), the dialog (Task 14).
- §4.8 c: the restart and disproved alerts in the stop's area, one per restart (Task 7), the email
  (Task 12).
- §4.8 d: what clears it — the restart (Task 5); devices and AEAT never lift it themselves; the
  28-10-2024 rule first (decision 9.1, Task 11).
- §7: no new table; witnesses in memory (decision 4).

## Revision 3, finding by finding

- **r3 I1**: decision 8c now holds each reading to the latest TIME among the records written under
  the restart (a running maximum); Words, 8d, Behaviour 1, the PR description, the guide and the
  CLAUDE.md sentence reworded; Task 5 case 3b (the twelve-step walk, S5) with its proof by deletion
  (S11); Codex seat 2's list; golden and `inmutabilidad` re-run unedited (S14).
- **r3 I2**: one definition — `heads`, every chain's largest `secuencia` (decisions 10, 21);
  fails closed with no throw for a `null` proof and every impossible value (S6, S7, proof by
  deletion S12); the row's `node_id` is not read (S9); two chains (S8, S10); Task 5 cases 8b–8c and
  Task 6 case 1b through the real writer.
- **r3 M1**: `from`/`to` are the earliest and latest generation times, not write order (decision 14,
  Task 7 case 2); after a disproof the restart still covers and later sales join no alert — the guide
  and a backlog entry say so.
- **r3 M2**: the tie-break's proof by deletion is now one reader ordering by `id asc` (S13: eight of
  eight runs differ); Q5's "named secuencia 2" dropped.
- **r3 M3**: the CLAUDE.md sentence says the stop reads the table through `clockBehindChain`, not
  that it is the only reader.
- **r3 M4**: Task 9a case 6 no longer says the 500's log names the index (S15).
- **r3 M5**: decision 8a no longer lists the disproof among `latestRecord`'s callers.
- **r3 M6**: `till-app.ts:17853` is the empty-service-zone section's Retry button.

## Revision 2, finding by finding

- **C1**: decision 8 (8b–8d) and Words; `recordsBefore` in the proof (decision 10); Task 5 cases 2–4
  with Q1/Q2/Q3 and the proof by deletion Q7; Task 9b case 2; Q8 reruns the golden and
  `inmutabilidad`; decision 14's backward-step sentence now true; guide, CLAUDE.md, asesor pointer,
  Review focus 3, Codex seat 2 and the PR description say which reading was built.
- **I1 / CC 46**: `{proof:clock_restart_proof}` and the registered list (decision 13, Tasks 7, 12);
  Task 7 case 3 fails on the dash.
- **I2**: the racing-press case moved to the real route (Task 9a case 6) with a proof by deletion
  that prints a 500; the conflict clause and the "read the row on conflict" branch dropped
  (decision 10).
- **I3**: the watch's `stop` on the close list and `undoOnFailure`, waiting for a tick in flight
  (decision 14; Task 10b case 6 and `boot.clock-watch.test.ts`).
- **I4**: `trustedUntil` for an AEAT disproof is the witness's `boxAt`; `from`/`to` are the first and
  newest records written under the restart; none written, no alert (decision 14; Task 7 case 2,
  Task 10b case 3).
- **I5**: AEAT disagreements kept for the rest of the stop (decision 4, departure 2; Task 2 case 5,
  Task 6 case 3), with the alternative for the owner and a backlog entry.
- **I6**: Tasks 9 → 9a, 9b; Task 10 → 10a, 10b.
- **I7**: one `latestRecord(tx)` with an `id` tie-break (decision 8a; Q5; Task 5 case 7).
- **CC 7**: "always" narrowed to four runs on 2026-10-23 (P2, Task 19).
- **CC 10, 11**: the certificate search corrected and re-run (P11, Q11).
- **CC 12**: the live workflow's `consult` mode and the one-line change (P11, Task 19).
- **CC 28, 29**: each restart's alerts keyed by its named record's sale (decision 13; Q10; Task 7
  case 4); "folded into" removed.
- **CC 35**: kitchen screens traced and probed (Q9; decision 3; Task 3's kept test).
- **CC 42, 43**: existing assertions 3–7 declared; "every existing duty case passes unedited"
  removed.
- **M1** exact 24 h cap (departure 6, Q4); **M2** midpoint and the drain's 500 ms (decisions 1, 4;
  Task 4); **M3** arrival readings (decision 3; Task 3); **M4** Task 6 records no alert; **M5**
  registry entries (decision 13, Global constraints, Task 7); **M6** reason words' home (decision 18,
  Task 12); **M7** body and session cases, no `authorizeSystemManager` (decision 12, Task 9a case 4);
  **M8** answered by CC 28/29's keying; **M9** refresh after a refusal (decision 18, Task 14); **M10**
  full paths (Task 17); **M11** "group" defined (decision 5, Task 1 case 4); **M12** Stryker `mutate`
  (Task 1).
- Line citations the claim check found a line or so off (CC 9, CC 51, CC 54) are corrected in place.
