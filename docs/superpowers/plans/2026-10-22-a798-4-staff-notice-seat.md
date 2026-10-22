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
> Task 1's refactor. M4 found no test that pins a module descriptor's whole shape. If one turns up
> (in CI or a run), the only allowed edit is the owner's rule for such pins: it gains the
> `staffNotices` key and no existing value changes, in a separate commit whose message begins
> `Changed test checks (A798 slice 4):` and names the `file:line`, and the pull request names it.
> Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `4cc2854e8` (2026-10-22), which is this branch's
> base (`feat/a798-4-staff-notice-seat`, worktree `waitron-feat-a798-4-staff-notice-seat`). Every
> claim about how the box or the store behaves today cites a probe in "Measured for this plan",
> run that day on macOS, Node v26.11.1, `node:sqlite`, in a throwaway worktree of `4cc2854e8` at
> `~/waitron-campaign-b/a798-4-plan-probe/wt` (since removed), with the probe sources and logs kept
> under `~/waitron-campaign-b/a798-4-plan-probe/`. A claim marked **(read)** comes from reading
> code, not from running it.

**Words used in this plan.**
- A **staff notice** is one line the design shows on every till and handheld (design §4.2, the
  "strip"): a code the till words in its own language files, a severity, and parameters.
- The **seat** is a field on a module's descriptor (`WaitronModule`,
  `packages/module/src/module.ts:1539`) that the server reads to let the module take part in
  something. This slice adds `staffNotices`, beside `alerts` (`:1585-1588`).
- A **source** is one check a module puts in the seat; the server asks it for its notices.
- The **reader** is the server function that asks every source given to it, each in its own
  savepoint, and gathers the answers.
- A **reading** is one reading of the box's clock in the venue's offset, the
  `{ instant, offsetMinutes }` part of `TrustedReading` (`packages/fiscal/src/clock.ts:26-28`).
- The **minimum date** is 28-10-2024, the first invoice date AEAT accepts; slice 3 made it the
  Veri\*Factu module's rule (`packages/fiscal-verifactu/src/first-issue-date.ts:5-20`).

**Goal:** a module can supply notices for staff, the server can gather them from every module it
is given without one failing check taking the rest down, and the Veri\*Factu module supplies its
first one — the clock before the minimum date — so that slices 6 (the strip, on the equipment read)
and 7 (the Box status page) have a seat, a reader and a real contributor to call.

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
   source by its module, and `readStaffNotices(tx, sources, { reading, log })`
   (`src/staff-notices.ts`), which asks each source in turn inside its own savepoint on the
   caller's transaction, orders the answers by severity, and reports a failed source by its owner
   in `unavailable` after logging it. Nothing in production calls the reader yet: slice 6 calls it
   from the equipment read, slice 7 from the Box status page (decision 8).

**Tech stack:** TypeScript, `node:sqlite` behind drizzle (`packages/store`), Vitest 4.1.11.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §5 (the seat), §4.2 (the strip and its notices), §4.3 (the Box status page), §4.5
item 1 (before the minimum date the module supplies the red notice), §8 slice 4. Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1
(slice 4: cross-package contract, FULL review path, no migration, lands itself; slices 6 and 7
depend on it). Backlog: A798-B (`docs/backlog.md:5467-5485`).

---

## Measured for this plan

Every Vitest run below read its `Tests` count. Runs that print a passing test's console output were
made with `env -u AI_AGENT -u CLAUDECODE` and `--silent=false` (CLAUDE.md §4). The throwaway
worktree was made with `git worktree add --detach … HEAD` at `4cc2854e8` and
`pnpm install --frozen-lockfile --offline` (`Done in 12s`), and removed with
`git worktree remove --force` after the last probe.

