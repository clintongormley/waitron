# A798-B, degraded but trading — build plan (all slices), with slice 1 in full

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement slice 1 task by task. Steps use
> checkbox (`- [ ]`) syntax. Each task is test-first: write the failing behavioural test, run it,
> watch it fail for the stated reason, then the minimal implementation.
>
> **Existing assertions.** A task may change an existing assertion only where it pins behaviour
> this plan removes (listed under "Behaviour slice 1 removes"), and only in a separate commit whose
> message begins `Changed test checks (A798 slice 1):` and lists each `file:line` with its before
> and after. Any other assertion that turns out to need changing is a STOP: report it, do not edit
> it.
>
> **Size.** Each task is sized for one implementer well under 100 tool calls. An implementer past
> about 150 calls with the task unfinished stops at a passing or cleanly red point, commits, and
> returns a handover: done, left, files, each check's state.
>
> Every `file:line` below was read at `main` `4e14618aa` on 2026-10-21, or at `90e174232`, which
> changes only this plan and `docs/compliance/asesor-questions.md` over it. Every claim about how
> the engine or the store behaves cites a probe in "Measured for this plan", run that day on macOS,
> Node v26.11.1, `node:sqlite`, from scratch files outside the repository: the planner's under
> `~/waitron-campaign-b/a798-plan-probe/`, the round-1 review's under
> `~/waitron-campaign-b/a798-plan-review/`, this revision's under
> `~/waitron-campaign-b/a798-plan-review/round1-fix/`, and the round-2 check's under
> `~/waitron-campaign-b/a798-plan-review/round2-check/`. Nothing was measured on Linux.

**Goal (whole build):** the box keeps trading when a part fails wherever a sale's record can still
be written, tells staff and managers what is wrong, and refuses honestly when it cannot — as the
design describes.

**Goal (slice 1):** a full disk is reported as `storage.disk_full` on every route and at start, and
a transaction the engine has already ended can never be half-committed, whatever the code inside it
catches.

**Architecture (slice 1):** the store learns to tell "the engine ended my transaction" from "a
statement was refused". When a statement on the write connection fails and the engine reports no
transaction open any more, the store records that failure, refuses every later statement in that
transaction body, issues no rollback of its own, and hands the caller the recorded failure. An
engine result code 13 becomes the domain error `storage.disk_full`. The route error boundary and
the start's failure classifier recognise that error anywhere in a cause chain, because drizzle wraps
some errors before they reach them.

**Tech stack:** TypeScript, `node:sqlite` behind drizzle 0.45.4 (`packages/store`), Hono
(`packages/server-kit`, `apps/server`), Vitest 4.

**Spec:** [A798 — Degraded but trading](../specs/2026-10-19-a798-degraded-trading-design.md),
revision 6. Slice 1 implements §4.6 item 1 and the store half of §11 item 2, from §8's slice list.
Backlog: A798-B (`docs/backlog.md`).

---

## Part 1 — The whole build

Ten slices, in §8's order, each on its own branch and pull request. **Only slice 1 is detailed
here.** Each later slice gets its own plan, written against `main` after the slice before it lands,
in the way A366 ran (`2026-10-07-a366-slice-1-service-periods.md`, then one plan per slice). That
plan re-reads the code, runs the experiments its slice needs, and may correct this table with
evidence.

