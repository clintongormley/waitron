# A798-B slice 5 — the free-space watch and the `storage.*` alerts

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation. Implementers are dispatched
> as `subagent_type: "implementer"`. The tasks run in their numbered order; every commit leaves the
> root guards green.
>
> **Existing assertions.** This plan changes exactly ONE existing assertion, declared here so no
> implementer has to decide it: `apps/dashboard/src/i18n/alerts.test.ts:259`, the filter of
> "names only registered word lists in its word-list slots", gains `&& m[1] !== "bytes"` beside
> its `"money"` and `"date"` built-ins (decision 6 says why; Task 3 Step 0 makes it, Step 4 shows it
> is needed and still bites). It falls under the owner's standing exception (2026-09-27, about
> 19:10): an assertion that pins a whole shape, such as a list, may gain the entry a new field adds,
> provided every existing value is unchanged — here `"money"`, `"date"` and the word-list check stay
> as they are. It goes in its own commit whose message begins `Changed test checks (A798 slice 5):`
> and names the `file:line` with its before and after, and the pull request names it. Every other
> test this plan touches gains cases, mocks or helpers only. Any other assertion that turns out to
> need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `227fa6ef2` (2026-10-22), which is this branch's base
> (`feat/a798-5-free-space-watch`, worktree `waitron-feat-a798-5-free-space-watch`). Every claim
> about how the box behaves today cites a probe in "Measured for this plan", run that day on macOS,
> Node v26.11.1: the planner's from scratch files under `~/waitron-campaign-b/a798-5-plan-probe/`
> (scripts in `scripts/`, logs beside them) and a throwaway worktree of `227fa6ef2` made with
> `git worktree add --detach` and `pnpm install --frozen-lockfile --offline` (`Done in 6.4s`,
> `install.log`), since removed; the claim check's under `~/waitron-campaign-b/a798-5-plan-check/`.
> A claim marked **(read)** comes from reading code, not running it. Nothing was measured on Linux.
>
> **Revision 2 (2026-10-22)** folds in the round-1 review
> (`~/waitron-campaign-b/a798-5-plan-review/round1.md`, 0 Critical, 0 Important, 9 Minor) and the
> claim check (`…/a798-5-plan-review/claim-check.md`, 0 Critical, 1 Important, 10 Minor), as the
> runner ruled: every finding applied; the tasks reordered so the wording lands before the alert
> source; the declared assertion change allowed under the owner's standing exception.
>
> **Revision 3 (2026-10-22)** folds in the round-3 check (`…/a798-5-plan-review/round3-check.md`,
> 0 Critical, 0 Important, 8 Minor): every Step 5 prediction now lists every failing case, the log
> and citation sentences are narrowed, and the Codex seat's experiment says how to hold one reading.

**Words used in this plan.**
- The **watch** is the new duty that reads the venue folder's free space once at start and then
  every minute.
- The **warning** is the `storage.space_low` alert: on below 2 GiB free, off again only at 2.5 GiB.
- The **stop** is slice 3's full-disk stop, `DiskFullState` (`apps/server/src/disk-full-state.ts:24-56`):
  set by a write the engine refused for a full disk or by a start under 16 MiB free, it refuses every
  till and kitchen-screen write until a reading finds 16 MiB free (`FULL_DISK_BYTES`,
  `apps/server/src/boot-failure.ts:47`). "Noted" means the stop is on.
- The **bell** is the dashboard's alert list, fed by `GET /management-api/alerts`, which asks every
  ongoing alert source on each read (`apps/server/src/alerts.ts:109-148`). An open dashboard asks
  again every 60 s: `listAlerts`' `refreshMs` falls to the 60 000 ms default
  (`apps/dashboard/src/api/live-queries.ts:584-591`), and its live dependencies are tables only
  (`:531`), so a change held in memory reaches it on that poll **(read)**.
- An **area** is the label the bell shows beside an alert (`Alert.area`,
  `packages/module/src/alerts.ts:15`), taken from the source that raised it.

**Goal:** the box notices, within about a minute, when its disk is running out, and an open bell
shows "The box has 1.8 GB of disk space left…" up to about two minutes after free space falls below
2 GiB (one watch interval plus one bell poll); the bell shows "The box is out of disk space" while
the stop is on; and a stop on a box nobody writes to lifts within about a minute of space being
freed, instead of waiting for the next till write (the bell catches up on its next poll).

**Architecture:** three pieces.
1. `apps/server/src/free-space-watch.ts` (new): `createFreeSpaceState`, which holds the latest
   reading and decides the warning with a 2 GiB / 2.5 GiB gap and logs only when something changes;
   and `startFreeSpaceWatch`, which reads `freeBytes(venueDir)` at once and then every minute on an
   unref'd timer, records each reading, and — only while the stop is noted — asks the stop to
   re-check (`disk.full()`), the same call a till write makes.
2. `storageAlertSource` in `apps/server/src/alert-sources.ts`: area `"box"`, permission
   `system.manage`; `storage.disk_full` (error) while the stop is noted, otherwise
   `storage.space_low` (warning) while the warning is on.
3. The dashboard words them: a `{name:bytes}` placeholder in `@waitron/dashboard-kit`'s
   `alertMessage` (a byte count as "1.8 GB" / "1,8 GB"), the two sentences in
   `apps/dashboard/src/i18n/alert-messages.ts`, and the area label `alerts.area.box` ("Box" /
   "Equipo") in `apps/dashboard/src/i18n/strings.ts`. Boot creates the state beside the stop,
   starts the watch in trading mode, and stops it on a failed start and on close.

**Tech stack:** TypeScript, Hono, Vitest 4.1.11 (Node for `apps/server` and
`packages/dashboard-kit`; real headless Chromium for `apps/dashboard`).

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §2.6 (the disk today), §4.3 (the bell's new alerts and their wording, `:476-484`; the
email to `system.manage`, `:508-509`), §4.6 item 4 (the watch, `:583-589`) and item 5 (no reserve,
`:590-594`), §8 slice 5. Build
plan: [2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md)
Part 1, row 5 (risk triggers: none; LIGHT; no migration; lands itself; depends on slice 1).
Backlog: A798-B (`docs/backlog.md:5491-5508`) and "A full-disk stop on a box nobody writes to
outlives the freed space" (`docs/backlog.md:5535-5539`), which says slice 5's watch is to clear it.

---

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **The warning clears at 2.5 GiB (2,684,354,560 bytes); it comes on below 2 GiB
   (2,147,483,648 bytes).** Design §4.6 item 4 leaves the gap to the build "so a disk hovering at the
   line does not email again and again". DEFAULT 512 MiB. Why that size: the space known to come and
   go in normal running is the bucket stream's side file and the log **(read)**. The stream pauses
   once it measures the side file at 256 MiB or more (`DEFAULT_WAL_LIMIT_BYTES`,
   `packages/stream/src/supervisor.ts:167`); it measures once per tick (`:747-757`), so the file can
   pass 256 MiB before the pause. The log keeps the current file and five rotated ones of up to
   10 MB each (`apps/server/src/log-file.ts:42-53`, `apps/server/src/config.ts:141-142`), so up to
   about 60 MB (57 MiB). Together about 313 MiB, which the 512 MiB gap exceeds. Not counted, because
   not measured: how far past 256 MiB the side file gets, and Litestream's own folder beside the
   database, which design §2.6 says "may grow while the bucket is unreachable (**unverified**)"
   (`:326-327`). A backup run's staging copies (design §2.6: as large as the database, twice) can
   swing further on a large database; a warning raised during a run that took the disk under 2 GiB
   is a true warning, and it stays until 2.5 GiB is free. The thresholds are in binary units because
   §4.6 item 4 says "2 GiB"; the owner's "2 GB" (question 1) is the same line in round figures.
