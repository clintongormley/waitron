# A798-B slice 8 — payments stop while the box's clock reads earlier than its last record

> **Revision 2 (2026-10-23).** Folds in plan review round 1
> (`~/waitron-campaign-b/a798-8-plan-review/round1.md`: C1, I1–I8, M1–M11) and its claim check
> (`claim-check.md` beside it: findings 1–4) under the driver's rulings. Each change names its
> finding in brackets, for example **[C1]**. New receipts are under "Measured for revision 2". New
> citations were read at `9cb4ce96c`, which differs from `263af1b92` only by this plan.
>
> **The build's one migration.** An index on `registros_facturacion.fecha_hora_huso_gen_registro`
> and a new append-only table `clock_stop_restarts`, both in the Veri\*Factu module's own set
> (Task 1). Nothing in this slice reads or writes the new table; slice 9's restart does.
>
> **Parked for the owner** (build plan Part 1, row 8): this slice puts a check inside the record
> append (`attemptAppend`, `packages/fiscal-verifactu/src/chain.ts:128-134`) and refuses order
> edits that would file an invoice. It does not touch what is hashed (`computeHuella` lives in
> `@waitron/verifactu`, outside this repository), numbering, series allocation, or the alta and
> anulación builders. The golden fingerprint test (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`)
> and `inmutabilidad.test.ts` pass **unedited** (E4, E9). If a task finds it must change either, or
> anything else on that list, STOP and report.
>
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation. Implementers are dispatched
> as `subagent_type: "implementer"`. Tasks run in their numbered order; every commit leaves the root
> guards green.
>
> **Existing assertions.** This plan changes exactly these existing assertions, declared here so no
> implementer has to decide one. Each goes in the task named, in one commit of its own whose message
> begins `Changed test checks (A798 slice 8):` and lists each `file:line` with its before and after;
> the pull request names them.
> 1. `scripts/append-only-triggers.test.ts:201-203` ("declares exactly the tables whose rows can
>    never be corrected"): `EXPECTED` **gains** `"clock_stop_restarts"` (Task 1; E2 printed this
>    case failing and every other case passing, the new table's update and delete refusals
>    included).
> 2. `packages/fiscal-verifactu/src/schema-ownership.test.ts:56` ("exports no table this package
>    does not own"): `OWNED` (`:10-23`) **gains** `"clock_stop_restarts"` (Task 1; E4).
> 3. `scripts/schema-constraints.test.ts`: its `EXPECTED_FOREIGN_KEYS` (`:36`) and
>    `EXPECTED_UNIQUE_INDEXES` (`:370`) **gain** the new table's two foreign keys and its unique index. These pass without
>    the entries (E2); they are added so a regeneration that drops them fails.
>
> Test **setup** changes (a clock, a journal filter, a stub's methods), never an assertion, are
> allowed where a task names them; the known ones are listed under "Declared test-setup changes"
> below. Any other assertion that turns out to need changing is a STOP: report it, do not edit it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `263af1b92` (2026-10-22), this branch's base
> (`feat/a798-8-clock-behind-stop`). Every claim about how the box behaves today cites a probe in
> "Measured for this plan", run that day on macOS 26, Node v26.11.1 (SQLite 3.54.0), from scratch
> files under `~/waitron-campaign-b/a798-8-plan-probe/` (scripts in `scripts/`, logs beside them)
> and a throwaway worktree of `263af1b92` made with `git worktree add --detach` and
> `pnpm install --frozen-lockfile --offline` (`Done in 3.9s`, `install.log`), removed afterwards. A
> claim marked **(read)** comes from reading code, not running it. Nothing was measured on Linux.

**Words used in this plan.**
- The **latest record time** is the largest `fecha_hora_huso_gen_registro` in
  `registros_facturacion`, across every chain the database holds, whatever the record's kind
  (design §4.8, "Decisions revision 5 makes" 1).
- The **stop** is open while a reading of the box's clock is more than 60 000 ms earlier than the
  latest record time (design §4.5 item 2, §4.8 d). A database with no records is never stopped.
- The **named check** is `refuseWhileClockBehind`: the Veri\*Factu module's function, reached by
  generic code through the fiscal seat (`FiscalBackend.refuseWhileClockBehind`, Task 4). It refuses
  a reading before 28-10-2024 with `clock.unusable` first (design §4.8 d, last bullet), then a
  reading inside the stop with `clock.behind_chain`. It judges the reading the route already takes,
  never a second one of its own (decision 3) **[I6]**.
- The **seat's question** is `FiscalBackend.clockBehindLatestRecord`, answering the type
  `ClockBehindLatestRecord`. The module's own function keeps the name `clockBehindChain`. The seat
  cannot: `packages/fiscal`'s vocabulary guard forbids "chain" there **[I1]**.
- The **chain check** is the same function called as the first statement of each append attempt
  (`attemptAppend`), so no path can write a record during the stop, whoever calls it (design §4.8 d).
- A **replay** is a retry a route answers from what it already did, writing nothing and moving no
  money (a settled order's ticket, a bill payment's first row, a COMPLETED or FAILED refund). A
  resent request for a PENDING refund is not a replay: answering it resumes the refund, and resuming
  can send money (`tender-refunds.ts:153` → `resumeTenderRefund(…, "retry")`; the review's X7 saw
  `refundCalls` go from 1 to 2) **[C1]**.
- **NOW** and **BEHIND** in tests: the latest record time when the case starts, and that time less
  one day. Each new file's setup records one sale at the real clock, so NOW has a value from the
  first case. Each case reads NOW from the database at its start. Every write in these files,
  helpers included, uses a clock built from NOW; a case that must write on another clock gets a
  database of its own (decision 13) **[I8]**.

**Goal:** while the box's clock reads more than a minute earlier than the latest record time,
every action that takes or gives back money, or would write a fiscal record, is refused with
`clock.behind_chain` before any card reader or refund is asked; everything else carries on; every
signed-in till and handheld shows the red strip; managers see the alert in the bell and red rows on
the Box status page; and the stop clears by itself once the clock no longer reads behind.

**Architecture:** five pieces.
1. **Storage** (Task 1): the index that makes the latest record time one index read (E5), and the
   append-only `clock_stop_restarts` table slice 9 writes.
2. **The module's rule** (`packages/fiscal-verifactu/src/clock-behind.ts`, Tasks 2–3):
   `clockBehindChain(tx, reading)` answers the two times when the stop is open;
   `refuseWhileClockBehind(tx, reading)` throws. The chain check calls it at the top of every append
   attempt.
3. **The seat** (Task 4): `FiscalBackend` gains `clockBehindLatestRecord` and
   `refuseWhileClockBehind`, as slice 3 gave it `assertRecordableAt`
   (`packages/fiscal/src/backend.ts:193-197`). The Veri\*Factu backend delegates; the other regimes
   are never stopped (design, "Decisions revision 5 makes" 16).
4. **Server** (Tasks 6–12): the named check after each money route's replay answer (decision 3);
   both refund recovery loops (the tender refunds' loop, and the refund half of the bill-payments
   pass) wait during the stop (decision 16); `fiscal.clock_drift` is left out of the bell while it
   is open; a card charged as the stop begins answers `sale.charged_not_recorded` with
   `reason: "clock_behind_chain"`.
5. **What people see** (Tasks 5, 13a–15): the red strip notice and the bell alert (both from the
   module's seats), the till's refusal words, the Box status page's red rows, and the guides.

**Tech stack:** TypeScript, `node:sqlite` behind drizzle 0.45.4 with drizzle-kit 0.31.11, Hono, Lit,
Vitest 4.1.12 (Node for `packages/*` and `apps/server`; real headless Chromium for `apps/till`,
`apps/dashboard` and part of `packages/fiscal-verifactu`).

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6: §3 (the row for a clock behind the last sale), §4.2 (the strip's red notice), §4.3 (the
bell, the email), §4.5 items 2 and 5, **§4.8 a, d and e**, §5, §6 ("The reversal of D8 and A364",
"Decisions revision 5 makes"), **§7**, **§8 item 8**. Pictures:
`docs/backlog/mockups/a798-degraded-trading/8-clock-behind-staff.png` and
`9-clock-behind-manager.png` (the restart dialog in picture 9 is slice 9's). Build plan:
[2026-10-21-a798-b-degraded-trading-build.md](2026-10-21-a798-b-degraded-trading-build.md) Part 1,
row 8 (fiscal invariants, cross-package contract, migrations; FULL; the one migration; parked;
depends on 4, 6 and 7, all landed). Backlog: A798-B (`docs/backlog.md:5507-5524`), and "A cancel's
whole-invoice credit under a clock before 28-10-2024 reaches the chain without the clock check"
(`:5631-5635`, left by slice 3 for this slice). Asesor questions Q51 and Q52
(`docs/compliance/asesor-questions.md`) ask about slice 9's restart, not this slice.

---

## Measured for this plan

Logs and scripts are under `~/waitron-campaign-b/a798-8-plan-probe/`. Vitest probes ran in the
throwaway worktree with `TESTCONTAINERS_RYUK_DISABLED=true env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run <file> --silent=false`
from the package folder; each probe file was copied in, run, and deleted.

- **E1 — what drizzle-kit generates for the index and the table** (`e1-generate.log`). In the
  throwaway worktree: `src/schema/clock-stop-restarts.ts` (Task 1's columns), its export in
  `src/schema/index.ts`, `index("registros_generado_idx").on(t.fechaHoraHusoGenRegistro)` in
  `registros.ts`, `appendOnly("clock_stop_restarts", "ledger", LEDGER)` in `classification.ts`,
  then `pnpm exec drizzle-kit generate --name clock_stop` from `packages/fiscal-verifactu`.
  Printed `drizzle/0010_clock_stop.sql` with exactly three statements: `CREATE TABLE
  clock_stop_restarts (…)` with the two `FOREIGN KEY` clauses, `CREATE UNIQUE INDEX
  clock_stop_restarts_registro_uq`, and `CREATE INDEX registros_generado_idx ON
  registros_facturacion (fecha_hora_huso_gen_registro)`; the journal gained entry `idx 10`,
  `when 1792692449985`. `/usr/bin/grep -ci 'DROP TABLE\|__new_\|PRAGMA'` over the file printed `0`.
  The failing case for CLAUDE.md §3's drizzle traps — a rebuild of `registros_facturacion` — would
  have printed a `__new_registros_facturacion` table, a `PRAGMA foreign_keys` pair and a `DROP
  TABLE`. So no table is rebuilt, no column is added beside a rebuild, no expression index is
  involved, and no foreign key points at a rebuilt table. The number 0010 is what this tree gave;
  Task 1 lets drizzle-kit assign it again.
- **E2 — the migration guards over that migration** (`e2-guards.log`, `e2b-append-only-verbose.log`).
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/append-only-migration-sets.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/column-vocabulary.test.ts`:
  `Test Files 1 failed | 11 passed (12)`, `Tests 1 failed | 568 passed (569)`. The one failure is
  `append-only-triggers`' exact list, `+ "clock_stop_restarts"` (declared assertion change 1). Run
  verbose, `clock_stop_restarts refuses an update` and `… refuses a delete` both passed: the
  installed `RAISE(ABORT)` pair works on the new table. `schema-constraints` passed without naming
  the new keys, which is why declared change 3 adds them.
- **E3 — which guard notices a missing manifest entry** (`e3-manifest-control.log`). With the
  manifest edit stashed: `scripts/append-only-migration-sets.test.ts` `Tests 16 passed (16)`, and
  `packages/composition/src/composition.test.ts` `Tests 2 failed | 25 passed (27)` ("derives
  exactly the manifest's sets, in order"). With it: `27 passed (27)` (`e4-fiscal-suites.log`). So
  the composition test, not the append-only-sets guard, is what catches a manifest that does not
  carry the new table. The module's descriptor needs no edit: `FISCAL_MIGRATIONS.appendOnlyTables`
  is `appendOnlyTablesIn(FISCAL_CLASSIFICATION)` (`packages/fiscal-verifactu/src/migrations.ts:13`).
- **E4 — the fiscal core's own suites over the migration** (`e4-fiscal-suites.log`):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts src/migrations.test.ts src/classification.test.ts src/schema/schema-conformance.test.ts src/schema-ownership.test.ts`
  printed `Tests 1 failed | 55 passed (56)`; the failure is `schema-ownership`'s `OWNED` list
  (declared change 2). The golden fingerprint and `inmutabilidad` passed unedited.
- **E5 — how the latest record time is read, and what the index serves** (`e5-latest-record.log`,
  `scripts/zz-latest-record.test.ts`; `e5b-plan-control.log`, `scripts/plan-control.mjs`). Three sales
  recorded through `VerifactuBackend` and `recordSale` with readings `2026-10-24T21:30:00.000Z`
  (+120), `2026-10-25T09:00:00.000Z` (+60) and `2026-10-25T08:59:59.999Z` (+60) stored
  `fecha_hora_huso_gen_registro` as `2026-10-24T21:30:00.000Z`, `2026-10-25T09:00:00.000Z` and
  **`2026-10-25T08:59:59.000Z`**: the record's time keeps whole seconds, so the reading's
  milliseconds are dropped. `max(...)`, drizzle's `max()` and
  `select fecha_hora_huso_gen_registro, offset_minutos … order by … desc limit ?` (its `.toSQL()`
  printed) all answered `2026-10-25T09:00:00.000Z`, the latest instant, though a summer `+120`
  reading came first. Query plans with the index: `SEARCH registros_facturacion USING COVERING INDEX registros_generado_idx`
  (the `max`) and `SCAN registros_facturacion USING INDEX registros_generado_idx` (the `order by …
  desc limit 1`). After `drop index registros_generado_idx`: `SEARCH registros_facturacion` and
  `SCAN registros_facturacion`, `USE TEMP B-TREE FOR ORDER BY`. The control on a plain table of
  20 000 rows timed the `max` at 435.1 µs a query without the index and 0.3 µs with it, so the
  index-less `SEARCH` line is a full read. **Today nothing reads the latest record time**:
  `/usr/bin/grep -rnE 'fechaHoraHusoGenRegistro|fecha_hora_huso_gen_registro' packages apps --include='*.ts'`,
  less tests, finds only `min(...)` reads (`submission-alerts.ts:31`, `:49`) and two ascending
  orderings in the drain (`drain.ts:634`, `:1010`). The one writer of the table is
  `chain.ts:207` (same grep for `insert(registrosFacturacion)`), through `toRegistroRow`'s
  `new Date(record.FechaHoraHusoGenRegistro)` (`registro-row.ts:118`) and the `ts` column's
  `toISOString` (`packages/db/src/schema/columns.ts:23-35`): one spelling, so text order is time
  order (CLAUDE.md §3, "A time stored as text…") **(read)**. *Revision 2 [claim-check §4]:* the
  grep's list above is too short. The same grep on unedited code also finds `registro-row.ts:330`,
  `drain.ts:593` and `backup-verification-chain.ts:21-35` (claim-check `e12-greps.log`). None of
  them reads the largest time, so "nothing reads the latest record time" stands.
- **E6 — the chain check placed before the retry loop breaks four fiscal test files**
  (`e6-fiscal-suite-with-check.log`). The prototype of `scripts/prototype-clock-behind.ts`, then
  without its `refuseBeforeFirstIssueDate` line, called at the top of `appendToChain`, before its
  `for` loop; `pnpm test` in `packages/fiscal-verifactu`:
  `Test Files 4 failed | 186 passed (190)`, `Tests 6 failed | 4135 passed (4141)`. Three are
  `chain.test.ts` cases whose `tx` is a stub with only `transaction` ("The stub is exactly the one
  method appendToChain calls on `tx`", `chain.test.ts:263-289`, `:291-368`, `:370-389`); one is
  `drain.test.ts:978` (below); the other two are `schema-ownership` (declared change 2) and
  `outage-upgrade.test.ts` (below).
- **E7 — a new append-only table raises no `append_only.triggers_restored`** (`e7-new-append-only.log`,
  `scripts/zz-new-append-only.test.ts`, in `apps/server`). A venue folder migrated by
  `applyMigrations` with the fiscal set's journal less `0010_clock_stop`, then
  `missingBeforeMigration(venue, <the full append-only list, clock_stop_restarts included>)`
  printed `[]`; the control, after dropping one of `registros_facturacion`'s triggers, printed
  `["registros_facturacion_append_only_update"]`. After `applyMigrations` with the full sets the
  table had `clock_stop_restarts_append_only_delete` and `…_update`, the index existed, and
  `assertAppendOnlyIntact` passed. That is `missingBeforeMigration` counting only tables that
  already exist (`apps/server/src/append-only-watch.ts:27-46`). So CLAUDE.md §3's PR-description
  rule — for a release that marks an EXISTING table `appendOnly()` — does not bite; the pull
  request says so instead (Review path).
- **E8 — the chain check against the server's suite** (`e8-server-suite-with-check.log`). E9's
  prototype and E1's migration; `pnpm exec vitest run` in `apps/server` (without the stream-loop
  binaries, so 25 cases skipped): `Test Files 6 failed | 939 passed (945)`, `Tests 11 failed |
  22506 passed | 25 skipped (22542)`. Ten failures are `clock.behind_chain` from `attemptAppend`, every
  one a fixture that records a sale dated before a record the same database already holds:
  `bill-payments.test.ts` "retains saved F1 issue offset 60 / 0 / -480 across replay and a live zone
  change" and "retains the full-invoice service date from bill opening 2026-10-06T21:50:00Z / 22:05:00Z
  across replay" (a fixed `2026-10-06T22:10:00Z` issue clock, `:1772-1781`, in a file whose database
  is shared, `resetPerTest: false`, `:113-114`, after earlier cases recorded at the real clock);
  `invoice-document.test.ts` "requires the current taxpayer only when the backend has no saved
  issuer" and "reads no guests for a sale with no bill"; `orders-api.test.ts` "shows staff unfinished
  bills at any date and finished bills only from today's business day";
  `orders-invoice-deliveries.test.ts` "does not let staff print an older finished invoice hidden from
  their Orders detail"; `orders-reprint.test.ts` "does not let staff copy an older finished bill hidden
  from their Orders detail". The eleventh, `first-fiscal-launch.test.ts` "the built owned CLI refuses
  JSON authority…", is not this slice's: on the unedited branch it fails the same way under this
  agent (`e8b-first-fiscal-launch-control.log`: the CLI's stderr begins with a
  `<claude-code-hint … stripe@claude-plugins-official />` line before `setup.attempt_conflict {}`).
  *Revision 2 [M11, claim-check §4]:* "eleven" is what this run printed, not the only result. Two
  more runs of the whole suite with the chain check also failed cases that fail under machine load
  and are not `clock.behind_chain`: `hour-recovery-placement-1` and `-2` (`signal: null` where
  `SIGKILL` was expected; claim-check `e8-server-suite-with-check.log`, and one of them failed alone
  on the unedited tree, `e8c-hour-recovery-wt3.log`), and `first-setup-unused-pdf.test.ts`
  "successive never-activated PDFs retain every old block while allowing a third replacement"
  (`Test timed out in 120000ms`, review `r1/fixtures/srvlog-none.log:10855`; its file wrote no
  record, so the check never ran there). Task 3b Step 3 names them.
- **E9 — the chain check inside the attempt** (`e9-fiscal-inside-attempt.log`; the diff is
  `scripts/prototype-chain.diff`, the whole throwaway worktree's `probe-worktree.diff`). The same prototype called as `attemptAppend`'s first statement,
  inside the savepoint, with `refuseBeforeFirstIssueDate` first:
  `pnpm exec vitest run src/chain.test.ts src/drain.test.ts src/chain.concurrency.test.ts src/chain.node-rekey.concurrency.test.ts src/chain.record-validation.test.ts src/chain.validation-warnings.test.ts src/write-path.e2e.test.ts inmutabilidad src/correction-path.e2e.test.ts src/void-path.e2e.test.ts src/substitution-path.e2e.test.ts`
  printed `Tests 1 failed | 143 passed (144)`. `chain.test.ts` passes unedited; the one failure is
  `drain.test.ts:978`, `AppError: clock.behind_chain` from `attemptAppend`: the case seeds envíos
  stamped `2026-07-20T19:20:30+01:00` (`test/drain-fixtures.ts:27`) and then records a sale with
  `steadyClock`, which reads `2026-03-01T13:05:00+01:00` (`test/write-path-fixtures.ts:8`) — a
  sale dated four months before the record before it. Whole package: E11.
- **E10 — which money routes reach the card provider or settle money today with the clock a day
  behind** (`e10-money-routes.log`, `scripts/zz-money-routes.test.ts`, in `apps/server` with the
  E9 prototype in place, on `provisionBillVenue`'s venue and its `FakePaymentProvider`
  (`packages/payments/src/testing/fake-provider.ts:75`, `collectCalls` at `:84`)). A card sale
  recorded at `2026-10-22T12:00:00.000Z`, then with every request on a clock reading
  `2026-10-21T12:00:00.000Z`:
  (a) a counter card sale with no saved order, `POST /api/pay`: **`collect` called once**, then the
  answer `400 clock.behind_chain` from the prototype's chain check after the charge — the card is
  charged and the sale refused;
  (b) a placed order whose invoice was filed at the first time, paid by card on `POST /api/pay`:
  **`collect` called once and `200 captured`** — money taken on the wrong clock and nothing refuses
  it, because settling a filed invoice writes no record;
  (c) the same kind of order collected in cash, `POST /api/working-orders/:id/collect`: **`200`**.
  The failing case for "the routes need a check of their own" would have been no `collect` call in
  (a) and (b) and a refusal in (c). (a) answered 400 because `clock.behind_chain` is in no status
  table (`apps/server/src/till-api.ts:418-645`). Today the reader is asked at
  `apps/server/src/till-sale.ts:1369` (`payIntegrated`) and `apps/server/src/bill-payments.ts:1452`
  (`takeReaderBillPayment`), and a refund is sent at `bill-refunds.ts:338` and
  `tender-refund-sends.ts:332`; none of those paths reads the latest record time **(read; the grep
  in E5 finds no reader)**.
- **E13 — the other packages whose tests record through the real backend** (`e13-other-packages.log`,
  `e13b-provisioning-control.log`), with E9's prototype: `packages/core` `Tests 310 passed (310)`,
  `packages/composition` `Tests 125 passed (125)`, `packages/provisioning` `Tests 7 failed | 1465
  passed (1472)`. The seven (`cli-owned-entry.test.ts` ×5, `cli-same-hour-entry.test.ts`,
  `first-setup-command-import.test.ts`) fail identically on the unedited branch under this agent: a
  built command's error output begins with a `<claude-code-hint … />` line. Not this slice's.
- **E12 — greps** (`e12-greps.log`, at `263af1b92`): `behind_chain`, `refuseWhileClockBehind` and
  `clockBehindChain` appear nowhere under `packages`, `apps` or `scripts` (count `0`);
  `sayCardChargedOnFullDisk` appears 8 times; `507` appears in no `apps/till/src` file outside tests;
  the readers and the one writer of the record time are E5's.
- **E11 — whole fiscal package, final shape** (`e11-fiscal-suite-final-shape.log`). E9's prototype
  and E1's migration, without the declared changes: `pnpm test` in `packages/fiscal-verifactu`
  printed `Test Files 3 failed | 187 passed (190)`, `Tests 3 failed | 4138 passed (4141)`: exactly
  `schema-ownership` (declared change 2), `outage-upgrade.test.ts` and `drain.test.ts:978` (the two
  setup changes below). No other fiscal test turns red.

### Measured for revision 2

Run on 2026-10-23, macOS, Node v26.11.1, git 2.56.0, in throwaway worktrees of `9cb4ce96c` made
with `git worktree add --detach` (and `pnpm install --frozen-lockfile --offline` where Vitest ran),
removed afterwards. The review's own experiments (X1–X7, F1–F9) and the claim check's are cited by
their log names; their logs are in `~/waitron-campaign-b/a798-8-plan-review/`.

- **R1 — the seat's new name passes `packages/fiscal`'s vocabulary guard [I1].** Added to
  `packages/fiscal/src/backend.ts` the two interface lines `clockBehindLatestRecord(…):
  Promise<ClockBehindLatestRecord | null>` and `refuseWhileClockBehind(…): Promise<void>`, and the
  exported interface `ClockBehindLatestRecord` with its four fields. Then
  `pnpm exec vitest run src/no-regime-vocabulary.test.ts` in `packages/fiscal`: `Tests 100 passed
  (100)`. Control, the first line renamed back to `clockBehindChain(`: `× ./backend.ts does not
  mention "chain"`, `Failed Tests 1`. The guard's word list is `no-regime-vocabulary.test.ts:56-70`
  **(read)**; it strips comments but not strings, so the string `"clock.behind_chain"` must not
  appear in `packages/fiscal` either.
- **R2 — the narrowed fiscal-core check ignores `packages/core` test files and still sees product
  files [I2].** With `// x` appended to `packages/core/src/record-void.test.ts` and `// y` to
  `packages/core/src/record-sale.ts`:
  `git diff --name-only main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/core/src ':!packages/core/src/*.test.ts'`
  printed only `packages/core/src/record-sale.ts`. The control, the same command without the
  `':!…'` pathspec, printed both files. With only the test file changed, the narrowed command
  printed nothing (`wc -l` → `0`).
- **R3 — the English-only grep without `registr` [M5].** On a three-line sample diff holding
  `registroCount(venue, id)`, ``sql`select max(fecha_hora_huso_gen_registro) from registros_facturacion` ``
  and `"No se puede cobrar: la hora del equipo"`, the old pattern matched all three lines; the new
  one (`cobr|venta|hora del|encargado|equipo`) matched only the third.
- **R4 — what the two refund loops do, and what their outcomes date [I3] (read, plus the review's
  three runs).** Neither loop sends money. The tender loop resumes with the `loop` resolver
  (`tender-refund-recovery.ts:73`). `resolve` then fails a never-sent refund without asking the
  provider (`tender-refund-sends.ts:357-358`) and never resends after a lookup
  (`:370-379`, `resolver !== "loop"` at `:372`). The bill half (`bill-payments-loop.ts:268`,
  `resumeCardRefund(deps, id, "loop", PAYMENT_CHECK)`) does the same (`bill-refunds.ts:442-445`,
  `:460-467`). The review ran the existing cases `tender-refunds.test.ts:855` ("a loop fails a
  never-sent intent without contacting a provider") and `:1362` ("fails an abandoned unsent intent
  without contacting a provider or opening a drawer"): both pass, with no send. Neither refund loop
  writes a fiscal record. A completed outcome writes the refund row and a `payment_refunds` row
  through `recordRefund` (`packages/payments/src/store.ts:227-262`).
  `/usr/bin/grep -nE 'record(Sale|Correction|Void|Substitution)|appendToChain|issueIfFullyPaid|completeBillPayment'`
  over `tender-refund-sends.ts`, `tender-refund-recovery.ts` and `bill-refunds.ts` printed nothing
  (exit 1), and over the refund half's lines `bill-payments-loop.ts:244-290` counted `0`. (The
  pass's payment half does call `completeBillPayment`, which can file an invoice; decision 17.)
  What a completed outcome does date: `completed_at` is stamped from the box's clock
  (`tender-refund-sends.ts:167-175`; `bill-refunds.ts:247`, `:282`), and the cash-up counts a
  completed refund of either kind in the window holding its `completed_at`
  (`packages/reporting/src/cash-up.ts:51-61`). The bill-payment half of the same pass dates a
  received payment by the provider's `settledAt`, falling back to the box's clock only when the
  provider gave none (`bill-payments-loop.ts:144-149`).
- **R5 — where `storage.disk_full` sits in the till today [I5].**
  `/usr/bin/grep -rn 'storage.disk_full' apps/till/src`, less tests: `TABLE_REFUSALS`
  (`till-app.ts:563`), `ACTIONABLE_REFUSALS` (`:835`), `discardError` (`:909`), `saleRefusalOf`
  (`:1500`), the station's advance (`:7907`, `screens/till-station-screen.ts:571`),
  `widgets/pay-refusal.ts:70`, `i18n/codes.ts:762` and the notice tables. The station's advance
  is a kitchen action, which this slice never refuses, so it gains nothing.
- **R6 — the review's X5 (named checks in place, 155 server files).** `Tests 11 failed | 5661
  passed`: E8's five `bill-payments.test.ts` cases, five cases behind `{} as FiscalBackend` stubs
  (`till-api.test.ts:332`, failing at `:4459`; `till-api.zone-required.test.ts:173`, four cases
  failing at `:271` and `:283`) answering 500, and `vat-rate-at-issue.test.ts:498-515`, whose
  ticking clock showed the check taking the request's first reading (`r1/x5b-failures.txt`). The
  refund, collect-after-reader and dashboard checks were not in that run. Task 7 Step 0 runs the
  whole suite with all of them.

---

## Departures from the design

1. **The named check comes after a route's replay answer, not before every branch.** Design §4.8 e:
   "the check goes at the top of `payIntegrated`, **before any branch**." Every branch the design
   names (the filed-invoice settle, the counter sale with no saved order, the recovery branches)
   comes after `payIntegrated`'s replay of a settled order (`till-sale.ts:1163-1168`), so all of
   them meet the check. The replay itself writes nothing and moves no money, and slice 3 pins that
   it is answered under a clock it would otherwise refuse ("replays a settled card sale under a
   clock in 2001 without asking the reader", `apps/server/src/till-pay.clock.test.ts:135-149`).
   Refusing it would also tell staff "Sale not recorded" for a sale that was. Decision 3 states the
   rule for every route.
2. **No email in this slice; the clock email goes to slice 9 [I7].** Design §8 item 8 lists "the
   alert and email". Design §8 item 10 puts "Emails for the red conditions and the 2 GB disk
   warning" in slice 10, which lands itself and depends on 5 and 6 only (build plan Part 1, row 10).
   The clock email has to ask this slice's seat (`clockBehindLatestRecord`), so slice 10 cannot
   build it while slice 8 is parked, and must not be made to depend on 8. Slice 9 already depends
   on 8 and parks (row 9: "parked", depends on 7 and 8). Decision 9.
3. **The refusal carries four params, not two.** Design §4.8 a: "carrying the two times (`clockAt`,
   `lastRecordAt`)". It also carries each time's offset, `offsetMinutes` and
   `lastRecordOffsetMinutes`, so the till writes each time as its record would print it, as slice 3
   writes `clock.unusable`'s date in the reading's own offset (`apps/till/src/i18n/t.ts:61-71`).
   The bell's alert carries the two times only (decision 10).
4. **Times on the dashboard read `2025-03-14 09:12`, not `14/03/2025 09:12`** (picture 9): the
   dashboard writes every instant with `formatIsoMinute` (`packages/dashboard-kit/src/date-format.ts:3-9`),
   as slice 7's Departure 7 chose for the Box status page. The till writes `14/03/2025 09:12`
   (picture 8).
5. **The Clock row has no proof line and no restart** (picture 9's "3 dispositivos marcan…" and
   "Reanudar los cobros" are slice 9's, design §8 item 9).
6. **The design's reason for pausing the tender-refund loop is half false, and the bill-refund
   half of the bill-payments pass pauses too [I3].** Design §4.8 e: "It sends a refund whose first
   send never happened … so it gives money back through no route at all". It does not: the loop
   resumes with the `loop` resolver, which fails a never-sent refund without asking the provider
   and never resends (R4; the passing cases `tender-refunds.test.ts:855` and `:1362`). The design's
   other reason holds: "its record would be dated by the wrong clock". A completed refund's
   `completed_at` comes from the box's clock and places it in a cash-up window (R4). That is just as
   true of the bill-refund half, which the design does not mention. Decision 16 pauses both, by one
   rule.

## Decisions this plan makes that the design does not

Each is a DEFAULT to build; the owner or the plan review may overrule any.

1. **The seat gains two methods, beside slice 3's `assertRecordableAt`.**
   `clockBehindLatestRecord(tx, reading): Promise<ClockBehindLatestRecord | null>` answers the four
   params when the stop is open, else `null`; `refuseWhileClockBehind(tx, reading): Promise<void>`
   throws. The type `ClockBehindLatestRecord` (`{ clockAt; offsetMinutes; lastRecordAt;
   lastRecordOffsetMinutes }`, ISO strings and minutes) is declared in
   `packages/fiscal/src/backend.ts`. No name or string in `packages/fiscal` may hold "chain" or
   any other word of the vocabulary guard's list (R1) **[I1]**. The Veri\*Factu backend
   delegates to `clock-behind.ts`; `NoneBackend` and `FakeFiscalBackend` answer `null` and return
   (design, "Decisions revision 5 makes" 16: only the Veri\*Factu module stops). The generic code
   never throws `clock.behind_chain` itself; the module does, so the code is declared in the
   module's registry, as the design says and as `clock.unusable` is
   (`packages/fiscal-verifactu/src/errors.ts:352-358`).
2. **The 28-10-2024 rule first** (design §4.8 d, "The 28-10-2024 rule is checked first"):
   `refuseWhileClockBehind` calls `refuseBeforeFirstIssueDate` (`first-issue-date.ts:15-25`)
   before reading the latest record. `clockBehindChain` (and so the seat's
   `clockBehindLatestRecord`) does not: it answers the times for any
   reading more than a minute behind, so the bell shows the stop under a 2001 clock too (slice 9
   adds `clock.unusable`'s own alert and settles which wins, `docs/backlog.md:5636-5640`), and the
   staff notice picks `clock.unusable` over it (design §4.2, "Two reds at once").
3. **Where the named check goes, route by route.** As the first statement after the route's replay
   answer, in the request's first transaction; where a route has no replay, the first statement
   after its authorization. A replay answered before the check is one that moves no money: a
   settled order, a bill payment's first row, a COMPLETED or FAILED refund. A pending refund's
   resend is checked before it resumes **[C1]**. The places:
   - `runPayWorkingOrder`, beside slice 3's full-disk check right after the replay
     (`till-sale.ts:688-691`). `/api/sales` and the counter's `/api/pay` reach it.
   - `payIntegrated`, right after the replay return (`:1163-1168`), before every branch.
   - `runCollectOrder`, beside the full-disk check after the replay (`:2138-2141`).
   - `beginBillPayment`, after the replay and id-reuse checks (`bill-payments.ts:1068-1078`), as
     `await backend.refuseWhileClockBehind(tx, reading)`: the function already holds `backend` and
     `reading` (`:1050-1060`), and `assertRecordableAt(reading)` judges the same reading at `:1092`
     **[M9]**.
   - `refundBillPayment`, in two places, because the code answers a pending replay (`:619-621`)
     before a finished one (`:622-625`), so no single line sits between them **[M1]**: inside the
     `pending` branch, before `return { kind: "resume" }` at `:620`, because resuming can send money;
     and after the id-reuse refusal (`:627-629`), before `requireOpenBill` at `:631`, for every new
     refund. A finished refund's replay (`:622-625`) still answers.
   - `beginSettledTenderRefund`, in two places **[C1]**. At `tender-refunds.ts:85`,
     `if (begun.replayed)`: when the replayed row is `pending`, the check runs before it is returned,
     so `refundSettledTender` never reaches `resumeTenderRefund(deps, refund.id, "retry")` at `:153`
     for it; a completed or failed row returns unchecked. Then, right after `:85`, the check for
     every new refund, whose reservation row the same transaction rolls back.
   - The tender-refund retry route, inside its authorized callback after `readRefund`
     (`tender-refund-api.ts:274`).
   - `recordUnpaidDeparture`, right after `authorize` (`unpaid-departure.ts:75-79`), so a wrong
     override PIN is still counted first; the route has no replay **[M2]**.
   - The eight dashboard resolutions in `apps/server/src/payments-api.ts` (`:1047`, `:1197`,
     `:1264`, `:1342`, `:1411`, `:1434`, `:1486`, `:1508`), first inside the authorized callback
     (`gated` or `pinGated`), so an unauthenticated caller is told nothing about the records. Two of
     those callbacks take no transaction today (`:1415`, `:1442`); Task 10 says what each gains
     **[M3]**.

   **One reading [I6].** The check judges the reading the route already takes, never a second one
   of its own. The route takes `const reading = deps.clock.now()` once, at the check, and:
   - where the same transaction then rates an invoice, it hands the issue a clock pinned to that
     reading, so the invoice is rated and dated from the reading the check judged:
     `runPayWorkingOrder` → `fileImmediateSale`'s `issueMoment` (`till-sale.ts:964`), and
     `recordUnpaidDeparture` → `priceForIssuance` (`unpaid-departure.ts:118`). The pinned clock is
     the one `issueMoment` already builds (`issue-moment.ts:22-30`), made an export (`pinnedAt`)
     with no change to what `issueMoment` does;
   - where the transaction issues nothing, the reading stamps the route's own write:
     `runCollectOrder`'s `settledAt` (`till-sale.ts:2168`), `refundBillPayment`'s `createdAt`
     (`bill-refunds.ts:656`), `beginSettledTenderRefund`'s `createdAt` (`tender-refunds.ts:73`);
   - `beginBillPayment` uses its `reading` parameter;
   - where the issue comes in a LATER transaction, after the card reader (`payIntegrated`), the
     check judges its own reading in the first transaction, and the issue keeps its own later
     reading, which the chain check judges again;
   - the retry route, the two pending-refund branches and the dashboard callbacks take one reading
     for the check. Whether a stamp later in those transactions should share it was not checked;
     Task 7 Step 0's whole-suite gate shows any existing case that pins one.
   The existing case that pins this is `vat-rate-at-issue.test.ts:498-515` ("prices and dates the
   invoice from one reading, even when the clock crosses midnight during the request"). With a
   second reading for the check it failed (R6); it must pass unedited.
4. **The chain check is `attemptAppend`'s first statement, inside the savepoint**, not
   `appendToChain`'s, before its retry loop. E6: before the loop it breaks three `chain.test.ts`
   cases whose `tx` stubs only `transaction`; E9: inside the attempt they pass unedited. It runs
   again on each attempt, a one-row index read (E5). It refuses with `clock.unusable` for a reading
   before 28-10-2024, and with `clock.behind_chain` during the stop. For an alta, `validate` refuses
   a reading before 28-10-2024 today as `fiscal.record_invalid` (`chain.ts:186-193`; claim-check
   `fs1b-refused-append-control-no-check.log`, `FECHA_EXPEDICION_BEFORE_MINIMUM`). An anulación under such a
   clock is recorded today (claim-check `fs2-anulacion-2001.log`; review X6, `validate` gave `[]`)
   and is newly refused. So the set of refused records grows by the stop, and by an anulación under
   a clock before 28-10-2024 **[M4, claim-check §4]**. No server route issues an anulación today:
   `/usr/bin/grep -rn 'recordVoid(' apps/server/src` prints three lines, all in test files or
   `testing/` (`fiscal-none.e2e.test.ts:248`, `testing/order-venue.ts:221`,
   `adjustments-report.test.ts:310`). A refused attempt has written nothing; the caller's
   transaction rolls back whole, invoice number included (Task 3 proves the next sale takes the
   next number). This also closes slice 3's open entry: a whole-invoice credit under a 2001 clock
   now answers `clock.unusable` (`docs/backlog.md:5631-5635`).
5. **The check lives in `clock-behind.ts`, and `chain.ts` gains only its import and one call.**
   `chain.ts` is a listed incident-code source in `scripts/alert-codes.test.ts:34`, which reads its
   dotted literals as recorded incident codes; `"clock.behind_chain"` there would be read as one.
6. **The margin is strictly more than 60 000 ms**, judged between the reading's instant
   (milliseconds) and the stored latest record time (whole seconds, E5). A reading exactly 60 000 ms
   earlier sells; 60 001 ms earlier is stopped.
7. **The latest record is read as `select fecha_hora_huso_gen_registro, offset_minutos from
   registros_facturacion order by fecha_hora_huso_gen_registro desc limit 1`**, the drizzle query
   E5 printed, served by the new index. The offset is read for decision 3 of the departures.
8. **The index is named `registros_generado_idx`**, beside `registros_sale_idx` and
   `registros_node_secuencia_idx` (`registros.ts:125-126`).
9. **No email and no one-minute watch in slice 8; the clock email is slice 9's [I7].** The
   design's email (subject and body, §4.8 c) needs this slice's seat, so its home must be a slice
   that can build on slice 8. Slice 10 cannot: it lands itself and depends on 5 and 6 only, and it
   must not be made to depend on 8. Slice 9 can: it already depends on 8 and parks (build plan
   Part 1, row 9). Slice 10 still builds the "once per episode" sender for its own red conditions
   (disk full, clock before 28-10-2024) and the 2 GB warning; slice 9 adds the clock-behind email
   to that sender. So slice 9 now also depends on 10, and the lane builds 10 before 9; the build
   plan's rows 9 and 10 and its order line say so (this revision edits them). The watch's only job
   in the design was the email (§4.8 d, "a one-minute watch that raises the alert and sends the
   email"); the alert is worked out on each bell read and needs none, and slice 9 decides whether
   its email needs a watch. Task 18 moves the email's words to slice 9's backlog entry.
10. **The alert `clock.behind_chain`** is an ongoing source in the Veri\*Factu module's
    `FISCAL_ALERTS.sources` (`packages/fiscal-verifactu/src/alerts.ts:7-10`): area `"box"`,
    permission `"system.manage"`, severity `"error"`, `screen: "box-status"`, `since: null` (the
    stop's start is not stored, design §7), params `{ clockAt, lastRecordAt }` read with
    `clockBehindChain(tx, { instant: now, offsetMinutes: 0 })` (the alert context carries no offset,
    `packages/module/src/alerts.ts:29-32`; the dashboard writes both times in the browser's zone).
    It is not a recorded incident, so `CORE_ALERTS`' claim on `clock.` (`packages/db/src/alerts.ts:7`)
    and the area-claim rule do not bite (design §4.8 c). On the Box status page `partOfAlert` already
    puts any `clock.*` alert on the Clock row before the `box` area's Disk row
    (`apps/dashboard/src/screens/box-status-rows.ts:61-63`).
11. **`fiscal.clock_drift` is left out while the stop is open** by the stop's state, never by which
    alerts a person can see: `authorityClockAlertSource(read, stopped)` (`apps/server/src/time-health.ts:102-120`)
    gains `stopped: (tx, now) => Promise<boolean>`, which boot wires to
    `tillBackend.clockBehindLatestRecord(tx, { instant: now, offsetMinutes: tillClock.now().offsetMinutes }) !== null`.
    The drift alert needs `fiscal.view` and the stop's `system.manage` (decision 10); suppressing by
    what the bell shows would leave the drift's "you can continue selling" in front of a person
    holding only the first.
12. **The strip's notice** comes from the module's existing source (`FISCAL_STAFF_NOTICES`,
    `packages/fiscal-verifactu/src/staff-notices.ts:52-59`): `clock.unusable` before 28-10-2024,
    otherwise `clock.behind_chain` (severity `error`, key and code `clock.behind_chain`, params the
    four of decision 1) while the stop is open, otherwise nothing. The box's own source comes first
    (`apps/server/src/box-staff-notices.ts:41-49`), so a full disk's red still leads.
13. **Server tests take their times from the database, and every write in them does [I8].** The
    suites this plan copies share one venue per file (`resetPerTest: false`:
    `till-pay.clock.test.ts:24`, `till-pay.disk-full.test.ts:36`,
    `bill-payments.refuse-before-reader.test.ts:25`), so a case that records moves the latest record
    time for every later case. A case that records AHEAD of the real clock makes a later real-clock
    sale in the same database refused: the review's F9, on `provisionBillVenue`, recorded a sale two
    minutes ahead, and the next real-clock sale answered `clock.behind_chain`
    (`{"clockAt":"…21:54:16.638Z","lastRecordAt":"…21:56:16.000Z"}`); the control, 59 s behind,
    was served. So, in every new `clock-behind-stop.*.test.ts` file:
    - the file's setup records one sale at the real clock, so NOW (`select
      max(fecha_hora_huso_gen_registro)`) has a value from the first case (NOW is null in a database
      with no record);
    - each case reads NOW at its start and builds every clock from it (`clockAt`, as
      `till-pay.clock.test.ts:47-51` builds one);
    - every write uses such a clock, helpers included: requests go to `venue.appAt(clock)`
      (`testing/bill-venue.ts:91`), never `venue.app`, which stamps the real clock (`:122`, `:316`);
      the file's own `placedIssuedOrder` takes a clock (the copy of
      `till-pay.disk-full.test.ts:104-116`, which today files with `venue.clock`); a shared helper
      with no clock parameter (`seatedWith`, which posts to `venue.app`, `bill-venue.ts:447-460`) is
      handed `{ ...venue, clock, app: venue.appAt(clock) }`;
    - a case that must write on a clock not built from NOW gets a database of its own.
    Task 16's testing rule names this shape.
14. **A card charged as the stop begins answers `sale.charged_not_recorded` with
    `reason: "clock_behind_chain"`.** `afterCardCharged` (`bill-payments.ts:1246-1259`) maps
    `clock.behind_chain` as it maps a full disk, and the flag `sayCardChargedOnFullDisk` is renamed
    `sayCardChargedNotRecorded` (eight sites in four files, E12).
    The code's HTTP status stays 507 (`till-api.ts:435`): the error boundary keys its status by code
    (`packages/server-kit/src/error-boundary.ts:41-46`), slice 3's tests pin 507 for the disk reason
    (`/usr/bin/grep -c '507' apps/server/src/card-charged-not-recorded.test.ts` counts 13 lines
    **[claim-check §4]**), and the till reads the code and
    reason, never the status (E12: `507` appears in no `apps/till/src` file outside tests).
    Task 18 files the wrong-sounding status as an open point.
15. **`BillRefundDeps` gains `backend`** (required; `apps/server/src/bill-refunds.ts:73-76`), so the
    refunds and `TenderRefundDeps` (`tender-refunds.ts:20`) can ask the seat; the typecheck lists
    every place that builds one.
16. **Both refund recovery loops wait for the whole stop, by one rule [I3].** The rule: a loop
    pauses during the stop if any outcome it records writes a fiscal record or sends money;
    otherwise it keeps running, unless dating its outcome by the behind clock harms something
    named. Applied (R4):
    - **The tender-refund loop** (`recoverTenderRefunds`, `tender-refund-recovery.ts:22-98`) never
      sends and writes no fiscal record: it records refund outcomes (a never-sent refund failed, a
      lookup's answer). The design's "it sends a refund" is false (Departure 6). But a completed
      outcome stamps `completed_at` from the box's clock, and the cash-up counts the refund in the
      window holding that time (`packages/reporting/src/cash-up.ts:59-61`), so a refund the
      provider completed today would be counted in an earlier window. **Pauses.** It reads the stop
      once with the reading it already takes (`:25`) and returns before its batch, touching no row
      and raising no "unresolved" alert, with `nextDueAt` a minute on (`RECHECK_MS`, `:14`).
    - **The refund half of the bill-payments pass** (`settlePendingBillRefunds`,
      `bill-payments-loop.ts:244-290`) acts the same way (`resumeCardRefund(…, "loop", …)`, `:268`;
      `bill-refunds.ts:442-445`, `:460-467`), and its completed outcome is counted by
      `completed_at` too (`cash-up.ts:51-55`). **Pauses**, the same way: it returns before its
      batch, touching no refund row and raising no `payment.refund_unresolved`. The pass's payment
      half still runs (decision 17).
17. **What is not changed.** The Stripe webhook (`webhook.ts:122`, design §4.8 e): it stores the
    provider's own `settledAt` (`webhook.ts:111-115`), takes no new money and writes no record.
    The payment half of the bill-payments pass (`settlePendingBillPayments`,
    `bill-payments-loop.ts:160-200`), by decision 16's rule: a completion that would file is refused
    by the chain check and retried, raising `payment.bill_settle_failed` (design §4.8 e's table); a
    completion that leaves the bill part-paid writes no record, sends nothing, and is dated by the
    provider's `settledAt` (`:144-149`), so it is still marked received **(read)**. Two settle paths
    after the card reader commit a card charged as the stop begins, because both write no record
    and run after the named check **[M10]**: a card on an already-invoiced order
    (`finalizeSettle`, `till-sale.ts:1924-1980`, dated by `result.settledAt`, `:1933`) and a card
    part payment that leaves a bill part-paid (`completeBillPayment`, reached at
    `bill-payments.ts:1477-1494` with `settledAt` from the provider's result, `:1473`). The money
    has already moved, which is the design's own reason for letting the webhook record; Task 11
    case 4 pins that such a settle is recorded. The automatic card recovery
    (`pending-card-recovery.ts:23-83`): it goes through `payIntegrated`, so the named check refuses
    it during the stop and its next pass after files it (Task 11). Kitchen sends, orders,
    clock-ins, bill prints, reprints and the drawer: no check. `issueMoment`: what it does is
    unchanged; its pinned clock becomes an export (decision 3).
18. **`clock_stop_restarts`' columns are slice 9's needs, fixed now** because this is the build's one
    migration (design §4.8 b, "One row per restart: the node, the person, the time on the box's
    clock, the box's reading and the named record's time, the record's id, and the proof"):
    `id`, `node_id` (→ `nodes.id`), `person_id` (no foreign key: `persons` is in the identity
    module's set, which this set does not require — the precedent of `filing_case_events.person_id`,
    `schema/filing-cases.ts:60-63`), `restarted_at` (`ts`, when the restart was recorded),
    `clock_at` (`ts`, the reading the manager accepted), `registro_id` (→ `registros_facturacion.id`,
    unique: "a second restart of the same record is answered with the first"), `record_at` (`ts`,
    that record's time) and `proof` (`json`). Nothing reads or writes it in slice 8. The backup
    verifier's link list (`packages/fiscal-verifactu/src/backup-verification-history.ts:424-433`)
    is not extended; slice 9 adds its two links with its first writer (Task 18).
19. **Status 409 for `clock.behind_chain`** in the till's table beside `clock.unusable`
    (`till-api.ts:454`) and in the dashboard's payments table (`payments-api.ts:134`), which also
    gains `"clock.unusable": 409`: today it names neither, so a resolution refused under a clock
    before 28-10-2024 answers 400 (`/usr/bin/grep -n 'clock.unusable' apps/server/src/payments-api.ts`
    prints nothing; the boundary answers an unlisted code `?? 400`,
    `packages/server-kit/src/error-boundary.ts:42`, read) **[M6]**.
20. **Which words each refusal gets on the till.** The design's payment sentence, with the two
    times, on a payment press: the counter sale and Pay (`saleRefusalOf`, `apps/till/src/till-app.ts:1487-1512`;
    `refusalText`, `apps/till/src/widgets/pay-refusal.ts:47-84`) and a bill payment. The
    card-charged sentence for `sale.charged_not_recorded` with the clock's reason. The design's
    "other" sentence ("Can't be recorded: …") everywhere else, through `codeMessage`
    (`apps/till/src/i18n/codes.ts`): refunds, the unpaid departure, a cancel's credit, an order edit,
    a collect. A Pay of an order whose invoice was already filed also gets the payment sentence,
    whose "Sale not recorded" then means the payment; Task 18 files it.
21. **Parked**, as the build plan's row 8 says. Nothing in this plan narrows that.

## Behaviour this slice changes

1. While the stop is open: `POST /api/sales`, `POST /api/pay`, `POST /api/working-orders/:id/collect`,
   `POST /api/working-orders/:id/payments`, `POST /api/working-orders/:id/payments/:paymentId/refunds`,
   `POST /api/transactions/:saleId/refunds`, `POST /api/tender-refunds/:refundId/retry`,
   `POST /api/parties/:id/unpaid-departure` and the eight dashboard resolutions answer
   `409 clock.behind_chain` (replays excepted); every write that would append a record (an order edit
   completing a part-paid bill, a cancel's credit, the bill pass's completion, the card recovery's
   filing) is refused whole with it.
2. A record dated before 28-10-2024 is refused by the append as `clock.unusable`, no longer as
   `fiscal.record_invalid`.
3. The tender-refund recovery loop, and the refund half of the bill-payments pass, do nothing
   during the stop (decision 16). A resent request for a pending refund is refused like a new one.
   The dashboard's payment resolutions answer `clock.unusable` as 409, not 400.
4. New: the strip's red `clock.behind_chain` notice, the bell's `clock.behind_chain` alert, the Box
   status page's red Sales and Clock rows for it; `fiscal.clock_drift` leaves the bell during it.
5. `sale.charged_not_recorded` gains `reason: "clock_behind_chain"`; `sayCardChargedOnFullDisk` is
   renamed.
6. A new index on `registros_facturacion` and a new, empty, append-only table.

## Declared test-setup changes

Setup only, never an assertion; each named in its task's commit message.
- `packages/fiscal-verifactu/src/outage-upgrade.test.ts:17-31`, in two halves, both needed
  **[claim-check 2]** (Task 1):
  1. the predecessor journal keeps the entries whose tag sorts before `0009_aeat_outage_flag`
     (`entry.tag < "0009_aeat_outage_flag"`), not "all but 0009" (`:23`). With the new entry left
     in, the predecessor applies it, drizzle's watermark (`max(created_at)`, CLAUDE.md §3) passes
     0009, and 0009 never runs (E6 printed this case failing, `no such column: technical_incidence`);
  2. the fiscal set handed to `applyMigrationSet` for the predecessor (`:27-29`) also drops
     `clock_stop_restarts` from its `appendOnlyTables`. With the journal half alone, setup fails
     `no such table: main.clock_stop_restarts`, because `applyMigrationSet` installs the set's
     append-only triggers and the set still lists the new table (claim-check
     `e4b-outage-upgrade-setup-fix.log`); with both halves, `Tests 1 passed (1)`
     (`e4c-outage-upgrade-fuller-fix.log`; the diff is claim-check `scripts/prototype-full.diff`,
     its `outage-upgrade.test.ts` hunk).
- `packages/fiscal-verifactu/src/drain.test.ts:978-…`: the sale's backend and `saleInput` take a
  clock after the seeded envíos' `2026-07-20T19:20:30+01:00` (Task 3; E9).
- Backends that list the seat's methods by hand gain the two new ones, as delegating lines or
  no-ops, never an assertion **[I2, claim-check 3]**. This is "adding what a stub lacks", which the
  owner's 2026-09-27 rule allows. Known sites:
  - `packages/core/src/record-sale.test.ts:154` and `packages/core/src/record-void.test.ts:169`:
    each a `wrapBackend` helper that lists every method; each gains two delegating lines, as it has
    one for `assertRecordableAt` (Task 4);
  - `packages/core/src/record-void.test.ts:378`, a typed literal (`const backend: FiscalBackend = {`,
    not `{} as FiscalBackend`), gains `refuseWhileClockBehind: async () => {}` and
    `clockBehindLatestRecord: async () => null` (Task 4);
  - the review's X2 typecheck found no other failing package once the three backends implement the
    methods;
  - `apps/server/src/till-api.test.ts:332` and `apps/server/src/till-api.zone-required.test.ts:173`,
    `backend: {} as FiscalBackend`, which compile but answer 500 once a route calls the check
    (R6: `till-api.test.ts:4459`, and four cases at `till-api.zone-required.test.ts:271` and
    `:283`). Each stub gains the same two no-ops (Task 7) **[I6]**;
  - any other `{} as FiscalBackend` stub Task 7 Step 0's gate finds, the same way.
- The ten `apps/server` cases E8 lists (Task 3b): each records an invoice dated before a record its
  database already holds. Remedy, in this order: record the older invoice first within the case, so
  no later record precedes it; or move the case, unchanged, into a file of its own whose database
  holds nothing later. Never change a date an assertion reads, never an assertion. A remedy may
  MOVE an `expect(` line within a case, byte for byte (the reorder in claim-check
  `scripts/t3b-orders-api-reorder.diff` moves two, and the file passes, `26 passed`)
  **[claim-check §4]**.
- Nothing else known before Task 7 Step 0: `packages/core` and `packages/composition` passed whole
  with the chain-check prototype, and `packages/provisioning`'s seven failures fail the same way on
  the unedited branch (E13). The server suite with every named check in place has not been run
  whole; Task 7 Step 0 runs it and classifies each failure before Task 8a starts.

## Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work only in this worktree. Stage explicit
  paths; never `git add -A`.
- **The fiscal core rule.** Not edited: `@waitron/verifactu` (outside the repo), `registro-row.ts`,
  `backend.ts`'s record methods (`recordSale`, `recordVoid`, `recordCorrection`,
  `recordSubstitution`), `packages/core/src/record-*.ts` **outside `*.test.ts`**, the series and
  numbering code, the golden test `write-path.e2e.test.ts` and `inmutabilidad.test.ts`. The three
  `packages/core` test sites of "Declared test-setup changes" are setup, not the fiscal core
  **[I2]**. `chain.ts`'s diff is exactly one import and one call (Task 3 shows it). After every
  task touching `packages/fiscal-verifactu` or `packages/core`:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  passes, and
  `git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts packages/fiscal-verifactu/src/registro-row.ts packages/core/src ':!packages/core/src/*.test.ts'`
  prints nothing. (R2: this pathspec hides a changed `packages/core` test file and still prints a
  changed `record-sale.ts`.)
- **Migrations:** generated, never hand-written; no number hardcoded; never edit a shipped
  migration (CLAUDE.md §3). If drizzle-kit's output differs from E1's three statements, STOP.
- **Module seams:** no file under `apps/server/src` imports `@waitron/fiscal-verifactu` outside
  `testing/` (`scripts/module-seams.test.ts`); the server reaches the rule through `FiscalBackend`.
- **Transactions:** the named check runs on the route's own transaction (`tx`), awaited, never in
  `Promise.all` (CLAUDE.md §3). The alert and notice sources only read.
- **Error codes:** `clock.behind_chain` is new (E12's grep for `behind_chain` found nothing; its
  siblings `clock.degraded`, `clock.jump_detected` in `packages/fiscal/src/errors.ts:9-12`,
  `clock.unusable` in the module's registry). `sale.charged_not_recorded` gains a reason. No other
  code. Every file that throws one imports its registry.
- **Words:** general code is English only (CLAUDE.md §3). Spanish appears only in
  `apps/till/src/i18n/strings.ts` and `codes.ts`, `apps/dashboard/src/i18n/strings.ts`,
  `alert-messages.ts` and `codes.ts`, and `apps/server/src/guide/es/`. `scripts/english-only.test.ts`
  scans only some packages, so each task greps its own diff:
  `git diff main -U0 -- apps packages ':!*/i18n/*' ':!apps/server/src/guide/es/*' | /usr/bin/grep -nE '^\+.*(cobr|venta|hora del|encargado|equipo)'`
  prints nothing outside `packages/fiscal-verifactu`. The pattern leaves out `registr`, which
  matches identifiers this plan's own tests use (`registroCount`, `fecha_hora_huso_gen_registro`,
  `registros_facturacion`; R3) **[M5]**. Those identifiers, and the new table's `registro_id`, are
  existing schema names and allowed.
- **Tests:** database tests use `useVenueDb` (CLAUDE.md §4). A rejected write asserts the domain
  code and params, never `toBeInstanceOf(Error)`. Every "never called" is a count on the
  `FakePaymentProvider`'s own `collectCalls` or `refundCalls` before and after, and every "nothing
  written" a row count before and after. Each refusing case has its control a minute inside the
  margin that goes through.
- Coverage 98/98/98/95 in every touched package; no exclude, no ignore comment. If a schema file's
  `.references(...)` callbacks pull branch or function coverage under the bar, close the gap with a
  test, never an ignore pair (Task 1) **[claim-check §4]**.
- Comments only for an invariant or a non-obvious why; no history, no slice numbers in code.
- Focused runs: `pnpm --filter <pkg> exec vitest run <files>`; root guards
  `pnpm exec vitest run scripts/<guard>.test.ts`. Read the `Tests` count every time. Vitest hides a
  passing test's console output under this agent; unset `AI_AGENT` and `CLAUDECODE` to see it.
  Every task runs `pnpm exec prettier --check` on the files it touched (for a file under `docs/`,
  `pnpm exec prettier --file-info <file>` prints `"ignored": true` instead). CI runs the package
  suites and coverage. `TESTCONTAINERS_RYUK_DISABLED=true` for every local run.
- `apps/till`, `apps/dashboard` and the browser half of `packages/fiscal-verifactu` run in real
  headless Chromium: check `memory_pressure | grep free` first; run beside another session's browser
  run only when free memory is well above 15%.

## Review focus

The conditions most likely to bite that no happy path exercises, each with its test.

1. **A money path that reaches a reader or a refund without the check.** Expected: none. The
   §8 item 8 cases (Tasks 7–10) count the fake provider's `collectCalls` and `refundCalls`; Task 7
   proves the check sits before `payIntegrated`'s first branch by deleting it and watching the
   filed-order case call `collect` (E10's (b)). A resent request for a PENDING refund is a money
   path too: it resumes the refund, and resuming can send (C1; Task 9 case 8).
2. **A record written during the stop by a path nobody listed.** Expected: refused by the chain
   check whatever the caller (Task 3; Task 8b's order edit and credit).
3. **A refused append that consumes an invoice number or leaves a row.** Expected: nothing written;
   the next sale takes the next number (Task 3 case 1).
4. **The margin.** 60 000 ms sells, 60 001 ms stops, judged against whole-second stored times (E5;
   Task 2 cases 2–3).
5. **Every chain.** A database whose own node's chain is empty and whose older chain holds the
   latest record is stopped; one with no records is not (Task 2 cases 5–6; Task 12).
6. **Replays.** A settled order, a bill payment's first row and a completed or failed refund are
   answered, writing nothing (Tasks 7, 8a, 9). A pending refund's resend is refused before it
   resumes: for bill refunds, Task 8a case 6; for tender refunds, Task 9 case 8, "a pending
   connected refund resent during the stop → 409 `clock.behind_chain`, `refundCalls` unchanged, the
   row still pending", with its proof by deletion **[C1]**.
7. **What keeps working.** Orders, kitchen sends, clock-ins and bill prints during the stop (Task
   12); a draft submit on a bill with no payments goes through while the same on a part-paid bill
   is refused whole (Task 8b).
8. **The fiscal core.** The golden test and `inmutabilidad` unedited and green; `chain.ts` changed
   by one import and one call.
9. **One reading.** The named check judges the reading the route issues or stamps with; the
   existing `vat-rate-at-issue.test.ts:498-515` passes unedited (Task 7) **[I6]**.
10. **Loops.** Neither refund loop touches a row during the stop, and each settles it after (Task
    9 cases 4 and 4b) **[I3]**.

## Review path

**FULL** (build plan row 8: fiscal invariants, cross-package contract, migrations): per-task
reviews, the full `/finish-branch` wave, and two Codex run-it reviews side by side. The fresh-context
plan-against-spec read runs before implementers start. The slice is **parked** for the owner.

**The pull request description says**, in its first lines: it is parked (it adds a check inside the
record append and refuses order edits that would file an invoice); it carries the build's one
migration — an index and a NEW append-only table, `clock_stop_restarts`; a box's first start on it
raises no `append_only.triggers_restored`, because that warning counts only tables that existed
before migrating (E7; CLAUDE.md §3's sentence is for an existing table marked append-only); and it
edits no shipped migration, so no venue reset is needed.

**Codex seat 1 (with this plan's checklist).** Experiments decided up front:
- Boot a server on a venue with one card sale recorded, its clock a day behind it (the
  `serverFixture` of `apps/server/src/boot.disk-full-wiring.test.ts`, or `wa-wt demo` with the
  box's clock faked in a test harness — not by setting the Mac's clock): `POST /api/pay` for a
  counter card sale and for a placed order whose invoice was filed → `409 clock.behind_chain`, the
  fake provider's `collectCalls` unchanged; `GET /api/device/equipment` → the red notice;
  `GET /management-api/alerts` as a manager → `clock.behind_chain`, no `fiscal.clock_drift`; then
  the clock a minute after the record → the same pay is `200`.
- Delete, one at a time, the named check in `payIntegrated`, in `beginBillPayment`, each of the two
  in `beginSettledTenderRefund` (the pending replay's and the new refund's), and the chain check's
  call in `attemptAppend`; name the test that fails for each.
- Run `scripts/migration-upgrade.test.ts`, then migrate a venue folder made on `main` with records in
  it through `applyMigrations` and start it: the index exists, the table has its two triggers, no
  `append_only.triggers_restored` is logged.

**Codex seat 2 (told to set the checklist aside).** Find a way to move money or write a record
while the stop is open: list every caller of `collect(`, `sendRefund(`, `settleSale(`,
`recordSale(`, `recordCorrection(` and `issueIfFullyPaid(` under `apps/server/src` and try each with
the clock a day behind; try readings 59 999, 60 000, 60 001 and 61 000 ms behind a record stored at
whole seconds; try a record stored with a `+120` offset and a reading with `+60`; step the clock
back while a card is at the reader (`FakePaymentProvider.holdNextCollect`) and check nothing is
charged twice once it is fixed.

---

### Task 1: The migration — the index and the restarts table

**Files:**
- Create: `packages/fiscal-verifactu/src/schema/clock-stop-restarts.ts`,
  `packages/fiscal-verifactu/src/clock-stop-restarts.test.ts`
- Modify: `packages/fiscal-verifactu/src/schema/registros.ts` (the index, beside `:125-126`),
  `packages/fiscal-verifactu/src/schema/index.ts` (explicit export, never `export *`),
  `packages/fiscal-verifactu/src/classification.ts` (`appendOnly("clock_stop_restarts", "ledger", LEDGER)`
  after `fiscal_reservations`), `packages/migrations/migrations.manifest.json` (the fiscal set's
  `appendOnlyTables`, `:84-91`)
- Generated: `packages/fiscal-verifactu/drizzle/<NNNN>_clock_stop.sql`, its snapshot, `_journal.json`
- Modify (declared changes 1–3): `scripts/append-only-triggers.test.ts`,
  `packages/fiscal-verifactu/src/schema-ownership.test.ts`, `scripts/schema-constraints.test.ts`
- Modify (setup): `packages/fiscal-verifactu/src/outage-upgrade.test.ts:17-31` (both halves)

**Interfaces:** `clockStopRestarts` (decision 18's columns), built from `@waitron/db`'s vocabulary
(`id`, `ts`, `json`, `newId`, `nodes`, `table`) and drizzle's `uniqueIndex`. **No `/* v8 ignore */`
pair** around the `.references(...)` callbacks: follow `schema/filing-cases.ts`, whose foreign keys
(`:37`, `:56`, `:65`) carry none, not `schema/sif.ts:17-19`. If the package's branch or function
coverage then falls under its bar, close it with a test that makes those callbacks run (which test
does that was not checked) **[claim-check §4]**. A doc comment says it is declared
`appendOnly()` in `../classification.ts` and that slice 9's restart is its only writer, and the
`person_id` column carries `filing-cases.ts:60-63`'s reason for no foreign key.

- [ ] **Step 1: Write the failing test** `clock-stop-restarts.test.ts` (`useVenueDb` with
  `TEST_MIGRATIONS`, `seedPendingEnvios` or `seedTenantWithSif` for a real record):
  1. "refuses an update and a delete": a row inserted naming a real record; `update` and `delete`
     each throw `clock_stop_restarts is append-only` (the trigger's message, as E2 printed for the
     guard).
  2. "answers a second restart of the same record with a refusal": a second row naming the same
     `registro_id` is refused by `clock_stop_restarts_registro_uq` (`isUniqueViolation`).
  3. "refuses a row naming no record": a random `registro_id` is refused at the write (a foreign key
     is refused at the first write, CLAUDE.md §3).
  4. "reads the latest record time through the index": `explain query plan` of decision 7's query
     names `registros_generado_idx`. The failing case prints a plan without it (E5).
- [ ] **Step 2: Run and watch it fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-stop-restarts.test.ts` → fails to
  resolve `./schema/clock-stop-restarts.js` (or `no such table`).
- [ ] **Step 3: The schema, then generate.** Write the schema file, the export, the index and the
  classification line, then `pnpm --filter @waitron/fiscal-verifactu exec drizzle-kit generate --name clock_stop`.
  Check the generated file holds E1's three statements and nothing else:
  `/usr/bin/grep -ci 'DROP TABLE\|__new_\|PRAGMA' packages/fiscal-verifactu/drizzle/*_clock_stop.sql`
  prints `0`; its journal entry's `when` is above the previous entry's (`scripts/journal-monotonic.test.ts`).
  Add `"clock_stop_restarts"` to the manifest's fiscal `appendOnlyTables`.
- [ ] **Step 4: Declared changes and setup.** `EXPECTED` and `OWNED` gain the table (declared 1, 2);
  `schema-constraints.test.ts` gains `["clock_stop_restarts", ["node_id"], "nodes"]`,
  `["clock_stop_restarts", ["registro_id"], "registros_facturacion"]` and
  `"clock_stop_restarts_registro_uq"` (declared 3) — these three go in their own commit (Step 7).
  `outage-upgrade.test.ts` takes BOTH halves of its declared setup change: the journal filter keeps
  the entries whose tag sorts before `0009_aeat_outage_flag`, and the predecessor's fiscal set drops
  `clock_stop_restarts` from its `appendOnlyTables`. With the first half alone its setup fails
  `no such table: main.clock_stop_restarts` (claim-check finding 2) **[claim-check 2]**.
- [ ] **Step 5: Run.** The new file → PASS (`Tests 4 passed`). Then
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/append-only-migration-sets.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/column-vocabulary.test.ts scripts/apply-migrations-callers.test.ts scripts/fiscal-certificate-migration.test.ts`
  → every file passes; `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`
  → PASS (E3: this is what fails without the manifest);
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts src/migrations.test.ts src/classification.test.ts src/schema/schema-conformance.test.ts src/schema-ownership.test.ts src/outage-upgrade.test.ts`
  → PASS. `pnpm --filter @waitron/fiscal-verifactu typecheck` exits 0.
- [ ] **Step 6: Proofs by deletion**, each restored and re-run: drop the manifest entry →
  `composition.test.ts` FAILS; drop the classification line → `classification-complete` or
  `append-only-triggers` FAILS; drop the index from the schema and regenerate in a throwaway
  worktree (`git worktree add --detach`, then `pnpm install --frozen-lockfile --offline`), never in
  this worktree's `drizzle/`: drizzle-kit writes to the package's own `drizzle/` from its
  `drizzle.config.ts`, so a `mktemp -d` copy of one folder does not work (claim-check, note on row
  67) → case 4 FAILS. Remove the throwaway worktree. Report each.
- [ ] **Step 7: Commit, in two.**
  ```bash
  git add packages/fiscal-verifactu/src/schema/clock-stop-restarts.ts packages/fiscal-verifactu/src/schema/index.ts packages/fiscal-verifactu/src/schema/registros.ts packages/fiscal-verifactu/src/classification.ts packages/fiscal-verifactu/drizzle packages/migrations/migrations.manifest.json packages/fiscal-verifactu/src/clock-stop-restarts.test.ts packages/fiscal-verifactu/src/outage-upgrade.test.ts
  git commit -s -m "The record table gets an index on its generation time, and an append-only table is ready for a manager's restarts of payments"
  git add scripts/append-only-triggers.test.ts packages/fiscal-verifactu/src/schema-ownership.test.ts scripts/schema-constraints.test.ts
  git commit -s -m "Changed test checks (A798 slice 8): the append-only, ownership and constraint lists name clock_stop_restarts"
  ```
  The second message lists each `file:line` with before and after. The outage-upgrade setup change
  is named in the first message's body.

### Task 2: The module's rule — is the clock behind the latest record?

**Files:**
- Create: `packages/fiscal-verifactu/src/clock-behind.ts`, `packages/fiscal-verifactu/src/clock-behind.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (beside `clock.unusable`, `:352-358`)

**Interfaces:**
```ts
/** The reading, and the latest record time across every chain this database holds, when the
 * reading is more than a minute earlier than it; each time with its own offset. */
export interface ClockBehind { clockAt: string; offsetMinutes: number; lastRecordAt: string; lastRecordOffsetMinutes: number }
export const CLOCK_BEHIND_MARGIN_MS = 60_000;
export async function clockBehindChain(tx: Transaction, reading: { instant: Date; offsetMinutes: number }): Promise<ClockBehind | null>;
/** `clock.unusable` before 28-10-2024, else `clock.behind_chain` while `clockBehindChain` answers. */
export async function refuseWhileClockBehind(tx: Transaction, reading: { instant: Date; offsetMinutes: number }): Promise<void>;
```
`errors.ts` gains `"clock.behind_chain": { clockAt: string; offsetMinutes: number; lastRecordAt: string; lastRecordOffsetMinutes: number }`,
with a doc comment naming its thrower. (Task 4 moves the interface into `@waitron/fiscal` as
`ClockBehindLatestRecord` and the module re-uses it; the shape does not change. The module's
function keeps the name `clockBehindChain`.)

- [ ] **Step 1: Write the failing tests** (`useVenueDb` with `TEST_MIGRATIONS`; records written
  through `VerifactuBackend` and `recordSale` with a clock built as E5's probe builds it,
  `scripts/zz-latest-record.test.ts`):
  1. "never stops a database with no records": `clockBehindChain` answers `null` for a reading in
     2026 and for one a year earlier; `refuseWhileClockBehind` returns for the 2026 one.
  2. "sells a reading exactly a minute earlier": a record at `T` (whole seconds); a reading at
     `T − 60 000 ms` → `null`, and refuse returns.
  3. "stops a reading a millisecond more than a minute earlier": `T − 60 001 ms` → the four params
     (`clockAt` the reading's ISO, `offsetMinutes` the reading's, `lastRecordAt` `T`'s ISO,
     `lastRecordOffsetMinutes` the record's `offset_minutos`); refuse throws
     `clock.behind_chain` with exactly those params.
  4. "does not stop a reading after the latest record".
  5. "judges against the latest record in any chain": a record on a second node's chain at `T`
     (a second SIF on another node, as `test/fixtures.ts` seeds `TENANT_A.nodeId2`), the first node's
     chain empty; a reading on the first node a day before `T` → stopped. This is the design's
     restored database (§4.8 d).
  6. "takes the latest instant, not the latest written": E5's three readings, the last written being
     a second earlier; the answer's `lastRecordAt` is the middle one.
  7. "refuses a 2001 reading as clock.unusable first": with a record present, a
     `2001-01-01T11:00:00.000Z` reading → refuse throws `clock.unusable` (`clockAt`,
     `offsetMinutes`); `clockBehindChain` answers the four params (decision 2).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/clock-behind.test.ts` → fails to resolve
  `./clock-behind.js`.
- [ ] **Step 3: Implement** decision 7's query, decision 6's comparison on `getTime()`, and decision
  2's order. One read, no write.
- [ ] **Step 4: Run, typecheck, format** → PASS; `pnpm --filter @waitron/fiscal-verifactu typecheck`
  exits 0; `pnpm exec vitest run scripts/errors-reachable.test.ts` passes.
- [ ] **Step 5: Proofs by deletion**: `<` → `<=` → case 2 FAILS; drop the margin → case 2 FAILS;
  `asc` for `desc` → case 6 FAILS; filter the read by the reading's node → case 5 FAILS; the 2024
  call after the read → case 7 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/clock-behind.ts packages/fiscal-verifactu/src/clock-behind.test.ts packages/fiscal-verifactu/src/errors.ts
  git commit -s -m "Veri*Factu can tell when the box's clock reads more than a minute earlier than the latest record in any chain"
  ```

### Task 3: The chain check — no record is written during the stop

**Files:**
- Modify: `packages/fiscal-verifactu/src/chain.ts` (one import; one call as `attemptAppend`'s first
  statement, before `readChainHead` at `:134`)
- Create: `packages/fiscal-verifactu/src/chain.clock-behind.test.ts`
- Modify (setup): `packages/fiscal-verifactu/src/drain.test.ts:978-…` and any file E11 lists

**Interfaces:** the call is
`await refuseWhileClockBehind(tx, { instant: registro.input.generadoEn, offsetMinutes: registro.input.offsetMinutes });`.
`git diff main -- packages/fiscal-verifactu/src/chain.ts` shows exactly that import and these four
lines; `scripts/prototype-chain.diff` (E9) is the shape.

- [ ] **Step 1: Write the failing tests**, shaped like `chain.record-validation.test.ts:57-75`
  ("writes nothing at all when it refuses"):
  1. "refuses a sale a day behind the last record and writes nothing": a sale at `T` takes
     `A/1`; a sale with a clock at `T − 1 day` rejects `clock.behind_chain` with its four params;
     then `registros_facturacion`, `sales`, `envios` and `incidents` counts, the node's
     `cadenas.secuencia` and `invoice_series.next_number` are as before it; then a sale at
     `T + 1 min` takes **`A/2`** and the chain's `secuencia` 2. The failing case for "consumes no
     number" would print `A/3`.
  2. "refuses a correction and an anulación the same way": `recordCorrection` (as
     `correction-path.e2e.test.ts` drives it) and `appendToChain` with `anulacionFor`
     (`chain.record-validation.test.ts:87-107`) at `T − 1 day` → `clock.behind_chain`, nothing
     written.
  3. "records a sale exactly a minute behind": `T − 60 000 ms` → recorded (the control).
  4. "refuses a 2001 record as clock.unusable": an alta appended with `generadoEn`
     `2001-01-01T11:00:00.000Z` → `clock.unusable`, both on a database with records and on one
     without (today `fiscal.record_invalid`; decision 4).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.clock-behind.test.ts` → cases 1, 2
  and 4 fail (recorded / `fiscal.record_invalid`); case 3 passes.
- [ ] **Step 3: Implement** the import and the call.
- [ ] **Step 4: Run the suites the append touches.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/chain.clock-behind.test.ts src/chain.test.ts src/chain.concurrency.test.ts src/chain.node-rekey.concurrency.test.ts src/chain.record-validation.test.ts src/chain.validation-warnings.test.ts src/correction-path.e2e.test.ts src/void-path.e2e.test.ts src/substitution-path.e2e.test.ts src/drain.test.ts inmutabilidad src/write-path.e2e.test.ts`
  → only `drain.test.ts:978` fails, `AppError: clock.behind_chain` (E9). Give that case's backend
  and `saleInput` a clock after `2026-07-20T19:20:30+01:00` — a setup change, named in the commit —
  and re-run → PASS. Then the whole package once, `pnpm --filter @waitron/fiscal-verifactu test`
  (it has browser files: check memory first): every failure must be a fixture dated after a later
  sale's clock (E11 lists the ones known); fix each by its clock, never its assertion, and list them
  in the commit message. Any other failure is a STOP.
- [ ] **Step 5: Proof by deletion**: remove the call → cases 1, 2 and 4 FAIL, and the golden test
  and `inmutabilidad` still pass.
- [ ] **Step 6: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/chain.ts packages/fiscal-verifactu/src/chain.clock-behind.test.ts packages/fiscal-verifactu/src/drain.test.ts
  git commit -s -m "The chain refuses to append a record whose time is more than a minute before the latest record"
  ```

### Task 3b: Server fixtures that date a sale before an earlier record

**Files:** `apps/server/src/bill-payments.test.ts`, `invoice-document.test.ts`, `orders-api.test.ts`,
`orders-invoice-deliveries.test.ts`, `orders-reprint.test.ts` (E8), and any new file a case moves to.
No product file.

After Task 3 these ten cases fail with `clock.behind_chain` (E8). Each records an invoice whose time
is earlier than a record already in its database: a fixed past issue clock in a file whose database is
shared, or an "older" finished bill recorded after today's.

- [ ] **Step 1: Run and see the ten fail**:
  `pnpm --filter @waitron/server exec vitest run src/bill-payments.test.ts src/invoice-document.test.ts src/orders-api.test.ts src/orders-invoice-deliveries.test.ts src/orders-reprint.test.ts`
  → exactly E8's ten names, each `AppError: clock.behind_chain`. Any other failure is a STOP.
- [ ] **Step 2: Fix each by its setup** (Declared test-setup changes, the remedy's order): record the
  older invoice first inside the case; or move the case, its body and assertions unchanged, into a
  new file with its own `useVenueDb` (copy only the `setup` it needs), so nothing later is in its
  database. `git diff main -- <file>` shows no CHANGED `expect(` line: an `expect(` line may only
  move, byte for byte, within its case (the reorder remedy moves two in `orders-api.test.ts`,
  claim-check `scripts/t3b-orders-api-reorder.diff`) or into a new file; check with `diff` of the
  sorted `-` and `+` `expect(` lines, and of a moved case's extracted block, and say so in the
  report **[claim-check §4]**.
- [ ] **Step 3: Run** the five files and any new one → PASS. Then the whole server package once,
  `pnpm --filter @waitron/server exec vitest run` (heavy: check memory first; about 945 files).
  Allowed failures **[M11]**:
  - `first-fiscal-launch.test.ts` "the built owned CLI refuses JSON authority…": fails on `main`
    under an agent, its stderr beginning with a `<claude-code-hint … />` line (E8);
  - known load flakes, each to be rerun ALONE before anything is called a STOP:
    `hour-recovery-placement-1.test.ts` and `hour-recovery-placement-2.test.ts` (`signal: null`
    where `SIGKILL` was expected), and `first-setup-unused-pdf.test.ts` "successive
    never-activated PDFs retain every old block while allowing a third replacement"
    (`Test timed out in 120000ms`). Rerun alone, such a case passes, or fails the same way on
    `main` in a throwaway worktree; either is not this slice's. One that fails alone with
    `clock.behind_chain`, or fails alone here and passes alone on `main`, is a STOP.
  Any other failure is a STOP.
- [ ] **Step 4: Commit.**
  ```bash
  git add apps/server/src/bill-payments.test.ts apps/server/src/invoice-document.test.ts apps/server/src/orders-api.test.ts apps/server/src/orders-invoice-deliveries.test.ts apps/server/src/orders-reprint.test.ts
  git commit -s -m "Test setup: server fixtures record an older invoice before a newer one, so the chain accepts it"
  ```
  The message names each case and which remedy it took; add any new file to the `git add`.

### Task 4: The fiscal seat asks the regime

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (`ClockBehindLatestRecord`; two methods beside
  `assertRecordableAt`, `:193-197`), `packages/fiscal/src/index.ts` (export the type),
  `packages/fiscal-verifactu/src/backend.ts` (delegate, beside `assertRecordableAt` at `:183-185`),
  `packages/fiscal-verifactu/src/clock-behind.ts` (use the shared type),
  `packages/fiscal/src/testing/fake-backend.ts` (`:117`), `packages/fiscal-none/src/backend.ts` (`:31`)
- Modify (setup, declared **[I2]**): `packages/core/src/record-sale.test.ts:154` and
  `packages/core/src/record-void.test.ts:169` (each `wrapBackend` gains two delegating lines beside
  its `assertRecordableAt` line, `:158` and `:173`), and `packages/core/src/record-void.test.ts:378`
  (a typed literal: two no-ops beside `:382`). No assertion changes.
- Test: `packages/fiscal-verifactu/src/backend.clock-behind.test.ts` (new), the fake's and
  `fiscal-none`'s existing test files (gain cases)

**Interfaces:**
```ts
export interface ClockBehindLatestRecord { readonly clockAt: string; readonly offsetMinutes: number; readonly lastRecordAt: string; readonly lastRecordOffsetMinutes: number }
// FiscalBackend:
/** The reading and this regime's latest record time when the reading is more than a minute
 * earlier; null when it is not, or when the regime keeps no such records. */
clockBehindLatestRecord(tx: Transaction, reading: Pick<TrustedReading, "instant" | "offsetMinutes">): Promise<ClockBehindLatestRecord | null>;
/** Throws this regime's refusal when nothing may take or give back money at `reading`. */
refuseWhileClockBehind(tx: Transaction, reading: Pick<TrustedReading, "instant" | "offsetMinutes">): Promise<void>;
```

- [ ] **Step 1: Write the failing tests.** `backend.clock-behind.test.ts`: the Veri\*Factu backend
  answers as Task 2's functions (a stopped case, a control a minute inside, a 2001 reading refused
  `clock.unusable`). `NoneBackend`: never stopped, with a record-like row absent and a 2001 reading
  (it returns, answers `null`). `FakeFiscalBackend`: the same.
- [ ] **Step 2: Run and watch them fail** (`clockBehindLatestRecord is not a function`):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.clock-behind.test.ts`,
  and the fake's and none's files with their packages' filters.
- [ ] **Step 3: Implement.** Give the three declared `packages/core` test sites the two methods
  (setup). Nothing in `packages/fiscal` (code or string) holds "chain" or another word of
  `no-regime-vocabulary.test.ts:56-70`'s list; the module keeps `clockBehindChain` and the code
  `clock.behind_chain` on its own side.
- [ ] **Step 4: Typecheck every implementer and caller**:
  `pnpm --filter @waitron/fiscal --filter @waitron/fiscal-verifactu --filter @waitron/fiscal-none --filter @waitron/core --filter @waitron/provisioning --filter @waitron/module --filter @waitron/server typecheck`
  exits 0. Run the three test files → PASS;
  `pnpm --filter @waitron/fiscal exec vitest run src/no-regime-vocabulary.test.ts` → PASS
  (`Tests 100 passed` today; R1's control shows `clockBehindChain` fails it) **[I1]**;
  `pnpm --filter @waitron/core exec vitest run src/record-sale.test.ts src/record-void.test.ts` →
  PASS; and
  `pnpm exec vitest run scripts/module-seams.test.ts scripts/workspace-cycles.test.ts` → PASS.
  Then the fiscal-core check of Global constraints, with its narrowed pathspec, prints nothing.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal/src/backend.ts packages/fiscal/src/index.ts packages/fiscal/src/testing/fake-backend.ts packages/fiscal-none/src/backend.ts packages/fiscal-verifactu/src/backend.ts packages/fiscal-verifactu/src/clock-behind.ts packages/fiscal-verifactu/src/backend.clock-behind.test.ts packages/core/src/record-sale.test.ts packages/core/src/record-void.test.ts
  git commit -s -m "The fiscal seat can say whether the box's clock reads behind the last record, and refuse while it does"
  ```
  (Add the fake's and none's test files to the `git add` once they have their cases.)

### Task 5: The strip's red notice and the bell's alert

**Files:**
- Modify: `packages/fiscal-verifactu/src/staff-notices.ts` (decision 12),
  `packages/fiscal-verifactu/src/alerts.ts` (decision 10), `apps/till/src/i18n/staff-notices.ts`
  (`FIXED` gains `"clock.behind_chain": "staff_notice.clock.behind_chain"`),
  `apps/till/src/i18n/strings.ts` (EN beside `:1734`, ES beside `:3439`)
- Test: `packages/fiscal-verifactu/src/staff-notices.test.ts`, `packages/fiscal-verifactu/src/alerts.test.ts`,
  `apps/till/src/i18n/staff-notices.test.ts` (gain cases)

**Words** (design §4.2): EN `"Payments stopped: the box's clock reads earlier than its last sale"`,
ES `"No se puede cobrar: la hora del equipo es anterior a la última venta"`; the hint is the shared
"Tell a manager" / "Avisa al encargado".

- [ ] **Step 1: Write the failing tests.** Module notices: a stopped reading → one notice
  `{ key: "clock.behind_chain", code: "clock.behind_chain", severity: "error", params: <four> }`;
  a 2001 reading with records → only `clock.unusable`; a reading a minute inside → none; no records →
  none. Module alerts: `FISCAL_ALERTS.sources` holds a source with area `box`, permission
  `system.manage`, which answers one alert `{ key, code: "clock.behind_chain", severity: "error",
  since: null, screen: "box-status", params: { clockAt, lastRecordAt } }` during the stop and none a
  minute inside. Till: `staffNoticeText` gives the words and hint in both languages (read the
  expected text from `strings.ts`).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/staff-notices.test.ts src/alerts.test.ts`;
  `pnpm --filter @waitron/till exec vitest run src/i18n/staff-notices.test.ts` (Chromium: memory first).
- [ ] **Step 3: Implement.** The notice source reads `clockBehindChain` on the ask's `tx` and
  `reading`.
- [ ] **Step 4: Run** the three files → PASS, and the guards
  `pnpm exec vitest run scripts/staff-notice-codes.test.ts scripts/alert-codes.test.ts` → PASS
  (proof: remove the till's English entry → `staff-notice-codes` FAILS; restore).
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/fiscal-verifactu/src/staff-notices.ts packages/fiscal-verifactu/src/staff-notices.test.ts packages/fiscal-verifactu/src/alerts.ts packages/fiscal-verifactu/src/alerts.test.ts apps/till/src/i18n/staff-notices.ts apps/till/src/i18n/staff-notices.test.ts apps/till/src/i18n/strings.ts
  git commit -s -m "Tills show a red notice, and managers an alert, while the box's clock reads earlier than its last sale"
  ```

### Task 6: The clock-drift alert leaves the bell during the stop

**Files:**
- Modify: `apps/server/src/time-health.ts` (`authorityClockAlertSource`, `:102-120`),
  `apps/server/src/boot.ts` (`:2184`)
- Test: `apps/server/src/time-health.test.ts` (gains cases), a new
  `apps/server/src/boot.clock-behind-wiring.test.ts` in the shape of
  `boot.disk-full-wiring.test.ts:1-80` (`serverFixture`, `vi.mock` capturing a dependency)

- [ ] **Step 1: Write the failing tests.** Source: with a `warning` status and `stopped` answering
  `true` → `[]`; `false` → the drift alert as today; with `stopped` omitted → as today (every
  existing case passes unedited). Wiring: `vi.mock("./time-health.js")` captures the `stopped`
  boot passes; with a record seeded before the start at a time a day after the server's clock
  (`beforeServerStarts`), calling it in a transaction answers `true`; a control venue with no
  records answers `false`.
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/time-health.test.ts src/boot.clock-behind-wiring.test.ts`.
- [ ] **Step 3: Implement** decision 11.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/server typecheck` exits 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/time-health.ts apps/server/src/time-health.test.ts apps/server/src/boot.ts apps/server/src/boot.clock-behind-wiring.test.ts
  git commit -s -m "The bell stops saying selling can continue after a clock comparison while payments are stopped for the clock"
  ```

### Task 7: The sale paths refuse before the reader — `/api/sales`, `/api/pay` and collect

**Files:**
- Modify: `apps/server/src/till-sale.ts` (`runPayWorkingOrder` beside `:691`, its reading handed to
  `fileImmediateSale`'s `issueMoment` at `:964`; `payIntegrated` right after the replay return at
  `:1163-1168`; `runCollectOrder` beside `:2141`, its reading reused for `settledAt` at `:2168`),
  `apps/server/src/issue-moment.ts` (export the pinned clock `issueMoment` already builds at
  `:22-30` as `pinnedAt(clock, reading)`, and use it there; behaviour unchanged),
  `apps/server/src/till-api.ts` (`STATUS` gains `"clock.behind_chain": 409`, `:454`)
- Modify (setup, declared): `apps/server/src/till-api.test.ts:332` and
  `apps/server/src/till-api.zone-required.test.ts:173` (`backend: {} as FiscalBackend` gains the two
  no-ops), and any other stub Step 0 lists
- Create: `apps/server/src/clock-behind-stop.pay.test.ts`, on `provisionBillVenue` and the
  `clockAt` helper of `till-pay.clock.test.ts:47-51`, under decision 13's rules (one real-clock sale
  in setup; every clock and write built from NOW); the fake provider's `collectCalls` is the spy
  (`packages/payments/src/testing/fake-provider.ts:84`)

- [ ] **Step 0: Gate — every named check in place, the whole server suite, before anything else
  [I6].** In a throwaway worktree of this branch's head (`git worktree add --detach <dir> HEAD`,
  `pnpm install --frozen-lockfile --offline`), never this worktree, put EVERY named check of
  decision 3 in place as a prototype, uncommitted: the three of this task, `beginBillPayment`'s,
  the two in `refundBillPayment`, the two in `beginSettledTenderRefund`, the retry route's, the
  unpaid departure's, the eight dashboard resolutions', each judging one reading as decision 3
  says, and both loops' pauses (decision 16). The review's prototype is the shape
  (`~/waitron-campaign-b/a798-8-plan-review/r1/scripts/x5-apply-named-checks.py`, which covered
  only the sale, bill-payment and departure checks). Where a deps type has no `backend` yet
  (`BillRefundDeps`), the prototype may make it optional and pass it at the five builders of
  decision 15; say in the report that a harness which does not pass it ran without the check. Then,
  with free memory checked, `TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run` in its
  `apps/server`, and read the `Tests` count. List every failing case by file and name, and classify
  each as one of:
  - **declared setup** — the `{} as FiscalBackend` stubs (R6: `till-api.test.ts:4459`, four cases
    in `till-api.zone-required.test.ts`), or a harness that builds deps by hand and lacks
    `backend`; fixed by setup only, in the task that adds that check;
  - **known load flake** — Task 3b Step 3's list and `first-fiscal-launch.test.ts`; rerun alone as
    that step says;
  - **STOP** — anything else, including `vat-rate-at-issue.test.ts:498-515` (it must pass with one
    reading) and any assertion that would need changing. Report and wait.
  Write the list into the task report and the ledger, then remove the throwaway worktree. Tasks 8a
  onward start only when the list holds no STOP.
- [ ] **Step 1: Write the failing tests** (each: status, the code, its four params, the
  `collectCalls` count before and after, and the rows):
  1. "refuses a counter card sale with no saved order before the reader" (§8 item 8, second
     bullet): `POST /api/pay` with lines at BEHIND → 409; `collect` never called; no
     `working_orders` and no `payments` row for the id.
  2. "refuses a card payment of an order whose invoice was filed before the reader" (§8, first
     bullet; E10 (b) called `collect`): a placed, invoiced order at NOW — the file's own copy of
     `till-pay.disk-full.test.ts:104-116`'s `placedIssuedOrder`, taking a clock (the original files
     with `venue.clock`, the real clock) — paid at BEHIND → 409; `collect` never called; the order
     unchanged.
  3. "refuses a stored open order before the reader and leaves no attempt mark".
  4. "refuses a cash collection of a filed order and writes no settlement" (§8, fourth bullet; E10
     (c) answered 200): `POST /api/working-orders/:id/collect` at BEHIND → 409; no `tenders` row;
     the order still `placed`.
  5. "refuses a cash sale on /api/sales and writes nothing" (§8, sixth bullet).
  6. "answers a replay of a settled order" (Departure 1): an order paid at NOW, paid again with
     `lines: []` at BEHIND → 200, its ticket, `collect` not called.
  7. "takes a card a minute inside the margin" (the control): NOW − 60 s → 200 captured,
     `collect` once; NOW − 61 s → 409.
  8. "sells again once the clock passes the record": NOW + 1 min → 200. Every later case reads the
     new NOW (decision 13).
- [ ] **Step 2: Run and watch them fail.**
  `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.pay.test.ts` → 1 fails with
  `collect` called and a 400 (E10 (a)); 2 and 4 answer 200; 3 and 5 are refused only after writing,
  or answer 400; 6–8 pass.
- [ ] **Step 3: Implement** decision 3's three calls, each on one reading (decision 3, "One
  reading"), `pinnedAt`, and the status. Give the two declared stubs their no-ops.
- [ ] **Step 4: Run** the new file and the suites these functions already have:
  `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.pay.test.ts src/vat-rate-at-issue.test.ts src/till-api.test.ts src/till-api.zone-required.test.ts src/till-pay.clock.test.ts src/till-pay.disk-full.test.ts src/till-sales.disk-full.test.ts src/card-charged-not-recorded.test.ts src/till-api.fiscal-sale-paths.test.ts src/pending-card-recovery.test.ts src/payments-api.stuck.test.ts src/placed-order-one-payment.test.ts src/till-sale-integrated.db.test.ts`
  → PASS, `vat-rate-at-issue.test.ts` unedited. Any other stub Step 0 listed gains the two no-ops
  (setup); list them in the commit.
- [ ] **Step 5: Proofs by deletion**: drop the call in `payIntegrated` → cases 1 and 2 FAIL with
  `collect` called; move it inside `if (locked !== undefined)` → case 1 FAILS; move it before the
  replay → case 6 and `till-pay.clock.test.ts:135-149` FAIL; drop it in `runCollectOrder` → case 4
  FAILS; let the check in `runPayWorkingOrder` take its own `deps.clock.now()` instead of the shared
  reading → `vat-rate-at-issue.test.ts`' "prices and dates the invoice from one reading…" FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/till-sale.ts apps/server/src/issue-moment.ts apps/server/src/till-api.ts apps/server/src/clock-behind-stop.pay.test.ts apps/server/src/till-api.test.ts apps/server/src/till-api.zone-required.test.ts
  git commit -s -m "A sale, a card payment or a collection is refused before the card reader while the box's clock reads behind its last sale"
  ```
  The message body names the two stubs' setup change.

### Task 8a: Bill payments and bill refunds

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (`beginBillPayment`, after `:1078`:
  `await backend.refuseWhileClockBehind(tx, reading)`, the function's own `backend` and `reading`
  **[M9]**), `apps/server/src/bill-refunds.ts` (`BillRefundDeps` gains `backend`, `:73-76`; the two
  checks in `refundBillPayment` of decision 3 **[M1]**: inside the `pending` branch before
  `return { kind: "resume" }` at `:620`, and after the id-reuse refusal at `:627-629`, before
  `requireOpenBill` at `:631`, whose reading then stamps `createdAt` at `:656`), every place that
  builds `BillRefundDeps` (`bill-payments-api.ts:305`, `tender-refund-api.ts:136-141`,
  `payments-api.ts:1358-1363`, `boot.ts:2709`, `:2730`, and test harnesses: setup)
- Create: `apps/server/src/clock-behind-stop.bills.test.ts` (shaped like
  `bill-payments.refuse-before-reader.test.ts`, under decision 13's rules)

- [ ] **Step 1: Write the failing tests:**
  1. "refuses a card payment on a bill before the reader": `POST /api/working-orders/:id/payments`
     with `entry: "reader"` at BEHIND → 409; `collect` never called; no `bill_payments` row.
  2. "refuses a cash part payment and queues no drawer": no row; no `drawer` print job.
  3. "refuses a cash bill refund and queues no drawer"; 4. "refuses a connected card bill refund and
     sends nothing": `refundCalls` unchanged, no `bill_payment_refunds` row.
  5. "answers a bill payment's replay": a cash part payment taken at NOW resent with its
     `submissionId` at BEHIND → 200, the first row, nothing new.
  6. "answers a finished refund's replay but refuses a pending one's resume": a completed refund
     replayed → 200; a refund left pending (the fake's `holdNextRefund` at
     `fake-provider.ts:161`, or a `pending` row as `bill-refunds.card.test.ts` builds one)
     replayed at BEHIND → 409, `refundCalls` unchanged.
  7. The control: a cash part payment a minute inside → 200.
- [ ] **Step 2: Run and watch them fail**: `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.bills.test.ts`.
- [ ] **Step 3: Implement**; add `backend` where the typecheck asks.
- [ ] **Step 4: Run** the new file with
  `src/bill-payments.refuse-before-reader.test.ts src/bill-payments.in-flight.test.ts src/bill-payments-api.test.ts src/bill-refunds.card.test.ts src/attendance-bill-payments.test.ts src/adjustments-bill-payments.test.ts src/till-money.write-session.test.ts`
  → PASS; `pnpm --filter @waitron/server typecheck` exits 0.
- [ ] **Step 5: Proofs by deletion**: drop the check in `beginBillPayment` → 1 and 2 FAIL; drop
  the check in the `pending` branch → 6's pending half FAILS; drop the new-refund check → 3 and 4
  FAIL; move the new-refund check above `findSubmission` (`:614`) → 6's finished half FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/bill-payments.ts apps/server/src/bill-refunds.ts apps/server/src/bill-payments-api.ts apps/server/src/tender-refund-api.ts apps/server/src/payments-api.ts apps/server/src/boot.ts apps/server/src/clock-behind-stop.bills.test.ts
  git commit -s -m "Bill payments and bill refunds are refused before any card or drawer while the box's clock reads behind its last sale"
  ```
  (Add each harness the typecheck asked for.)

### Task 8b: Order edits that would file an invoice, the unpaid departure, and a credit

**Files:**
- Modify: `apps/server/src/unpaid-departure.ts` (`recordUnpaidDeparture`: the check right after
  `authorize`, `:75-79`, so a wrong override PIN is still counted first **[M2]**; its reading
  handed to `priceForIssuance` at `:118` through `pinnedAt` **[I6]**)
- Create: `apps/server/src/clock-behind-stop.records.test.ts` (on `provisionBillVenue`,
  `tabWith`, `seatedWith`, `registroCount`, `paymentRows` from `testing/bill-venue.ts`, under
  decision 13's rules: `seatedWith` is handed `{ ...venue, clock, app: venue.appAt(clock) }`)

The order edits and the credit need no code here: the chain check refuses them (Task 3). These
tests prove it through the routes.

- [ ] **Step 1: Write the failing tests:**
  1. "refuses a kitchen send that would complete a part-paid bill, as a whole" (§8, seventh bullet):
     a bill with a cash part payment at NOW whose draft's submit
     (`POST /api/parties/:id/drafts/:did/submit`, `till-api.ts:3715-3744`) would leave it fully paid,
     sent at BEHIND → 409 `clock.behind_chain`; the draft still there, no kitchen ticket or print job
     for its lines, no sale, `registroCount` unchanged.
  2. "sends the same draft on a bill with no payments" → 200; the kitchen ticket written.
  3. "refuses a line edit that would complete a part-paid bill"
     (`PUT /api/working-orders/:id/lines/:lineNo`, `:3949`) → 409, the line unchanged.
  4. "refuses an unpaid departure and writes nothing" (§8, sixth bullet) → 409; the party open; no
     sale and no departure rows. Twice: for an open bill, which the departure would invoice (the
     chain check alone would also refuse it), and for a bill whose invoice was already filed
     (presented with its invoice, `unpaid-departure.ts:55-56`), whose departure writes no record —
     only the named check refuses that one.
  5. "refuses a cancel's credit of an invoiced order" (`POST /api/working-orders/:id/cancel`,
     `:2707`) → 409, no corrective sale; "cancels an order with no invoice" → 200.
  6. "refuses a credit under a 2001 clock as clock.unusable" (decision 4; closes the slice-3 entry).
  7. The control a minute inside for 1 and 4.
  8. "counts a wrong override PIN before refusing for the clock": an unpaid departure at BEHIND
     with a wrong override PIN → the wrong PIN's own refusal, not `clock.behind_chain`, and the
     attempt counted as the existing departure suites count it **[M2]**.
- [ ] **Step 2: Run and watch them fail**: `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.records.test.ts`
  → case 4's filed-invoice departure answers 200 (no record, no check yet). Cases 1, 3, 4's open
  bill, 5 and 6 pass already through Task 3: run them once with Task 3's call removed to see them
  FAIL, then restore.
- [ ] **Step 3: Implement** the departure's check.
- [ ] **Step 4: Run** with `src/unpaid-departure*.test.ts src/cancel-invoiced-order.test.ts src/line-cancel-api.test.ts src/adjustments-api.test.ts src/till-api.parties.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/unpaid-departure.ts apps/server/src/clock-behind-stop.records.test.ts
  git commit -s -m "While the box's clock reads behind its last sale, an unpaid departure is refused, and so is any edit or credit that would file an invoice"
  ```

### Task 9: Tender refunds, both refund loops, and the Stripe webhook

**Files:**
- Modify: `apps/server/src/tender-refunds.ts` (decision 3's two checks in
  `beginSettledTenderRefund`, on the one reading taken at `:73` **[C1]**: inside
  `if (begun.replayed)` at `:85`, before a `pending` row is returned; and right after `:85` for
  every new refund), `apps/server/src/tender-refund-api.ts` (the retry callback after `:274`),
  `apps/server/src/tender-refund-recovery.ts` (decision 16, at the top of `recoverTenderRefunds`,
  on the reading at `:25`), `apps/server/src/bill-payments-loop.ts` (decision 16, at the top of
  `settlePendingBillRefunds`, `:244`) **[I3]**
- Create: `apps/server/src/clock-behind-stop.refunds.test.ts` (under decision 13's rules); a case
  in `apps/server/src/webhook.test.ts`

- [ ] **Step 1: Write the failing tests:**
  1. "refuses a connected card refund and sends nothing" (§8, fifth bullet):
     `POST /api/transactions/:saleId/refunds` at BEHIND → 409; `refundCalls` unchanged; no
     `tender_refunds` row.
  2. "refuses a cash refund and queues no drawer".
  3. "refuses the retry of a pending refund": `POST /api/tender-refunds/:refundId/retry` → 409,
     `refundCalls` unchanged.
  4. "the tender-refund loop leaves a pending refund untouched during the stop, and settles it
     after" (§8, third bullet; decision 16): a pending connected refund whose first send never
     happened (`sent_at` null, as `tender-refunds.test.ts:1362`'s `abandoned(false)` seeds one).
     `recoverTenderRefunds` at BEHIND → the row unchanged (`state` `pending`, `failed_at` null,
     `next_retry_at` as before), `refundCalls` and `lookupCalls` unchanged, and the answer's
     `nextDueAt` a minute after the reading. Then at NOW + 1 min → the row `failed` (the loop's
     `never_sent`, as `tender-refunds.test.ts:855` and `:1362` pin today), `refundCalls` still
     unchanged. The loop never sends (R4), so no case says "sent".
  4b. "the bill-refund half of the pass leaves a pending refund untouched during the stop, and
     settles it after": a pending bill card refund already sent, whose lookup on the fake provider
     would find it completed (as `bill-refunds.card.test.ts` scripts one).
     `settlePendingBillPayments` at BEHIND → the refund row unchanged, `refundsCompleted 0`, no new
     `payment_refunds` row, no `payment.refund_unresolved`. At NOW + 1 min → `completed`, one
     `payment_refunds` row, `refundCalls` unchanged.
  5. "answers a finished refund's replay": a completed refund's request resent at BEHIND → 200, the
     same row.
  6. In `webhook.test.ts`: "records a hosted payment while the box's clock reads behind its last
     sale": a record seeded a day after the webhook's clock; the delivered payment is recorded with
     the event's own `settledAt` (`webhook.ts:111-115`), and no `clock.*` refusal is raised (§8,
     third bullet) **[M8]**.
  7. The control a minute inside for 1.
  8. "refuses the resend of a pending connected refund and sends nothing" **[C1]**: a connected
     refund whose first answer is lost, left `pending` with `refundCalls` 1 (the review's X7 shape,
     `~/waitron-campaign-b/a798-8-plan-review/r1/scripts/x7-tender-replay-probe-cases.ts`, on
     `tender-refunds.test.ts`' harness). The same request (same `submissionId`) resent at BEHIND →
     409 `clock.behind_chain` with its four params; `refundCalls` still 1; the row still `pending`,
     `send_count` unchanged.
- [ ] **Step 2: Run and watch 1–4, 4b and 8 fail** (5–7 pass; 4 fails because the row is marked
  `failed` during the stop; 8 answers `completed` with `refundCalls` 2, as X7 printed):
  `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.refunds.test.ts src/webhook.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** with `src/tender-refunds.test.ts src/tender-refund-api*.test.ts src/tender-refund-recovery*.test.ts src/bill-payments-loop.test.ts src/bill-refunds.card.test.ts`
  (whatever `ls apps/server/src/tender-refund*` shows) → PASS.
- [ ] **Step 5: Proofs by deletion**: drop the tender loop's pause → 4 FAILS; drop the bill half's
  pause → 4b FAILS; drop the check inside `if (begun.replayed)` → 8 FAILS with `refundCalls` 2;
  move the new-refund check before `reserveTenderRefund`'s replay → 5 FAILS; drop the new-refund
  check → 1 FAILS.
- [ ] **Step 6: Commit.**
  ```bash
  git add apps/server/src/tender-refunds.ts apps/server/src/tender-refund-api.ts apps/server/src/tender-refund-recovery.ts apps/server/src/bill-payments-loop.ts apps/server/src/clock-behind-stop.refunds.test.ts apps/server/src/webhook.test.ts
  git commit -s -m "No refund is sent or settled while the box's clock reads behind its last sale; the Stripe webhook still records hosted payments"
  ```

### Task 10: The dashboard's payment resolutions

**Files:**
- Modify: `apps/server/src/payments-api.ts` (the eight handlers, decision 3; `STATUS`, `:134`,
  gains `"clock.behind_chain": 409` and `"clock.unusable": 409` **[M6]**). Two callbacks take no
  transaction today **[M3]**: `:1415`, `await gated(sessionId, () => Promise.resolve())`, becomes
  `gated(sessionId, (tx) => …refuseWhileClockBehind(tx, reading))`; `:1442`,
  `pinGated(sessionId, pin, async (_tx, authorizedBy) => authorizedBy)`, names its `tx` and runs
  the check before returning `authorizedBy`.
- Create: `apps/server/src/payments-api.clock-behind.test.ts` (on the harness of
  `payments-api.stuck.test.ts`)

- [ ] **Step 1: Write the failing tests.** Table-driven over the eight routes, each `POST` as a
  manager with a valid body (an attest's `outcome`, `note` and the manager's own PIN) and a random
  id: with a record a day after the box's clock → 409 `clock.behind_chain` (the check is the first
  statement inside the authorized callback, so the id need not exist); with no session → 401 (auth
  first); the same request a minute inside → anything but `clock.behind_chain`. The two callbacks
  of `:1415` and `:1442` are rows of that table like the rest. Plus: one route under a clock in
  2001 → 409 `clock.unusable` (today 400) **[M6]**. Plus: the stuck
  resolve of a real stuck payment calls neither `collect` nor `resolveAbandonedAttempt`
  (`abandonedAttemptCalls`, `fake-provider.ts:88`).
- [ ] **Step 2: Run and watch them fail**: `pnpm --filter @waitron/server exec vitest run src/payments-api.clock-behind.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** with `src/payments-api*.test.ts` → PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/payments-api.ts apps/server/src/payments-api.clock-behind.test.ts
  git commit -s -m "Managers' payment and refund resolutions wait while the box's clock reads behind its last sale"
  ```

### Task 11: A card charged as the stop begins, recorded once the clock moves on

**Files:**
- Modify: `apps/server/src/bill-payments.ts` (`afterCardCharged`, `:1246-1259`; the rename),
  `apps/server/src/till-sale.ts`, `apps/server/src/till-api.ts`, `apps/server/src/bill-payments-api.ts`
  (the rename), `apps/server/src/errors.ts` (`:294`, the reason union)
- Create: `apps/server/src/clock-behind-stop.charged.test.ts` (under decision 13's rules; case 1
  leaves the latest record at NOW + 2 min, and every later case reads that as its NOW)

- [ ] **Step 1: Write the failing tests**, with a clock whose reading a test can move and
  `card.holdNextCollect()` (`fake-provider.ts:128-134`):
  1. "a card charged as the stop begins says so, and Pay records it without charging again" (§8,
     ninth bullet; design §4.8 a's third bullet): at NOW + 1 min a counter card sale is held at the
     reader; the clock moves to BEHIND; released → `sale.charged_not_recorded`
     `{ reason: "clock_behind_chain" }`; one captured payment with no sale; no new record. Pay again at
     BEHIND → 409 `clock.behind_chain`, `collect` not called. The clock at NOW + 2 min → Pay → 200,
     `collectCalls` unchanged since the first, one sale, one new record.
  2. "the automatic recovery files nothing during the stop, then files it" **[I4]**: a captured
     payment seeded as `pending-card-recovery.test.ts`'s `retained` helper seeds one (`:31-58`: the
     captured payment, then a `payment_resolutions` row with outcome `captured` and no person,
     `:47`), on an order of its own. Case 1's payment cannot be used: the recovery selects only
     payments with such a row (`pending-card-recovery.ts:26-45`), and a card captured at the reader
     whose recording was refused has none, so it would answer `filed 0` with no error during and
     after the stop. `recoverAutomaticCardPayments` (`pending-card-recovery.ts:23-83`) at BEHIND →
     `filed 0`, one error naming `clock.behind_chain`; at NOW + 1 min → `filed 1`, `collect` not
     called.
  3. "a card on a bill as the stop begins": `takeReaderBillPayment` completing the bill, held and
     released after the clock moves → `sale.charged_not_recorded` with the clock's reason; the bill
     payment still `pending`; `settlePendingBillPayments` after the clock moves on completes it and
     files the invoice once.
  4. "a card charged as the stop begins on a path that writes no record is recorded" (decision 17)
     **[M10]**: (a) a card on an already-invoiced placed order, held at the reader at NOW, the clock
     moved to BEHIND, released → 200 captured through `finalizeSettle`, the tender dated by the
     provider's `settledAt`, `collectCalls` 1, `registros_facturacion` count unchanged; (b) a card
     part payment that leaves its bill part-paid, held and released the same way → the bill
     payment `received`, dated by the provider's `settledAt`, no new record. Both pass today; they
     pin the decision.
- [ ] **Step 2: Run and watch 1 and 3 fail** (`clock.behind_chain` instead of
  `sale.charged_not_recorded`): `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.charged.test.ts`.
- [ ] **Step 3: Implement** decision 14; rename the flag.
- [ ] **Step 4: Run** with `src/card-charged-not-recorded.test.ts src/bill-payments.in-flight.test.ts src/pending-card-recovery.test.ts src/bill-payments-loop*.test.ts`
  → PASS; typecheck exits 0.
- [ ] **Step 5: Commit.**
  ```bash
  git add apps/server/src/bill-payments.ts apps/server/src/till-sale.ts apps/server/src/till-api.ts apps/server/src/bill-payments-api.ts apps/server/src/errors.ts apps/server/src/clock-behind-stop.charged.test.ts
  git commit -s -m "A card charged as payments stop for the clock says not to charge again, and is recorded without a second charge once the clock moves on"
  ```

### Task 12: What keeps working, and the database with no records

**Files:** create `apps/server/src/clock-behind-stop.open.test.ts` (no product change expected; a
failure here is a STOP and a report; under decision 13's rules, with cases 4 and 5 on databases of
their own)

- [ ] **Step 1: Write the tests** (§8, eighth and tenth bullets), with a record a day after the
  box's clock:
  1. seat a table, save a draft, send it to the kitchen on a bill with no payments → 200 each,
     tickets written;
  2. clock in and clock out (`POST /api/clock/in` and `/api/clock/out`, `apps/server/src/till-clock-api.ts:106`) → 200, the event at the
     box's clock;
  3. print the bill for checking, reprint a receipt → 200;
  4. a venue database with no records at all (its own `useVenueDb`), a cash sale on a clock a year
     behind today → 200 (never stopped);
  5. a restored database: a record on another node's chain at T (as Task 2 case 5 seeds it, through
     the server's own fixtures, as `restore-fiscal-e2e.test.ts:410-413` reads an older chain's
     record), this node's chain empty, a cash sale at T − 1 day → 409 `clock.behind_chain`.
