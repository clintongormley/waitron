# A798-B slice 4 — the module seat for staff notices

> **No migration.** Nothing in this slice adds or changes a table, an index or a trigger.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation. Implementers are dispatched
> as `subagent_type: "implementer"`.
>
> **Existing assertions.** This plan expects NO existing assertion to change: every test it touches
> gains cases, and `packages/fiscal-verifactu/src/first-issue-date.test.ts` must pass unedited after
> Task 1's refactor. No test run or searched for this plan pins a module descriptor's whole shape
> (M4). If one turns up (in CI or a run), the only allowed edit is the owner's rule for such pins:
> it gains the `staffNotices` key and no existing value changes, in a separate commit whose message
> begins `Changed test checks (A798 slice 4):` and names the `file:line`, and the pull request
> names it. Any other assertion that turns out to need changing is a STOP: report it, do not edit
> it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `4cc2854e8` (2026-10-22), which is this branch's
> base (`feat/a798-4-staff-notice-seat`, worktree `waitron-feat-a798-4-staff-notice-seat`). Every
> claim about how the box or the store behaves today cites a probe in "Measured for this plan",
> run that day on macOS, Node v26.11.1, `node:sqlite`, in throwaway worktrees of `4cc2854e8`
> (since removed). Where each probe's source and log are kept is said beside it: the planner's
> under `~/waitron-campaign-b/a798-4-plan-probe/`, the round-1 review's and the claim check's under
> `~/waitron-campaign-b/a798-4-plan-review/`. A claim marked **(read)** comes from reading code,
> not from running it.
>
> **Revision 2 (2026-10-22)** folds in the round-1 review (`a798-4-plan-review/round1.md`, 0
> Critical, 2 Important, 6 Minor) and the claim check (`a798-4-plan-review/claim-check.md`, 0
> Critical, 1 Important, 9 Minor), every finding applied as the coordinator ruled.

**Words used in this plan.**
- A **staff notice** is one line the design shows on every till and handheld (design §4.2, the
  "strip"): a code the till words in its own language files, a severity, and parameters.
- The **seat** is a field on a module's descriptor (`WaitronModule`,
  `packages/module/src/module.ts:1539`) that the server reads to let the module take part in
  something. This slice adds `staffNotices`, beside `alerts` (`:1585-1588`).
- A **source** is one check a module puts in the seat; the server asks it for its notices.
- The **owner** of a source is the module whose seat holds it (or, from slice 6, the server for a
  source the server builds itself).
- The **reader** is the server function that asks every source given to it, each in its own
  savepoint, and gathers the answers.
- A **reading** is one reading of the box's clock in the venue's offset, the
  `{ instant, offsetMinutes }` part of `TrustedReading` (`packages/fiscal/src/clock.ts:26-28`).
- The **minimum date** is 28-10-2024, the earliest FechaExpedicionFactura `@waitron/verifactu`
  accepts (its `FECHA_EXPEDICION_BEFORE_MINIMUM`; `packages/fiscal-verifactu/src/errors.ts:351-354`).
  Slice 3 made it the Veri\*Factu module's rule (`packages/fiscal-verifactu/src/first-issue-date.ts:5-20`).

**Goal:** a module can supply notices for staff, the server can gather them from every module it
is given without one failing check taking the rest down, and the Veri\*Factu module supplies its
first one — the clock before the minimum date — so that slice 6 (the strip, on the equipment read)
has a seat, a reader and a real contributor to call. Whether slice 7's Box status page reads the
staff notices at all is for slice 7's plan to decide (Departure 1).

**Architecture:** three pieces.
1. `@waitron/module` gains the seat's types in a new `src/staff-notices.ts` — `StaffNotice`
   (`key`, `code`, `severity`, `params`), `StaffNoticeSeverity`, `StaffNoticeContext` (`tx`,
   `reading`) and `StaffNoticeSource` (`read(ctx)`) — and `WaitronModule.staffNotices?: readonly
   StaffNoticeSource[]`. Types only.
2. `@waitron/fiscal-verifactu` exports `FISCAL_STAFF_NOTICES`, one source that answers a
   `clock.unusable` notice, severity `error`, params `{ clockAt, offsetMinutes }`, when the reading's
   date in its own offset is before the minimum date, and nothing otherwise. It judges the date with
   the same predicate slice 3's refusal uses, extracted as `isBeforeFirstIssueDate`.
   `@waitron/composition` puts it on the `fiscal-verifactu` descriptor.
3. `apps/server` gains `enabledStaffNoticeSources(modules)` (`src/modules.ts`), which names each
   source by its owning module, and `readStaffNotices(tx, sources, { reading, log })`
   (`src/staff-notices.ts`), which asks each source in turn inside its own savepoint on the
   caller's transaction, stamps each notice with its source's `owner`, orders the answers by
   severity, and reports a failed source by its owner in `unavailable` after logging it. Nothing in
   production calls the reader yet: slice 6 calls it from the equipment read (decision 8).

**Tech stack:** TypeScript, `node:sqlite` behind drizzle (`packages/store`), Vitest 4.1.11.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §5 (the seat), §4.2 (the strip and its notices), §4.3 (the Box status page), §4.4
(printers), §4.5 item 1 (before the minimum date the module supplies the red notice), §8 slice 4.
Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1
(slice 4: cross-package contract, FULL review path, no migration, lands itself; slices 6 and 7
depend on it). Backlog: A798-B (`docs/backlog.md:5467-5485`).

---

## Measured for this plan

Every Vitest run below read its `Tests` count. Runs that print a passing test's console output were
made with `env -u AI_AGENT -u CLAUDECODE` and `--silent=false` (CLAUDE.md §4). The planner's
throwaway worktrees were made with `git worktree add --detach …` at `4cc2854e8` and
`pnpm install --frozen-lockfile --offline` (`Done in 12s`, `a798-4-plan-probe/install.log`), and
removed with `git worktree remove --force` after their probes. M1, M2 A–D, M3's three-file run,
M5 and M6 were read from the terminal; their logs were not kept. The claim check re-ran M1, M3, M5
and M6; where it kept a source or a log, it is named beside the result.