- **M1 — today's alert registry tests, as a baseline.**
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts` → `Tests 20 passed (20)`.
- **M2 — what a savepoint does for a source that fails, on this store**
  (`scripts/savepoint-probe.test.ts`, copied to `apps/server/src/zz-savepoint-probe.test.ts` in the
  throwaway worktree; `useVenueDb` with `migrationOptionsFor(manifestSets(), null)`, each case
  inside one `withTransaction`; a scratch table `probe_rows`). Run:
  `env -u AI_AGENT -u CLAUDECODE pnpm --filter @waitron/server exec vitest run src/zz-savepoint-probe.test.ts --reporter=verbose --silent=false`
  → `Tests 4 passed (4)`.
  - A: a source that inserts one row and then throws, called inside `tx.transaction(() => …)`,
    caught by the caller; then a count on the same `tx` → `A {"caught":true,"rows":0}`.
  - B: the same source called with no savepoint → `B {"caught":true,"rows":1}`. Failing case for
    "the savepoint is what removes a failed source's writes": `rows 0` here too, which would mean
    the probe could not tell the two apart. It printed 1.
  - C: with no savepoint, `select * from no_such_table` caught, then `select 1` on the same `tx` →
    `C {"caught":true,"after":1}`. **A failed query alone leaves the transaction usable**, as
    CLAUDE.md §3 says of a refused statement; so a test whose failing source only fails a query
    cannot tell whether the savepoint is there.
  - D: a source that throws before returning a promise, inside `tx.transaction(() => { throw … })`
    → `D {"caught":true,"after":1}`: the caller's `try` catches it and the transaction reads on.
- **M3 — today's alert registry savepoint has no test that fails without it.** In the throwaway
  worktree, `apps/server/src/alerts.ts:127` changed from
  `await tx.transaction(() => source.read({ tx, now: deps.now }))` to
  `await source.read({ tx, now: deps.now })`, then
  `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts src/alerts-api.test.ts src/alerts.brake-probe.test.ts`
  → `Test Files 3 passed (3)`, `Tests 43 passed (43)`; the file restored with `git checkout`. The
  failing-source case at `apps/server/src/alerts.test.ts:337-391` fails a query only, which M2 C
  shows leaves the transaction usable. This slice's reader is tested with a source that WRITES and
  then throws (Task 3), the shape M2 B tells apart; the alerts gap is a backlog entry (Task 4).
- **M4 — nothing pins a module descriptor's whole shape.** In the throwaway worktree,
  `WaitronModule` gained `readonly staffNotices?: readonly { read(): Promise<readonly unknown[]> }[];`
  after `alerts` and the `fiscal-verifactu` descriptor gained
  `staffNotices: [{ read: () => Promise.resolve([]) }],` after `alerts: FISCAL_ALERTS,`. Then:
  - `pnpm --filter @waitron/module --filter @waitron/composition --filter @waitron/server typecheck`
    → exit 0.
  - `pnpm --filter @waitron/composition --filter @waitron/module test` → module
    `Tests 172 passed (172)`, composition `Tests 123 passed (123)`, exit 0.
  - `pnpm --filter @waitron/server exec vitest run src/modules.test.ts` → `Tests 5 passed (5)`.
  - From the root, `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/alert-codes.test.ts scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts`
    → `Test Files 7 passed (7)`, `Tests 5439 passed (5439)`, exit 0.
  - Control, so the runs above could have seen the key: a throwaway case in
    `packages/composition/src` asserting `Object.keys(fiscal-verifactu descriptor)` contains
    `"staffNotices"` → `Tests 1 passed (1)`.
  - A text search, `grep -rn 'toEqual(ALL_MODULES\|toStrictEqual(ALL_MODULES\|toMatchSnapshot\|toMatchInlineSnapshot'`
    over `packages/provisioning/src`, `packages/composition/src`, `packages/module/src`,
    `apps/server/src/modules*.ts` and `scripts`, printed nothing. Not run: the provisioning and
    dashboard-modules suites; CI runs them.
- **M5 — the minimum date is judged in the reading's own offset** (a throwaway case in
  `packages/fiscal-verifactu/src` calling today's `refuseBeforeFirstIssueDate`;
  `Tests 1 passed (1)`):
  `2024-10-27T23:30:00.000Z +60 -> ok`, `2024-10-27T23:30:00.000Z +0 -> clock.unusable`,
  `2024-10-27T22:59:59.999Z +60 -> clock.unusable`, `2024-10-27T23:00:00.000Z +60 -> ok`,
  `2001-01-01T11:00:00.000Z +60 -> clock.unusable`, `2026-10-22T10:00:00.000Z +120 -> ok`. The
  23:30 pair is the reading that separates "in its own offset" from "in UTC"; Task 1 uses it.
- **M6 — the real composition's enabled sets** (a throwaway case in `apps/server/src` calling
  `enabledModules(ALL_MODULES, parseModuleOverrides(o, ALL_MODULES))`; `Tests 1 passed (1)`):
  `{"fiscal-none":false}` → the fiscal modules enabled are `fiscal-verifactu`, 14 modules in all;
  `{"fiscal-verifactu":false}` → `fiscal-none`, 14 in all. Task 3's real-composition case uses both.
- **M7 — text searches** (each run at `4cc2854e8` in this worktree):
  - `grep -rln 'staffNotices\|StaffNotice\|staff_notice' packages apps scripts --include='*.ts' --include='*.mjs'`
    printed nothing: every name this slice adds is new.
  - `grep -rln 'floorAnnotations\|tableRemoval\|timeRecordExport\|contentTranslations' docs --include='*.md'`
    outside `docs/superpowers` printed only `docs/backlog.md`, and `grep -rn 'seat' docs/developers/conventions-data.md`
    shows no list of the descriptor's seats (its mentions are `vocabulary`, `provisioning`,
    `fiscal`, `classification` and the fiscal seat's `assertRecordableAt`, at `:139`, `:161`,
    `:272`, `:1321`, `:2491`). So no developer doc lists seats, and none needs a new line for this
    one (decision 13).
  - Stryker configs exist only in `packages/ui`, `packages/ui-core`, `packages/fiscal`,
    `packages/shared` and `packages/db` (`find packages apps -maxdepth 2 -name 'stryker*'`); this
    slice edits none of those packages, so no mutation floor applies to it.

---

## Decisions this plan makes that the spec does not

1. **A `staffNotices` seat beside `alerts`, not an audience on the alerts seat** — design §5's
   preference, chosen on four facts. (a) The bell asks a source only when the session holds its
   `permission` (`apps/server/src/alerts.ts:122`), a management-session notion; the equipment read
   slice 6 extends is device-guarded and holds no permission set (`apps/server/src/device-api.ts:382-389`,
   `requireDevice`) **(read)**. (b) The two audiences see the same condition at different times:
   the manager's `fiscal.submission_delayed` starts at 4 hours
   (`packages/fiscal-verifactu/src/submission-alerts.ts:12`, `:37`), the staff's unsent count at the
   first failed send (design §4.2); one alert with an audience flag cannot carry two thresholds.
   (c) An alert code must have English and Spanish dashboard wording (CLAUDE.md §3, guarded by
   `scripts/alert-codes.test.ts`); a staff notice is worded only by the till. (d) The clock notice
   needs the reading's offset, which `AlertReadContext` (`packages/module/src/alerts.ts:28-31`,
   `{ tx, now }`) does not carry. The seat is an array, `readonly StaffNoticeSource[]`, as
   `changes` and `permissions` are on the same descriptor.
2. **What a notice carries: `key`, `code`, `severity`, `params` — never words.** `key` is unique
   within its source (design §4.2's printer notice names one printer, so a source may answer several); `code` is a dotted
   code the till words; `params` are what the words need. The design's "tone" is this `severity`,
   with the alerts' three values: `error` is the design's red, `warning` amber, `notice` blue.
   The pairing follows design §4.3, where each strip condition's alert has that severity
   (`storage.disk_full` error and red; `storage.space_low` warning and amber), and
   `AlertSeverity`'s own definition of `notice`, "news, not a fault"
   (`packages/module/src/alerts.ts:3`), for blue's "informs, nothing to do". It is its own type,
   `StaffNoticeSeverity`, with the same three literals, so the two can part later without touching
   alert sources. No `since` field: of design §4.2's six notices only the printer's carries a time
   ("desde 21:16"), as words, so it is a parameter. A field added later is optional and breaks no
   source.
3. **What a source is given: `{ tx, reading }`, one reading per ask.** `reading` has the shape
   `FiscalBackend.assertRecordableAt` takes (`packages/fiscal/src/backend.ts:197`). Every source in
   one ask judges the same instant. The facts slice 6's unsent count needs and the module does not
   hold — whether the drain was skipped for a missing certificate (`AwaitingCertStatus`,
   `apps/server/src/pass.ts:56-58`) and whether this box files at all (`fiscalDrainEnabled`,
   `apps/server/src/onboarding-policy.ts:12-16`) — are added by slice 6 as new fields the host
   fills; a source that does not read a field is not broken by its arrival.
4. **The reader never opens a transaction.** `readStaffNotices` takes the caller's `tx` (the
   route opens one with `withTransaction`, `packages/db/src/tenancy.ts:30-42`, as the alerts route
   does, `apps/server/src/alerts-api.ts:44`), asks each source in turn in a `for … of` loop, never
   `Promise.all` (CLAUDE.md §3), each inside `tx.transaction(() => source.read({ tx, reading }))` —
   the alert registry's shape (`apps/server/src/alerts.ts:124-127`) — so a source that writes and
   then fails keeps nothing (M2 A and B).
5. **A failed source yields no notice, is logged, and is reported by owner.** The reader logs
   `staff_notice.source_unavailable` at `error` with `{ owner, errorCode }` (as
   `apps/server/src/alerts.ts:130-133` logs its own), drops that source's answer, and lists its
   owner once in `unavailable`. Unlike the bell (`alerts.ts:136-144`) it adds no synthetic notice:
   design §4.2 gives a failed check no staff wording and staff can do nothing about it. What a
   device or the Box status page shows for `unavailable` is slice 6's and slice 7's to decide; Task
   4 records it as an open entry.
6. **Order: severity first (`error`, `warning`, `notice`), then the order of the sources as given,
   then each source's own order.** The reader uses the alert registry's rank, `SEVERITY_RANK`
   (`apps/server/src/alerts.ts:79-82`), exported for it, and a stable sort. This serves design
   §4.2's "two reds at once: the disk's shows first" if slice 6 passes the core's sources before the
   modules'. Design §4.2's other rule — before the minimum date, the clock's own notice instead of
   the behind-the-last-sale one — is between two notices of the Veri\*Factu module, so slice 8 keeps
   it inside that module's source, not in the reader.
7. **Each source is named by its owner.** `enabledStaffNoticeSources(modules)` returns
   `{ owner: module.name, source }` for every source of every module given. Slice 6 can pass sources
   the server owns under its own owner name, as boot already mixes server-owned alert sources with
   the modules' (`apps/server/src/boot.ts:2173`).
8. **No production caller in this slice; the contributor is reached by tests through the real
   composition.** The callers are slice 6 (the equipment read) and slice 7 (the Box status page),
   both of which depend on this slice (build plan Part 1). Putting the equipment read here would
   take slice 6's till↔box contract and the cost of asking every module on every device's
   15-second poll into this slice, against §8 item 4. Boot is not wired either: it would build
   something nothing reads. What keeps the contract from being designed in a vacuum: Task 3's
   real-composition case asks the real `ALL_MODULES` enabled set, over a real migrated database,
   through the reader slice 6 will call, with both fiscal choices (M6).
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
13. **No developer doc changes for the seat** (M7: no doc lists the descriptor's seats). The seat's
    doc comment on `WaitronModule` is its documentation, as `alerts`' is.
14. **The Box status page's rows are not in this seat.** Slice 7 adds what that page reads from a
    module (the Hacienda row's unsent count and last accepted record, design §4.3, picture 4) as its
    own optional member or seat, which breaks nothing here.
15. **Lands itself**, as the build plan's row 4 says. It changes no invoice, record, chain link,
    series, number or filing; the one fiscal-module change reads a clock reading and a constant.
    Checked in Task 3, Step 6.
16. **The alert registry's untested savepoint (M3) is not fixed here.** It is outside §8 item 4;
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
  unset `AI_AGENT` and `CLAUDECODE` to see it. CI runs the package suites and coverage.

## Review focus

1. **Isolation.** A source that writes and then throws keeps nothing in the caller's transaction,
   and the sources after it are still asked; a source that throws before returning a promise is
   handled the same way; a module with two failing sources is listed once; each failure is logged
   with its owner and code (Task 3). Deleting the savepoint, and separately the `catch`, fails
   named cases (Task 3, Step 5).
2. **Order.** Errors, then warnings, then notices; within a severity, sources in the order given
   and each source's own order (Task 3).
3. **The contract slices 6 and 7 build on** (cross-package: `@waitron/module` ↔
   `@waitron/fiscal-verifactu` ↔ `@waitron/composition` ↔ `apps/server`). The notice carries no
   words; the context carries `tx` and one reading; adding a context field or an optional notice
   field later breaks no source (decisions 2, 3). Check the types against design §4.2's six
   notices: each fits `code` + `severity` + `params`.
4. **The contributor.** Before the minimum date in the reading's own offset, one `clock.unusable`
   notice, `error`, with exactly the refusal's params; on or after it, none; the 23:30 pair of M5
   tells "own offset" from UTC (Task 1). It reaches the server only through `ALL_MODULES`, and only
   when `fiscal-verifactu` is enabled (Task 3's real-composition case, both fiscal choices).
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
   * with `params` in its own language files. `key` is unique within its source. */
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
  ("A disabled module's tables are not migrated": `apps/server/src/boot.ts:917-920`, which
  migrates only the enabled set in trading mode.)
- Produces, in `first-issue-date.ts`: `export function isBeforeFirstIssueDate(reading: { instant:
  Date; offsetMinutes: number }): boolean` — the comparison now inside `refuseBeforeFirstIssueDate`
  (`:13-14`), moved; `refuseBeforeFirstIssueDate` becomes `if (isBeforeFirstIssueDate(reading))
  throw new AppError("clock.unusable", { … })` with the params unchanged.
- Produces, in `packages/fiscal-verifactu/src/staff-notices.ts`:
  ```ts
  /** The clock notice for one reading: a `clock.unusable` notice before the first day AEAT
   * accepts, judged in the reading's own offset; nothing on or after it. */
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
- [ ] **Step 4: Run and watch it pass; run the slice-3 rule's tests unedited; typecheck.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/staff-notices.test.ts src/first-issue-date.test.ts`
  → PASS, with a `Tests` count that includes the new cases; then
  `git diff --stat main -- packages/fiscal-verifactu/src/first-issue-date.test.ts` prints nothing.
  Then `pnpm --filter @waitron/module --filter @waitron/fiscal-verifactu typecheck` exits 0.