- [ ] **Step 2: Run**: `pnpm --filter @waitron/server exec vitest run src/clock-behind-stop.open.test.ts`
  → PASS. Proof: temporarily add the named check to the kitchen-send route → case 1 FAILS; restore.
- [ ] **Step 3: Commit.**
  ```bash
  git add apps/server/src/clock-behind-stop.open.test.ts
  git commit -s -m "Orders, kitchen sends and clock-ins carry on while payments stop for the clock; an empty database is never stopped"
  ```

### Task 13a: The till's payment and card-charged sentences **[M7]**

**Files:**
- Modify: `apps/till/src/i18n/strings.ts` (`sale.clock_behind_chain`, `sale.charged_clock_behind`,
  EN beside `:1352-1359`, ES beside `:3061-3068`), `apps/till/src/i18n/t.ts` (`clockBehindOf`,
  `clockBehindText`, beside `:47-71`), `apps/till/src/widgets/pay-refusal.ts` (beside its
  `storage.disk_full` arm, `:70`), `apps/till/src/till-app.ts` (`saleRefusalOf`, beside `:1500`;
  `CounterError`; the `findBillError` union), `apps/till/src/widgets/find-bill-dialog.ts` — the four
  files where slice 3 added a `clockUnusable` arm (`git show 43456c45a -- apps/till`: `till-app.ts`,
  `widgets/find-bill-dialog.ts`, `widgets/pay-refusal.ts`, `i18n/t.ts`); `api/client.ts` and
  `state/bill-payment.ts` gained only pass-through fields there, and change only if the typecheck
  asks **[claim-check §4]**