- **M1 — today's alert registry tests, as a baseline.**
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts` → `Tests 20 passed (20)`. The
  claim check re-ran it with `src/modules.test.ts`: `Tests 25 passed (25)`.
- **M2 — what a savepoint does for a source that fails, on this store.**
  - **A–D** (source `a798-4-plan-probe/scripts/savepoint-probe.test.ts`, copied to
    `apps/server/src/zz-savepoint-probe.test.ts` in a throwaway worktree; `useVenueDb` with
    `migrationOptionsFor(manifestSets(), null)`, each case inside one `withTransaction`; a scratch
    table `probe_rows`). Run:
    `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/zz-savepoint-probe.test.ts --reporter=verbose --silent=false`
    → `Tests 4 passed (4)`. Cases A–C only log; they assert nothing, so the pass records no result
    by itself; the printed lines are the result.
    - A: a source that inserts one row and then throws, called inside `tx.transaction(() => …)`,
      caught by the caller; then a count on the same `tx` → `A {"caught":true,"rows":0}`. A alone
      cannot tell "only the source's write was undone" from "the whole transaction was rolled
      back": nothing was written outside the savepoint. E below tells them apart.
    - B: the same source called with no savepoint → `B {"caught":true,"rows":1}`. Failing case for
      "the savepoint is what removes a failed source's writes": `rows 0` here too. It printed 1.
    - C: with no savepoint, `select * from no_such_table` caught, then `select 1` on the same `tx` →
      `C {"caught":true,"after":1}`. **A failed query alone leaves the transaction usable**, as
      CLAUDE.md §3 says of a refused statement; so a test whose failing source only fails a query
      cannot tell whether the savepoint is there.
    - D: a source that throws before returning a promise, inside `tx.transaction(() => { throw … })`
      → `D {"caught":true,"after":1}`: the caller's `try` catches it and the transaction reads on.
  - **E–G, the caller writes first** (the claim check's probe,
    `a798-4-plan-review/claim-check/scripts/zz-claimcheck-savepoint.test.ts`; re-run by the
    planner unchanged in a fresh throwaway worktree, source copied to
    `a798-4-plan-probe/scripts/caller-writes-first.test.ts`, log `a798-4-plan-probe/m2e-rerun.log`).
    Run: `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/zz-claimcheck-savepoint.test.ts --silent=false`
    → `Tests 3 passed (3)`; these cases assert.
    - E: the caller writes row 1; a savepoint writes row 2 and throws, caught; a second savepoint
      writes row 3 → `E {"inside":[1,3],"after":[1,3]}`, inside the transaction and in a fresh one
      after the commit. Failing case for "the savepoint undoes only the failed source's write": a
      rollback of the whole transaction would print `[]` or `[3]`.
    - F: a throw before any promise inside `tx.transaction`, then a write → `F {"after":[7]}`.
    - G (control): the same failing write with no savepoint survives to commit → `G {"after":[2]}`.
- **M3 — today's alert registry savepoint has no test that fails without it.** In a throwaway
  worktree, `apps/server/src/alerts.ts:127` changed from
  `await tx.transaction(() => source.read({ tx, now: deps.now }))` to
  `await source.read({ tx, now: deps.now })`, then
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts src/alerts.brake-probe.test.ts`
  → `Test Files 3 passed (3)`, `Tests 43 passed (43)`; the file restored with `git checkout`. The
  round-1 review re-ran it (`a798-4-plan-review/probe-m3.log`, 43 passed). The claim check ran the
  same change over every test file that reaches `readOpenAlerts` or `/management-api/alerts`
  (`alerts`, `alerts-api`, `alerts.brake-probe`, `boot.backup-network`, `boot.clock-alert`,
  `boot.clock-wiring`, `boot.invoice-alert`, `boot.restore`, `boot`) → `Test Files 9 passed (9)`,
  `Tests 132 passed (132)` (`a798-4-plan-review/claim-check/m3-mutated.log`), with a control: also
  removing the line that pushes found alerts makes `alerts.test.ts` fail. `alerts.test.ts` has two
  failing-source cases: one fails a query (`:337-391`), the other throws before returning a promise
  (`:392-421`); neither writes, so nothing is left for the savepoint to undo (M2 C, D). This
  slice's reader is tested with a source that WRITES and then throws, beside a caller that wrote
  first (Task 3 case 2), the shape M2 B and E tell apart; the alerts gap is a backlog entry (Task 4).
- **M4 — no test run or searched pins a module descriptor's whole shape.** In a throwaway
  worktree, `WaitronModule` gained `readonly staffNotices?: readonly { read(): Promise<readonly unknown[]> }[];`
  after `alerts` and the `fiscal-verifactu` descriptor gained
  `staffNotices: [{ read: () => Promise.resolve([]) }],` after `alerts: FISCAL_ALERTS,`. Then (logs
  `a798-4-plan-probe/m4-*.log`):
  - `pnpm --filter @waitron/module --filter @waitron/composition --filter @waitron/server typecheck`
    → exit 0 (`m4-typecheck.log`).
  - `pnpm --filter @waitron/composition --filter @waitron/module test` → module
    `Tests 172 passed (172)`, composition `Tests 123 passed (123)`, exit 0 (`m4-pkg-tests.log`).
  - `pnpm --filter @waitron/server exec vitest run src/modules.test.ts` → `Tests 5 passed (5)`
    (`m4-server-modules.log`).
  - From the root, `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/alert-codes.test.ts scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts`
    → `Test Files 7 passed (7)`, `Tests 5439 passed (5439)`, exit 0 (`m4-root.log`).
  - Control, so the runs above could have seen the key: a throwaway case in
    `packages/composition/src` asserting `Object.keys(fiscal-verifactu descriptor)` contains
    `"staffNotices"` → `Tests 1 passed (1)` (read from the terminal).
  - The claim check, with the same stand-in key (`a798-4-plan-review/claim-check/m4-standin.patch`):
    `@waitron/dashboard-modules` → `Tests 13 passed (13)`; `@waitron/provisioning` →
    `Tests 7 failed | 1464 passed (1471)` (`m4-extra.log`), and the same 7 fail with the key removed
    (`m4-extra-control.log`, `Tests 7 failed | 10 passed (17)` over the three failing files): the
    claim check traced them to a line this agent environment injects on a child process's stderr,
    not to the change.
  - `apps/server`'s suite was not run with the key. A text search over `packages`, `apps` and
    `scripts` for whole-list comparisons and snapshots (the claim check's) found only name-list pins
    (`backup-verification-target.test.ts:216`, `:381`, which compare `.map((m) => m.name)`), no
    `__snapshots__` directory, and no code that enumerates a descriptor's keys.
- **M5 — the minimum date is judged in the reading's own offset** (a throwaway case in
  `packages/fiscal-verifactu/src` calling today's `refuseBeforeFirstIssueDate`;
  `Tests 1 passed (1)`):
  `2024-10-27T23:30:00.000Z +60 -> ok`, `2024-10-27T23:30:00.000Z +0 -> clock.unusable`,
  `2024-10-27T22:59:59.999Z +60 -> clock.unusable`, `2024-10-27T23:00:00.000Z +60 -> ok`,
  `2001-01-01T11:00:00.000Z +60 -> clock.unusable`, `2026-10-22T10:00:00.000Z +120 -> ok`.
  `2024-10-27T23:30Z` at +60 is a reading that separates "in its own offset" (ok) from "in UTC"
  (refused); its +0 twin shows that the offset, not the instant, decides. Task 1 uses both. The
  claim check re-ran these readings plus `2024-10-28T00:00Z −60` (refused) under the process time
  zones `UTC`, `Pacific/Kiritimati` and `America/Los_Angeles`, with the same answers each time
  (source `a798-4-plan-review/claim-check/scripts/zz-cc-m5.test.ts`).