**Review path.** FULL for a slice with any risk trigger: per-task reviews, the full
`/finish-branch` wave, and two Codex run-it reviews side by side (the second told to set the
branch's checklist aside). LIGHT for a slice with none: no per-task reviewer, one Codex run-it
review. Every slice, on either path, gets the fresh-context plan-against-spec read before its
implementers start.

**Lands itself or parked.** The owner's rule (2026-10-21): a pull request that changes invoices,
the Veri\*Factu record chain or its hashes, invoice series or numbering, or AEAT filing is finished
to green and parked for the owner; everything else lands itself.

| # | Branch | What | Risk triggers (§8) | Path | Migration | Lands or parked | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `feat/a798-1-full-disk-store` | The store reports a full disk as itself and stops after an ended transaction | concurrency, cross-package contract, fiscal invariants (the sale path) | FULL | no | **lands itself** | — |
| 2 | `feat/a798-2-full-disk-at-start` | A full disk at start (§4.7) | auth (an unauthenticated page), concurrency (the start's order) | FULL | no | **lands itself** | 1 |
| 3 | `feat/a798-3-refuse-before-reader` | The till names the red refusals; both checks before the reader refuse; the red state they read | fiscal invariants (settle handlers), cross-package contract | FULL | no | **parked** | 1 |
| 4 | `feat/a798-4-staff-notice-seat` | The module seat for staff notices (§5) | cross-package contract | FULL | no | **lands itself** | — (built after 3, by order) |
| 5 | `feat/a798-5-free-space-watch` | Free-space watch and the `storage.*` alerts | none | LIGHT | no | **lands itself** | 1 |
| 6 | `feat/a798-6-device-strip` | Notices on the equipment read; the strip in the till | cross-package contract, fiscal invariants (reads the outbox) | FULL | no | **lands itself** | 4, 5 |
| 7 | `feat/a798-7-box-status-page` | Box status page and Liberar | auth (`system.manage`) | FULL | no | **lands itself** | 4, 5 |
| 7b | `feat/a798-7b-retry-now` | Reintentar ahora | fiscal invariants (nudging the drain) | FULL | no | **parked** | 7 |
| 8 | `feat/a798-8-clock-behind-stop` | The clock-behind stop (§4.8 a, d, e) | fiscal invariants, cross-package contract, migrations | FULL | **yes — the build's one** | **parked** | 4, 6, 7 |
| 9 | `feat/a798-9-clock-restart` | Devices report their clock, `clock.disagrees`, the minimum-date checks, the restart | fiscal invariants (lifts the stop), auth | FULL | no | **parked** | 7, 8 |
| 10 | `feat/a798-10-emails-and-install` | Emails, `reader.offline`, the printer notice, `waitron.sh` | none | LIGHT | no | **lands itself** | 5, 6 |

Why each lands itself or is parked, against the owner's four categories:

1. **Lands itself.** It changes what a failed write reports and stops statements running after the
   engine has ended a transaction. It changes no invoice's content, no record, hash or chain link,
   no series or number, and nothing about filing. The sale path's code (`recordSale`,
   `appendToChain`) is not edited; Task 5 proves a sale on a full database still writes neither
   its sale nor its record. If review finds a task touching any of the four categories, the slice
   parks instead.
2. **Lands itself.** The start and the recovery page; nothing fiscal.
3. **Parked, by default** (decision 17). It refuses, before a card is charged, sales while the
   disk is red and sales under a clock before 28-10-2024, and words them. That can refuse a sale
   that would be issued today: on a database filled until a 20-line sale was refused, the next one-line
   sale was written (`~/waitron-campaign-b/a798-plan-review/round2-check/srv/seq.test.ts`,
   2026-10-21), and design §4.6 item 5 refuses every sale once a save has failed. It
   changes no invoice's content, no record, chain, series or number; whether refusing a sale that
   would otherwise be issued counts as changing invoices is the owner's call, so slice 3's plan
   may ask for it to land itself. The red state its checks read (§4.6 item 5: set by the first save
   that fails) is produced by no earlier slice, so slice 3 builds it.
4. **Lands itself.** A new seat on the module contract; it carries notices, not records.
5. **Lands itself.** Reads free space, raises alerts.
6. **Lands itself.** Reads the unsent count through the seat; writes nothing to the outbox.
7. **Lands itself** once Reintentar ahora is taken out of it. **Decision 11 below** splits that
   button into 7b, because clearing the outbox's back-off changes when records are sent to AEAT —
   AEAT filing — while the rest of the page reads and links.
8. **Parked.** It puts a check inside the record append (`appendToChain`,
   `packages/fiscal-verifactu/src/chain.ts:280-293`), refuses order edits that would file an
   invoice (design §4.8 e), and adds an index on `registros_facturacion` in the Veri\*Factu set.
   Chain and invoices both.
9. **Parked.** Its restart lifts the stop and lets a record be written with a generation time
   earlier than the one before it (design §4.8 b) — the chain — and it makes a read-only query to
   AEAT with the filing certificate.
10. **Lands itself.** Emails, an alert, a notice and the install script; nothing fiscal.

Order: the lane builds them one at a time in the table's order. Slice 4 has no dependency on 1–3
and could go earlier; it stays in §8's order. A parked slice does not block a later slice that does
not depend on it: 4 to 7 can land while 3 waits, and 10 while 8 and 9 wait for the owner.

**Two asesor questions** were added with this plan, as design §10 asks:
[Q51](../../compliance/asesor-questions.md#q51-a-chain-whose-record-times-step-back-once-under-a-managers-restart-added-2026-10-21)
(a chain whose record times step back once under a manager's restart) and
[Q52](../../compliance/asesor-questions.md#q52-sales-recorded-under-a-restart-whose-clock-later-proved-wrong-added-2026-10-21)
(sales recorded under a restart whose clock later proved wrong). Slices 8 and 9 build the
behaviour they ask about.

---

## Part 2 — Slice 1: the store reports a full disk as itself

### Measured for this plan

Each probe says what its failing case would have printed. Scripts for E1 to E12: `engine.mjs`,
`disk-commit.mjs`, `vt/queue.test.ts`, `vt/migrate.test.ts`, `vt/boundary.test.ts`,
`vt/standin.test.ts`, `srv/sale.test.ts`, all under `~/waitron-campaign-b/a798-plan-probe/`. For
E3b and E13 to E18: `engine.mjs`, `stmtjournal.mjs`, `appendonly.mjs`, `vt/review.test.ts` and
`vb/boundary.test.ts` under `~/waitron-campaign-b/a798-plan-review/`, and `feedshape.mjs` and
`vt/open-txn.test.ts` under its `round1-fix/`. The `.mjs` ones ran as `node <script> <scratch dir>`;
the Vitest ones with `env -u AI_AGENT -u CLAUDECODE node_modules/.bin/vitest run --root <probe dir>`
from the worktree, importing the worktree's own `packages/store/src` and `apps/server/src`.

- **E1, a page limit inside a transaction (engine only).** `begin immediate`, one insert, then an
  insert past `pragma max_page_count`. Printed `errcode 13 | database or disk is full`,
  `isTransaction after error: false`, an insert after it `ok`, `commit: errcode 1 | cannot commit -
  no transaction is active`, `rows kept: ["after"]`. Failing case (the design wrong): `true`.
  Control E4, a unique refusal in the same shape: `isTransaction after error: true`, both rows kept.
- **E2, inside a savepoint (engine only).** Printed `isTransaction after error: false`,
  `rollback to wt_sp_1: errcode 1 | no such savepoint: wt_sp_1`, `rows kept: []`. Failing case:
  `true` and `rollback to … ok`.
- **E3, can a page limit be met at COMMIT?** `cache_size = -65536`, `cache_spill = off`, so dirty
  pages stay in memory until commit. Printed `errcode 13` **at the insert**, and
  `isTransaction after insert: false`. Had the limit been checked at commit, the insert would have
  printed `ok` and the commit `errcode 13`. **In this shape, and in E3b's, a page limit was met at
  a statement, never at commit.** No other shape was tried.
- **E3b, more shapes for E3 (review round 1, `engine.mjs`, re-run for this revision).** Cache large,
  spill off, a 6-page headroom, rows of about 100 bytes into an indexed table one at a time inside one
  transaction, in the `delete`, `wal` and `truncate` journal modes: each printed
  `inserts before failure 111, failure errcode 13 | database or disk is full isTransaction false`.
  A `create index` inside a transaction at a 2-page headroom (WAL): `errcode 13`,
  `isTransaction: true`, then `commit: ok`. Failing case: every insert `ok` and the commit
  `errcode 13`.
- **E5, `RAISE(ROLLBACK)` (engine only).** Printed `errcode 1811 | refused x`,
  `isTransaction after error: false`, as design §12 experiment 5 reported.
- **E6, a page limit is per connection.** A second connection on the same file printed
  `max_page_count: 4294967294` and its big insert `ok`.
- **E7, a real full disk at COMMIT.** A 4 MB HFS+ image (`hdiutil create -size 4m -fs HFS+`),
  the database in WAL mode on it, cache large and spill off, a filler file leaving 16 KiB. Printed
  `statement: ok (dirty pages held in cache)`, `commit: errcode 13 | database or disk is full`,
  `isTransaction after commit attempt: false`, `rows on reopen: ["committed before"]`. Control,
  no filler: `commit: ok`, both rows on reopen. **A disk that fills at commit also ends the
  transaction itself and keeps nothing.**
- **E8, today's write queue, through `openVenueStore`** (a temp folder, WAL, page limit):
  - Q1, a body that lets the error escape: `caller sees: cannot rollback - no transaction is active
    | errcode 1`, `sales: []`.
  - Q2, a body that catches and carries on: `caught: database or disk is full`, `caller sees:
    cannot rollback …`, `sales: ["part 2"]` — **a statement after the failure committed by
    itself.** Failing case for the fix: anything but `[]`.
  - Q3, control, a caught unique refusal: `sales: ["part 1","part 2"]`.
  - N, a nested `db.transaction(...)` that fills: `nested caller sees: no such savepoint: wt_sp_1`,
    `outer caller sees: cannot rollback …`, `sales: []`.
  - **N2 (new; the design did not test it)**: the outer body swallows the nested failure, writes a
    row, then opens another nested transaction. `caller sees: cannot rollback …`,
    `sales: ["after nested","second nested"]`. With the engine's transaction gone, the adapter's
    `transaction()` saw `isTransaction` false and opened a fresh top-level `begin`
    (`node-sqlite-adapter.ts:136-137`), which committed on its own.
  - K, the queue's own commit on the real full disk image of E7: `statement ok`, `caller sees:
    cannot rollback - no transaction is active | errcode 1`, then `next transaction: ok`.
- **E9, a migration that fills (today's code).** drizzle's migrator on a store at its page limit.
  Printed `caller sees: Failed to run the query 'ROLLBACK' | first engine failure in chain:
  {"errcode":1,"message":"cannot rollback - no transaction is active"}`, `filler table exists: 0`.
  The migrator issues its own `ROLLBACK` as a statement after a failure
  (`drizzle-orm/sqlite-core/dialect.js:657-673`), and `packages/migrations/src/apply.ts:88-95` then
  wraps errcode 1 as `migrations.apply_failed`. **A full disk while migrating reads today as a failed
  migration, not a full disk.**
- **E10, the error boundary and the start's classifier today.** A raw errcode-13 error and the
  queue's "cannot rollback" error, each thrown inside `createErrorBoundary({}, …)`: both answered
  `500 {"error":{"code":"server.internal"}}`, logged `errorCode: "unknown"`, and
  `classifyBootFailure` returned `unknown` for both.
- **E11, a stand-in for "the disk fills at commit".** A `Proxy` over a real in-memory
  `DatabaseSync` whose `exec("commit")` runs the real `rollback` and then throws
  `{ errcode: 13, message: "database or disk is full" }`. Through today's queue it printed
  `caller sees: cannot rollback - no transaction is active | errcode 1 | isTransaction false`,
  `rows: []` — the same lines K printed on the real disk. So the stand-in reproduces the measured
  engine behaviour at commit, which this plan found no way to produce on a CI runner (E3, E3b: no
  shape tried met a page limit at commit).
- **E12, a real cash sale on a database filled to its page limit** (`provisionBillVenue`, the real
  Veri\*Factu backend, `POST /api/sales`). The database was filled by inserting 16-byte rows into a
  ballast table until the page limit refused (345 rows). Then:
  - a one-line sale answered **`200`**, and wrote its sale, record and outbox row: free space on
    pages already allocated held a whole sale. **Filling one table does not fill the database.**
  - a 20-line sale answered `500 {"code":"server.internal"}`, and the counts of `sales`,
    `registros_facturacion`, `envios` and `working_orders` stayed `1, 1, 1, 1`; an 80-line sale
    the same.
  - parking a 20-line counter order (`POST /api/working-orders`) on the same full database
    answered `500 {"code":"server.internal"}`, and `working_orders` stayed `1`.
  - after lifting the limit, the next sale answered `200` and `sales`, `registros_facturacion` and
    `envios` each rose by one.
- **E13, a full disk does not always end the transaction** (review round 1, `stmtjournal.mjs` on a
  WAL file and `appendonly.mjs` in memory; this revision, `feedshape.mjs`; all re-run for this
  revision). Each: `begin immediate`; in `stmtjournal.mjs` and `feedshape.mjs` an insert of
  `before`; then the filling statement at a 4-page headroom, then `isTransaction`. Every filling
  statement failed with errcode 13. Failing case for "a full disk ends the whole transaction":
  `isTransaction true`.
  - **Ended** (`isTransaction false`; where checked, `before` not kept): an insert of a 64 KiB row
    into a plain table; the same into a table with a foreign key; with a `unique` column; an
    `insert … select` of three rows; an insert into a table whose only triggers refuse updates and
    deletes (the append-only shape); an insert with `on conflict do nothing`, and one with
    `on conflict (…) do update`, into a table with a unique index.
  - **Left open, only the statement backed out** (`isTransaction true`; where checked, `before`
    kept): a three-row `update`; an insert into a table carrying a `before insert` trigger whose `when` did
    not match; `create index` (E3b); an insert whose `after insert` trigger writes a 64 KiB row to
    another table; and an insert of a 64 KiB row into a table carrying a trigger shaped like the
    change feed's (`after insert`, one small row into `change_log`; compare
    `packages/db/src/change-feed.ts:76` and `:117-130`), in memory and on a WAL file.
  The change feed puts an `after insert` trigger on every change source (`change-feed.ts:117-130`,
  installed at start, `apps/server/src/boot.ts:1550`; read), so by shape an insert into a change
  source on a running box is in the second group. Not run on a real change-source table.
- **E14, a full disk that leaves the transaction open, through today's code.** Review V5
  (`vt/review.test.ts`, through `openVenueStore`): a body inserts `before`, then a three-row
  `update` fills: `rejects: database or disk is full | errcode 13`, then `next: ok`, and
  `sales: ["a","b","c","next"]`. This revision's P1 (`vt/open-txn.test.ts`; a raw in-memory
  connection like the one `write-queue.test.ts`'s `open` builds, through `createWriteQueue`; a
  `when`-guarded `after insert` trigger writing 64 KiB):
  `isTransaction right after the failure: true | after run: false`, `rows: []`, `next: ok`. P2 (the
  same trigger shape in a nested `db.transaction` inside a `withWriteLock` body): the nested caller
  and the run both saw `database or disk is full | errcode 13`, `sales: []`, `next: ok`. Failing
  case for "today's queue rolls such a transaction back": the next transaction refused, or `before`
  or `outer` kept. So today the queue already rolls these back; under decision 14, slice 1 changes
  only the error the caller sees there.
- **E15, callers outside a running body** (review V2, re-run). A first body commits `seen`; a
  second fills, catches it and waits. Meanwhile, from outside any body, a read printed
  `[{"body":"seen"}]` and an insert printed `outside write: ok`. After release the second run
  rejected `cannot rollback - no transaction is active`, and `sales: ["seen","outsider"]`: the
  outside write was kept, committed on its own. The read is routed to the read connection while
  any body runs (`forStatement`, `packages/store/src/connections.ts:194-198`; read); V2 printed the
  same row either way, so it does not show which connection answered. An outside write is refused
  read-only there and re-run on the writer (`node-sqlite-adapter.ts:78-83`; read).
- **E16, the adapter's own top-level commit on the E11 stand-in, today** (this revision P3).
  `db.transaction` over `drizzleNodeSqlite(connectionPair(standIn, standIn), { schema: {} })`, one
  insert: rejected `database or disk is full | errcode 13`, the stand-in recorded
  `["begin deferred","commit","rollback"]`, `rows: []`. Failing case for Task 3a's fix: a
  `rollback` after `commit`, or a rejection without `code: "storage.disk_full"`.
- **E17, two tests that pin today's answer to a `RAISE(ROLLBACK)`.** In `apps/server`,
  `vitest run src/receipt-print.test.ts -t "propagates an engine rollback"` printed
  `Tests 1 passed | 120 skipped (121)`; that test asserts
  `.rejects.toThrow(/no transaction is active|no such savepoint/u)` (`receipt-print.test.ts:2775`)
  and `warning.mock.calls` `[]` (`:2776`). `vitest run src/till-api.unroutable-dish.test.ts -t
  "writing the alert ends the transaction"` printed `Tests 1 passed | 44 skipped (45)`; that test
  asserts status `500` and nothing sold (`:698-712`).
- **E18, the boundary today, two more answers** (review `vb/boundary.test.ts`, re-run). An
  `AppError("storage.disk_full", {})` thrown under `createErrorBoundary({}, …)` answered
  `400 {"error":{"code":"storage.disk_full","params":{}}}`; a Hono route answering `c.json(…, 507)`
  sent status `507`.
- **E19, three review probes cited below.** Review V1 (E8 N2 re-run), V3 (a top-level
  `db.transaction` outside the queue today: `cannot rollback - no transaction is active`,
  `sales: []`) and V4 (`RAISE(ROLLBACK)` through the queue today: `cannot rollback - no transaction
  is active`, `sales: ["after"]`), in `vt/review.test.ts`.

### Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan. Each has the DEFAULT to build.

1. **The test "at commit" uses a stand-in, not a page limit.** The design asks for tests "on a
   database at its page limit … at both failure points (inside the body and at commit)" (§8 slice
   1). No way to do that was found: in every shape tried, a page limit was met at a statement,
   never at commit (E3, E3b). DEFAULT: the inside-the-body and nested cases run on a real database
   at its page limit; the at-commit cases (the queue's, Task 2; the adapter's own, Task 3b) run on
   the E11 stand-in, whose behaviour E7 and K measured on a real full disk. The real-disk
   harness is slice 2's (design §4.7 asks for one); slice 2's plan adds an at-commit case to it.
2. **The store also refuses a new top-level `begin` inside a body whose transaction was ended**
   (N2). The design names the queue and the adapter's nested undo; N2 shows a third hole. DEFAULT:
   the adapter's `transaction()` refuses, with the recorded failure, when called inside a body
   whose transaction the engine ended.
3. **The code is declared in `@waitron/shared`'s registry.** Three packages need it — the store
   throws it, the error boundary and the start's classifier recognise it — and only their common
   dependency can hold one declaration. Precedent: `table.not_found` in `packages/db/src/errors.ts`
   for the same reason. DEFAULT: `"storage.disk_full": Record<string, never>` in
   `packages/shared/src/errors.ts`, with the recogniser `diskFullIn` beside `sqliteFailureOf` in
   `packages/shared/src/engine-failure.ts`. The only other `storage.` strings in the tree are
   fixture values in two dashboard test files (`backup-screen.archive-destination.test.ts`,
   `backup-screen.a11y.test.ts`; read: grep); nothing declares or throws them.
4. **The error boundary and the start look through the whole cause chain.** drizzle wraps an error
   thrown under `db.run` in a `DrizzleError` whose `cause` is the original
   (`drizzle-orm/sqlite-core/session.js:153-157`; E9 printed its message), so an `AppError` the
   adapter throws can reach a boundary wrapped. DEFAULT: `diskFullIn(error)` is true when any layer
   of the cause chain, to `MAX_CAUSE_DEPTH`, is an `AppError` coded `storage.disk_full` or carries
   engine errcode 13; the boundary and `classifyBootFailure` check it before anything else.
5. **A full disk answers HTTP 507** (Insufficient Storage), on every route, unless a route's own
   status table names the code. The owner's status rule (`conventions-data.md:37-50`) covers
   refusals caused by the request; a full disk is the box's fault. It is logged at `error`, not
   `warn`, under the event `storage.disk_full`.
6. **The queue hands back the failure that ended the transaction**, even when the body went on to
   throw something else (a later refusal, the poison refusal, a wrapper of its own). The design
   says "rethrow the original error"; this pins which one. An outermost `db.transaction` does the
   same; a nested one does not (decision 13).
7. **A `ROLLBACK` statement issued outside a transaction body, after a statement ended the
   transaction, throws the recorded failure** instead of "cannot rollback". This is the migrator's
   path (E9) and makes a full disk while migrating at start read as `storage.disk_full`. The design
   says the code reaches "every route and at start" (§4.6 item 1) without naming the migrator.
8. **Statements issued straight on the raw write connection bypass the refusal.** Only the store
   itself does that (`write-queue.ts:53-61`, `index.ts` → `checkpointTruncate`; `Connections` is not
   exported from `packages/store/src/index.ts`). DEFAULT: the queue still never rolls back a
   transaction the engine ended and never reports success for one, whatever ran in the body; the
   statement-level refusal covers what goes through drizzle, which is every product statement.
9. **The checkpoint is unchanged.** `checkpointTruncate` (`index.ts`, `writes.exclusive`) opens no
   transaction; a checkpoint on a full disk keeps today's error. The design's Liberar never folds the
   side file back (§4.6 item 6), and slice 5 owns the watch.
10. **No till or dashboard wording in slice 1.** Slice 3 adds the till's message (§4.6 item 2). Until
    then a full disk shows each client's generic sentence for a code it does not know
    (`apps/till/src/i18n/codes.ts:4-5`, "a code missing from this table degrades to the GENERIC
    sentence"). Two places read `server.internal` by name and so change words for a full disk: the
    dashboard's stuck-payments line (`apps/dashboard/src/screens/payments-screen.ts:71`) and the
    translations dialog (`apps/dashboard/src/widgets/content-translations-dialog.ts:445`). Both are
    acceptable for one slice; slice 3's plan revisits them.
11. **Slice 7's Reintentar ahora goes in its own parked pull request, 7b** (Part 1). It changes when
    records reach AEAT; the rest of slice 7 does not.
12. **The recovery page gets an entry for `storage.disk_full` in slice 1**, without the sentence
    about the start freeing space, which only becomes true in slice 2. The page's guard requires an
    entry for every code `classifyBootFailure` produces (`recovery-surface.test.ts:405-428`), and
    E9's migrator path can reach the page after three counted failures. Slice 2 adds "El equipo ha
    borrado lo que podía volver a crear, y no ha bastado." and its English.
13. **A nested transaction the engine ended throws a fresh error, never the object its body threw**
    (review round 1, finding 1). `optionalDocument` omits a failure only when the nested
    transaction rethrows the very object its body threw
    (`apps/server/src/optional-document.ts:35`, `if (!failed || error !== bodyError) throw error;`).
    Today a nested level whose transaction the engine ended fails its own `rollback to`, a
    different object, so the failure escapes (E17 pins it). Had the nested level thrown the
    recorded failure (the first draft of Task 3), that is the object the body caught, and a full
    disk or a `RAISE(ROLLBACK)` inside a receipt or invoice-delivery enqueue would be logged
    `receipt.optional_document_failed` and omitted; by Task 3a's design the sale would then still
    fail at its next statement, with a false warning logged (read, not run). Two fixes were open:
    (a) the store's nested level throws a fresh error when the engine ended the transaction —
    `new AppError("storage.disk_full", {}, { reason })` when the recorded failure is a full disk,
    otherwise `new Error("…", { cause: <the recorded failure> })`; (b) `optionalDocument` asks
    whether the transaction is gone. DEFAULT (a): the store is where the engine's state is read,
    and `Transaction` gives `optionalDocument` no way to ask it, so (b) needs a new store-to-server
    contract; (a) also covers any other caller that compares failures by identity. The outermost
    level and the queue still hand back the recorded failure (decision 6). Built in Task 3a; its
    effect on `receipt-print.test.ts:2765-2780` and the comment at `optional-document.ts:15` is
    Task 3c's.
14. **The store refuses later statements only when the engine ended the transaction, not on every
    result code 13** (review round 1, finding 2). E13: a full disk sometimes ends the transaction
    and sometimes backs out only the statement. DEFAULT: a full disk is always mapped to
    `storage.disk_full`, but recorded, and later statements refused, only when the writer had a
    transaction open before the statement and has none after it. A full disk that left the
    transaction open is treated as any refused statement: code that catches it may carry on and
    what it writes afterwards commits; one that escapes is rolled back by the queue (E14). The
    alternative, recording every errcode 13 whatever the engine's state, is not built: it would
    also refuse a sale whose only full disk was inside a failure the code is written to survive,
    which today's code lets commit (`optional-document.ts:24-50`; read, not run) — slice 3's kind
    of change (decision 17), not slice 1's.
15. **The department-transfer stream sends `session-invalid` for every `AppError` except a full
    disk** (review round 1, finding 4). `apps/server/src/department-transfer-api.ts:121-125` sends
    any `AppError` from the stream's periodic `authenticate()` as `session-invalid`, and the till's
    monitor stops for a code with no status
    (`apps/till/src/state/department-transfer-monitor.ts:165-173`). The review proposed matching
    only session codes, as `live-api.ts:156-161` does. The stream's own tests already expect
    `session-invalid` for five codes (`department-transfer-api.test.ts:1240-1287`), and
    `monitoringActor` also calls `authorize` and `assertDeviceStillProven`
    (`department-transfer-api.ts:31-55`), so a list would have to name every code those can throw
    to change nothing else. DEFAULT: when `diskFullIn(error)`, the stream takes the path a
    non-`AppError` takes today (log `live.stream_failed`, close). Whether `authenticate()` can meet
    a full disk was not run: with `passive: true` it records no sighting
    (`apps/server/src/till-session.ts:117`); the functions `monitoringActor` calls were not read
    for writes. The change does not depend on the answer. Built in Task 3c.
16. **The record of an ended transaction is kept per connection pair, not per body** (review round
    1, 8e). An outermost `db.transaction` opened outside the queue while a queue body's
    transaction was ended would clear that body's record (Task 3a: it calls `clearEnded()` after
    its `begin`). DEFAULT: not closed in slice 1. Product writes go through `withTransaction`
    (`packages/db/src/tenancy.ts:30-43`), which runs inside `withWriteLock`.
    `/usr/bin/grep -rnE "\b(db|venue|database|store\.venue|deps\.db|target)\.transaction\(" packages apps --include='*.ts'`,
    less `*.test.*` files, found seven such calls, all under a `test/` or `src/testing/` folder —
    weaker than "none in product": a receiver with another name is not matched. Keying the record
    to the body would need a chain of body tokens through every nested savepoint.
17. **Slice 3 parks by default** (review round 1, finding 9; Part 1, reason 3).
18. **Task 3 is split into 3a, 3b and 3c** (review round 1, finding 7, proposed 3a and 3b). 3a is
    the adapter and its cases; 3b the migrator's `ROLLBACK`, the controls on 3a's code (the
    refusal controls, Open and Top-at-commit) and the audit;
    3c the two `apps/server` consequences this round found (decisions 13 and 15), so 3a and 3b
    stay inside `packages/store`.
19. **Task 5's failing run is a deletion, not a run on `main`** (review round 1, finding 5). Its
    fixture now checks `diskFullIn(error)` (Task 1), which `main` lacks. On `main` the file loads,
    but `diskFullIn` is undefined there, so every case fails inside `fillDatabase` with
    `diskFullIn is not a function` — for the wrong reason. E12 is the run on `main`. DEFAULT: Step 2 deletes the boundary's full-disk branch
    (Task 4), watches the refusal cases fail, then restores it.

### Behaviour slice 1 removes

Tests pinning these may change, under the commit rule above. Run at `90e174232`,
`/usr/bin/grep -rnE "cannot rollback|no such savepoint|no transaction is active|cannot commit|Failed to run the query 'ROLLBACK'|raise\(rollback|errcode: 13|errcode === 13|disk is full|max_page_count" packages apps scripts --include='*.ts' --include='*.mjs'`
found one assertion pinning one of them: `apps/server/src/receipt-print.test.ts:2775` (E17; Task
3c changes it). Its other hits are comments, test names containing "cannot commit" (names, not
assertions on a message),
a `raise(rollback)` case whose assertions slice 1 should leave passing
(`till-api.unroutable-dish.test.ts:698-712`, E17; Task 3c re-runs it), and
`restore-stream.test.ts:438`, about a restore's partial download. If another turns up, it is this
list's.

- A full disk reported as "cannot rollback - no transaction is active", "no such savepoint: …" or
  "Failed to run the query 'ROLLBACK'" (E8, E9).
- An engine rollback (`RAISE(ROLLBACK)`) reported to the outer caller as "no such savepoint: …" or
  "cannot rollback …" instead of the trigger's own refusal (E17, V4; Task 3a's Raise-rollback
  case; `receipt-print.test.ts:2775`).
- Statements after a full disk that ended the transaction, in the same body, committing by
  themselves (E8 Q2, N2).
- A full disk answering `500 server.internal`, and classifying `unknown` or
  `migrations.apply_failed` at start (E9, E10).
- A full disk logged as `errorCode: "unknown"` by the code that logs a failure's code; it now logs
  `storage.disk_full` (Task 3b's audit, group B).
- A full disk passed through, where it reaches them, by the wrappers that pass an `AppError` on and
  re-code anything else, and printed by the operator commands that print an `AppError`'s code:
  `storage.disk_full` instead of `cloud.unavailable`, `reader.unpair_failed`,
  `provisioning.state_unreadable`, `unexpected failure (Error)` or a bare `restore failed`
  (Task 3b's audit, groups C and E), and `cloud.failed` in the Cloud status reply (group B).

### Global constraints

- Every commit `git commit -s`. Never `--no-verify`. Work in this worktree only.
- No migration. No change to `packages/fiscal-verifactu`, `packages/core/src/record-sale.ts`, the
  golden huella test or `inmutabilidad.test.ts`.
- Error codes name the domain concept; `storage.disk_full` is the one new code. No new `server.*`
  code.
- No Spanish in general code (CLAUDE.md §3). The recovery page's Spanish lives in its existing
  fixed-text table (`apps/server/src/recovery-surface.ts:234`), which already holds both languages.
- Database tests in `apps/server` use `useVenueDb`. `packages/store` cannot (`@waitron/db` depends
  on it, `scripts/workspace-cycles.test.ts`), so its tests open a real store on a temp folder with
  `openVenueStore`, as `packages/store/src/index.test.ts:29-38` does.
- Coverage stays at 98/98/98/95 in `packages/shared`, `packages/store`, `packages/server-kit` and
  `apps/server`. `packages/shared` is mutation-tested (floor 90): its new function's tests must fail
  for a changed comparison, a changed number and a removed loop bound.
- A rejected write asserts the domain code, never `toBeInstanceOf(Error)` (CLAUDE.md §4).
- Comments only for an invariant or a non-obvious why. Every doc comment this slice makes false is
  fixed in the same task — in particular `node-sqlite-adapter.ts:103-125` ("a transaction the engine
  ended on its own is not one this client still believes in"), `write-queue.ts:4-13` and
  `apps/server/src/optional-document.ts:15` (Task 3c).
- Run focused tests as each task says; CI runs the package suites.

### Review focus

The conditions most likely to bite that no single happy path exercises, each with its test in the
task named.

1. **Code that catches a full disk that ENDED the transaction and carries on**, in a body or a
   nested transaction, at any depth. Expected: every later statement refused, nothing kept, the
   caller told `storage.disk_full` (Task 3a, cases Q2 and N2; Task 2 for a body that catches and
   returns).
2. **A full disk that left the transaction OPEN** (E13: a multi-row update, an index build, an
   insert into a table with an insert trigger). Expected: `storage.disk_full`; a body that lets it
   escape is rolled back, nothing kept, and the next transaction served; a body that catches it
   carries on as after any refused statement (Task 2, the open-transaction case; Task 3b, case
   Open). An implementation keyed on result code 13 rather than on the engine's state fails these
   (decision 14).
3. **A refusal is not a full disk.** A unique key, NOT NULL, CHECK, an immediate foreign key,
   `RAISE(ABORT)`, `RAISE(FAIL)` and a missing table, each caught inside a nested transaction,
   must still leave the transaction usable and commit the rows around it (Task 3b, the controls).
4. **The disk fills at commit.** Expected: `storage.disk_full`, no rollback issued, and the next
   transaction served (Task 2 for the queue's commit and Task 3b, case Top-at-commit, for the
   adapter's own, both on the stand-in). The control: a commit the engine refuses and leaves open
   (a deferred foreign key) is still rolled back (Task 2).
5. **Other callers around the failure.** A caller queued behind the failed body is served; a read
   from outside the failed body, while it is still running, is answered by the read connection
   with committed rows; a write from outside it is not refused (Tasks 2 and 3a).
6. **A caller that compares failures by identity** (`optionalDocument`). A nested transaction the
   engine ended throws an error that is not its body's own, so the failure escapes instead of
   being logged and omitted (decision 13; Task 3a, cases N and N-rollback; Task 3c,
   `receipt-print.test.ts:2765-2780`).
7. **A full disk while migrating at start** reads as `storage.disk_full`, not as a failed
   migration (Task 3b, case M; Task 4, the classifier).

---

### Task 1: The code `storage.disk_full` and a recogniser for it

**Files:**
- Modify: `packages/shared/src/errors.ts` (the `ErrorParams` interface, `:27-58`)
- Modify: `packages/shared/src/engine-failure.ts`
- Modify: `packages/shared/src/index.ts:139` (export beside `sqliteFailureOf`)
- Test: `packages/shared/src/engine-failure.test.ts`

**Interfaces:**
- Produces: `ErrorParams["storage.disk_full"]: Record<string, never>`, with a one-line doc comment:
  the box's disk is full, so a write was refused. (Not "the transaction kept nothing": E13 and E14
  show a full disk that leaves the transaction open.)
- Produces: `export const DISK_FULL_RESULT_CODE = 13;` (SQLite's `SQLITE_FULL`).
- Produces: `export function diskFullIn(error: unknown): boolean` — true when any layer of the
  `cause` chain, walked at most `MAX_CAUSE_DEPTH` layers (`cause-chain.ts:4`) and stopping at a
  layer that is its own cause, is an object whose `code` is the string `"storage.disk_full"` or whose
  `errcode` is the number 13.

- [ ] **Step 1: Write the failing tests** in `engine-failure.test.ts`, in a new
  `describe("diskFullIn")`, using the file's `driverError` helper:
  - `"recognises the engine's full-disk code"`: `diskFullIn(driverError(13, "database or disk is full"))` is `true`.
  - `"recognises the domain error"`: `diskFullIn(new AppError("storage.disk_full", {}))` is `true`.
  - `"recognises either one under a wrapper"`: `new Error("Failed to run the query 'ROLLBACK'", { cause: new AppError("storage.disk_full", {}) })` → `true`; the same with `{ cause: driverError(13, "…") }` two layers down → `true`.
  - `"does not take a neighbouring code for a full disk"`: errcodes 12, 14 and 1 → `false`; `new AppError("table.not_found", { tableId: "x" })` → `false`; an object `{ code: 13 }` (a number on `code`) → `false`; an object `{ errcode: "13" }` (a string) → `false`.
  - `"stops at the depth bound"`: a chain whose errcode-13 layer sits at depth `MAX_CAUSE_DEPTH` (the sixth object) → `false`; at depth `MAX_CAUSE_DEPTH - 1` → `true`.
  - `"stops at a self-referencing error"`: an error whose `cause` is itself and which carries no code → `false`, and returns.
  - `"answers false for values that are not objects"`: `null`, `undefined`, `"storage.disk_full"`, `13` → `false`.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/shared exec vitest run src/engine-failure.test.ts`
  Expected: the new cases FAIL because `diskFullIn` is not exported (`diskFullIn is not a function`,
  or a missing-export error); the existing `sqliteFailureOf` cases pass. Typecheck also fails on
  `"storage.disk_full"` not being an `ErrorCode` until Step 3.

- [ ] **Step 3: Implement** the registry entry, `DISK_FULL_RESULT_CODE` and `diskFullIn` in
  `engine-failure.ts` (one loop, the same shape as `sqliteFailureOf`, `:15-31`), and export both
  from `index.ts`.

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/shared exec vitest run src/engine-failure.test.ts`
  Expected: PASS, with a `Tests` count that includes the new cases. Then
  `pnpm --filter @waitron/shared typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/src/errors.ts packages/shared/src/engine-failure.ts packages/shared/src/index.ts packages/shared/src/engine-failure.test.ts
  git commit -s -m "Name a full disk as storage.disk_full, and recognise it anywhere in an error's causes"
  ```

### Task 2: The write queue never rolls back or reports success for a transaction the engine ended

**Files:**
- Create: `packages/store/src/disk-full.ts`
- Modify: `packages/store/src/connections.ts` (the `Connections` interface `:81-137` and
  `connectionPair` `:165-227`)
- Modify: `packages/store/src/write-queue.ts:42-68` and its doc comment `:4-13`
- Test: `packages/store/src/write-queue.test.ts`, `packages/store/src/connections.test.ts`

**Interfaces:**
- Consumes: `AppError`, `sqliteFailureOf`, `DISK_FULL_RESULT_CODE` from `@waitron/shared` (Task 1).
- Produces, in `disk-full.ts`: `export function asDiskFull(error: unknown): AppError<"storage.disk_full"> | undefined` —
  a new `AppError("storage.disk_full", {}, { reason: "sqlite errcode 13" })` when
  `sqliteFailureOf(error)?.errcode === DISK_FULL_RESULT_CODE`, the same `error` when it already is
  that `AppError`, otherwise `undefined`.
- Produces, on `Connections`:
  - `noteEnded(error: unknown): void` — records `error` as the failure that ended the writer's
    open transaction; keeps the FIRST one until cleared.
  - `endedBy(): { error: unknown } | undefined` — the recorded failure.
  - `clearEnded(): void`.
  - `insideBody(): boolean` — whether the caller's asynchronous context is one of this pair's
    running transaction bodies (the same test `forStatement` makes at `connections.ts:196-197`).
- Produces, the queue's `run` behaviour, in this order:
  1. `begin immediate` (a failure there is mapped by `asDiskFull` and thrown, as today it is thrown);
     then `clearEnded()`.
  2. Run the body. If the body returned but `endedBy()` is set, or the writer has no transaction open
     (`!connections.write.isTransaction`), throw `endedBy()?.error`, or when nothing was recorded
     `new Error("write queue: the engine ended this transaction before its body finished")`.
  3. `commit`. If it throws: map with `asDiskFull`; if the writer has no transaction open, `noteEnded`
     the mapped error; throw it (through step 4).
  4. On any failure: issue `rollback` **only if** `connections.write.isTransaction` is true; if that
     rollback itself throws, discard its error. Throw `endedBy()?.error ?? asDiskFull(error) ?? error`.
  5. In every case, `clearEnded()` before `run` settles.

- [ ] **Step 1: Write the failing tests** in `write-queue.test.ts`, in a new
  `describe("when the engine ends the queue's transaction itself")`. These use the file's raw
  in-memory connection (`open`, `:6-10`), set
  `pragma max_page_count = <page_count + 4>` on it, and fill with
  `insert into t (who) values (zeroblob(65536))` (E1 measured a 64 KiB row past a 4-page limit).
  Add `const full = (db) => …` beside `open`. Cases:
  - `"hands back storage.disk_full, not the queue's own failed rollback, when a statement fills the disk"`:
    body inserts `"A"`, then fills. `await expect(run).rejects.toMatchObject({ code: "storage.disk_full" })`,
    and `who(db)` is `[]`.
  - `"refuses to report success for a body that caught the full disk and returned"`: the body
    catches the filling insert's error and returns `"done"`. The run rejects rather than resolving,
    with `"write queue: the engine ended this transaction before its body finished"` — on raw
    statements nothing records the failure (decision 8); through drizzle Task 3a's case Q2b gets
    `storage.disk_full` — and `who(db)` is `[]`.
  - `"hands back storage.disk_full when the disk fills at commit, and issues no rollback of its own"`:
    the E11 stand-in (a `fullAtCommit(real)` helper in the test file: a `Proxy` over a real
    in-memory `DatabaseSync` whose `exec("commit")` runs the real `rollback` and throws
    `Object.assign(new Error("database or disk is full"), { errcode: 13, code: "ERR_SQLITE_ERROR" })`,
    and which records every `exec` text it receives). A comment on the helper cites the plan's E7
    and K: on a real full disk the engine answered this way. Assert the rejection is
    `{ code: "storage.disk_full" }`, no `exec` text after `"commit"` is `"rollback"`, the real
    table is empty, and `isTransaction` is false.
  - `"still rolls back a commit the engine refused and left open"` (control): a deferred foreign
    key accepted in the body and refused at `commit` (the shape of
    `node-sqlite-adapter.test.ts:328-351`, on raw `exec`). The run rejects with
    `/FOREIGN KEY constraint failed/`, the child table is empty, `isTransaction` is false, and a
    following `queue.run` that inserts a row resolves and keeps it.
  - `"serves the caller queued behind a body that filled the disk"`: two `queue.run` calls started
    together; the first fills, the second inserts `"B"` (a short row, which fits in the page the
    first left free). The first rejects `{ code: "storage.disk_full" }`, the second resolves, and
    `who(db)` is `[{ who: "B" }]`.
  - `"rolls back a full disk that left the transaction open, and serves the next transaction"`
    (decision 14): in the case's setup add `create table log (v blob)` and
    `create trigger t_big after insert on t when new.who = 'big' begin insert into log values (zeroblob(65536)); end`.
    The body inserts `"A"`, then inserts `"big"` and lets its error escape. The run rejects
    `{ code: "storage.disk_full" }`; afterwards `isTransaction` is false and `who(db)` is `[]` (so
    the queue rolled back rather than committed); a following `queue.run` inserting `"next"`
    resolves, and `who(db)` is `[{ who: "next" }]`. E14's P1 ran this shape through today's queue:
    `isTransaction` true right after the failure, `[]`, then `next: ok`. A queue that skipped its
    rollback for every errcode 13 would leave the transaction open and fail the `isTransaction`
    and `next` assertions (reasoned, not run: a `begin` inside a transaction is refused,
    `write-queue.ts:7-9`).
  - In `connections.test.ts`, `describe("the record of a transaction the engine ended")`:
    `endedBy()` is `undefined` on a fresh pair; after `noteEnded(a)` then `noteEnded(b)` it is
    `{ error: a }`; after `clearEnded()` it is `undefined`; `insideBody()` is `false` outside any
    body, `true` inside `asTransactionBody`, and `false` from a callback detached inside a body
    that has finished (the shape of the existing case at `connections.test.ts:120`).

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/store exec vitest run src/write-queue.test.ts src/connections.test.ts`
  Expected: the first and the stand-in case FAIL with `cannot rollback - no transaction is active`
  (E8 Q1 and E11 printed it); the "caught and returned" case FAILS with `cannot rollback - no
  transaction is active` (today's queue commits, gets "cannot commit", then rolls back and gets
  "cannot rollback"); the queued-caller case FAILS on the first rejection's message; the
  open-transaction case FAILS on its first assertion, the run rejecting with the raw
  `database or disk is full`, `code: "ERR_SQLITE_ERROR"` rather than `storage.disk_full` (E14, P1), while its `[]` and `next` assertions pass
  today; the connections cases FAIL because `noteEnded`, `endedBy`, `clearEnded` and `insideBody`
  do not exist. The deferred-key control PASSES before and after — it is the control.

- [ ] **Step 3: Implement** `disk-full.ts`, the four `Connections` members, and the queue's `run`
  as the Interfaces block orders it. Rewrite the queue's doc comment so it says the queue issues
  no rollback for a transaction the engine has already ended (E1, E7: there the engine rolled the
  whole transaction back itself), and still rolls back one a full disk left open (E13, E14).

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/store exec vitest run src/write-queue.test.ts src/connections.test.ts`
  Expected: PASS, with a `Tests` count covering the new cases. Then
  `pnpm --filter @waitron/store typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/store/src/disk-full.ts packages/store/src/connections.ts packages/store/src/write-queue.ts packages/store/src/write-queue.test.ts packages/store/src/connections.test.ts
  git commit -s -m "The write queue no longer hides a full disk behind its own failed rollback"
  ```

### Task 3a: The adapter refuses every statement after the engine ended the transaction

**Files:**
- Modify: `packages/store/src/node-sqlite-adapter.ts` — `prepare`'s `onWriter` and `issue`
  (`:68-84`), `transaction`'s `inMode`, `keep` and `undo` (`:126-174`), and the doc comment
  `:103-125`
- Create: `packages/store/src/disk-full.test.ts`

**Interfaces:**
- Consumes: `asDiskFull` (Task 2), `noteEnded`/`endedBy`/`clearEnded`/`insideBody` (Task 2),
  `diskFullIn` (Task 1). Below, "the mapped error" means `asDiskFull(error) ?? error`.
- Produces, the adapter's behaviour:
  - **A statement on the writer** (`onWriter`): if `endedBy()` is set and `insideBody()` is true,
    throw `endedBy().error` without running it. Otherwise run it; if it throws, and a transaction
    was open before it ran and is not open after, `noteEnded` the mapped error; throw the mapped
    error. A full disk that left the transaction open is mapped and thrown, and nothing is
    recorded (decision 14). (The bare-`rollback` rule of decision 7 is Task 3b's.)
  - **A statement on the reader** that throws errcode 13: thrown mapped; a read-only refusal still
    goes back to the writer as today (`:78-83`).
  - **`transaction()`**: on entry, if `endedBy()` is set and `insideBody()` is true, throw
    `endedBy().error` and open nothing (decision 2). An outermost transaction (no savepoint) calls
    `clearEnded()` after its `begin` and again when it finishes either way. `undo` does nothing
    when the writer has no transaction open. `keep`'s failure is mapped, `noteEnded` when the
    transaction is gone, and otherwise undone as today. On failure, on both the synchronous and
    the asynchronous path:
    - **outermost level:** throw `endedBy()?.error ?? <the mapped error>` (decision 6);
    - **savepoint level, writer has no transaction open:** throw a FRESH error, never the object
      the body threw (decision 13) — `new AppError("storage.disk_full", {}, { reason: "the engine
      ended the transaction this savepoint was in" })` when `diskFullIn(endedBy()?.error)`, and
      otherwise `new Error("the engine ended the transaction this savepoint was in", { cause:
      endedBy()?.error ?? <the body's error> })`;
    - **savepoint level, transaction still open:** as today — rolled back to the savepoint,
      released, and the body's error thrown.

- [ ] **Step 1: Write the failing tests** in the new `disk-full.test.ts`. A helper opens a store on a
  temp folder (as `index.test.ts:29-38`, closed in `afterEach`), creates
  `sale (id integer primary key, body text unique, pad blob)`, and `limit(db, 4)` sets
  `pragma max_page_count = page_count + 4` through `db.execute` (E6: per connection; with no body
  running the statement goes to the writer). `fill` is
  `db.execute("insert into sale (body, pad) values ('fill', zeroblob(65536))")` (in the cases that
  call it `sale` has no trigger, so E13 puts it in the "ended" group). Every body runs in
  `store.venue.withWriteLock(...)`, as `withTransaction` does (`packages/db/src/tenancy.ts:35`).
  Each case asserts `bodies()` — the `body` column in id order — after the run:
  - Q2 `"refuses the statements a body runs after catching a full disk, and keeps nothing"`: inserts
    `part 1`, catches `fill`, inserts `part 2`. The run rejects `{ code: "storage.disk_full" }`;
    the `part 2` insert itself threw `{ code: "storage.disk_full" }` (record it inside the body);
    `bodies()` is `[]`.
  - Q2b `"hands back storage.disk_full for a body that caught the full disk and returned"`: catches
    `fill`, returns. Rejects `{ code: "storage.disk_full" }`.
  - N `"tells both the nested and the outer caller storage.disk_full, with a fresh error at the nested level"`:
    inserts `outer`, then `await db.transaction(async () => { insert inner; fill })` where the
    nested body catches `fill`'s error, keeps it as `bodyError` and rethrows it; the outer body
    records the nested caller's error and rethrows it. The nested caller's error and the run's
    rejection are both `{ code: "storage.disk_full" }`; the nested caller's error is not
    `bodyError` (`expect(nested).not.toBe(bodyError)`, decision 13); `bodies()` is `[]`.
  - N-rollback `"throws a fresh error from a nested transaction a RAISE(ROLLBACK) ended"`: a
    `before insert` trigger on `sale` with `when new.body = 'x'` and `raise(rollback, 'refused x')`;
    the body inserts `before`, then a nested `db.transaction` inserts `x`, keeps the error it caught
    as `bodyError` and rethrows; the outer body records the nested caller's error and rethrows it.
    The nested caller's error is not `bodyError`, and its `cause` is `bodyError`; the run rejects
    with the message `refused x`; `bodies()` is `[]`. This is the store-level shape of
    `receipt-print.test.ts:2765-2780` (Task 3c).
  - N2 `"refuses a nested transaction opened after a swallowed full disk"`: swallows the nested
    failure, then inserts `after nested` (record its error), then opens another nested transaction
    inserting `second nested` (record its error). Both recorded errors are
    `{ code: "storage.disk_full" }`; the run rejects the same; `bodies()` is `[]`.
  - Top `"hands back storage.disk_full from a top-level transaction opened without the queue"`:
    `await expect(db.transaction(async () => { insert x; fill })).rejects.toMatchObject({ code: "storage.disk_full" })`;
    `bodies()` is `[]`; a following `db.transaction` inserting `y` resolves and keeps it.
  - Next `"serves the next transaction after a full disk"`: after Q2's shape fails, a
    `withWriteLock` body inserting `next` resolves; `bodies()` is `["next"]`.
  - Reader `"answers a read and a write from outside a body that filled the disk, while that body still runs"`:
    a first `withWriteLock` body inserts and commits `seen`; a second body fills, catches it, then
    awaits a promise the test releases. Meanwhile, from the test's own context, outside any body:
    a read (`db.execute("select body from sale")`), which the store routes to the READ connection
    (E15), resolves with `[{ body: "seen" }]`; and a write (`insert … 'outsider'`), which reaches
    the writer, resolves and is not refused with `storage.disk_full`. Then release; the second run
    rejects `{ code: "storage.disk_full" }`; `bodies()` is `["seen", "outsider"]` (E15 printed the
    same rows today). The write is the half that reaches this task's new check; the read guards
    the routing.
  - Raise-rollback `"ends the transaction on RAISE(ROLLBACK), hands back the trigger's own refusal, and keeps nothing"`:
    a `before insert` trigger with `raise(rollback, 'refused x')`; the body inserts `before`,
    catches the `x` insert, inserts `after` (record its error). The recorded error and the run's
    rejection both carry the message `refused x`, and neither is `storage.disk_full`; `bodies()`
    is `[]`. Nothing in the product uses this form (design §2.6, read); the case pins that the
    refusal mechanism is the engine's state, not the error code.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/store exec vitest run src/disk-full.test.ts`
  Expected, on top of Task 2. Measured on today's code, and expected to hold after Task 2: N with
  the nested caller's error `no such savepoint: wt_sp_<n>` (E8 N; the counter is module-level, so
  the number varies); N-rollback the same way; N2 with `bodies()` `["after nested", "second nested"]`
  (E8 N2, V1); Top with `cannot rollback - no transaction is active` (V3); Raise-rollback with
  `bodies()` `["after"]` (V4). Reasoned, not run, because Task 2 is not yet built: Q2 with `bodies()`
  `["part 2"]` (E8 Q2) and the run rejecting with Task 2's "ended this transaction" error, because
  the body caught the only error that named the disk; Q2b with that same error; Next with
  `bodies()` `["part 2", "next"]`, because nothing yet stops `part 2` committing by itself; Reader
  on the run's rejection, Task 2's error rather than `storage.disk_full`. Passing before and after:
  Reader's read and write. (Open and Top-at-commit are Task 3b's.)

- [ ] **Step 3: Implement** the adapter behaviour in the Interfaces block, and rewrite the doc
  comment at `:103-125` so it says that the engine sometimes ends a transaction itself and
  sometimes backs out only the statement (E1, E2, E7, E13), why a later statement in a body whose
  transaction the engine ended is refused (E8 Q2, N2), and why a nested level then throws an error
  of its own (decision 13).

- [ ] **Step 4: Run the store's suite and watch it pass**

  Run: `pnpm --filter @waitron/store exec vitest run`
  Expected: PASS, every file, `Tests` count shown; the existing adapter cases at
  `node-sqlite-adapter.test.ts:328-367` (a refused commit, a deferred key) still pass unchanged.
  Then run `pnpm --filter @waitron/store test:coverage` and note any line or branch below the bar: the
  adapter's commit-failure branch is reached only by Task 3b's Top-at-commit case, so the bar
  (98/98/98/95) is required at the end of Task 3b, not here.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/store/src/node-sqlite-adapter.ts packages/store/src/disk-full.test.ts
  git commit -s -m "Nothing written after the engine ends a transaction can commit, at any depth"
  ```

### Task 3b: A migration that fills the disk, the refusal controls, and the audit

**Files:**
- Modify: `packages/store/src/node-sqlite-adapter.ts` — `onWriter` (`:68-74`), the bare-`rollback`
  rule
- Modify: `packages/store/src/disk-full.test.ts` (Task 3a's file)

**Interfaces:**
- Consumes: Task 3a's adapter.
- Produces: a statement on the writer whose text is a bare rollback
  (`/^\s*rollback\s*;?\s*$/i` on `prepare`'s `query`), issued when the writer has no transaction
  open, `endedBy()` is set and `insideBody()` is false, throws `endedBy().error` and calls
  `clearEnded()` (decision 7). This is the migrator's path (E9): it issues `begin`, its statements
  and `rollback` as ordinary statements outside any body (`connections.ts`, the comment above
  `connectionPair`).

- [ ] **Step 1: Write the tests** in `disk-full.test.ts`:
  - Refusal controls `"leaves the transaction usable after each refusal the product can meet"`,
    one `it.each` row per refusal from design §12 experiment 5: duplicate `body` (unique), a null
    into a `not null` column, a failing `check`, an immediate foreign key, `RAISE(ABORT)`,
    `RAISE(FAIL)`, and a missing table. Each row's body inserts `before`, runs the refused statement
    inside a nested `db.transaction(...)` and catches it, then inserts `after`. The run resolves
    and `bodies()` is `["before", "after"]`. Create the extra tables and triggers the rows need in
    the case's own setup.
  - Open `"rolls back a full disk that left the transaction open, and serves the next one"`
    (decision 14): add `create table log (v blob)` and
    `create trigger sale_big after insert on sale when new.body = 'big' begin insert into log values (zeroblob(65536)); end`
    (E13's "left open" shape; E14's P2 ran it). The body inserts `outer`, then a nested
    `db.transaction` inserts `inner` and `big`; the outer body records the nested caller's error
    and rethrows it. The nested caller's error and the run's rejection are both
    `{ code: "storage.disk_full" }`; `bodies()` is `[]`; a following `withWriteLock` body inserting
    `next` resolves, and `bodies()` is `["next"]`. A second case, the control: the same, but the
    outer body catches the nested failure and inserts `after`; the run resolves and `bodies()` is
    `["outer", "after"]` — a full disk the engine backed out alone is a refused statement like any
    other.
  - Top-at-commit `"hands back storage.disk_full when a top-level transaction's commit fills the disk, and issues no rollback"`
    (review round 1, 8a): copy Task 2's `fullAtCommit` stand-in into this file (a dozen lines;
    test files do not import each other here), wrap a raw in-memory `DatabaseSync` holding
    `create table t (who text)`, and build `drizzleNodeSqlite(connectionPair(w, w), { schema: {} })`
    over it, as E16 did. `db.transaction(async () => { db.execute("insert into t values ('x')") })`
    rejects `{ code: "storage.disk_full" }`; the stand-in recorded no `"rollback"` after
    `"commit"`; the real table is empty; the real connection's `isTransaction` is false.
  - M `"reports a full disk while migrating as storage.disk_full"`: a migrations folder written
    into the temp folder by the test, as the probe `a798-plan-probe/vt/mig/` holds it:
    `meta/_journal.json` with one entry (`"breakpoints": true`) and one `.sql` file whose two
    statements — `CREATE TABLE \`filler\` (\`id\` integer PRIMARY KEY, \`pad\` blob);` and
    `INSERT INTO \`filler\` (\`pad\`) VALUES (zeroblob(262144));` — are separated by a
    `--> statement-breakpoint` line. Limit to `page_count + 8`; run drizzle's migrator (`migrate`
    from `drizzle-orm/better-sqlite3/migrator`, as `packages/db/src/migrate.ts:1` imports it) on
    `store.venue`. It throws an error for which `diskFullIn` (Task 1) is `true`, and whose message
    does not contain `cannot rollback`; `sqlite_master` has no `filler` table.

- [ ] **Step 2: Run them**

  Run: `pnpm --filter @waitron/store exec vitest run src/disk-full.test.ts`
  Expected: M FAILS with `diskFullIn` false and the message `Failed to run the query 'ROLLBACK'`
  (E9, measured on today's code; expected unchanged by Tasks 2 and 3a, which leave the bare
  `rollback` alone). The refusal controls, Open's two cases and Top-at-commit PASS: they are
  controls on Task 3a's code, and one that fails is a defect in Task 3a — stop and fix it there,
  test first. Measured on today's code, Top-at-commit rejects with the raw
  `database or disk is full` and a `rollback` after `commit` (E16). For Open, after Task 2 the
  run's own rejection is already mapped, so without Task 3a Open fails on the nested caller's
  error, the raw `database or disk is full`, `code: "ERR_SQLITE_ERROR"` rather than
  `storage.disk_full` (E14, P2).

- [ ] **Step 3: Implement** the bare-`rollback` rule.

- [ ] **Step 4: Run the store's suite and watch it pass**

  Run: `pnpm --filter @waitron/store exec vitest run`, then
  `pnpm --filter @waitron/store test:coverage` (98/98/98/95). Expected: PASS, `Tests` counts shown.

- [ ] **Step 5: Audit the callers that branch on `AppError`.** A full disk used to reach callers
  as a raw engine error; now it arrives as an `AppError`. Run, from the worktree root:

  ```bash
  /usr/bin/grep -rn 'isAppError(\|instanceof AppError' packages apps --include='*.ts' | /usr/bin/grep -v node_modules | /usr/bin/grep -v '\.test\.'
  ```

  At `90e174232` it printed 108 lines: the 64 in the table below, and 44 that name a code on the
  same line (`error.code ===`, `hasCode` or `.has(error.code)`), listed after it. Each was read
  for this plan, not run. Confirm the output matches; a line that is not listed is a STOP: report
  it with what it does on a full disk. This step changes no code: the only site changed is Task
  3c's.

  | Group | What a full disk does there after slice 1 | Sites |
  | --- | --- | --- |
  | A | Names its codes (or a prefix, or a named set); a full disk takes the path every unnamed failure takes, as the raw engine error does today. No change of path (`webhook.ts:130` and `supervisor.ts:370` also log the code, as group B does). | `packages/payments-stripe/src/provider.ts:259`; `packages/fiscal-verifactu/src/allocated-lifecycle.ts:38`; `packages/stream/src/supervisor.ts:370`; `packages/venue-service/src/party-allergy.ts:146` (prefix `allergen.`); `packages/venue-service/src/season-weeks.ts:305` (rethrows an `AppError` with no string `field` param, and `storage.disk_full` has none); `packages/venue-service/src/configuration-transfer.ts:51`; `apps/server/src/restore-command.ts:181`, `:185`, `:376`, `:498`, `:573` (the refusal tables name their codes; `storage.*` matches none, so the operator still reads `restore failed`, `:376-393`); `apps/server/src/recovery-unpack-command.ts:82`; `apps/server/src/location-settings-api.ts:263`; `apps/server/src/restore-stream.ts:192`, `:261`, `:310`; `apps/server/src/invoice-print.ts:47`; `apps/server/src/business-day-start.ts:171`; `apps/server/src/till-api.ts:1407`; `apps/server/src/setup-api.ts:693`, `:855`; `apps/server/src/webhook.ts:130` (a named set; the rest is logged by code and answered 500 — the webhook is not under the error boundary, so it stays 500); `apps/server/src/rejoin-command.ts:98`, `:154` (prefix `rejoin.`); `apps/server/src/department-receipt-draft.ts:101`; `apps/server/src/till-sale.ts:1917`; `apps/server/src/cloud-client.ts:529`; `apps/server/src/content-suggestion-runner.ts:52` (`null` for an unnamed code) |
  | B | Reads the code for a log line, a reply field or a printed detail: it now says `storage.disk_full` where it said `unknown` (or `cloud.failed`). Accepted. | `packages/payments/src/reconcile.ts:539`; `packages/fiscal-verifactu/src/drain.ts:1579`; `packages/fiscal-verifactu/src/aeat-transport.ts:185`; `packages/stream/src/supervisor.ts:206`; `packages/scheduler/src/run.ts:236`; `packages/server-kit/src/error-code.ts:8` (`codeOf`); `apps/server/src/node-entry.ts:178`; `apps/server/src/cloud-api.ts:82` (`replacementError`); `apps/server/src/optional-document.ts:40`, `:41` (the warning's code; the comparison at `:35` is Task 3c's) |
  | C | Passes an `AppError` on and re-codes anything else: where a full disk reaches it, it now passes on as `storage.disk_full`. Accepted (listed under "Behaviour slice 1 removes"). | `packages/provisioning/src/cli.ts:557` (instead of `provisioning.state_unreadable`); `apps/server/src/cloud-installation.ts:346`, `apps/server/src/cloud-translation.ts:176` (instead of `cloud.unavailable`); `apps/server/src/cloud-client.ts:375` (instead of `cloud.unavailable`, only when the signal was aborted); `apps/server/src/payments-api.ts:478` (instead of `reader.unpair_failed`); `apps/server/src/recovery-preparation.ts:110` (instead of its own refusal); `apps/server/src/restore.ts:701` (wrapped as `restore.hook_failed` naming `storage.disk_full`, where the raw error passed on and printed `restore failed`) |
  | D | Not reached: the code inside its `try` runs no statement on the store. | `packages/provisioning/src/first-setup-owner.ts:137` (a JSON file and two `lstat`s, `:116-133`; `setup-operation.ts:87`); `packages/catalogue/src/content-translations.ts:160` (`validateOptionalTranslations`, in memory); `apps/server/src/cloud-client.ts:309`, `apps/server/src/cloud-backup.ts:112` (an HTTP exchange); `apps/server/src/rebuild-first-start.ts:232` (a bucket read) |
  | E | Prints an `AppError`'s code to an operator; anything else is rethrown or printed generically. A full disk now prints `storage.disk_full {}` (or `restore failed: storage.disk_full`). Accepted (listed). | `packages/provisioning/src/cli.ts:652`; `packages/provisioning/src/bin.ts:80`; `packages/credentials/src/cli.ts:192`; `packages/credentials/src/bin.ts:46`; `apps/server/src/restore-command.ts:306` |
  | F | Changed by this slice. | `packages/server-kit/src/error-boundary.ts:32` and `apps/server/src/boot-failure.ts:30` (Task 4 checks `diskFullIn` first); `apps/server/src/department-transfer-api.ts:121` (Task 3c, decision 15) |
  | G | Not product code. | `packages/shared/src/errors.ts:95`, `:96` (the definition); `packages/identity/test/fixtures.ts:98`, `:107`; `packages/credentials/src/testing/captured.ts:9`; `apps/server/src/testing/s3-archive-scenario.ts:257` |

  The 44 that name a code on the line, all group A: `packages/fiscal-verifactu/src/allocation.ts:207`;
  `packages/fiscal-verifactu/src/allocated-lifecycle.ts:53`; `packages/identity/src/credential.ts:96`;
  `packages/stream/src/conditional.ts:5`; `packages/stream/src/probe.ts:179`;
  `packages/stream/src/supervisor.ts:217`; `packages/workforce/src/corrections.ts:193`;
  `packages/provisioning/src/first-setup-owner.ts:310`, `:337`; `packages/media/src/images.ts:152`;
  `apps/server/scripts/daily-close-z-demo.ts:336`; `apps/server/src/break-glass-command.ts:57`,
  `:70`; `apps/server/src/backup-config.ts:247`, `:376`; `apps/server/src/bill-refunds.ts:90`;
  `apps/server/src/archive-download.ts:24`, `:30`; `apps/server/src/restore-request.ts:508`;
  `apps/server/src/backup-api.ts:194`, `:263`; `apps/server/src/rebuild-first-start.ts:171`;
  `apps/server/src/till-attendance-api.ts:287`; `apps/server/src/restore-stream.ts:170`;
  `apps/server/src/archive-recovery-pack.ts:43`; `apps/server/src/receipt-logo.ts:80`;
  `apps/server/src/testing/aws-listing-denial.ts:64`; `apps/server/src/testing/s3-archive-scenario.ts:209`,
  `:250`; `apps/server/src/payments-api.ts:358`, `:411`, `:476`; `apps/server/src/own-password-ahead.ts:51`;
  `apps/server/src/workforce-api.ts:307`; `apps/server/src/bill-payments.ts:1379`;
  `apps/server/src/venue-details.ts:268`; `apps/server/src/stream-api.ts:181`;
  `apps/server/src/archive-settings.ts:168`, `:272`, `:387`; `apps/server/src/management-api.ts:904`;
  `apps/server/src/invoice-email-contact.ts:29`; `apps/server/src/cloud-replacement.ts:334`;
  `apps/server/src/content-suggestion-runner.ts:46`.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/store/src/node-sqlite-adapter.ts packages/store/src/disk-full.test.ts
  git commit -s -m "A full disk while migrating reports itself, not the migrator's failed rollback"
  ```

### Task 3c: Two server callers that compare or classify failures

**Files:**
- Modify: `apps/server/src/department-transfer-api.ts:121-125`
- Modify: `apps/server/src/optional-document.ts:15` (the doc comment)
- Test: `apps/server/src/department-transfer-api.test.ts`; `apps/server/src/receipt-print.test.ts:2775`
  (a changed assertion, in its own commit)

**Interfaces:**
- Consumes: `diskFullIn` (Task 1); Task 3a's fresh error at the nested level (decision 13).
- Produces: the department-transfer stream sends `session-invalid` for an `AppError` only when
  `!diskFullIn(error)`; a full disk takes the non-`AppError` path (`live.stream_failed` logged,
  the stream closed) (decision 15).

- [ ] **Step 1: Write the failing test** in `department-transfer-api.test.ts`, beside the
  `"closes the stream when … removes authorisation"` cases (`:1240-1287`), using the same `ready()`
  fixture and the file's `logged` list (`:75`, filled by the mount at `:256-264`):
  `"closes the stream without session-invalid when checking the session meets a full disk"`. After
  the first read, `vi.spyOn(suite.db, "withWriteLock").mockRejectedValueOnce(new AppError("storage.disk_full", {}))`
  (the stream's next `authenticate()` reaches it through `requireSession`'s `withTransaction`,
  `till-session.ts:99`, and `tenancy.ts:35`; the mount's `db` is `suite.db`, `:256`; if the property
  cannot be replaced, mount a second app whose `db` is a `Proxy` over `suite.db` answering
  `withWriteLock` with a function that rejects once), then publish a `department_transfer_requests`
  change. The next read is `done` with no `session-invalid` text
  before it, and `logged` contains `"live.stream_failed"`. Restore the spy in a `finally`.

- [ ] **Step 2: Run it and watch it fail**

  Run: `env TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/department-transfer-api.test.ts`
  Expected: the new case FAILS on reading
  `event: session-invalid\ndata: {"code":"storage.disk_full"}` (read from `:121-125`, not run); the
  five authorisation cases PASS.

- [ ] **Step 3: Implement** the one-line condition, and rewrite the doc comment at
  `optional-document.ts:15` so it says what now happens:
  `/** Only a body failure whose savepoint was rolled back may be omitted; when the engine ended the transaction the store throws a different error, and that one escapes. */`
  (decision 13; Task 3a's cases N and N-rollback are its receipt).

- [ ] **Step 4: Run it and watch it pass.** The Step 2 command; expected PASS, `Tests` count shown.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/department-transfer-api.ts apps/server/src/department-transfer-api.test.ts apps/server/src/optional-document.ts
  git commit -s -m "A full disk does not tell the till its department-transfer session ended"
  ```

- [ ] **Step 6: The engine-rollback receipt test.** Run:
  `env TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/receipt-print.test.ts -t "propagates an engine rollback"`.
  Expected after Task 3a: it FAILS at `:2775` only, rejecting with the trigger's own message
  `engine transaction invalidated` (the queue hands back the recorded failure, decision 6), while
  `expect(warning.mock.calls).toEqual([])` (`:2776`), the four empty-table assertions and the
  trigger-gone assertion pass. If `:2776` or any assertion other than `:2775` fails, STOP: decision
  13 is not working, and Task 3a needs a fix, test first. Otherwise change `:2775` from
  `.rejects.toThrow(/no transaction is active|no such savepoint/u)` to
  `.rejects.toThrow("engine transaction invalidated")` — behaviour this plan removes (an engine
  rollback reported as "no such savepoint") — and commit it alone:

  ```bash
  git add apps/server/src/receipt-print.test.ts
  git commit -s -m "Changed test checks (A798 slice 1): apps/server/src/receipt-print.test.ts:2775 ..."
  ```

  with the before and after in the message, as the plan's commit rule says.

- [ ] **Step 7: Re-run the other `RAISE(ROLLBACK)` route case.**
  `env TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/till-api.unroutable-dish.test.ts src/receipt-print.test.ts`
  Expected: PASS, `Tests` counts shown, with
  `"refuses a cash payment when writing the alert ends the transaction"` (`:698-712`) unchanged
  (E17). A failure there is a STOP.

### Task 4: Every route answers `storage.disk_full`, and the start classifies it

**Files:**
- Modify: `packages/server-kit/src/error-boundary.ts:22-43`
- Modify: `apps/server/src/boot-failure.ts:29-37`
- Modify: `apps/server/src/recovery-surface.ts` (`OPERATOR_TEXT`, `:234`)
- Test: `packages/server-kit/src/error-boundary.test.ts`, `apps/server/src/boot-failure.test.ts`,
  `apps/server/src/recovery-surface.test.ts` (the guard list at `:405-428`, and a fixed-text case)

**Interfaces:**
- Consumes: `diskFullIn` (Task 1).
- Produces, the boundary: before the `isAppError` branch, when `diskFullIn(cause)`, log
  `("error", "storage.disk_full", { requestId })` and answer
  `{ error: { code: "storage.disk_full", params: {} } }` at `status["storage.disk_full"] ?? 507`.
- Produces, the classifier: `classifyBootFailure` returns `"storage.disk_full"` first when
  `diskFullIn(error)`; every other path unchanged.
- Produces, the page text (`OPERATOR_TEXT["storage.disk_full"]`), exactly:
  - `en-GB`: title `The box's disk is full, so Waitron cannot save anything.`; action
    `Ask whoever installed this box to free some space (old backups, earlier versions of Waitron) or fit a bigger disk. Your sales are not touched.`
  - `es-ES`: title `El disco del equipo está lleno, así que Waitron no puede guardar nada.`; action
    `Pide a quien instaló este equipo que libere espacio (copias antiguas, versiones anteriores de Waitron) o ponga un disco mayor. Tus ventas no se tocan.`
  (design §4.7 item 3, less the sentence slice 2 makes true; decision 12).

- [ ] **Step 1: Write the failing tests.**
  - `error-boundary.test.ts`, `describe("a full disk")`, each through a Hono app as the file's
    existing cases do, with a `collect`ed log:
    - `"answers storage.disk_full at 507 for the domain error"`: `fn` throws
      `new AppError("storage.disk_full", {})`; status `507`, body
      `{ error: { code: "storage.disk_full", params: {} } }`, one log line
      `{ level: "error", event: "storage.disk_full" }` carrying the request id.
    - `"answers the same for the engine's own full-disk error"`: `fn` throws
      `Object.assign(new Error("database or disk is full"), { errcode: 13 })`; same answer.
    - `"answers the same when a wrapper carries it"`: `new Error("Failed to run the query 'x'", { cause: new AppError("storage.disk_full", {}) })`; same answer.
    - `"uses a route's own status for it when the route names one"`: boundary built with
      `{ "storage.disk_full": 503 }`, `fn` throwing the engine's own error
      (`Object.assign(new Error("database or disk is full"), { errcode: 13 })`) — not the domain
      error, which today's `isAppError` branch already answers at the table's status; status `503`.
    - Controls `"leaves every other failure as it was"`: errcode 14 → `500 server.internal`;
      `AppError("test.not_found", { id })` → its own status and warn line.
  - `boot-failure.test.ts`:
    - `"names a database at its page limit as a full disk"`, in the file's
      `"on the engine the box runs"` describe, using `realSqliteError`: open a `DatabaseSync` in the
      temp folder, create a table, set `max_page_count` to `page_count + 2`, insert
      `zeroblob(65536)`. `classifyBootFailure(error)` is `"storage.disk_full"`.
    - `"names a full disk under a wrapper"`: `new Error("Failed to run the query 'ROLLBACK'", { cause: new AppError("storage.disk_full", {}) })` → `"storage.disk_full"`.
    - The file's existing errcode-14 and missing-table cases are the controls; they must still pass.
  - `recovery-surface.test.ts`: add `"storage.disk_full"` to the `classified` list at `:406-410`
    (an addition, not a changed assertion), and a case
    `"names a full disk in both languages"` using `pageFor("storage.disk_full")` (`:208`) that
    checks each of the four fixed strings above appears, written out as literals and each passed
    through `escapeHtml`, as the `"append_only.triggers_changed"` case does (`:450-460`): the page
    escapes its curated strings, so the English title's apostrophe renders as `&#39;` (`:328`).

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server-kit exec vitest run src/error-boundary.test.ts`
  Expected: the engine-error and wrapper cases FAIL with status `500` and code `server.internal`
  (E10); the domain-error case FAILS with `400` (E18: an `AppError` the table omits); the
  route-status case FAILS with `500` (E10); the controls PASS.

  Run: `pnpm --filter @waitron/server exec vitest run src/boot-failure.test.ts src/recovery-surface.test.ts`
  Expected: the classifier cases FAIL with `unknown` (E10); the guard FAILS listing
  `storage.disk_full` as missing; the fixed-text case FAILS on the generic page.

- [ ] **Step 3: Implement** the boundary branch, the classifier line and the `OPERATOR_TEXT` entry.
  Update the boundary's doc comment (`:15-21`) to list the third case.

- [ ] **Step 4: Run them and watch them pass**

  Run the two commands of Step 2. Expected: PASS, with `Tests` counts.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/server-kit/src/error-boundary.ts packages/server-kit/src/error-boundary.test.ts apps/server/src/boot-failure.ts apps/server/src/boot-failure.test.ts apps/server/src/recovery-surface.ts apps/server/src/recovery-surface.test.ts
  git commit -s -m "A full disk answers storage.disk_full on every route and names itself at start"
  ```

### Task 5: A sale on a full database is refused whole, and the box sells again once there is room

**Files:**
- Create: `apps/server/src/till-sale.disk-full.test.ts`

**Interfaces:**
- Consumes: everything above. Test harness from `apps/server/src/testing/bill-venue.ts`
  (`provisionBillVenue`, `inTx`, `send`), `apps/server/src/testing/zone-offers.ts`
  (`offerProducts`), `useVenueDb` with `migrationOptionsFor(manifestSets(), null)`, and the setup
  shape of `apps/server/src/simplified-limit.test.ts:43-101`.

- [ ] **Step 1: Write the tests.** `useVenueDb({ resetPerTest: false, … })`; setup provisions
  the venue, one catalogue, one category and one product at `10.00`, all with English names
  (CLAUDE.md §3: general code is English only; `simplified-limit.test.ts:50-57` uses Spanish ones,
  "Banquetes", "Eventos", "Lote" — do not copy those), and a counter zone offering the product.
  Helpers:
  - `fillDatabase()`: creates `ballast (id integer primary key, pad blob)` if absent, sets
    `pragma max_page_count = page_count + 2` through `venue.db.all(sql.raw(...))`, then inserts
    `zeroblob(16)` rows, the same way, until one throws, and asserts `diskFullIn(error)` (Task 1)
    for that throw, so a fixture that stops filling fails loudly, not silently. Not errcode 13:
    after Task 3a the adapter has already turned it into `storage.disk_full`, which carries no
    `errcode`, and `venue.db.all` does not wrap
    (`drizzle-orm/sqlite-core/session.js:163-165`, drizzle-orm 0.45.4).
  - `liftLimit()`: `pragma max_page_count = 4294967294`, called in a `finally` in every case.
  - `cashSale(lines)`: `POST /api/sales` with `lines` copies of the product, quantity `1`, cash
    tender of `10.00 × lines`.
  - `counts()`: rows in `sales`, `registros_facturacion`, `envios` and `working_orders` (E12 measured
    all four unchanged after a refused sale and a refused park).
  Cases:
  - `"refuses a cash sale on a full database with storage.disk_full and writes neither the sale nor its record"`:
    `fillDatabase()`; `cashSale(20)` answers `{ status: 507, json: { code: "storage.disk_full", params: {} } }`;
    `counts()` unchanged. A comment cites the plan's E12: a one-line sale fitted into pages already
    allocated, a 20-line one did not.
  - `"sells again once the limit is lifted"` (the control that the refusal was the disk): after the
    case above, `liftLimit()`; `cashSale(20)` answers `200`; `sales`, `registros_facturacion` and
    `envios` each rose by one.
  - `"refuses parking a counter order on a full database"`: `fillDatabase()`; a
    `POST /api/working-orders` with 20 lines (the body shape of `simplified-limit.test.ts:196-205`)
    answers `507 storage.disk_full`, and `working_orders` is unchanged.

- [ ] **Step 2: Watch them fail by deletion** (decision 19). On `main` the file loads, but
  `diskFullIn` is undefined there, so every case fails inside `fillDatabase` with
  `diskFullIn is not a function` — for the wrong reason. E12 is the run on `main`, which answered
  `{ status: 500, json: { code: "server.internal" } }`.

  Run: `env TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/till-sale.disk-full.test.ts`
  first with Tasks 1 to 4 in, 3a to 3c included (expected: PASS, `Tests 3 passed`), then with the `diskFullIn` branch
  Task 4 added to `packages/server-kit/src/error-boundary.ts` deleted. Expected then: the two
  refusal cases FAIL with a status other than `507` (`400` if the domain error reaches the boundary
  unwrapped and the route's table omits it, as E18 measured; `500` if a drizzle wrapper carries
  it), and their unchanged-counts
  assertions hold; the "sells again" case passes. Restore the file with
  `git checkout -- packages/server-kit/src/error-boundary.ts` (Task 4 is committed) and record both
  runs in the commit message.

- [ ] **Step 3: No production change is expected.** If a case fails after Tasks 1–4, that is a
  defect in them: stop, find which layer answers what (add debug logging to the boundary's
  branch), and fix it in the task it belongs to with a test there first.

- [ ] **Step 4: Run it and watch it pass**

  Run the Step 2 command once more, with the boundary restored. Expected: PASS, `Tests 3 passed`.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/till-sale.disk-full.test.ts
  git commit -s -m "Prove a sale on a full database is refused whole, with storage.disk_full"
  ```

### Task 6: The refusal rule in CLAUDE.md, its receipt, and the backlog

**Files:**
- Modify: `CLAUDE.md:493-495` (§3, the refusal rule)
- Modify: `docs/developers/conventions-data.md:2182-2223` (the receipt section)
- Modify: `docs/backlog.md` — the A798-B entry (`:5260-5272`), its line in the summary (`:117-121`),
  and the finished entry at `:5088-5091`

- [ ] **Step 1: Replace the CLAUDE.md rule** (rule plus pointer, CLAUDE.md §7) with:

  > - **A statement this engine refuses backs out ITSELF, not the transaction around it — except a
  >   full disk, which sometimes ends the whole transaction** (as `RAISE(ROLLBACK)`, `INSERT OR
  >   ROLLBACK` and `ON CONFLICT ROLLBACK` always do; nothing here uses them). Measured at a page
  >   limit: an insert into a table with no insert trigger ended it; a multi-row update, an index
  >   build, or an insert into a table with an insert trigger (one shaped like the change feed's
  >   included) backed out only the statement. So catching a refusal and carrying on in the same
  >   `tx` is safe. Either way the caller gets `storage.disk_full`, and after one that ended the
  >   transaction the store refuses every later statement in that body. **A TEST still catches such
  >   a refusal OUTSIDE the transaction**, around the whole `withTransaction`, and no guard enforces
  >   that. Guard: `packages/store/src/disk-full.test.ts` and `write-queue.test.ts`, weaker than
  >   their names — a page limit, not a real disk, and both at-commit cases are a stand-in. Receipt:
  >   [conventions-data.md](docs/developers/conventions-data.md#a-full-disk-sometimes-ends-the-whole-transaction).

- [ ] **Step 2: Add the receipt** as a `### A full disk sometimes ends the whole transaction`
  subsection at the end of the section at `conventions-data.md:2182`, before
  `## A refusal under result code 1811`. It carries, dated 2026-10-21, Node v26.11.1, macOS, with
  each probe's command shape and what its failing case would have printed: E1, E2, E3 and E3b (in
  every shape tried a page limit was met at a statement, never at commit), E13 (which full disks
  ended the transaction and which backed out only the statement), E5, E7 (a real full disk at
  commit, HFS+ image), E8, E9 and E14 (what the store did before this slice), and what the store
  does now with a pointer to `packages/store/src/disk-full.test.ts`. Weaker than the rule, said
  there: nothing was measured on Linux's filesystems; the commit point is tested on a stand-in; the
  change-feed shape was a copy of its trigger, not the feed itself.

- [ ] **Step 3: Check the pointers**

  Run, from the worktree root: `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (the root
  project, as the root `test` script runs it).
  Expected: PASS, with a `Tests` count — the two files the new line names exist.

- [ ] **Step 4: Update the backlog** (CLAUDE.md §6, in this same pull request):
  - Delete the entry "CLAUDE.md §3's rule 'a statement this engine refuses backs out ITSELF' does
    not hold for a full disk" (`:5088-5091`): this slice finishes it.
  - In A798-B (`:5260-5272`), replace "The build is to be planned as its own item" with the plan's
    link (`superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md`) and "Slice 1 of 10 (a
    full disk reported as `storage.disk_full`; nothing written after one that ended the transaction
    can commit) is built on
    `feat/a798-1-full-disk-store`", and name the open asesor questions Q51 and Q52. The landing
    session puts the pull request's number in after the merge, as `main`'s "docs: backlog after
    #NNNN" commits do.
  - In the summary line at `:117-121`, "(A798-B, the build: … every owner question answered)"
    gains "; slice 1 of 10 built".

- [ ] **Step 5: Commit**

  ```bash
  git add CLAUDE.md docs/developers/conventions-data.md docs/backlog.md
  git commit -s -m "CLAUDE.md: a full disk is the refusal rule's exception, with its receipt"
  ```

  CLAUDE.md is format-checked: let the pre-push hook run `prettier` on it once, at push.