- Test: `apps/till/src/till-app.clock.test.ts`, `apps/till/src/widgets/presented-pay-dialog.test.ts`,
  `apps/till/src/till-app-bill-payments.test.ts` (gain cases)

**Words** (design §4.8 a), each time written `dd/mm/yyyy HH:mm` in its own offset — date and time
formatted separately and joined with a space, because `en-GB`'s combined format writes a comma:
- payment: EN "Sale not recorded: the box's clock ({clockAt}) reads earlier than the last sale
  ({lastRecordAt}). The order stays open; tell a manager. If you already charged on another card
  machine, don't charge again: record it once this is fixed." / ES "Venta no registrada: la hora del
  equipo ({clockAt}) es anterior a la última venta ({lastRecordAt}). El pedido sigue abierto; avisa
  al encargado. Si ya has cobrado en otro datáfono, no vuelvas a cobrar: regístralo cuando se
  arregle."
- charged: EN "Card charged, but the sale is not recorded: the box's clock reads earlier than its last
  sale. Don't charge again. Once it is fixed, press Pay: it is recorded without charging again." / ES
  "Cobrado con tarjeta, pero la venta no se ha registrado: la hora del equipo es anterior a la última
  venta. No vuelvas a cobrar. Cuando se arregle, pulsa Cobrar: se registra sin cobrar otra vez."