- **M6 — the real composition's enabled sets** (a throwaway case in `apps/server/src` calling
  `enabledModules(ALL_MODULES, parseModuleOverrides(o, ALL_MODULES))`; `Tests 1 passed (1)`):
  `{"fiscal-none":false}` → the fiscal modules enabled are `fiscal-verifactu`, 14 modules in all;
  `{"fiscal-verifactu":false}` → `fiscal-none`, 14 in all. Task 3's real-composition case uses both.
  The claim check reproduced it (source `a798-4-plan-review/claim-check/scripts/zz-cc-m6.test.ts`).
- **M7 — text searches** (each run at `4cc2854e8` in this worktree):
  - `grep -rln 'staffNotices\|StaffNotice\|staff_notice' packages apps scripts --include='*.ts' --include='*.mjs'`
    printed nothing: every name this slice adds is new.
  - `grep -rln 'floorAnnotations\|tableRemoval\|timeRecordExport\|contentTranslations' docs --include='*.md'`
    outside `docs/superpowers` printed only `docs/backlog.md`. `grep -n seat docs/developers/conventions-data.md`
    finds the `vocabulary` seat (`:139`), the `provisioning` and `fiscal` seats (`:161`), an open
    example list of seats ending in "…" (`:272`), the `classification` seat (`:1321`), each
    module's `TableRemoval` seat (`:1914`) and the fiscal seat's `assertRecordableAt` (`:2491`),
    besides uses of "seat" for a table's seats. No developer doc keeps a full list of the
    descriptor's seats, so none needs a new line for this one (decision 13).
  - Stryker configs exist only in `packages/ui`, `packages/ui-core`, `packages/fiscal`,
    `packages/shared` and `packages/db` (`find packages apps -maxdepth 2 -name 'stryker*'`); this
    slice edits none of those packages, so no mutation floor applies to it.
- **M8 — what the reader's tests catch** (the round-1 review built Tasks 1–3 as revision 1 specified
  them, with a reader an environment variable switches between the right version and wrong ones;
  sources `a798-4-plan-review/probe-src/server-staff-notices.probe.ts` and
  `server-staff-notices.probe.test.ts`, log `a798-4-plan-review/probe-reader.log`):
  - Right version → `Tests 6 passed (6)`.
  - Severity then key (what the alert registry's `compareOpen`, `apps/server/src/alerts.ts:84-95`,
    which sorts by severity, then `since`, then key, reduces to when no notice carries a `since`): only
    the review's case "1c source order beats key order" failed —
    `expected [ 'a-error', 'm-error', 'z-error' ] to deeply equal [ 'z-error', 'm-error', 'a-error' ]`.
    Revision 1's case 1, whose keys sort the same way as its sources, passed. Task 3 now carries
    case 1c.
  - `Promise.all` (with savepoints): the review's case "1b order with a query between in and out",
    whose sources await a query and a 5 ms timer between entry and exit, failed with
    `expected [ 'p in', 'q in', 'p out', 'q out' ] to deeply equal [ 'p in', 'p out', 'q in', 'q out' ]`;
    revision 1's case 1, with no await between entry and exit, did not fail on its order (it failed
    only because Q's savepoint was already gone when Q finished — releasing P's savepoint, opened
    first, released Q's nested one: `no such savepoint: wt_sp_2`, as the round-3 check logged under
    this deletion (`a798-4-plan-review/round3.md`, m2) — so Q was listed in `unavailable`; under
    `Promise.all` without savepoints it passed). Task 3's case 1 now awaits both.
  - No savepoint: only case 2 failed, on the incident count.

---

## Departures from the design

1. **The Box status page's row is not in this seat.** Design §5 describes the chosen shape as "a
   `staffNotices` seat beside `alerts`, returning notices (code, tone, parameters) on each ask,
   plus a row for the Box status page", and §8 item 4 is "The module seat of §5". This slice builds
   the notices and not the row. Why: nothing reads a row until slice 7 builds the page, and the
   row's fields — the Hacienda row's unsent count, its last accepted record and the route behind
   **Reintentar ahora** (design §4.3, picture 4) — are for slice 7 and slice 7b to settle. Slice 7
   adds the row as an optional member of this seat or a seat of its own; either is added without
   breaking a source. Task 4 records this in the backlog so slice 7's plan picks it up.

## Decisions this plan makes that the spec does not

1. **A `staffNotices` seat beside `alerts`, not an audience on the alerts seat** — design §5's
   preference, chosen on four facts. (a) The bell asks a source only when the session holds its
   `permission` (`apps/server/src/alerts.ts:122`), a management-session notion; the equipment read
   slice 6 extends is device-guarded and holds no permission set (`apps/server/src/device-api.ts:382-389`,
   `requireDevice`) **(read)**. (b) The two audiences see the same condition at different times:
   the manager's `fiscal.submission_delayed` starts at 4 hours
   (`packages/fiscal-verifactu/src/submission-alerts.ts:12`, `:37`), the staff's unsent count at the
   first failed send (design §4.2); one alert with an audience flag cannot carry two thresholds.
   (c) An alert code needs English and Spanish dashboard wording: a recorded one under CLAUDE.md §3
   (`scripts/alert-codes.test.ts`), an ongoing one under `scripts/ongoing-alert-codes.test.ts`,
   which reads only its listed files; a staff notice is worded only by the till. (d) The clock
   notice needs the reading's offset, which `AlertReadContext` (`packages/module/src/alerts.ts:28-31`,
   `{ tx, now }`) does not carry. The seat is an array, `readonly StaffNoticeSource[]`, as
   `changes` and `permissions` are on the same descriptor.
2. **What a notice carries: `key`, `code`, `severity`, `params` — never words.** `key` is unique
   among every notice its owner's sources answer (a module's, or, from slice 6, the server's;
   design §4.2's printer notice names one printer, so a source may answer several); `code` is a
   dotted code the till words; `params` are what the words need. Once the reader has merged every
   source's answers, a notice is identified by its `owner` and `key` together: the reader stamps
   `owner` on each notice it returns (decision 7), since two owners may answer the same `key`. The
   reader enforces the rule rather than trusting it: a notice whose `owner` and `key` are already in
   the list is dropped, the first (in source order) kept, and `staff_notice.duplicate_key` logged at
   `error` with `{ owner, key }` (Task 3 case 6). The design's "tone" is this `severity`, with the alerts' three
   values: `error` is the design's red, `warning` amber, `notice` blue. The pairing follows design
   §4.3, where each strip condition's alert has that severity (`storage.disk_full` error and red;
   `storage.space_low` warning and amber), and `AlertSeverity`'s own definition of `notice`, "news,
   not a fault" (`packages/module/src/alerts.ts:3`), which fits the design's only blue notice, the
   unsent count that "Se reintenta solo" (design §4.2). It is its own type, `StaffNoticeSeverity`,
   with the same three literals, so the two can part later without touching alert sources; the
   reader ranks it with its own table (decision 6). No `since` field: of design §4.2's six notices
   only the printer's carries a time ("desde 21:16"), as words, so it is a parameter. A field added
   later is optional and breaks no source.