- [ ] **Step 5: Proof by deletion.** In `isBeforeFirstIssueDate`, pass `0` instead of
  `reading.offsetMinutes` to `formatDate` (judging in UTC). Re-run Step 4's command: the
  `2024-10-27T23:30:00.000Z` +60 case of `clockNotices` FAILS (it now answers a notice), and so do
  the matching cases of `first-issue-date.test.ts`. Restore; re-run; PASS.
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
- [ ] **Step 4: Run and watch it pass.** The Step 2 command → PASS, with a `Tests` count two
  higher than before. Then `pnpm --filter @waitron/composition test` (the whole package, M4 ran it
  at 123) → PASS, and `pnpm --filter @waitron/composition typecheck` exits 0.
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
- Modify: `apps/server/src/modules.test.ts` (a new `describe` beside "alert assembly")
- Modify: `apps/server/src/alerts.ts` (`SEVERITY_RANK`, `:79-82`: add `export`, nothing else)

**Interfaces:**
- Produces, in `apps/server/src/staff-notices.ts`:
  ```ts
  export interface OwnedStaffNoticeSource {
    readonly owner: string;
    readonly source: StaffNoticeSource;
  }
  export interface StaffNoticeReadDeps {
    readonly reading: StaffNoticeContext["reading"];
    readonly log: Logger;
  }
  export interface StaffNoticesRead {
    readonly notices: StaffNotice[];
    /** Owners with a source that failed, each once, in the order first met. */
    readonly unavailable: string[];
  }
  export async function readStaffNotices(
    tx: Transaction,
    sources: readonly OwnedStaffNoticeSource[],
    deps: StaffNoticeReadDeps,
  ): Promise<StaffNoticesRead>;
  ```
  Body: for each entry in turn, `const found = await tx.transaction(() => source.read({ tx,
  reading: deps.reading }))`, then push `found`; on a throw, `deps.log("error",
  "staff_notice.source_unavailable", { owner, errorCode: codeOf(error) })` and add `owner` to
  `unavailable` if absent. Return the notices sorted by `SEVERITY_RANK[severity]` (a stable sort).
  The savepoint's own comment, if any, says why in one line: a failed source's writes go with it
  (M2 A, B); alerts.ts's comment at `:124-126` is the model.
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
    migrationOptionsFor(manifestSets(), null), timeoutMs: 60_000 })` and a `seedVenue` and
    incident-writing helper copied from `apps/server/src/alerts.test.ts:53-93` (tenant, location,
    device; `recordIncident` inside the given `tx`). `READING = { instant: new
    Date("2026-10-22T10:00:00.000Z"), offsetMinutes: 120 }`. Each case runs inside one
    `withTransaction(db, …)`.
    1. `"asks every source in turn with the transaction and the one reading, and orders errors, warnings, then notices"`:
       source P (owner `"p"`) answers keys `p-notice` (notice), `p-error` (error); source Q (owner
       `"q"`) answers `q-warning` (warning), `q-error` (error). Expect keys
       `["p-error", "q-error", "q-warning", "p-notice"]`, `unavailable: []`; each source saw
       `ctx.tx` `toBe` the transaction and `ctx.reading` `toBe` `READING`; Q was asked after P
       finished (record the order of entry and exit in an array: `["p in", "p out", "q in", "q out"]`).
    2. `"a source that writes and then fails keeps nothing, is logged, and the sources after it are still asked"`:
       source W (owner `"w"`) records an incident through `recordIncident(tx, …)` and then throws
       `new AppError("server.internal", {})`; source H (owner `"h"`) answers one notice. Expect
       `notices` = H's one notice; `unavailable: ["w"]`; `await listOpenIncidents(tx)` in the same
       transaction is `[]` (M2 B's failing case is `1`); the log spy called with
       `("error", "staff_notice.source_unavailable", { owner: "w", errorCode: "server.internal" })`.
    3. `"a source that throws before returning a promise is reported, and the rest are asked"`:
       `read: () => { throw new Error("sync"); }` (owner `"s"`) beside a healthy one. Expect the
       healthy notice, `unavailable: ["s"]`, and the log's `errorCode: "unknown"`
       (`codeOf`, `packages/server-kit/src/error-code.ts:7-9`).
    4. `"two failing sources of one owner list it once"`: two throwing sources, both owner `"m"`.
       Expect `unavailable: ["m"]` and the log spy called twice.
    5. `"through the real composition, the Veri*Factu module's clock notice and nothing else"`:
       `const verifactu = enabledStaffNoticeSources(enabledModules(ALL_MODULES, parseModuleOverrides({ "fiscal-none": false }, ALL_MODULES)))`
       (M6). With `{ instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 }`:
       `notices` `toEqual` `[{ key: "clock.unusable", code: "clock.unusable", severity: "error", params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 } }]`,
       `unavailable: []`. With `READING`: `{ notices: [], unavailable: [] }`. Control in the other
       direction: with `{ "fiscal-verifactu": false }` and the 2001 reading, `{ notices: [],
       unavailable: [] }` — the notice comes from the enabled Veri\*Factu module, not from the
       reader. (`ALL_MODULES` from `./modules.js`; never import `@waitron/fiscal-verifactu` here:
       test files are outside `scripts/module-seams.test.ts`, but the case is about the seat.)
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/staff-notices.test.ts src/modules.test.ts`.
  Expected: `staff-notices.test.ts` FAILS to resolve `./staff-notices.js`; the new
  `modules.test.ts` case FAILS with `enabledStaffNoticeSources is not a function` (or its import
  error); the five existing `modules.test.ts` cases pass.