A refusal whose params cannot be read falls back to Task 13b's `codes.ts` sentence, as
`clockReadingOf` does for `clock.unusable`; until 13b lands, the fallback test reads `codeMessage`.

- [ ] **Step 1: Write the failing tests**: the two sentences in both languages (expected text read
  from `strings.ts`); a counter sale refused shows the payment sentence with picture 8's
  `14/03/2025 09:12` and `18/10/2026 23:40` for `clockAt` `2025-03-14T08:12:00.000Z` (+60) and
  `lastRecordAt` `2026-10-18T21:40:00.000Z` (+120); the bill pay sheet the same; a card charged
  shows the charged sentence; malformed params fall back.
- [ ] **Step 2: Run and watch them fail** (Chromium; memory first):
  `pnpm --filter @waitron/till exec vitest run src/till-app.clock.test.ts src/widgets/presented-pay-dialog.test.ts src/till-app-bill-payments.test.ts`.
- [ ] **Step 3: Implement**, mirroring each `clockUnusable` arm.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/till typecheck` exits 0;
  `pnpm exec vitest run scripts/english-only.test.ts` passes and the diff grep of Global
  constraints prints nothing.
- [ ] **Step 5: Commit** the files above by name:
  `git commit -s -m "The till says why a payment is refused while the box's clock reads behind its last sale, with both times"`.

### Task 13b: The till's "Can't be recorded" sentence everywhere else **[I5, M7]**

**Files:**
- Modify: `apps/till/src/i18n/codes.ts` (`clock.behind_chain`, beside `storage.disk_full` at `:762`
  and `clock.unusable` at `:770-773`), `apps/till/src/till-app.ts`: `clock.behind_chain` goes
  wherever `storage.disk_full` sits in a refusal set or helper (R5) — `TABLE_REFUSALS` (`:563`,
  read by `tableWriteError`, `:654-663`), `ACTIONABLE_REFUSALS` (`:835`, read by `counterError`,
  `:890-900`) and `discardError` (`:909`). Without it, those helpers answer the generic `table.error`
  (EN "Could not update the table, try again", `strings.ts:1426`; ES "No se pudo actualizar la mesa,
  inténtalo de nuevo", `:3135`) or `held.stale`, the "try again" the design rules out (design
  §4.8 a). The station's advance (`till-app.ts:7907`, `screens/till-station-screen.ts:571`) is a
  kitchen action this slice never refuses, so it gains nothing (R5).
- Test: `apps/till/src/i18n/codes.test.ts`, and cases beside the existing `storage.disk_full` ones:
  `apps/till/src/till-app-drafts.test.ts` (`:1907`, `:2790`: a refused draft save),
  `apps/till/src/till-app.test.ts` (the `it.each` tables at `:7247`, park; `:7994`, discard;
  `:11607`, place order), `apps/till/src/till-app-table-service.test.ts` (`:1240-1269`, the table
  writes), the refund dialogs' refusal cases (`widgets/bill-refund-dialog.test.ts`,
  `widgets/tender-refund-dialog.test.ts`, which already read `codeMessage`), and the unpaid
  departure's (`till-app-parties.test.ts`, its describe at `:8642`, beside `:8906`)

**Words:** EN "Can't be recorded: the box's clock reads earlier than its last sale. Tell a
manager." / ES "No se puede registrar: la hora del equipo es anterior a la última venta. Avisa al
encargado."

- [ ] **Step 1: Write the failing tests**: the sentence in both languages (expected text read from
  `strings.ts`/`codes.ts`); then, each in EN and ES, a draft submit refused with
  `{ code: "clock.behind_chain", status: 409 }` shows "Can't be recorded…"; a discard refused the
  same way shows it; a table write (`tableWriteError`) and a counter action (`counterError`) the
  same; a refund dialog and the unpaid departure show it.
- [ ] **Step 2: Run and watch them fail** (Chromium; memory first):
  `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/till-app-drafts.test.ts src/till-app.test.ts src/till-app-table-service.test.ts src/till-app-parties.test.ts src/widgets/bill-refund-dialog.test.ts src/widgets/tender-refund-dialog.test.ts`
  → the helper cases show "Could not update the table, try again" or the discard's stale words.
- [ ] **Step 3: Implement**: the `codes.ts` entry, and the code in the three sets and helpers.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @waitron/till typecheck` exits 0; the English-only
  checks as 13a. Proof by deletion: take `clock.behind_chain` out of `TABLE_REFUSALS` → the table
  write case FAILS; out of `discardError` → the discard case FAILS.