3. **What a source is given: `{ tx, reading }`, one reading per ask.** `reading` has the shape
   `FiscalBackend.assertRecordableAt` takes (`packages/fiscal/src/backend.ts:197`). Every source in
   one ask judges the same instant. The facts slice 6's unsent count needs and the module does not
   hold — whether the drain was skipped for a missing certificate (`AwaitingCertStatus`,
   `apps/server/src/pass.ts:56-58`) and whether this box files at all (`fiscalDrainEnabled`,
   `apps/server/src/onboarding-policy.ts:12-16`) — are added by slice 6 as new fields the host
   fills; a source that does not read a field is not broken by its arrival. The context names no
   device, while design §4.4 shows a receipt printer's notice only on the devices whose receipts go
   to it; slice 6 meets that either by adding an optional `deviceId` to the context or by a
   server-owned source built for each request, which already knows the device (decision 7).
4. **The reader never opens a transaction.** `readStaffNotices` takes the caller's `tx` (the
   route opens one with `withTransaction`, `packages/db/src/tenancy.ts:30-42`, as the alerts route
   does, `apps/server/src/alerts-api.ts:44`), asks each source in turn in a `for … of` loop, never
   `Promise.all` (CLAUDE.md §3), each inside `tx.transaction(() => source.read({ tx, reading }))` —
   the alert registry's shape (`apps/server/src/alerts.ts:124-127`) — so a source that writes and
   then fails keeps nothing, while what the caller wrote before and what later sources write stay
   (M2 A, B and E).
5. **A failed source yields no notice, is logged, and is reported by owner.** The reader logs
   `staff_notice.source_unavailable` at `error` with `{ owner, errorCode }` (as
   `apps/server/src/alerts.ts:130-133` logs its own), drops that source's answer, and lists its
   owner once in `unavailable`. Unlike the bell (`alerts.ts:136-144`) it adds no synthetic notice:
   design §4.2 gives a failed check no staff wording and staff can do nothing about it. What a
   device shows for `unavailable`, and whether that log line is limited once the reader runs on
   every device's 15-second read, are for slice 6 to decide; Task 4 records both as an open entry.
6. **Order: severity first (`error`, `warning`, `notice`), then the order of the sources as given,
   then each source's own order.** The reader ranks with its own table,
   `{ error: 0, warning: 1, notice: 2 } as const satisfies Record<StaffNoticeSeverity, number>`,
   and a stable sort; it does not reuse the alert registry's `SEVERITY_RANK`, so `alerts.ts` is not
   touched and the two severity types stay apart (decision 2). It must not break ties by key, as
   the alert registry's `compareOpen` does after `since` (`apps/server/src/alerts.ts:84-95`): design §4.2's "two reds at once:
   the disk's shows first" is met only by source order, if slice 6 passes the core's sources before
   the modules', and the likely keys (`storage.disk_full`, `clock.unusable`) sort the other way
   (M8; Task 3 case 1c). Design §4.2's other rule — before the minimum date, the clock's own notice
   instead of the behind-the-last-sale one — is between two notices of the Veri\*Factu module, so
   slice 8 keeps it inside that module's source, not in the reader.
7. **Each source and each notice is named by its owner.** `enabledStaffNoticeSources(modules)`
   returns `{ owner: module.name, source }` for every source of every module given, and the reader
   returns each notice with that `owner` added. Slice 6 can pass sources the server owns under its
   own owner name, as boot already mixes server-owned alert sources with the modules'
   (`apps/server/src/boot.ts:2173`).
8. **No production caller in this slice; the contributor is reached by tests through the real
   composition.** The first caller is slice 6 (the equipment read), which depends on this slice
   (build plan Part 1). Putting the equipment read here would take slice 6's till↔box contract and
   the cost of asking every module on every device's 15-second poll into this slice, against §8
   item 4. Boot is not wired either: it would build something nothing reads. What keeps the
   contract from being designed in a vacuum: Task 3's real-composition case asks the real
   `ALL_MODULES` enabled set, over a real migrated database, through the reader slice 6 will call,
   with both fiscal choices (M6).
9. **The slice's one contributor is Veri\*Factu's clock-before-the-minimum-date notice, not the
   unsent count.** Design §4.2 and §4.5 item 1 name it as the module's to supply through the seat.
   It needs no table read and no new code (slice 3 registered `clock.unusable`,
   `packages/fiscal-verifactu/src/errors.ts:357`), and it reuses slice 3's rule. The unsent count,
   the brief's example, stays in slice 6: the build plan gives slice 6 the risk "fiscal invariants
   (reads the outbox)" and "reads the unsent count through the seat"; its start rule needs the two
   host facts of decision 3; and it needs a new code whose till words slice 6 writes. The
   behind-the-last-sale notice is slice 8's.
10. **The notice's params equal the refusal's.** For the same reading, the notice carries exactly
    the `{ clockAt, offsetMinutes }` that `refuseBeforeFirstIssueDate` throws, so "one code for the
    refusal and the alert" (design §4.8 a, about `clock.behind_chain`, and §4.6 for
    `storage.disk_full`) holds for the notice too. Task 1 pins the equality.
11. **The minimum-date predicate is extracted, not copied.** `first-issue-date.ts` gains
    `isBeforeFirstIssueDate(reading): boolean`; `refuseBeforeFirstIssueDate` calls it and throws
    exactly as today. Its existing tests pass unedited.
12. **No new error code.** `staff_notice.source_unavailable` is a log event, a plain name, never
    on the wire. (`alert.source_unavailable` is registered, `apps/server/src/errors.ts:1290`,
    because the bell sends it to the dashboard, which words it.)
13. **No developer doc changes for the seat** (M7: no doc keeps a full list of the descriptor's
    seats). The seat's doc comment on `WaitronModule` is its documentation, as `alerts`' is.
14. **Lands itself**, as the build plan's row 4 says. It changes no invoice, record, chain link,
    series, number or filing; the one fiscal-module change reads a clock reading and a constant.
    Checked in Task 3, Step 6.
15. **The alert registry's untested savepoint (M3) is not fixed here.** It is outside §8 item 4;
    Task 4 adds it to the backlog under "Alerts, logging and diagnostics".

## Behaviour this slice removes

None. No production path calls the new reader (decision 8), so what every route answers and every
device and dashboard shows is unchanged. The one changed existing function,
`refuseBeforeFirstIssueDate`, throws for the same readings with the same params (decision 11;
Task 1 runs its tests unedited).

---

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths.
- **No migration.** No change to `packages/fiscal-verifactu/src/chain.ts`, `backend.ts`, `drain.ts`,
  any record builder, `packages/core/src`, invoice series or numbering, or filing.
- **`apps/server/src/alerts.ts` is not edited** (decision 6).
- **Transaction discipline** (CLAUDE.md §3): the reader takes the caller's `tx` and never opens its
  own; sources are awaited in turn, never `Promise.all`; each source runs inside its own savepoint.
- General code is English only (CLAUDE.md §3). This slice adds no staff or manager wording
  anywhere: the till's words for notices are slice 6's.
- `scripts/module-seams.test.ts`: no file under `apps/server/src` may import
  `@waitron/fiscal-verifactu` or `@waitron/verifactu`; the server reaches the module only through
  `ALL_MODULES` (`apps/server/src/modules.ts:1`). Never grow `DEFERRED_RUNTIME_PASS`
  (`scripts/module-seams.test.ts:28`, empty).