- [ ] **Step 3: Implement** `staff-notices.ts`, `enabledStaffNoticeSources` and the `export` on
  `SEVERITY_RANK`.
- [ ] **Step 4: Run and watch them pass.** The Step 2 command → PASS, with `Tests` counts that
  include every new case. Then `pnpm --filter @waitron/server exec vitest run src/alerts.test.ts`
  → `Tests 20 passed (20)` as in M1 (the `export` changed nothing).
- [ ] **Step 5: Proofs by deletion**, each restored and re-run to PASS before the next:
  - Replace `await tx.transaction(() => source.read(…))` with `await source.read(…)`: case 2
    FAILS on the incident count (expected `[]`, got one incident), as M2 B predicts; cases 1, 3, 4
    still pass.
  - Remove the `try`/`catch` (let the error out): cases 2, 3 and 4 FAIL with the source's own
    error; case 1 passes.
  - Remove the sort: case 1 FAILS on the key order.
  - Remove `staffNotices: FISCAL_STAFF_NOTICES,` from `packages/composition/src/modules.ts`: case 5
    FAILS (the 2001 reading answers `[]`), and Task 2's two cases FAIL
    (`pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`).
- [ ] **Step 6: The guards and the fiscal check.**
  - `pnpm --filter @waitron/module --filter @waitron/fiscal-verifactu --filter @waitron/composition --filter @waitron/server typecheck`
    exits 0.
  - From the root: `pnpm exec vitest run scripts/module-seams.test.ts scripts/english-only.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts`
    → PASS (M4 ran these with a stand-in key). `git diff main -- scripts/module-seams.test.ts`
    prints nothing.
  - `git diff main --stat -- packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/drain.ts packages/core/src`
    prints nothing (decision 15).
  - Coverage is CI's gate (CLAUDE.md §2; global rule: no package-wide coverage run just because a
    task is done). Before calling the branch green, read the coverage or merge jobs of
    `packages/module`, `packages/fiscal-verifactu`, `packages/composition` and `apps/server` on the
    pull request's current head, and check that the `changes` job selected all four. Run a
    package's `test:coverage` locally only to chase a failure CI reports.