- [ ] **Step 5: Commit** the files above by name:
  `git commit -s -m "The till says a refund, edit or departure can't be recorded while the box's clock reads behind its last sale, never 'try again'"`.

### Task 14: The dashboard — the alert's words and the Box status rows

**Files:**
- Modify: `packages/dashboard-kit/src/alert-messages.ts` (a `{name:minute}` slot writing an ISO
  instant with `formatIsoMinute`; `—` for anything that is not one), `apps/dashboard/src/i18n/alert-messages.ts`
  (`clock.behind_chain`, design §4.8 c), `apps/dashboard/src/screens/box-status-rows.ts`
  (`NOTICE_PARTS` gains `"clock.behind_chain": ["sales", "clock"]`; `STOPPED_WORDS` its words; on
  the Sales row the disk's words, then `clock.unusable`'s, then the stop's, `:125-131`; the Clock
  row's detail line), `apps/dashboard/src/i18n/strings.ts` (EN and ES), `apps/dashboard/src/i18n/codes.ts`
  (`clock.behind_chain` for the payment resolutions, beside `:1271`)
- Test: `packages/dashboard-kit/src/alert-messages.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`,
  `apps/dashboard/src/screens/box-status-rows.test.ts`, `apps/dashboard/src/screens/payments-screen.test.ts`

**Words:** the alert, EN "The box's clock ({clockAt:minute}) reads earlier than its last sale
({lastRecordAt:minute}), so no payment can be taken. Orders and the kitchen still work. Sort it out
on the Box status page." / ES "La hora del equipo ({clockAt:minute}) es anterior a la última venta
({lastRecordAt:minute}), así que no se puede cobrar. Los pedidos y la cocina siguen funcionando.
Resuélvelo en Estado del equipo." The rows: "Payments stopped: the box's clock reads earlier than
its last sale" / "No se puede cobrar: la hora del equipo es anterior a la última venta"; the Clock
row's detail, EN "Connect the box to the internet so it can correct its clock, or call whoever
installed it." / ES "Conecta el equipo a internet para que corrija la hora, o llama a quien lo
instaló." (picture 9; the first half holds only where the box's system keeps its clock in step
with internet time — slice 10 switches that on at install, design §4.8 b; Task 18 files the hedge).