- Coverage stays at 98/98/98/95 in `packages/module`, `packages/fiscal-verifactu`,
  `packages/composition` and `apps/server`. No exclude, no ignore comment.
- Database tests use `useVenueDb` (CLAUDE.md §4). A rejected or failed path asserts what it
  reports (the owner in `unavailable`, the log line's fields), never only that something threw.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`. Read the `Tests` count every time;
  a run with no count proved nothing. Vitest hides a passing test's console output under this agent;
  unset `AI_AGENT` and `CLAUDECODE` to see it. Every task runs `pnpm exec prettier --check` on the
  files it touched before committing. CI runs the package suites and coverage.

## Review focus

1. **Isolation.** A source that writes and then throws keeps nothing in the caller's transaction,
   while what the caller wrote before the read and what a later source writes both survive the
   commit; the sources after it are still asked; a source that throws before returning a promise is
   handled the same way; a module with two failing sources is listed once; each failure is logged
   with its owner and code (Task 3). Deleting the savepoint, and separately the `catch`, fails
   named cases (Task 3, Step 5).
2. **Order.** Errors, then warnings, then notices; within a severity, sources in the order given
   and each source's own order, never key or owner order; sources asked one after another, each
   finished before the next starts. Swapping in a severity-then-key sort, and separately
   `Promise.all`, fails named cases (Task 3, Step 5).
3. **The contract slice 6 builds on** (cross-package: `@waitron/module` ↔
   `@waitron/fiscal-verifactu` ↔ `@waitron/composition` ↔ `apps/server`). The notice carries no
   words; the context carries `tx` and one reading; each merged notice carries its owner, and
   `owner` + `key` is unique in the reader's answer (case 6); adding a
   context field or an optional notice field later breaks no source (decisions 2, 3, 7). Check the
   types against design §4.2's six notices: each fits `code` + `severity` + `params`; and against
   who sees each — every device alike, except the receipt printer's (§4.4), which decision 3 says
   how slice 6 meets.
4. **The contributor.** Before the minimum date in the reading's own offset, one `clock.unusable`
   notice, `error`, with exactly the refusal's params; on or after it, none; the
   `2024-10-27T23:30Z` reading at +60 and its +0 twin (M5) tell "own offset" from UTC (Task 1). It
   reaches the server only through `ALL_MODULES`, and only when `fiscal-verifactu` is enabled
   (Task 3's real-composition case, both fiscal choices).
5. **Nothing fiscal moves.** `git diff main --stat -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/drain.ts packages/core/src`
   prints nothing; `first-issue-date.test.ts` is unedited and passes (Tasks 1 and 3).

---

### Task 1: The seat's types, and Veri\*Factu's clock notice

**Files:**
- Create: `packages/module/src/staff-notices.ts`
- Modify: `packages/module/src/module.ts` (`WaitronModule`, after `alerts` at `:1585-1588`; one
  type import)
- Modify: `packages/module/src/index.ts` (beside the alerts type exports at `:75-83`)
- Modify: `packages/fiscal-verifactu/src/first-issue-date.ts` (`:9-20`)
- Create: `packages/fiscal-verifactu/src/staff-notices.ts`
- Create: `packages/fiscal-verifactu/src/staff-notices.test.ts`
- Modify: `packages/fiscal-verifactu/src/index.ts` (beside `FISCAL_ALERTS`, `:3`)

**Interfaces:**
- Produces, in `packages/module/src/staff-notices.ts` (exported from the package's `index.ts` as
  types):
  ```ts
  import type { Transaction } from "@waitron/db";
  import type { TrustedReading } from "@waitron/fiscal";

  /** `error` is the strip's red, `warning` its amber, `notice` its blue (A798 design §4.2). */
  export type StaffNoticeSeverity = "error" | "warning" | "notice";

  /** One notice for the staff on a device that sells. It carries no words: the till words `code`
   * with `params` in its own language files. `key` is unique among the notices answered by all
   * the sources one owner gives. */
  export interface StaffNotice {
    readonly key: string;
    readonly code: string;
    readonly severity: StaffNoticeSeverity;
    readonly params: Readonly<Record<string, unknown>>;
  }

  export interface StaffNoticeContext {
    readonly tx: Transaction;
    /** One reading of the box's clock for the whole ask, so every source judges the same instant. */
    readonly reading: Pick<TrustedReading, "instant" | "offsetMinutes">;
  }

  /** A check asked on each read of the notices. */
  export interface StaffNoticeSource {
    read(ctx: StaffNoticeContext): Promise<readonly StaffNotice[]>;
  }
  ```
  (`@waitron/module` already depends on `@waitron/db` and `@waitron/fiscal`,
  `packages/module/package.json:15-16`.)
- Produces, on `WaitronModule`:
  ```ts
  /** Checks whose notices the staff see on every device that sells. Read only from enabled
   * modules, since a disabled module's tables are not migrated. */
  readonly staffNotices?: readonly StaffNoticeSource[];
  ```
  ("A disabled module's tables are not migrated": `apps/server/src/boot.ts:916-920`, which
  migrates only the enabled set in trading mode.)
- Produces, in `first-issue-date.ts`: `export function isBeforeFirstIssueDate(reading: { instant:
  Date; offsetMinutes: number }): boolean` — the comparison now inside `refuseBeforeFirstIssueDate`
  (`:13-14`), moved; `refuseBeforeFirstIssueDate` becomes `if (isBeforeFirstIssueDate(reading))
  throw new AppError("clock.unusable", { … })` with the params unchanged.
- Produces, in `packages/fiscal-verifactu/src/staff-notices.ts`:
  ```ts
  /** The clock notice for one reading: a `clock.unusable` notice before the first issue date
   * `@waitron/verifactu` accepts, judged in the reading's own offset; nothing on or after it. */
  export function clockNotices(reading: { instant: Date; offsetMinutes: number }): StaffNotice[];
  export const FISCAL_STAFF_NOTICES: readonly StaffNoticeSource[]; // one source: ({ reading }) => clockNotices(reading)
  ```
  The notice: `{ key: "clock.unusable", code: "clock.unusable", severity: "error", params: {
  clockAt: reading.instant.toISOString(), offsetMinutes: reading.offsetMinutes } }`.

- [ ] **Step 1: Write the failing tests** in `packages/fiscal-verifactu/src/staff-notices.test.ts`.
  - `describe("clockNotices")`, `it.each` over M5's six readings with the expected answer: the
    three refused readings (`2024-10-27T23:30:00.000Z` offset 0, `2024-10-27T22:59:59.999Z` +60,
    `2001-01-01T11:00:00.000Z` +60) give exactly
    `[{ key: "clock.unusable", code: "clock.unusable", severity: "error", params: { clockAt: <the instant's ISO string>, offsetMinutes: <the offset> } }]`
    (`toEqual`, the whole array); the three others (`2024-10-27T23:30:00.000Z` +60,
    `2024-10-27T23:00:00.000Z` +60, `2026-10-22T10:00:00.000Z` +120) give `[]`.
  - `"carries the refusal's own params"`: for the 2001 reading, catch what
    `refuseBeforeFirstIssueDate` throws and
    `expect(clockNotices(reading)[0]!.params).toEqual(caught.params)`.
  - `"the seat's source answers through a transaction"`: `useVenueDb({ migrations: TEST_MIGRATIONS })`
    as `packages/fiscal-verifactu/src/submission-alerts.test.ts:4-9` does; inside
    `withTransaction(suite.db, (tx) => FISCAL_STAFF_NOTICES[0]!.read({ tx, reading }))`, the 2001
    reading answers the one notice and the 2026 reading `[]`; and `FISCAL_STAFF_NOTICES` has length 1.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/staff-notices.test.ts`.
  Expected: FAILS to resolve `./staff-notices.js`.
- [ ] **Step 3: Implement** the module types, the `WaitronModule` member, the index exports, the
  predicate extraction, `staff-notices.ts` and its index export.
- [ ] **Step 4: Run and watch it pass; run the slice-3 rule's tests unedited; typecheck; format.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/staff-notices.test.ts src/first-issue-date.test.ts`
  → PASS, with a `Tests` count that includes the new cases; then
  `git diff --stat main -- packages/fiscal-verifactu/src/first-issue-date.test.ts` prints nothing.
  Then `pnpm --filter @waitron/module --filter @waitron/fiscal-verifactu typecheck` exits 0. Then
  `pnpm exec prettier --check packages/module/src/staff-notices.ts packages/module/src/module.ts packages/module/src/index.ts packages/fiscal-verifactu/src/first-issue-date.ts packages/fiscal-verifactu/src/staff-notices.ts packages/fiscal-verifactu/src/staff-notices.test.ts packages/fiscal-verifactu/src/index.ts`
  exits 0.
- [ ] **Step 5: Proof by deletion.** In `isBeforeFirstIssueDate`, pass `0` instead of
  `reading.offsetMinutes` to `formatDate` (judging in UTC). Re-run Step 4's test command: the
  `2024-10-27T23:30:00.000Z` +60 case of `clockNotices` FAILS (it now answers a notice), and so do
  the matching cases of `first-issue-date.test.ts` (the round-1 review's run of this deletion:
  `Tests 7 failed | 10 passed (17)` over the two files). Restore; re-run; PASS.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/module/src/staff-notices.ts packages/module/src/module.ts packages/module/src/index.ts packages/fiscal-verifactu/src/first-issue-date.ts packages/fiscal-verifactu/src/staff-notices.ts packages/fiscal-verifactu/src/staff-notices.test.ts packages/fiscal-verifactu/src/index.ts
  git commit -s -m "A module can give staff notices, and Veri*Factu gives one for a clock before its first day"
  ```

### Task 2: The composition list puts the notices on the Veri\*Factu descriptor

**Files:**
- Modify: `packages/composition/src/modules.ts` (the `fiscal-verifactu` descriptor, `:279-304`;
  the `@waitron/fiscal-verifactu` import, `:29-42`)
- Modify: `packages/composition/src/composition.test.ts` (imports `:17-24`; a new `describe`
  after "ALL_MODULES alerts seat", `:311-321`)

- [ ] **Step 1: Write the failing test.** `describe("ALL_MODULES staff-notices seat")`:
  - `"fiscal-verifactu carries its notices, by reference"`:
    `expect(ALL_MODULES.find((m) => m.name === "fiscal-verifactu")?.staffNotices).toBe(FISCAL_STAFF_NOTICES)`.
  - `"no other module carries the seat"`:
    `expect(ALL_MODULES.filter((m) => m.staffNotices !== undefined).map((m) => m.name)).toEqual(["fiscal-verifactu"])`.
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
  Expected: the two new cases FAIL (`undefined` is not `FISCAL_STAFF_NOTICES`; `[]` is not
  `["fiscal-verifactu"]`); every other case passes.
- [ ] **Step 3: Implement.** Add `staffNotices: FISCAL_STAFF_NOTICES,` after
  `alerts: FISCAL_ALERTS,` (`modules.ts:302`) and the import.
- [ ] **Step 4: Run and watch it pass; format.** The Step 2 command → PASS, with a `Tests` count
  two higher than before. Then `pnpm --filter @waitron/composition test` (the whole package, M4 ran
  it at 123) → PASS, `pnpm --filter @waitron/composition typecheck` exits 0, and
  `pnpm exec prettier --check packages/composition/src/modules.ts packages/composition/src/composition.test.ts`
  exits 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/composition/src/modules.ts packages/composition/src/composition.test.ts
  git commit -s -m "The composition list gives the Veri*Factu module's staff notices to its descriptor"
  ```

### Task 3: The server's reader, gathered from the enabled modules, one failing source isolated

**Files:**
- Create: `apps/server/src/staff-notices.ts`
- Create: `apps/server/src/staff-notices.test.ts`
- Modify: `apps/server/src/modules.ts` (a new function beside `enabledAlertSources`, `:50-54`)
- Modify: `apps/server/src/modules.test.ts` (a new `describe` beside "alert assembly",
  `:34-50`)

**Interfaces:**
- Produces, in `apps/server/src/staff-notices.ts`:
  ```ts
  export interface OwnedStaffNoticeSource {
    readonly owner: string;
    readonly source: StaffNoticeSource;
  }
  /** A notice as the reader returns it: identified by `owner` and `key` together. */
  export interface OwnedStaffNotice extends StaffNotice {
    readonly owner: string;
  }
  export interface StaffNoticeReadDeps {
    readonly reading: StaffNoticeContext["reading"];
    readonly log: Logger;
  }
  export interface StaffNoticesRead {
    readonly notices: OwnedStaffNotice[];
    /** Owners with a source that failed, each once, in the order first met. */
    readonly unavailable: string[];
  }
  export async function readStaffNotices(
    tx: Transaction,
    sources: readonly OwnedStaffNoticeSource[],
    deps: StaffNoticeReadDeps,
  ): Promise<StaffNoticesRead>;
  ```
  Body: for each entry in turn (`for … of`), `const found = await tx.transaction(() =>
  source.read({ tx, reading: deps.reading }))`, then push each `{ ...notice, owner }`; on a throw,
  `deps.log("error", "staff_notice.source_unavailable", { owner, errorCode: codeOf(error) })` and
  add `owner` to `unavailable` if absent. A notice whose `owner` and `key` are already in the list
  is not pushed; `deps.log("error", "staff_notice.duplicate_key", { owner, key })` instead
  (decision 2). Return the notices sorted by a local rank,
  `const RANK = { error: 0, warning: 1, notice: 2 } as const satisfies Record<StaffNoticeSeverity, number>`,
  with a stable sort and no tie-break (decision 6). The savepoint's own comment, if any, says why in
  one line: a failed source's writes go with it (M2 B, E); alerts.ts's comment at `:124-126` is the
  model.
- Produces, in `apps/server/src/modules.ts`:
  ```ts
  /** Every staff-notice check of the modules given, named by its module. The caller passes the
   * enabled set: a disabled module's tables are not migrated. */
  export function enabledStaffNoticeSources(
    modules: readonly WaitronModule[],
  ): readonly OwnedStaffNoticeSource[];
  ```

- [ ] **Step 1: Write the failing tests.**
  - `apps/server/src/modules.test.ts`, `describe("staff-notice assembly")`,
    `"collects the sources of the modules it is given only, named by their module"`: a descriptor
    copied from `ALL_MODULES[0]` with `staffNotices: [a, b]` and `name: "probe"` gives
    `[{ owner: "probe", source: a }, { owner: "probe", source: b }]` (`toEqual`, sources by
    reference); `ALL_MODULES[0]` alone (core carries no notices) gives `[]`. Shape as the "alert
    assembly" cases (`modules.test.ts:34-50`).
  - `apps/server/src/staff-notices.test.ts`, with `useVenueDb({ migrations:
    migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 })` and the `seedVenue` helper
    copied from `apps/server/src/alerts.test.ts:53-70` (tenant, location, device). Incidents are
    written with `recordIncident(tx, …)` directly on the reader's transaction — not through that
    file's `raise` (`:79-93`), which opens its own transaction through `asApp`. A helper
    `n(key, severity)` builds `{ key, code: "x.y", severity, params: {} }`, as the review's probe
    does (`a798-4-plan-review/probe-src/server-staff-notices.probe.test.ts`).
    `READING = { instant: new Date("2026-10-22T10:00:00.000Z"), offsetMinutes: 120 }`. Each case
    runs inside one `withTransaction(db, …)` unless it says otherwise.
    1. `"asks every source in turn with the transaction and the one reading, and orders errors, warnings, then notices"`:
       source P (owner `"p"`) answers `n("p-notice", "notice")`, `n("p-error", "error")`; source Q
       (owner `"q"`) answers `n("q-warning", "warning")`, `n("q-error", "error")`. Each source
       pushes `"<name> in"` to a shared array, awaits `ctx.tx.execute(sql\`select 1\`)` and
       `new Promise((r) => setTimeout(r, 5))`, pushes `"<name> out"`, and returns its notices (the
       review's case 1b shape). Assert, in this order: the entry/exit array is
       `["p in", "p out", "q in", "q out"]`; the keys are
       `["p-error", "q-error", "q-warning", "p-notice"]` and the owners `["p", "q", "q", "p"]`;
       `unavailable` is `[]`; each source saw `ctx.tx` `toBe` the transaction and `ctx.reading`
       `toBe` `READING`.
    1c. `"source order beats key order and owner order within a severity"` (the review's case 1c,
       `probe-src/server-staff-notices.probe.test.ts`, with owners renamed so their alphabetical
       order also runs against source order): source one (owner `"zeta"`) answers
       `n("z-error", "error")`, `n("m-error", "error")`; source two (owner `"alpha"`) answers
       `n("a-error", "error")`. Expect keys `["z-error", "m-error", "a-error"]` — a key sort gives
       `a, m, z` and an owner sort `a, z, m`.
    2. `"a source that writes and then fails keeps nothing; the caller's earlier write and a later source's write are kept"`:
       seed the venue; then, in one transaction, the caller first records its own incident
       (`recordIncident(tx, …)`, code `"test.caller"`), then calls the reader with source W (owner
       `"w"`), which records `"test.w"` and then throws `new AppError("server.internal", {})`, and
       source H (owner `"h"`), which records `"test.h"` and answers `n("h-1", "notice")`. Codes are
       passed as `new AppError("test.caller" as never, {} as never)`, as the review's probe did.
       Expect: `notices` keys `["h-1"]`, `unavailable: ["w"]`; `(await listOpenIncidents(tx)).map((i) => i.code).sort()`
       in the same transaction is `["test.caller", "test.h"]`; the same list read in a fresh
       `withTransaction` after the first commits is `["test.caller", "test.h"]`; the log spy was
       called with `("error", "staff_notice.source_unavailable", { owner: "w", errorCode: "server.internal" })`.
       (M2 E is the probe of this shape, `[1,3]`; a rollback of the whole transaction would lose
       `"test.caller"`, and no savepoint would keep `"test.w"`, as M2 B and G show.)
    3. `"a source that throws before returning a promise is reported, and the rest are asked"`:
       `read: () => { throw new Error("sync"); }` (owner `"s"`) beside a healthy one (owner `"h"`,
       answering `n("h-1", "notice")`). Expect the healthy notice with its owner (`notices`
       `toEqual` `[{ ...n("h-1", "notice"), owner: "h" }]`), `unavailable: ["s"]`, and the log's
       `errorCode: "unknown"`
       (`codeOf`, `packages/server-kit/src/error-code.ts:7-9`).
    4. `"two failing sources of one owner list it once"`: two throwing sources, both owner `"m"`.
       Expect `unavailable: ["m"]` and the log spy called twice.
    5. `"through the real composition, the Veri*Factu module's clock notice and nothing else"`:
       `const verifactu = enabledStaffNoticeSources(enabledModules(ALL_MODULES, parseModuleOverrides({ "fiscal-none": false }, ALL_MODULES)))`
       (M6). With `{ instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 }`:
       `notices` `toEqual`
       `[{ key: "clock.unusable", code: "clock.unusable", severity: "error", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 }, owner: "fiscal-verifactu" }]`,
       `unavailable: []`. With `READING`: `{ notices: [], unavailable: [] }`. Control in the other
       direction: with `{ "fiscal-verifactu": false }` and the 2001 reading, `{ notices: [],
       unavailable: [] }` — the notice comes from the enabled Veri\*Factu module, not from the
       reader. (`ALL_MODULES` from `./modules.js`; never import `@waitron/fiscal-verifactu` here:
       test files are outside `scripts/module-seams.test.ts`, but the case is about the seat.)
    6. `"keeps the first of two notices one owner answers under the same key, and logs the second"`:
       two sources, both owner `"d"`: the first answers `{ key: "k", code: "first.code", severity:
       "warning", params: {} }`, the second `{ key: "k", code: "second.code", severity: "error",
       params: {} }`. Expect `notices` `toEqual`
       `[{ key: "k", code: "first.code", severity: "warning", params: {}, owner: "d" }]`,
       `unavailable: []`, and the log spy called with
       `("error", "staff_notice.duplicate_key", { owner: "d", key: "k" })`. The second notice's
       higher severity is the control: a check that ran after the sort would keep it instead.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/staff-notices.test.ts src/modules.test.ts`.
  Expected: `staff-notices.test.ts` FAILS to resolve `./staff-notices.js`; the new
  `modules.test.ts` case FAILS with `enabledStaffNoticeSources is not a function` (or its import
  error); the five existing `modules.test.ts` cases pass.
- [ ] **Step 3: Implement** `staff-notices.ts` and `enabledStaffNoticeSources`.
- [ ] **Step 4: Run and watch them pass; format.** The Step 2 command → PASS, with `Tests` counts
  that include every new case. Then
  `pnpm exec prettier --check apps/server/src/staff-notices.ts apps/server/src/staff-notices.test.ts apps/server/src/modules.ts apps/server/src/modules.test.ts`
  exits 0.
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS before the next:
  - Replace `await tx.transaction(() => source.read(…))` with `await source.read(…)`: case 2
    FAILS on the incident codes (`"test.w"` is kept), as M2 B and G predict; cases 1, 1c, 3, 4,
    5 and 6 still pass (the round-3 check's run of this deletion, before case 6 existed, passed 1, 1c,
    3, 4 and 5).
  - Remove the `try`/`catch` (let the error out): cases 2, 3 and 4 FAIL with the source's own
    error; cases 1, 1c, 5 and 6 pass.
  - Remove the sort: case 1 FAILS on the key order.
  - Remove the duplicate check: case 6 FAILS with two notices for `("d", "k")`.
  - Replace the sort with severity then key (`RANK[a.severity] - RANK[b.severity] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)`):
    case 1c FAILS with keys `["a-error", "m-error", "z-error"]` (M8).
  - Replace the `for … of` with `Promise.all` over the sources, keeping each source's savepoint and
    `catch`: case 1 FAILS on the entry/exit order (M8: the review's run of this shape printed
    `["p in", "q in", "p out", "q out"]`).
  - Remove `staffNotices: FISCAL_STAFF_NOTICES,` from `packages/composition/src/modules.ts`: case 5
    FAILS (the 2001 reading answers `[]`), and Task 2's two cases FAIL
    (`pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`).
- [ ] **Step 6: The guards and the fiscal check.**
  - `pnpm --filter @waitron/module --filter @waitron/fiscal-verifactu --filter @waitron/composition --filter @waitron/server typecheck`
    exits 0.
  - From the root: `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts`
    → PASS (M4 ran five of these with a stand-in key; the round-1 review ran these six and
    `module-graph-honesty` with the slice built as revision 1 specified it, `Tests 5444 passed`,
    `a798-4-plan-review/probe-guards.log`). `git diff main -- scripts/module-seams.test.ts`
    prints nothing.
  - `git diff main --stat -- apps/server/src/alerts.ts packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/drain.ts packages/core/src`
    prints nothing (decisions 6 and 14).
  - Coverage is CI's gate (CLAUDE.md §2; global rule: no package-wide coverage run just because a
    task is done). Before calling the branch green, read the coverage or merge jobs of
    `packages/module`, `packages/fiscal-verifactu`, `packages/composition` and `apps/server` on the
    pull request's current head, and check that the `changes` job selected all four. Run a
    package's `test:coverage` locally only to chase a failure CI reports.
- [ ] **Step 7: Commit.**
  ```bash
  git add apps/server/src/staff-notices.ts apps/server/src/staff-notices.test.ts apps/server/src/modules.ts apps/server/src/modules.test.ts
  git commit -s -m "The server gathers staff notices from the enabled modules, one failing check kept apart"
  ```

### Task 4: Backlog

**Files:**
- Modify: `docs/backlog.md` (the A798-B entry, `:5467-5485`; the A798-B open entries after it;
  "Alerts, logging and diagnostics", `:4976`)
- Modify, only if an entry runs past four lines: the matching file under `docs/backlog/` (read
  "How to keep this file honest", `docs/backlog.md:7331`)

- [ ] **Step 1: The A798-B entry.** Replace "slice 4 is next" with: slice 4 (a module seat for
  staff notices, with the Veri\*Factu module's notice for a clock before 28-10-2024; nothing shows
  notices yet) landed in #<this pull request>; slice 5 is next. State, not history: no test counts
  or proofs.
- [ ] **Step 2: Two open entries in A798-B's area, after the A798-B entry:**
  - "**The Box status page's rows from a module are not in the staff-notice seat.** Design §5's
    seat was to return 'plus a row for the Box status page'; slice 4 built only the notices. Slice
    7 adds the row (the Hacienda row's unsent count, last accepted record and the Reintentar ahora
    route) as an optional member of `staffNotices` or a seat of its own, and its plan decides
    whether the page reads the staff notices at all. Left open by A798-B slice 4 (#<this pull
    request>) for slice 7."
  - "**What a device shows when a module's notice check fails, and how often it is logged.**
    `readStaffNotices` (`apps/server/src/staff-notices.ts`) logs
    `staff_notice.source_unavailable` at `error` and names the module in `unavailable` on every
    read; nothing shows it. Once slice 6 runs it on every device's 15-second equipment read, a
    check that keeps failing logs that line on every read from every device, so slice 6 decides
    what a device shows and whether the line is limited or written only when a check starts or
    stops failing. Left open by A798-B slice 4 (#<this pull request>) for slice 6."
- [ ] **Step 3: One entry under "Alerts, logging and diagnostics":**
  "**The alert registry's per-source savepoint has no test that fails without it.**
  `readOpenAlerts` (`apps/server/src/alerts.ts`) asks each source inside a savepoint so a failed
  source's writes go with it, but removing the savepoint left every test file that reaches
  `readOpenAlerts` passing (nine files, 2026-10-22): their failing sources fail a query or throw
  before writing anything, so nothing is left for the savepoint to undo. A failing source that
  writes before it throws would pin it, as `apps/server/src/staff-notices.test.ts` does. Found by
  A798-B slice 4 (#<this pull request>)."
- [ ] **Step 4: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true` (docs/ is not format-checked, so `prettier --check` would prove nothing here).
  Then:
  ```bash
  git add docs/backlog.md
  git commit -s -m "Backlog: A798-B slice 4 builds the staff-notice seat; what it leaves open"
  ```
  (`docs/backlog/` too, if Step 2 or 3 moved detail there.) The pull request number is filled in
  once `/finish-branch` has opened it, in a follow-up commit on the same branch.

---

## Self-review against the spec

- §5 (a seat, `staffNotices`, beside `alerts`, returning code, tone and parameters on each ask):
  Task 1's types and member, Task 2's descriptor, Task 3's reader; "tone" is `severity`
  (decision 2); the shape was chosen on the evidence of decision 1. The "row for the Box status
  page" is not built: Departure 1, recorded for slice 7 by Task 4 Step 2.
- §4.2 ("the Veri\*Factu module supplies … the clock-before-28-10-2024 notice … through the new
  seat"; one wording each, red for the clock): Task 1's source, `clock.unusable`, `error`; its words
  and the strip are slice 6's. The unsent count and the behind-the-last-sale notice are slices 6
  and 8's (decision 9). "Two reds at once": the reader's source order serves it, and case 1c pins
  that keys do not override it (decision 6).
- §4.4 (a receipt printer's notice only on its devices): the context names no device; decision 3
  says how slice 6 meets it.
- §4.5 item 1 ("the Veri\*Factu module supplies it, since the date is its rule"): Task 1 reuses
  slice 3's predicate (decision 11).
- §5's isolation ("the alert registry already isolates a failing module's check"): the reader does
  the same, with a test that would fail without the savepoint, which the alert registry lacks (M3,
  decision 15).
- §8 slice 4's risk, cross-package contract: Review focus 3 and 4.
- Build plan Part 1, row 4 (lands itself, no migration): decision 14, Global constraints.