2. **The minute watch also lets the stop lift: while the stop is noted, each reading calls
   `disk.full()`.** DEFAULT: yes, with **no change to `disk-full-state.ts` or its tests**. The watch
   is one more caller of the same `full()` the till gate (`apps/server/src/disk-full-gate.ts:37`),
   the sale routes and the card-reader payments already call while the stop is noted
   (`till-sale.ts:666`, `:1138`, `:2103`; `bill-payments.ts:1179`, `:1412`) — the claim check's grep
   found no other caller outside tests (claim check M10). Why: today a noted stop clears only when
   one of those runs (P5 A), so a box nobody writes to keeps the stop — and, from this slice, the red
   alert — after space is freed; slice 3 left exactly this to slice 5 (backlog
   `docs/backlog.md:5535-5539`; slice 3 plan decision 3). The watch never NOTES a refusal: below
   16 MiB it does nothing to the stop. Noting there would refuse sales that would still be written
   (design §2.6: sales reuse room the side file holds), which is slice 3's parked ground. What the
   extra caller can and cannot change is in Review focus 2.
3. **While the stop is noted, the bell shows `storage.disk_full` and leaves `storage.space_low`
   out**, though the disk is also under 2 GiB. Why: the warning's own words say "Everything still
   works", which is false while the stop refuses every till write; the bell already leaves out an
   alert another one explains (`streamAlerts`, `apps/server/src/alert-sources.ts:91-107`), and the
   design leaves `fiscal.clock_drift` out while `clock.behind_chain` is open (§4.3) for the same
   reason.
4. **The warning's sentence ships without its last sentence, "See what is using it on the Box status
   page." / "Mira qué ocupa espacio en Estado del equipo."** The page does not exist until slice 7
   (P6: no `box-status` or "Estado del equipo" anywhere in `apps/dashboard/src`), so the sentence
   would send a manager to a page they cannot find. Slice 7 adds the sentence back, word for word
   from design §4.3, together with the alert's `screen` (its "Go to" button) in the same change;
   Task 6 records that in the backlog. Every other word is the design's.
5. **The area is `"box"`, labelled "Box" in English and "Equipo" in Spanish** (design §4.3), shown
   for `system.manage`: design §4.3 sends the 2 GB warning's email to "everyone with
   `system.manage`" (`:508-509`), and the backup alerts use the same permission
   (`alert-sources.ts:166-167`). The clock stop's alert, in the same area, is given to
   `system.manage` too (§4.8 c, `:816-817`; §6, revision 5 decision 12, `:1153`). No alert screen yet (decision 4).
6. **The free space is written by the dashboard, not the server: a new `{name:bytes}` placeholder**
   in `alertMessage` (`packages/dashboard-kit/src/alert-messages.ts:64-91`). The server sends
   `freeBytes` as a whole number of bytes; the dashboard writes it in the reader's language —
   "1.8 GB" / "1,8 GB" (P1, the figure the owner's picture 3 shows,
   `docs/backlog/mockups/a798-degraded-trading/3-dashboard-bell.png`). Gigabytes with one decimal
   from 1 GB up (decimal units, so "GB" means what it says); whole megabytes below, switching to
   gigabytes when the megabytes would round to 1000; `-0` written as `0 MB`; "—" for anything that
   is not a finite number at or above 0. Why not on the server: the params carry no language, and a
   preformatted "1.8 GB" is wrong in Spanish. The one existing assertion this touches is the list of
   built-in placeholders at `alerts.test.ts:259`, extended under the owner's standing exception (the
   "Existing assertions" note above; the runner allowed it). **Pull request note:** the warning
   comes on below 2 GiB (2.147 GB) and writes decimal gigabytes, so for its first stretch under the
   line the bell reads "The box has 2.1 GB of disk space left…" (or "2 GB"), beside the owner's
   "a warning at 2 GB"; the alternative is to divide by 1024³ for display.
7. **Logging: one line for each thing that changes, never one per minute** (a single reading can
   log two, as state case 5 shows). `storage.free_space_read`
   (info, `{ freeBytes }`) on the first readable reading after start or after unreadable ones;
   `storage.space_low` (warn, `{ freeBytes }`) when the warning comes on; `storage.space_ok` (info,
   `{ freeBytes }`) when it goes off; `storage.free_space_unread` (warn, `{}`) on the first unreadable
   reading after start or after a readable one; `storage.free_space_check_failed` (warn,
   `{ errorCode }`) if a reading's own code throws. Clearing the stop is already logged by `full()`
   (`storage.disk_space_back`, `disk-full-state.ts:51`). Log events are plain names, never on the
   wire.
8. **An unreadable reading (`freeBytes` answers null) changes nothing**: the last reading and the
   warning stay as they were, as a noted stop stays on an unreadable reading
   (`disk-full-state.ts:45`). On a filesystem that never reports, no warning ever comes on; the log
   says so once.
9. **First reading at once, then every minute.** The first timer is armed at 0 ms, so a box started
   under 2 GiB warns from its first minute; each later timer is armed only after the reading before
   it finished, so readings never overlap. The timer is `unrefTimer` (`apps/server/src/unref-timer.ts:9-13`),
   as the append-only watch's is (`apps/server/src/append-only-watch.ts:83-118`), with the same
   injectable `timer` for tests.