- [ ] **Step 1: Write the failing tests**: the slot (an instant; a non-string; a bad date); the
  alert's words in both languages, three sentences each; the rows red with the stop's words; a full
  disk's words still first; `clock.unusable`'s before the stop's; the stop's notice alone puts the
  Sales and Clock rows red and nothing else; the payments screen shows the code's words for a
  refused resolution.
- [ ] **Step 2: Run and watch them fail** (Chromium for `apps/dashboard`; memory first):
  `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts`;
  `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts src/screens/box-status-rows.test.ts src/screens/payments-screen.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck both packages; `pnpm exec vitest run scripts/alert-codes.test.ts`.
- [ ] **Step 5: Commit.**
  ```bash
  git add packages/dashboard-kit/src/alert-messages.ts packages/dashboard-kit/src/alert-messages.test.ts apps/dashboard/src/i18n/alert-messages.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/i18n/codes.ts apps/dashboard/src/i18n/alerts.test.ts apps/dashboard/src/screens/box-status-rows.ts apps/dashboard/src/screens/box-status-rows.test.ts apps/dashboard/src/screens/payments-screen.test.ts
  git commit -s -m "Managers read the clock stop in the bell and on the Box status page, with both times"
  ```

### Task 15: The guides

**Files:** `apps/server/src/guide/en/till-notices.md` and its Spanish twin (the notice under
`{#notices}`, after the clock-before-28-10-2024 paragraph); `apps/server/src/guide/en/box-status.md`
and its twin (a new section `## When payments stop because of the clock {#clock-behind}` /
`## Cuando se paran los cobros por la hora {#clock-behind}`, after `{#out-of-space}`)

What each says, in the guides' own plain style (`~/.claude/docs-writing-style.md`):
- till-notices: the red notice's words; that payments, refunds and anything that would record a sale
  are refused, while orders, the kitchen, printing the bill and clocking in carry on; that a card
  taken on another machine is not charged again but recorded once it is fixed; a link to
  `box-status.md#clock-behind`.
- box-status: what the stop means (the box's clock reads more than a minute earlier than the last
  sale it recorded, in any of its records); the bell and the red rows; what fixes it — the clock set
  right, by internet time where the box keeps it in step, or by whoever installed the box, and that
  the stop then clears by itself within a few seconds; that the box offers no way to set its clock
  from a page; that waiting also works once real time passes the last sale. No word about restarting
  payments (slice 9).

- [ ] **Step 1: Write** both pages in English and Spanish, ids shared.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` → PASS.
- [ ] **Step 3: Commit.**
  ```bash
  git add apps/server/src/guide/en/till-notices.md apps/server/src/guide/es/till-notices.md apps/server/src/guide/en/box-status.md apps/server/src/guide/es/box-status.md
  git commit -s -m "Guides: what staff and managers see when payments stop because of the box's clock"
  ```

### Task 16: Developer docs and CLAUDE.md

**Files:** `CLAUDE.md` §5 and §4; `docs/developers/conventions-data.md`;
`docs/developers/testing-guide.md`; `docs/compliance/verifactu-findings.md` (`:168-170`)

- [ ] **Step 1: CLAUDE.md §5**, one rule: "**While the box's clock reads more than a minute earlier
  than the latest record in the database, nothing takes or gives back money or writes a record.**
  A money route calls `refuseWhileClockBehind` (the fiscal seat) after its replay answer and before
  any reader, refund or drawer; the append refuses on its own. Guards: the
  `clock-behind-stop.*.test.ts` files and `chain.clock-behind.test.ts`, weaker than the rule — they
  cover the routes they name; a new money route is seen by none. Receipt: conventions-data.md." The
  receipt section in `conventions-data.md` (the comparison, the margin, the index, decision 3's
  placement rule, E10).
- [ ] **Step 2: CLAUDE.md §4**, one rule naming both shapes **[I8]**: "**A record in a test's
  database must not be dated after the clock of a later sale in the same database**, or the chain
  refuses that sale as `clock.behind_chain`: a fixture dated in the past recorded after a newer
  record (`drain.test.ts`'s outbox case), and a case that records AHEAD of the real clock followed
  by a real-clock write (the review's F9). In a file that shares one database, every write reads
  its clock from the latest record time, helpers included, or a case that writes ahead gets a
  database of its own. Cost: A798-B slice 8 plan, E9 and revision 2's F9." Receipt in
  `testing-guide.md`, with decision 13's helper rules (`venue.appAt`, a clock-taking
  `placedIssuedOrder`, `{ ...venue, clock, app: venue.appAt(clock) }`).
- [ ] **Step 3: `verifactu-findings.md`**: a dated pointer after `:170`, "built by A798-B slice 8
  (#…)".
- [ ] **Step 4: Check**: `pnpm exec prettier --check CLAUDE.md`; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 5: Commit.**
  ```bash
  git add CLAUDE.md docs/developers/conventions-data.md docs/developers/testing-guide.md docs/compliance/verifactu-findings.md
  git commit -s -m "CLAUDE.md: payments stop while the box's clock reads behind its last record, and test fixtures must not date records after a later sale"
  ```

### Task 17a: LOOK in English

**Files:** throwaway `apps/till/src/zz-clock-behind.look.test.ts` and
`apps/dashboard/src/zz-clock-behind.look.test.ts`, never committed; screenshots to
`~/waitron-campaign-b/a798-8-shots/`. A fix is committed with the file it touches.

- [ ] **Step 1: Write the throwaway look tests.** Till, shaped like slice 6's
  (`mountEquipmentApp` and `signIn`, as `apps/till/src/till-app.notices.test.ts:12`, `:86-87` use them **[claim-check §4]**):
  `light`/`dark` × 1280/390, the language a parameter; (a) the red strip alone on Counter; (b) the
  strip with a full disk's too (`+1`), list open; (c) the counter sale refused (picture 8's top);
  (d) a handheld's pay sheet refused; (e) the card-charged sentence; (f) a refund dialog's generic
  sentence. Dashboard, shaped like slice 7's Task 16a: the bell open on the alert; the Box status
  page with the Sales and Clock rows red. `page.screenshot` to a gitignored `__screenshots__/a798-8/`
  path; one contact sheet per theme and width with `sharp`; copy to `~/waitron-campaign-b/a798-8-shots/`.
- [ ] **Step 2: Run** `-t en` for each and LOOK beside pictures 8 and 9: the strip's red and its
  hint; both times readable, never broken mid-time at 390; the refusal under the order and in the
  sheet, nothing covered; the bell's three sentences and its Go to; the rows' red dots and words.
  Write what you saw, sheet by sheet.
- [ ] **Step 3: Fix and re-run**, each fix with a test that would have caught it where one can.

### Task 17b: LOOK in Spanish

- [ ] **Step 1: Run** `-t es` and LOOK as 17a; the longer Spanish sentences fit at 1280 and wrap
  cleanly at 390.
- [ ] **Step 2: Fix and re-run**, then `-t en` once.
- [ ] **Step 3: Remove the throwaways**; `git status --short` shows neither.

### Task 18: Backlog

**Files:** `docs/backlog.md` (A798-B, `:5507-5524`; the slice-3 entry `:5631-5635`),
`docs/backlog/box.md`

- [ ] **Step 1: The A798-B entry**: "slice 8 (payments stop while the box's clock reads more than a
  minute earlier than the latest record, with the red strip, the bell alert and the Box status rows;
  the build's one migration; parked for the owner) is #<PR>; slice 9 is next."
- [ ] **Step 2: Delete** "A cancel's whole-invoice credit under a clock before 28-10-2024 reaches the
  chain without the clock check" (decision 4). Its last sentence ("No product path records a
  substitution or a void today") is still true and stays only if another entry needs it; its
  implied "a void would answer `fiscal.record_invalid`" no longer holds: an anulación under such a
  clock is now refused `clock.unusable` by the chain check (decision 4) **[claim-check §4]**.
- [ ] **Step 3: Short open entries** in A798-B's area, each "Left open by A798-B slice 8 (#…)":
  - "**The clock stop's email is slice 9's.** Its subject and body are design §4.8 c's. Slice 9
    sends it once per stop through slice 10's once-per-episode sender, so slice 9 depends on 10
    too; slice 10 does not depend on 8. Slice 10 cannot build it: it lands itself, and the email
    asks slice 8's seat (`clockBehindLatestRecord`), which sits in a parked pull request." **[I7]**
  - "**`sale.charged_not_recorded` for the clock answers HTTP 507.** The till reads the code and
    reason; a status by reason needs the error boundary to take a function."
  - "**A Pay of an order whose invoice was already filed says 'Sale not recorded' during the clock
    stop**, where the payment is what is not recorded."
  - "**The Clock row says 'connect the box to the internet' on a box that may not keep its clock in
    step with internet time** until slice 10 switches that on at install."
  - "**The backup verifier does not know `clock_stop_restarts`' links.** Slice 9 adds them with its
    first writer (`packages/fiscal-verifactu/src/backup-verification-history.ts`)."
  - Outside A798, in the testing area: "**Tests that read a built command's error output fail under
    Claude Code.** The command's stderr begins with a `<claude-code-hint … />` line, so
    `apps/server/src/first-fiscal-launch.test.ts` and seven `packages/provisioning` CLI cases fail
    locally under an agent on `main` (A798-B slice 8 plan, E8 and E13). Found while planning A798-B
    slice 8."
- [ ] **Step 4: Check and commit.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`.
  ```bash
  git add docs/backlog.md docs/backlog/box.md
  git commit -s -m "Backlog: A798-B slice 8 stops payments while the clock reads behind the last record; what it leaves open"
  ```

---

## Self-review against the spec

- §8 item 8's scope: `refuseWhileClockBehind` at every money route of §4.8 e (Tasks 7–10, placement
  decision 3), the chain check (Task 3), every chain (Task 2 case 5, Task 12 case 5), the migration
  (Task 1), the refusal and its till words (Tasks 7, 13a, 13b), the red notice (Task 5), the alert
  (Task 5) and its words (Task 14), the email (decision 9: slice 9), `fiscal.clock_drift` left out
  (Task 6).