- [ ] **Step 7: Commit.**
  ```bash
  git add apps/server/src/staff-notices.ts apps/server/src/staff-notices.test.ts apps/server/src/modules.ts apps/server/src/modules.test.ts apps/server/src/alerts.ts
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
- [ ] **Step 2: One open entry in A798-B's area, after the A798-B entry:**
  "**What a device and the Box status page show when a module's notice check fails.**
  `readStaffNotices` (`apps/server/src/staff-notices.ts`) logs the failure and names the module in
  `unavailable`; nothing shows it. Left open by A798-B slice 4 (#<this pull request>) for slices 6
  and 7."
- [ ] **Step 3: One entry under "Alerts, logging and diagnostics":**
  "**The alert registry's per-source savepoint has no test that fails without it.**
  `readOpenAlerts` (`apps/server/src/alerts.ts`) asks each source inside a savepoint so a failed
  source's writes go with it, but removing the savepoint left the three alerts test files passing
  (2026-10-22): their failing source only fails a query, which leaves the transaction usable
  anyway. A failing source that writes before it throws would pin it, as
  `apps/server/src/staff-notices.test.ts` does. Found by A798-B slice 4 (#<this pull request>)."
- [ ] **Step 4: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true` (docs/ is not format-checked). Then:
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
  page" is slice 7's (decision 14).
- §4.2 ("the Veri\*Factu module supplies … the clock-before-28-10-2024 notice … through the new
  seat"; one wording each, red for the clock): Task 1's source, `clock.unusable`, `error`; its words
  and the strip are slice 6's. The unsent count and the behind-the-last-sale notice are slices 6
  and 8's (decision 9). "Two reds at once": the reader's order serves it (decision 6).
- §4.5 item 1 ("the Veri\*Factu module supplies it, since the date is its rule"): Task 1 reuses
  slice 3's predicate (decision 11).
- §5's isolation ("the alert registry already isolates a failing module's check"): the reader does
  the same, with a test that would fail without the savepoint, which the alert registry lacks (M3,
  decision 16).
- §8 slice 4's risk, cross-package contract: Review focus 3 and 4.
- Build plan Part 1, row 4 (lands itself, no migration): decision 15, Global constraints.