10. **The state is created beside the stop; the watch runs in trading mode only.**
    `createFreeSpaceState` (no I/O) is created right after the stop and its start reading
    (`apps/server/src/boot.ts:935-938`), so the till and device routes mounted later
    (`mountTillApi`, `boot.ts:1658`; `mountDeviceApi`, `:1811`), where slice 6's notices are likely
    to live, can be handed it directly. The watch is started just before boot builds its alert
    sources (`boot.ts:2137`), its stop pushed onto `undoOnFailure` at once (CLAUDE.md §3,
    `bootServer`'s duties) and added to the started server's `stopWork` beside the append-only watch
    (`boot.ts:2724`). Setup mode (`boot.ts:1010-1331`) and an adoption-pending start
    (`:1367-1392`) return before the alert registry is mounted and pass the stop to no till route
    **(read)**, so a watch there would serve nothing; the state made after `:938` simply goes unused
    there. Every node past those — primary, standby, mirror — gets the watch (`boot.ts:2097`,
    "Reached by every boot past setup and adoption").
11. **`storage.space_low` is registered** in `apps/server/src/errors.ts` beside the backup alert
    codes (`:1290-1345`), `{ freeBytes: number }`, "built as data by the box alert source, never
    thrown", as `backup.stream_behind` is (`:1321-1324`). `storage.disk_full` is already registered
    (`packages/shared/src/errors.ts:60`). No guard requires either: of the 40 ongoing codes the
    ongoing-code guard scans, 14 have no registry entry (claim check M3). It documents the params.
12. **The watch reads the venue folder only** (design §4.6 item 4: "the venue folder's disk"). On a
    box every volume shares one disk (design §2.6, `deploy/compose.yml:174-177`).
13. **The `ENOSPC` backlog entry stays open** (`docs/backlog.md:5301-5305`, "A798-B slice 5's watch is
    the natural home"). The watch does not change what a route answers; teaching `diskFullIn` about
    `ENOSPC` changes every route's answer across `@waitron/shared` and `@waitron/server-kit`, a
    cross-package contract this LIGHT slice does not take on. Task 6 adds one line to that entry
    saying slice 5 did not take it.
14. **Lands itself**, as the build plan's row 5 says: it reads free space, raises alerts, and lets an
    existing stop lift through its existing check. No invoice, record, chain, series, number or
    filing changes.

## Behaviour this slice changes

- The bell gains the two `storage.*` alerts, in the new area, for `system.manage`.
- A noted stop now lifts within about a minute of 16 MiB being free even with no till write
  (decision 2); an open bell drops its red alert on its next poll, up to about two minutes after the
  space was freed. Today the stop lifts only on a till write, a sale route or a card payment (P5 A).
  This is the only change to what a till is refused: a till write that arrives first still clears it
  as before.
- New log lines only when something changes, never one per minute: one line for each thing that
  changes, so a single reading can log two — `storage.free_space_read` and `storage.space_ok` when
  readings come back into the clearing zone (state case 5), or `storage.free_space_read` and
  `storage.space_low` on a first reading under 2 GiB (decision 7). Nothing else.

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths.
- **No migration.** No change to `apps/server/src/disk-full-state.ts`, `disk-full-gate.ts`,
  `till-sale.ts`, `bill-payments.ts`, `packages/store`, `packages/fiscal-verifactu`,
  `packages/core`, or anything fiscal (decisions 2, 14).
- **No change to `apps/server/src/alerts.ts`**: the new source is an ordinary ongoing source.
- General code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/dashboard/src/i18n/alert-messages.ts` and `apps/dashboard/src/i18n/strings.ts`; no test
  this plan adds writes a Spanish literal — a dashboard test of Spanish text reads its expected text from those
  files. `packages/dashboard-kit` tests use the package's "ES …" placeholders
  (`packages/dashboard-kit/src/alert-messages.test.ts:10-19`).
- `apps/dashboard/src/i18n/alert-messages.ts` stays free of imports (its header, `:1-3`), because the
  root guards load it.
- Every ongoing alert code is spelled as a `code: "…"` literal in `apps/server/src/alert-sources.ts`,
  so `scripts/ongoing-alert-codes.test.ts` finds it (P3) — never built at runtime, never in another
  file. Its wording lands first (Task 3), so the guard stays green when the source lands (Task 4).
- Tests of the watch never wait real minutes and never sleep for a fixed time: the watch takes a
  `timer` and a `statfs`, and tests pass a manual timer (the append-only watch's test pattern,
  `append-only-watch.test.ts:96-117`) and a settable stub. A test "ticks" by calling the last armed
  callback and then waiting (`vi.waitFor`) until the next timer is armed, which the watch does as
  the last step of a reading. To show that nothing happens after a held reading is released, a test
  awaits `new Promise((r) => setImmediate(r))` twice: every promise continuation queued by the
  release runs before a `setImmediate` callback.
- Coverage stays at 98/98/98/95 in `apps/server`, `packages/dashboard-kit` and `apps/dashboard`. No
  exclude, no ignore comment.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`. Read the `Tests` count every time; a
  run with no count proved nothing. Vitest hides a passing test's console output under this agent;
  unset `AI_AGENT` and `CLAUDECODE` to see it. Every task runs `pnpm exec prettier --check` on the
  files it touched before committing. CI runs the package suites and coverage.
- `apps/dashboard` runs in real headless Chromium; check `memory_pressure | grep free` before its
  run and run it beside another session's browser run only when free memory is well above 15%.

## Review focus

1. **The warning's gap.** On below 2 GiB, off at 2.5 GiB or more, never in between; a disk hovering
   at 2 GiB logs one warning and the alert's `since` stays the first reading's time (Task 1). The
   exact values are pinned as literal byte counts, 2_147_483_648 and 2_684_354_560, by Task 1 state
   case 7, not through the constants.
2. **The watch and the stop (decision 2).** The watch calls `full()` only while `noted()` is true and
   never calls `noteRefused()`. What that can change: a stop noted on the card-payment routes is
   read again by their own checks, which use `noted()` just before the reader is asked
   (`till-sale.ts:684`, `:1139`, `:1351`; `bill-payments.ts:1192`, `:1423`, `:1438`) **(read)**. A
   watch reading that finds 16 MiB free may clear the stop between a payment's first check and its
   last, exactly as a concurrent till write's gate check can today; `full()` keeps the stop when a
   refusal was noted while its reading was in flight (P5 B; claim check B, D, E) and logs the
   clearing once when two readings race (P5 C; claim check C). The watch reads outside every request
   and outside the write queue, so it cannot put a transaction ahead of a payment's first one (the
   ordering concern of `docs/developers/conventions-data.md:2426-2433`). Task 1 case 7 shows the
   watch's re-check goes through the stop's in-flight rule. **For the Codex run-it seat:** test the
   race through the real watch beside a real gate request. In a booted server the stop takes no
   `statfs` (`boot.ts:935` passes `{ dir, now, log }`), and the gate and the watch reach the disk
   through the same stop, so hold one reading this way: mount a till route behind
   `mountGatedWhileDiskFull` (`disk-full-gate.ts:15-32`) with a real
   `createDiskFullState({ …, statfs })` whose stub holds its FIRST call and answers every later call
   at once with room, and start the real `startFreeSpaceWatch` on the same stop with a manual timer.
   Turn the stop on; send a till write (the gate's `full()` makes the held first call); tick the
   watch (its `full()` answers at once and clears the stop); `noteRefused()` again; release the
   gate's reading; expect the gate to answer 507 `storage.disk_full`. The same race was run against
   the real `createDiskFullState` without the gate by the claim check (its case D, P5).
3. **Stopped means stopped.** A failed start after the watch began, and `close()`, each stop it once
   (Task 5). A reading whose free-space read is in flight when `stop()` is called records nothing,
   and no reading arms a timer after `stop()` (Task 1 case 6). A stop re-check (`disk.full()`)
   already under way when `stop()` is called still finishes, and may clear the stop and log
   `storage.disk_space_back` after `close()` (claim check F); it touches only the disk reading and
   the log, so this plan accepts it.
4. **Words.** Each sentence is the design's, less decision 4's last sentence of `storage.space_low`;
   no sentence claims more than the box does (decision 3: "Everything still works" never shows beside
   the stop). The `bytes` placeholder writes the reader's decimal mark (P1).
5. **Nothing else moves.** `git diff main --stat -- apps/server/src/disk-full-state.ts apps/server/src/disk-full-gate.ts apps/server/src/alerts.ts apps/server/src/till-sale.ts apps/server/src/bill-payments.ts packages/fiscal-verifactu packages/core packages/store`
   prints nothing.

## Review path

**LIGHT** (build plan row 5): no per-task reviewer; one Codex run-it review in `/finish-branch`,
whose brief names decision 2 and Review focus 2's experiment; the fresh-context plan-against-spec
read before implementers start. Checked against the risk triggers: no fiscal invariant (no sale,
record or filing path is edited, Review focus 5); no tenant or by-id read; no migration; no grant,
ACL or auth change (the source uses the existing `system.manage` permission through the existing
registry); no new cross-package contract beyond a dashboard-internal placeholder kind. The one
place a reviewer could argue **concurrency** is decision 2: a background duty now calls the stop's
existing `full()`. It adds no new shape — the same call, from outside any request and outside the
write queue, that every till write already makes concurrently (Review focus 2). The round-1
review judged it LIGHT; the claim check's race probes found no order of events that breaks it
(P5); the runner ruled LIGHT.

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-5-plan-probe/` unless marked as the claim
check's (`~/waitron-campaign-b/a798-5-plan-check/`). Vitest probes in a throwaway worktree ran with
`env -u AI_AGENT -u CLAUDECODE … --silent=false`.

- **P1 — what `Intl` writes for a size, in Node and in Chromium.**
  `node -e` with `new Intl.NumberFormat(l, { style: "unit", unit, maximumFractionDigits })` →
  `en-GB "1.8 GB"`, `en-GB "950 MB"`, `es-ES "1,8 GB"`, `es-ES "950 MB"` (`p1-node.log`). The same in
  Playwright's Chromium 156.0.8078.4, from the dashboard's own `playwright`
  (`scripts/intl-chromium.mjs`, `p1-chromium.log`), identical. Code points: the gap before the unit
  is a plain space, U+0020, in both languages and both engines (`p1-node-codepoints.log`,
  `p1-chromium-codepoints.log`) — unlike the euro format, which puts U+00A0 (a no-break space)
  before the sign (`packages/dashboard-kit/src/alert-messages.test.ts`, "a money placeholder"; the
  claim check's control printed `39 2c 30 30 a0 20ac` for it). Failing case for "Spanish gets its
  own decimal mark": `es-ES "1.8 GB"`. It printed `1,8`.
- **P1b — `-0`.** `node -e` with the megabyte format: `-0` → `"-0 MB"`; `Math.max(0, -0)` → `"0 MB"`,
  and `Object.is(Math.max(0, -0), 0)` is `true` (run 2026-10-22 by the planner; the round-1 review
  found the `-0` output). `freeBytes` cannot produce `-0` in practice (`bavail * frsize`); Task 2
  covers it anyway.
- **P2 — baselines, in this worktree, no edits.**
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts` →
  `Tests 6 passed (6)` (`p2-root-guards.log`);
  `pnpm --filter @waitron/server exec vitest run src/disk-full-state.test.ts src/alert-sources.test.ts src/append-only-watch.test.ts`
  → `Tests 110 passed (110)` (`p2-server.log`);
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts` alone →
  `Tests 84 passed (84)` (run by the planner and by the claim check);
  `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts` →
  `Tests 13 passed (13)` (`p2-kit.log`).
- **P3 — the ongoing-code guard sees a new code in `alert-sources.ts`.** Throwaway worktree: a
  source returning `code: "storage.space_low"` appended to `apps/server/src/alert-sources.ts`, then
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts` → exit 1,
  `expected [ 'storage.space_low' ] to deeply equal []`, `Tests 1 failed | 1 passed (2)`
  (`p3-no-wording.log`). With `"storage.space_low": { en: "probe", es: "probe" }` added to
  `ALERT_MESSAGES` → `Tests 2 passed (2)` (`p3-with-wording.log`). Both files restored with
  `git checkout`. The claim check re-ran it with both codes: without wording the header line read
  `expected [ 'storage.disk_full', …(1) ] to deeply equal []` with both codes in the diff below;
  with wording for one only, it failed naming `storage.disk_full` (`p3-one-missing.log`). The guard
  only checks codes in its files against the wording, so wording with no code yet passes. Failing
  case for "the guard covers this file": a pass without the wording. It failed.
- **P4 — what an unknown placeholder kind writes today.** Throwaway case in
  `packages/dashboard-kit/src` (`scripts/zz-bytes-kind.test.ts`): `"Left: {freeBytes:bytes}."` with
  `freeBytes: 1800000000` → `P4 "Left: —."`, `Tests 1 passed (1)` (`p4.log`), as
  `alert-messages.ts:81` writes a dash for a kind no word list names. So Task 2's test fails today
  on a dash, not on a crash.
- **P5 — the stop's clearing, from a caller outside any request.** Throwaway case in
  `apps/server/src` (`scripts/zz-stop-watch.test.ts`, `p5.log`, `Tests 3 passed (3)`; the cases log,
  they do not assert):
  - A: `noteRefused()`, a stub reporting 10 GiB, 50 ms and no call →
    `{"noted":true,"lines":["storage.disk_full_noted"]}`; then one `full()` →
    `{"full":false,"noted":false,"lines":[…,"storage.disk_space_back"]}`. Failing case for "nothing
    clears the stop but `full()`": `noted: false` before the call. It printed `true`. The claim
    check re-ran it waiting 2 s: `{"before":true,"answer":false,"after":false}`; and
    `createDiskFullState` holds no timer (`disk-full-state.ts:24-56`).
  - B: `full()` started with its reading held, `noteRefused()` again, reading released →
    `{"full":true,"noted":true,…}`: a refusal during the reading keeps the stop.
  - C: two `full()` calls with readings held, both released → both `false`, one
    `storage.disk_space_back`.
  - The claim check's `scripts/zz-claim-check.test.ts` (`p5-races.log`, `Tests 7 passed (7)`) ran
    the watch's reading order (read free space, then `if (disk.noted()) await disk.full()`) against
    the real stop: B, C and E (a refusal after the disk answered, before `full()` acted) kept the
    stop or logged once; D (a gate clears, a new refusal starts a new stop, then the watch's reading
    lands with room) kept the new stop and its start time; F (`stop()` while `full()` reads) still
    cleared the stop and logged `storage.disk_space_back` after the stop (Review focus 3); G (an
    unreadable reading while the stop is on) kept it.
- **P6 — text searches** (`p6-searches.log`, this worktree):
  - `storage.space_low` is new. The search found slice 2's `storage.start_space_low` log event
    (`apps/server/src/start-space.ts:138`) and its tests; the claim check also found
    `backup.staging_space_low` (`apps/server/src/errors.ts:1311`, `backup-sweep.ts:112`), which my
    filtered search had hidden. Neither is `storage.space_low`.
  - `area: "box"` and `alerts.area.box` appear nowhere: the area is new.
  - No `box-status` or "Estado del equipo" in `apps/dashboard/src`: there is no Box status page.
  - Every boot test that reads `/management-api/alerts` filters by code or area or uses
    `toContain`/`toContainEqual` (`boot.test.ts:3077`, `:3110`; `boot.restore.test.ts:237`, `:572-573`,
    `:647`; `boot.clock-alert.test.ts:76`; `boot.clock-wiring.test.ts:149`;
    `boot.invoice-alert.test.ts:102`; `boot.backup-network.test.ts:307`), so a test machine with
    less than 2 GiB free, where the real watch would raise the warning, breaks none of them.
  - Read, not run: `apps/dashboard/src/i18n/alerts.test.ts:255-264` lists the built-in placeholder
    kinds as `"money"` and `"date"` — the one assertion decision 6 extends; the claim check found no
    other test or guard listing them.
- **P7 — the thresholds as the plan first wrote them were not pinned** (claim check I1,
  `scripts/zz-space-state.test.ts`, `p-state-mutation.log`). With state cases 2–5 written with the
  constants, setting the clearing line to 2 GiB failed only case 4 (case 3 moves with the constant),
  and setting it to 3 GiB − 1 byte failed nothing. Task 1 now adds case 7 with literal byte counts.
- **Not measured:** anything on Linux or a real box; the bell in a browser (Task 3's tests read the
  strings and the label functions, not the rendered bell).

---

### Task 1: The free-space state and the minute watch

**Files:**
- Create: `apps/server/src/free-space-watch.ts`
- Create: `apps/server/src/free-space-watch.test.ts`

**Interfaces** (`free-space-watch.ts`):
```ts
import { codeOf, type Logger } from "@waitron/server-kit";
import type { DiskFullState } from "./disk-full-state.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

/** Below this the box warns that its disk is running out (design §4.6 item 4). */
export const SPACE_LOW_BYTES = 2 * 1024 ** 3;
/** The warning goes off only at this much free, so it does not toggle at the line. */
export const SPACE_OK_BYTES = 2.5 * 1024 ** 3;
export const FREE_SPACE_CHECK_MS = 60_000;

export interface FreeSpaceReading {
  /** The latest reading the filesystem could give; null until one. */
  readonly freeBytes: number | null;
  readonly readAt: Date | null;
  /** When the warning now on came on; null while it is off. */
  readonly lowSince: Date | null;
}

export interface FreeSpaceState {
  /** `free` is `freeBytes`' answer: null where the filesystem cannot say, which changes nothing. */
  record(free: number | null, at: Date): void;
  current(): FreeSpaceReading;
}

export function createFreeSpaceState(deps: { log: Logger }): FreeSpaceState;

/**
 * Reads `dir`'s free space at once and then every `intervalMs`, each timer armed after the reading
 * before it finished. While `disk` holds a noted stop, each reading also asks it to re-check, so a
 * stop lifts when space is freed even if nothing writes.
 */
export function startFreeSpaceWatch(deps: {
  dir: string;
  state: FreeSpaceState;
  disk: Pick<DiskFullState, "noted" | "full">;
  intervalMs: number;
  now: () => Date;
  log: Logger;
  statfs?: Statfs;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => void };
```
`record`: a non-null `free` sets `freeBytes`/`readAt`; the warning comes on when it is off and
`free < SPACE_LOW_BYTES` (setting `lowSince = at`, logging `storage.space_low`), goes off when it is
on and `free >= SPACE_OK_BYTES` (logging `storage.space_ok`); `storage.free_space_read` and
`storage.free_space_unread` as decision 7 says. `startFreeSpaceWatch`'s reading, in order:
return if stopped; `const free = await freeBytes(dir, statfs)`; return if stopped;
`state.record(free, now())`; `if (disk.noted()) await disk.full()`; then, in a `finally` that
checks `stopped`, arm the next timer at `intervalMs`. A throw is caught and logged as
`storage.free_space_check_failed` `{ errorCode: codeOf(error) }`; the next timer is still armed. The
first timer is armed at 0 ms. `stop()` sets `stopped` and cancels the armed timer.

- [ ] **Step 1: Write the failing tests** in `free-space-watch.test.ts`. A log spy collects
  `[level, event, fields]`. `GIB = 1024 ** 3`. Times are fixed `Date`s.
  `describe("createFreeSpaceState")`:
  1. `"starts with nothing read"`: `current()` `toEqual`
     `{ freeBytes: null, readAt: null, lowSince: null }`; no log line.
  2. `"warns from just under 2 GiB, not at it, since that reading"`: `record(SPACE_LOW_BYTES, t1)` →
     `lowSince` null; `record(SPACE_LOW_BYTES - 1, t2)` → `toEqual({ freeBytes: SPACE_LOW_BYTES - 1,
     readAt: t2, lowSince: t2 })`; the log is exactly
     `[["info","storage.free_space_read",{freeBytes: SPACE_LOW_BYTES}], ["warn","storage.space_low",{freeBytes: SPACE_LOW_BYTES - 1}]]`.
  3. `"keeps the warning, and when it began, until 2.5 GiB is free"`: `record(GIB, t1)`,
     `record(SPACE_OK_BYTES - 1, t2)` → `lowSince` `t1`, `freeBytes` `SPACE_OK_BYTES - 1`;
     `record(SPACE_OK_BYTES, t3)` → `lowSince` null, and the last log line is
     `["info","storage.space_ok",{freeBytes: SPACE_OK_BYTES}]`.
  4. `"a disk hovering at 2 GiB warns once"`: readings `SPACE_LOW_BYTES - 1`, `SPACE_LOW_BYTES + 1`
     three times over (six readings, t1…t6) → `lowSince` `t1`; the log holds one
     `storage.space_low` and no `storage.space_ok`.
  5. `"an unreadable reading keeps the last reading and the warning, and says so once"`:
     `record(GIB, t1)`, `record(null, t2)`, `record(null, t3)` → `toEqual({ freeBytes: GIB, readAt:
     t1, lowSince: t1 })`, one `["warn","storage.free_space_unread",{}]`; then
     `record(3 * GIB, t4)` → one more `storage.free_space_read` with `3 * GIB` and a
     `storage.space_ok`. A first-ever reading that is null logs `storage.free_space_unread` too.
  6. `"logs nothing for readings that change nothing"`: ten readings of `10 * GIB` → the log is the one
     `storage.free_space_read`.
  7. `"turns on below 2,147,483,648 bytes and off at 2,684,354,560, as literal numbers"`: written with
     literals only, never the constants. `record(2_147_483_648, t1)` → `lowSince` null;
     `record(2_147_483_647, t2)` → `lowSince` `t2`; `record(2_684_354_559, t3)` → `lowSince` still
     `t2`; `record(2_684_354_560, t4)` → `lowSince` null.
  `describe("startFreeSpaceWatch")`, with the manual timer of `append-only-watch.test.ts:96-117`
  (each entry `{ ms, fn, cancelled }`) and `tick = async () => { const n = armed.length;
  armed.at(-1)!.fn(); await vi.waitFor(() => expect(armed.length).toBe(n + 1)); }`; a settable stub
  `statfs = async (dir) => { seen.push(dir); return { bavail: free, frsize: 1 }; }`:
  1. `"reads at once, then a minute after each reading"`: right after start `armed` is
     `[{ ms: 0, … }]`; after one tick a second entry with `ms: 60_000`; after two more, four entries,
     each later one `60_000`; `seen` is three times the watched dir.
  2. `"records each reading on the state"`: free `GIB` → after a tick, `state.current().lowSince` is
     the `now()` value; free `3 * GIB` → after a tick, null.
  3. `"asks the stop to re-check only while it is noted"`: a disk double
     `{ noted: () => noted, full: vi.fn(async () => false) }`; noted false → two ticks, `full` not
     called; noted true → one tick, called once.
  4. `"a noted stop lifts on the next reading once 16 MiB is free, with no write"`: the REAL
     `createDiskFullState({ dir, now, log, statfs: diskStatfs })` with `diskStatfs` reporting
     `FULL_DISK_BYTES - 1`; `noteRefused()`; tick → `noted()` true; `diskStatfs` now reports
     `FULL_DISK_BYTES`; tick → `noted()` false and the log holds one `storage.disk_space_back`.
  5. `"never notes a refusal, however little is free"`: the real stop, nothing noted; watch statfs and
     `diskStatfs` both report 0 → after two ticks `noted()` is false.
  6. `"stop cancels the armed timer, and a reading whose free-space read is in flight records and arms nothing"`:
     after start, `stop()` → `armed[0].cancelled` true. Second watch: a statfs that returns a held
     promise; call the first timer's `fn`, then `stop()`, then release the reading with `GIB`, then
     `await new Promise((r) => setImmediate(r))` twice (Global constraints) → `armed.length` still 1,
     `state.current().freeBytes` null, no `storage.space_low` logged.
  7. `"the watch's re-check goes through the stop's in-flight rule"`: the real stop with
     `diskStatfs` returning a held promise; `noteRefused()`; call the timer's `fn`; once `diskStatfs`
     has been called (`vi.waitFor`), `noteRefused()` again; release the reading with
     `FULL_DISK_BYTES`; wait until the next timer is armed → `noted()` true, and the log holds no
     `storage.disk_space_back`. It fails if the watch never re-checks (it times out waiting for
     `diskStatfs`) or if it clears the stop by any path but `full()`; it re-proves the stop's own
     rule (P5 B) through the watch rather than proving something new about the watch.
  8. `"a reading that throws is logged and the next is still armed"`: a disk double whose `noted` is
     true and whose `full` rejects `new Error("boom")` → after one tick, the log holds
     `["warn","storage.free_space_check_failed",{ errorCode: "unknown" }]` and a timer at `60_000`
     was armed.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/free-space-watch.test.ts` → FAILS to resolve
  `./free-space-watch.js`.
- [ ] **Step 3: Implement** `free-space-watch.ts` as the Interfaces say.
- [ ] **Step 4: Run and watch it pass; typecheck; format.** The Step 2 command → PASS, `Tests 15
  passed (15)`. `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/free-space-watch.ts apps/server/src/free-space-watch.test.ts`
  exits 0.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS before the next. The expected
  failures below were run on a stand-in built from the Interfaces by the round-3 check
  (`~/waitron-campaign-b/a798-5-plan-check3/t1-mutations.log`), every case listed; if a different
  case fails, report it rather than adjusting the case.
  - `SPACE_OK_BYTES` set to `SPACE_LOW_BYTES`: state cases 4 and 7 FAIL; case 3 passes, because it
    is written with the constant.
  - `SPACE_LOW_BYTES` set to `2 * 1000 ** 3`: only state case 7 FAILS.
  - The `if (disk.noted()) await disk.full()` line removed: watch cases 3, 4 and 8 FAIL (case 8's
    double throws only from `full()`), and case 7 times out.
  - The re-arm removed: every watch case but 6 FAILS — cases 1, 2, 3, 4, 5, 7 and 8, each `tick`
    waiting about a second for a re-arm that never comes; case 1 names the cause (the round-3
    check's run of this deletion on a stand-in: `Tests 7 failed | 8 passed (15)`).
  - The `stopped` check after the reading removed: watch case 6 FAILS.
  - The `catch` removed: watch case 8 FAILS (with an unhandled rejection or no armed timer).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/free-space-watch.ts apps/server/src/free-space-watch.test.ts
  git commit -s -m "The server reads its disk's free space every minute, warns below 2 GiB, and lets a full-disk stop lift once space is back"
  ```

### Task 2: A `bytes` placeholder for alert sentences

**Files:**
- Modify: `packages/dashboard-kit/src/alert-messages.ts` (the type comment `:4-7`; a `formatBytes`
  beside `formatDay`, `:42-55`; one branch in `alertMessage`, `:74-79`)
- Modify: `packages/dashboard-kit/src/alert-messages.test.ts` (a `registerAlertMessages` entry and a
  new `describe` after "a money placeholder")

**Interfaces:** `{name:bytes}` writes a number of bytes. Anything but a finite number at or above 0
writes "—". Otherwise, with `v = Math.max(0, value)` (which turns `-0` into `0`, P1b): decimal
gigabytes with at most one decimal (`Intl.NumberFormat(locale, { style: "unit", unit: "gigabyte",
maximumFractionDigits: 1 })` of `v / 1e9`) when `Math.round(v / 1e6) >= 1000`, else whole megabytes
(`unit: "megabyte"`, `maximumFractionDigits: 0`, of `v / 1e6`); the locale is
`pickLocale(DAY_LOCALES, l)` (`:40`: `en-GB`, `es-ES`). The type comment gains one clause for
`{name:bytes}`.

- [ ] **Step 1: Write the failing tests.** Register
  `"test.space": { en: "Left: {free:bytes}.", es: "ES left: {free:bytes}." }`.
  `describe("a bytes placeholder")`:
  1. `"writes gigabytes with one decimal from 1 GB, with the alert's language's decimal mark"`:
     `free: 1_800_000_000` → en-GB `"Left: 1.8 GB."`, es-ES `"ES left: 1,8 GB."`;
     `2_147_483_648` → `"Left: 2.1 GB."`; `12_345_678_901` → `"Left: 12.3 GB."`.
  2. `"writes whole megabytes below that, and gigabytes once they would round to 1000"`:
     `950_000_000` → `"Left: 950 MB."` (and es-ES `"ES left: 950 MB."`); `999_499_999` →
     `"Left: 999 MB."`; `999_500_000` → `"Left: 1 GB."`; `0` → `"Left: 0 MB."`; `-0` →
     `"Left: 0 MB."`.
  3. `"writes a dash for anything that is not a byte count"`: for each of `"1800000000"`, `null`,
     `undefined`, `NaN`, `-1`, `Infinity`, `{}` → `"Left: —."`.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts` → cases 1 and 2
  FAIL with `"Left: —."` in place of the sizes (P4); case 3 passes already (every value writes a
  dash today) and is kept as the guard on the new branch.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch it pass; typecheck; format.** The Step 2 command → PASS,
  `Tests 16 passed (16)` (P2's 13 plus 3). `pnpm --filter @waitron/dashboard-kit typecheck` exits 0.
  `pnpm exec prettier --check packages/dashboard-kit/src/alert-messages.ts packages/dashboard-kit/src/alert-messages.test.ts`
  exits 0.
- [ ] **Step 5: Proofs by deletion.** Drop the megabyte branch (always gigabytes): case 2 FAILS
  (`950_000_000` writes `"1 GB"`, as the claim check measured). Drop the `Number.isFinite`/`>= 0`
  check: case 3 FAILS on `-1` or `Infinity`. Drop `Math.max(0, …)`: case 2 FAILS on `-0`
  (`"-0 MB"`, P1b). Restore; PASS.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/dashboard-kit/src/alert-messages.ts packages/dashboard-kit/src/alert-messages.test.ts
  git commit -s -m "Alert sentences can write a size in bytes as gigabytes or megabytes, in the reader's language"
  ```

### Task 3: The dashboard's words for the two alerts and the Box area

Lands before the alert source (Task 4), so the ongoing-code guard stays green at every commit
(P3: the guard checks codes in `alert-sources.ts` against the wording, and wording with no code yet
passes).

**Files:**
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (two entries after
  `"backup.stream_bucket_unusable"`, near `:84-100`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`"alerts.area.box"` after `"alerts.area.content"`
  in `en`, `:851`, and in `es`, `:4064`)
- Modify: `apps/dashboard/src/i18n/alerts.test.ts` (the ONE declared change at `:259`, Step 0; two
  new cases)
- Modify: `apps/dashboard/src/widgets/alert-format.test.ts` (one new case after
  "labels the translations area in both languages", `:131-136`)

**The words** (design §4.3, `:479-484`, less decision 4's sentence):
```ts
"storage.space_low": {
  en: "The box has {freeBytes:bytes} of disk space left. Everything still works, but if it fills up nothing can be saved.",
  es: "Al equipo le quedan {freeBytes:bytes} de espacio en disco. Todo sigue funcionando, pero si se llena no se podrá guardar nada.",
},
"storage.disk_full": {
  en: "The box is out of disk space: nothing can be saved.",
  es: "El equipo no tiene espacio en disco: no se puede guardar nada.",
},
```
`en["alerts.area.box"] = "Box"`, `es["alerts.area.box"] = "Equipo"`.

- [ ] **Step 0: The declared assertion change, alone, first.** In `alerts.test.ts`, change line
  259 from
  `.filter((m) => m[1] !== "money" && m[1] !== "date" && !Object.hasOwn(ALERT_WORDS, m[1]!))` to
  `.filter((m) => m[1] !== "money" && m[1] !== "date" && m[1] !== "bytes" && !Object.hasOwn(ALERT_WORDS, m[1]!))`.
  Nothing uses `bytes` yet, so the file still passes; Step 4 shows the change is needed and that the
  case still catches what it was written for. Commit this one line alone, before any other edit to
  the file:
  ```bash
  git add apps/dashboard/src/i18n/alerts.test.ts
  git commit -s -F - <<'MSG'
  Changed test checks (A798 slice 5): bytes is a built-in alert placeholder

  apps/dashboard/src/i18n/alerts.test.ts:259, before:
    .filter((m) => m[1] !== "money" && m[1] !== "date" && !Object.hasOwn(ALERT_WORDS, m[1]!))
  after:
    .filter((m) => m[1] !== "money" && m[1] !== "date" && m[1] !== "bytes" && !Object.hasOwn(ALERT_WORDS, m[1]!))

  @waitron/dashboard-kit's alertMessage gained the {name:bytes} placeholder, which the box's
  disk warning uses. The list gains one entry and every existing one is unchanged (the owner's
  standing exception of 2026-09-27); a slot naming an unregistered word list still fails this case.
  MSG
  ```
- [ ] **Step 1: Write the failing tests.**
  - `alerts.test.ts`, `"words the box's disk alerts, writing the free space in each language"`:
    `alertMessage("storage.space_low", { freeBytes: 1_800_000_000 }, "en")` `toBe`
    `"The box has 1.8 GB of disk space left. Everything still works, but if it fills up nothing can be saved."`;
    the `"es"` answer `toBe` `ALERT_MESSAGES["storage.space_low"]!.es.replace("{freeBytes:bytes}", "1,8 GB")`
    and does not contain `"{"`; `alertMessage("storage.disk_full", {}, "en")` `toBe`
    `"The box is out of disk space: nothing can be saved."` and the `"es"` answer `toBe`
    `ALERT_MESSAGES["storage.disk_full"]!.es`; `hasAlertMessage` is true for both.
  - `alerts.test.ts`, `"keeps the disk warning to two sentences while there is no Box status page"`:
    for both `ALERT_MESSAGES["storage.space_low"]!.en` and `.es`,
    `text.split(/(?<=\.)\s+/).length` is `2`. This keeps decision 4's sentence out without writing
    any Spanish in the test; slice 7 deletes this case when it adds the sentence back.
  - `alert-format.test.ts`, `"labels the box area in both languages"`: `setLocale("en-GB")`,
    `areaLabel("box")` `toBe("Box")`; `setLocale("es-ES")`, `areaLabel("box")` `toBe(es["alerts.area.box"])`
    (`es` imported from `../i18n/strings.js`) and not `"box"`.
- [ ] **Step 2: Run and watch them fail.** Check `memory_pressure | grep free` first.
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/widgets/alert-format.test.ts`
  → the first new case FAILS (`hasAlertMessage` false; the sentence is the generic "Something needs
  attention"); the two-sentence case FAILS (`ALERT_MESSAGES["storage.space_low"]` is undefined); the
  label case FAILS (`"box"`), or the file fails to typecheck on `es["alerts.area.box"]`.
- [ ] **Step 3: Implement** the two entries and the two strings.
- [ ] **Step 4: Show the declared change is needed and still bites.** Re-run the Step 2 command →
  PASS. Then, each restored before the next: (a) take `&& m[1] !== "bytes"` back out of line 259 →
  "names only registered word lists in its word-list slots" FAILS naming
  `storage.space_low: {freeBytes:bytes}` (twice); (b) with line 259 as committed, change the new
  English sentence's slot to `{freeBytes:bites}` → the same case FAILS naming
  `storage.space_low: {freeBytes:bites}`; (c) append the design's third sentence to the English
  wording → the two-sentence case FAILS.
- [ ] **Step 5: Run and watch them pass; the root guards; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/dashboard typecheck` exits 0. From the root:
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/english-only.test.ts`
  → PASS. `pnpm exec prettier --check apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/alerts.test.ts apps/dashboard/src/widgets/alert-format.test.ts`
  exits 0.
- [ ] **Step 6: Commit** the rest.
  ```bash
  git add apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/alerts.test.ts apps/dashboard/src/widgets/alert-format.test.ts
  git commit -s -m "The dashboard words the box's disk alerts in English and Spanish, under the Box area"
  ```

### Task 4: The box's alert source

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (a new exported factory after
  `appendOnlyRestoredAlertSource`, `:285-303`; a type import of `FreeSpaceState` from
  `./free-space-watch.js` and `DiskFullState` from `./disk-full-state.js`)
- Modify: `apps/server/src/alert-sources.test.ts` (a new `describe` after
  "appendOnlyRestoredAlertSource", `:107-124`)
- Modify: `apps/server/src/errors.ts` (after `"backup.stream_behind"`, `:1324`)

**Interfaces:**
```ts
/**
 * The box's disk: `storage.disk_full` while the full-disk stop is noted, else `storage.space_low`
 * while the free-space warning is on. Never both: the warning says everything still works.
 */
export function storageAlertSource(deps: {
  space: Pick<FreeSpaceState, "current">;
  disk: Pick<DiskFullState, "since">;
}): AlertSource;
```
`area: "box"`, `permission: "system.manage"`. While `disk.since()` is a date:
`[{ key: "storage.disk_full", code: "storage.disk_full", params: {}, severity: "error", since: <that date's ISO string> }]`.
Otherwise, while `space.current().lowSince` is a date:
`[{ key: "storage.space_low", code: "storage.space_low", params: { freeBytes: <current freeBytes> }, severity: "warning", since: <lowSince ISO> }]`.
Otherwise `[]`. No `screen` (decision 4). Both codes are written as `code: "…"` literals. In
`errors.ts`: `"storage.space_low": { freeBytes: number };` with a doc comment in the shape of
`backup.stream_behind`'s: free space under `SPACE_LOW_BYTES` (`free-space-watch.ts`); `freeBytes`
is the latest reading; built as data by the box alert source, never thrown.

- [ ] **Step 1: Write the failing tests**, `describe("storageAlertSource")`, using the file's `ctx`
  (`:62`), the real `createFreeSpaceState` and the real `createDiskFullState` (statfs stub reporting
  0, so it never clears in these cases):
  1. `"belongs to the box area and needs system.manage"`: `area` `"box"`, `permission`
     `"system.manage"`.
  2. `"raises nothing while the disk has room and no save has failed"`: state with one
     `record(10 * GIB, t)` → `read(ctx)` `toEqual([])`.
  3. `"raises storage.space_low with the latest free space, since the warning began"`:
     `record(GIB, t1)`, `record(GIB / 2, t2)` → `toStrictEqual([{ key: "storage.space_low", code:
     "storage.space_low", params: { freeBytes: GIB / 2 }, severity: "warning", since:
     t1.toISOString() }])`.
  4. `"raises storage.disk_full, since the stop began, and leaves the warning out"`: the state as in
     case 3; the stop's `now` returns `t3`; `noteRefused()` → `toStrictEqual([{ key:
     "storage.disk_full", code: "storage.disk_full", params: {}, severity: "error", since:
     t3.toISOString() }])`.
  5. `"raises storage.disk_full with room on the disk too"`: state at `10 * GIB`, stop noted →
     the one `storage.disk_full` alert.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts` → the five new cases FAIL
  (`storageAlertSource` is not exported); the other 84 pass (P2).
- [ ] **Step 3: Implement** the factory and the registry entry.
- [ ] **Step 4: Run and watch it pass; typecheck; root guard; format.** The Step 2 command → PASS,
  `Tests 89 passed (89)`. `pnpm --filter @waitron/server typecheck` exits 0. From the root,
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts` → PASS (Task 3's wording is in).
  `pnpm exec prettier --check apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts apps/server/src/errors.ts`
  exits 0.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS:
  - Swap the two branches (check the warning before the stop): case 4 FAILS with the warning in
    place of the error.
  - Remove the `storage.disk_full` entry from `apps/dashboard/src/i18n/alert-messages.ts`: the
    ongoing-code guard FAILS naming `storage.disk_full` (the claim check's `p3-one-missing.log`).
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts apps/server/src/errors.ts
  git commit -s -m "The bell can say the box's disk is nearly full or full, under a new Box area"
  ```

### Task 5: Boot creates the state, starts the watch, puts the source in the bell, and stops the watch

**Files:**
- Modify: `apps/server/src/boot.ts` (imports; `createFreeSpaceState` right after
  `noteFullAtStart`, `:938`; the watch's start before `const serverAlertSources`, `:2137`; the
  array, `:2137-2158`; `stopWork`'s `closeAll`, beside `() => appendOnlyWatch.stop()`, `:2724`)
- Create: `apps/server/src/boot.free-space.test.ts`
- Modify: `apps/server/src/boot.failed-start.test.ts` (a `vi.mock` for `./free-space-watch.js` beside
  the append-only one, `:81-84`; a spy helper beside `spyOnAppendOnlyWatchStop`, `:161-171`; two
  cases beside `:545-556` and `:870-882`)

**The wiring:**
```ts
// after `await noteFullAtStart(diskFull, …)` (boot.ts:938)
const freeSpace = createFreeSpaceState({ log });

// just before `const serverAlertSources` (boot.ts:2137)
const freeSpaceWatch = startFreeSpaceWatch({
  dir: config.venueDir,
  state: freeSpace,
  disk: diskFull,
  intervalMs: FREE_SPACE_CHECK_MS,
  now,
  log,
});
undoOnFailure.push(async () => freeSpaceWatch.stop());
```
then `storageAlertSource({ space: freeSpace, disk: diskFull })` as the array's second entry, after
`backupSource`; and `() => freeSpaceWatch.stop()` in `stopWork`. No new `StartServerSeams` field: the
tests reach the watch by mocking its module, as `boot.clock-alert.test.ts:14-28` does for the clock.
`boot.disk-full-wiring.test.ts` expects exactly one `createDiskFullState` (round-1 review); this
wiring adds none.

- [ ] **Step 1: Write the failing tests.**
  - `boot.free-space.test.ts`, copied in shape from `boot.clock-alert.test.ts:1-108` (its env, its
    migrations copy, `setupVenue`, `venue.managerCookie`; the manager role holds `system.manage`,
    round-1 review). A hoisted holder `{ free: 10 * GIB, deps: undefined, armed: [] }`;
    `vi.mock("./free-space-watch.js")` wraps the real `startFreeSpaceWatch`, keeping the caller's
    `dir`, `state`, `disk`, `now` and `log` but passing
    `statfs: async () => ({ bavail: holder.free, frsize: 1 })` and the manual timer, and saves the
    deps in `holder.deps`. `boxAlerts()` fetches `/management-api/alerts` and returns
    `body.alerts.filter((a) => a.area === "box")`. One `it`,
    `"the bell shows the box's disk, and a full-disk stop lifts on the watch's next reading"`:
    1. `holder.free = GIB`; start; tick (the 0 ms reading) → `boxAlerts()` `toEqual([{ key:
       "storage.space_low", code: "storage.space_low", params: { freeBytes: GIB }, severity:
       "warning", since: expect.any(String), kind: "ongoing", area: "box" }])`, and
       `holder.deps.dir` is `env.WAITRON_VENUE_DIR`.
    2. `(holder.deps.disk as DiskFullState).noteRefused()` → `boxAlerts()` is the one
       `storage.disk_full` alert (`severity: "error"`, `params: {}`, `area: "box"`): boot gave the
       watch and the bell the same stop.
    3. Tick → the stop re-reads the real venue folder, which has room → `boxAlerts()` is back to the
       one `storage.space_low`; `(holder.deps.disk as DiskFullState).noted()` is false.
    4. `holder.free = 3 * GIB`; tick → `boxAlerts()` `toEqual([])`.
    `finally`: `server.close()`, `rm` the scratch folder.
  - `boot.failed-start.test.ts`: `spyOnFreeSpaceWatchStop()`, the shape of
    `spyOnAppendOnlyWatchStop` (`:161-171`). Two cases:
    `"in trading mode, when a step after the listener is started throws, stopping the free-space watch"`
    (the shape of `:545-556`: `failLandingAfterMdns`, `startServer` rejects with the failure,
    `stop` called once, `readVenueHolder(venueDir)` null) and `"stops the free-space watch"` (the
    shape of `:870-882`: not called while running; called once after `server.close()`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/boot.free-space.test.ts src/boot.failed-start.test.ts`
  → `boot.free-space.test.ts` FAILS (`holder.deps` undefined: boot never starts the watch, or no
  armed timer to tick); the two new failed-start cases FAIL (the spy's `stop` never called, or the
  `mockImplementationOnce` never consumed); every existing case passes.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run and watch them pass; typecheck; format.** The Step 2 command → PASS.
  `pnpm --filter @waitron/server exec vitest run src/boot.clock-alert.test.ts src/boot.invoice-alert.test.ts src/boot.disk-full-wiring.test.ts`
  → PASS (two neighbours that read the bell through a booted server, and the stop's own wiring
  test). `pnpm --filter @waitron/server typecheck` exits 0.
  `pnpm exec prettier --check apps/server/src/boot.ts apps/server/src/boot.free-space.test.ts apps/server/src/boot.failed-start.test.ts`
  exits 0.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS:
  - Remove `undoOnFailure.push(async () => freeSpaceWatch.stop())`: the failed-start case FAILS.
  - Remove `() => freeSpaceWatch.stop()` from `stopWork`: the close case FAILS.
  - Remove `storageAlertSource(…)` from the array: `boot.free-space.test.ts` FAILS at sub-step 1 (no
    "box" alert).
  - Pass the watch a second `createDiskFullState(…)` instead of `diskFull`: `boot.free-space.test.ts`
    FAILS at sub-step 2 — `noteRefused()` turns on the watch's own stop, not the one the bell reads,
    so no `storage.disk_full` appears (round-1 review Minor 4; claim check M1).
    `boot.disk-full-wiring.test.ts` fails too while this deletion is in place, since it counts the
    stops created.
- [ ] **Step 6: Root guards and the "nothing else moves" check.**
  From the root: `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`
  → PASS. Then Review focus 5's `git diff main --stat -- …` prints nothing. Coverage is CI's gate:
  before calling the branch green, read the coverage or merge jobs of `apps/server`,
  `packages/dashboard-kit` and `apps/dashboard` on the pull request's current head, and check that
  the `changes` job selected all three.
- [ ] **Step 7: Commit.**
  ```bash
  git add apps/server/src/boot.ts apps/server/src/boot.free-space.test.ts apps/server/src/boot.failed-start.test.ts
  git commit -s -m "Boot starts the free-space watch in trading mode, shows the box's disk in the bell, and stops the watch on a failed start and on close"
  ```

### Task 6: Developer docs and backlog

**Files:**
- Modify: `docs/developers/conventions-data.md` (section "A full disk stops the till's writes",
  "How the box knows", `:2413-2433`)
- Modify: `docs/backlog.md` (the A798-B entry, `:5491-5508`; the entry at `:5535-5539`; the entry at
  `:5301-5305`; new open entries after the A798-B entry)

- [ ] **Step 1: `conventions-data.md`.** In "How the box knows", after the bullet that lists who reads
  free space while the stop is on (`:2426-2433`), one bullet: the free-space watch
  (`apps/server/src/free-space-watch.ts`, started by boot in trading mode) reads the venue folder's
  free space at start and every minute; while the stop is on, each reading also calls `full()`, so
  the stop lifts within about a minute of 16 MiB being free with no write; it never turns the stop
  on. One more bullet: below 2 GiB it raises `storage.space_low` in the bell, and it clears only at
  2.5 GiB; while the stop is on the bell shows `storage.disk_full` instead (`storageAlertSource`,
  `alert-sources.ts`); an open bell asks for its alerts every 60 s, so what it shows can lag the
  watch by up to about two minutes. State, not history.
- [ ] **Step 2: `backlog.md`.**
  - The A798-B entry: replace "slice 5 is next" with "slice 5 (a free-space watch every minute: the
    bell warns below 2 GiB and shows a full disk, and a full-disk stop lifts once space is back with
    no write) landed in #<this pull request>; slice 6 is next".
  - Delete "A full-disk stop on a box nobody writes to outlives the freed space" (`:5535-5539`): the
    watch now clears it.
  - The `ENOSPC` entry (`:5301-5305`): replace "A798-B slice 5's watch is the natural home." with
    "A798-B slice 5's watch did not take it: it changes no route's answer."
  - New entry after A798-B: "**The disk warning does not point at the Box status page yet.**
    `storage.space_low`'s sentence leaves out the design's 'See what is using it on the Box status
    page.' / 'Mira qué ocupa espacio en Estado del equipo.' and carries no Go-to, because the page
    does not exist. Slice 7 adds both, and deletes the two-sentence test in
    `apps/dashboard/src/i18n/alerts.test.ts` that keeps the sentence out. Left open by A798-B slice 5
    (#<this pull request>) for slice 7."
  - New entry: "**'Equipo' names two things in the Spanish dashboard.** The bell's new area for the
    box is 'Equipo' (design §4.3), and so is the sidebar's staff group (`nav.group.team`,
    `apps/dashboard/src/i18n/strings.ts`). The owner's picture 3 shows both. Not yet put to the owner.
    Raised by A798-B slice 5's plan."
- [ ] **Step 3: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` and the same for
  `docs/developers/conventions-data.md` print `"ignored": true` (docs/ is not format-checked). Then:
  ```bash
  git add docs/developers/conventions-data.md docs/backlog.md
  git commit -s -m "Docs and backlog: the free-space watch, the box's disk alerts, and what slice 5 leaves open"
  ```
  The pull request number is filled in once `/finish-branch` has opened it, in a follow-up commit.

## Pull request notes

The pull request description says, in plain words:
- The one changed test check (`apps/dashboard/src/i18n/alerts.test.ts:259`), its before and after,
  and that it falls under the owner's standing exception of 2026-09-27 (a list gains one entry;
  every existing one unchanged).
- The warning comes on below 2 GiB but shows decimal gigabytes, so it can read "The box has 2.1 GB of
  disk space left" (decision 6), and what the alternative would be.
- The bell can show a change up to about two minutes after it happens (one watch interval plus the
  bell's 60 s poll).
- The warning's last sentence, about the Box status page, waits for slice 7 (decision 4).

---

## Self-review against the spec

- §4.6 item 4 (a watch every minute on the venue folder's disk; below 2 GiB `storage.space_low`; the
  build picks the clearing line): Task 1, decisions 1, 9, 12; boot wiring Task 5. The amber strip is
  slice 6's, the Box status row slice 7's, the email slice 10's; each can read
  `FreeSpaceState.current()`, created beside the stop at `boot.ts:938` (decision 10), and `lowSince`
  marks an episode for slice 10's "once per episode".
- §4.6 item 5 (the first failed save turns everything red; trading back when someone frees space):
  slice 3's stop is untouched; the bell's `storage.disk_full` follows it (Task 4), and the watch lets
  it lift without a write (decision 2, Task 1 case 4, Task 5 sub-step 3).
- §4.3 (a new area "Equipo"/"Box"; the two codes, their severities and wording): Tasks 3 and 4;
  decision 4 is the one departure from the wording, recorded for slice 7.
- §4.3 (`system.manage`, by the email line `:508-509`): Task 4 case 1, decision 5.
- §8 slice 5, risk "none": Review path (LIGHT, with decision 2 named and the Codex seat's experiment).
- Build plan Part 1 row 5 (no migration, lands itself, depends on slice 1): Global constraints,
  decision 14.