- §8 item 8's tests, one by one: filed-invoice card pay, `collect` never called — Task 7 case 2;
  counter card sale with no saved order — Task 7 case 1; the tender-refund recovery loop sending no
  refund during the stop, and the Stripe webhook — Task 9 cases 4, 4b and 6; cash collection of a
  filed order — Task 7 case 4; tender refund, provider refund never called — Task 9 cases 1 and 8;
  `/api/sales`, a bill payment, an unpaid departure and a credit — Task 7 case 5, Task 8a cases
  1–2, Task 8b cases 4–5; the draft submit refused as a whole and the same on a bill with no
  payments — Task 8b cases 1–2; a restored database stopped and an empty one not — Task 2 cases 1
  and 5, Task 12 cases 4–5; a card captured before the stop, recorded without a second charge —
  Task 11 cases 1 and 4; orders, kitchen sends and clock-ins accepted — Task 12 cases 1–2; the
  control a minute inside the margin — Task 2 case 2, Task 3 case 3, Task 7 case 7 and every route
  task.
- §4.8 a: the strip (Task 5), the payment and card-charged sentences (Task 13a), the other sentence
  on every other surface, never "try again" (Task 13b), buttons keep their look (nothing in Tasks
  13a or 13b changes a button).
- §4.8 d: what it compares, every chain, the empty database, when it checks (equipment read through
  the notice source; the named check; the append; the watch is decision 9's), what clears it (Task 7
  case 8, Task 9 cases 4 and 4b, Task 11), the 28-10-2024 rule first (decision 2).
- §4.8 e: the named check's routes, the two ways money moves without a route (Task 9; the loop's
  reason corrected by Departure 6), the table's rows (Tasks 7–12), the nine order edits (the chain
  check; Task 8b samples two).
- §7: the index and the table, `appendOnly()` in class `ledger`, the descriptor and the manifest, the
  unique index on the record's id (Task 1).
- §4.8 b's restart, `clock.behind_chain_restarted` and `_disproved`: slice 9.

**Revision 2, finding by finding.** Each is applied as the driver ruled.
- C1 / claim-check 1: a pending refund's resend is refused before it resumes (Words; decision 3;
  Task 9 case 8 with its proof by deletion; Review focus 1 and 6; Codex seat 1).
- I1: the seat is `clockBehindLatestRecord` / `ClockBehindLatestRecord` (Words; decisions 1, 2, 11;
  Task 4, with the guard run; R1).
- I2 / claim-check 3: the three `packages/core` test sites are declared setup; the fiscal-core rule
  and its check exclude `packages/core` test files (R2).
- I3: one rule for the loops; both refund loops pause, for the cash-up dating reason, not for
  sending (decision 16; Departure 6; Task 9 cases 4 and 4b; R4).
- I4: Task 11 case 2 seeds the resolution row as `pending-card-recovery.test.ts:47` does.
- I5 + M7: Task 13 split into 13a and 13b; 13b adds the code wherever `storage.disk_full` sits (R5).
- I6: one reading per route (decision 3); Task 7 Step 0 runs the whole server suite with every
  named check and classifies each failure; the two `{} as FiscalBackend` stubs are declared.
- I7: the clock email moves to slice 9, which gains a dependency on 10; slice 10 gains none
  (Departure 2; decision 9; Task 18; the build plan's rows 9 and 10).
- I8: decision 13's rules (one real-clock sale in setup; every write from NOW, helpers included);
  Task 16's rule names both shapes.
- claim-check 2: `outage-upgrade.test.ts`' setup change has two halves (declared; Task 1).
- M1 (and claim-check §4's bill-refund item): two checks in `refundBillPayment` (decision 3; Task 8a).
- M2: the departure's check after `authorize` (decision 3; Task 8b case 8).
- M3: the two callbacks without a transaction (Task 10).
- M4 (and claim-check §4's decision 4 item): decision 4 narrowed to altas; Task 18 Step 2.
- M5: the English-only grep drops `registr` (R3).
- M6: `clock.unusable` 409 on the dashboard's resolutions (decision 19; Task 10); its backlog entry
  is dropped.
- M8: the webhook case asserts the event's `settledAt` and no `clock.*` refusal (Task 9 case 6).
- M9: `beginBillPayment` judges its own `reading` (decision 3; Task 8a).
- M10: the two after-reader settle paths named (decision 17) and pinned (Task 11 case 4).
- M11 (and claim-check §4's E8 item): the load flakes named, each rerun alone before a STOP (E8;
  Task 3b Step 3; Task 7 Step 0).
- claim-check §4, the rest: E5's grep list widened; Task 3b's moved `expect(` lines allowed; the
  `/* v8 ignore */` contradiction settled for no ignore pair (Task 1; Global constraints); the
  wrong citations fixed (`backup-verification-history.ts`'s package, `till-app.notices.test.ts`,
  `chain.record-validation.test.ts:57-75`, `restore-fiscal-e2e.test.ts:410-413`,
  `record-void.test.ts:378` as a typed literal, 13 lines of `507`, the four till files holding
  `clockUnusable` arms).
- Not changed: the golden test, `inmutabilidad`, `computeHuella`, the chain's code beyond Task 3's
  one call, numbering, `registros_facturacion`'s writer and the alta builders. `issueMoment`'s
  pinned clock becomes an export with no change to what it does.
