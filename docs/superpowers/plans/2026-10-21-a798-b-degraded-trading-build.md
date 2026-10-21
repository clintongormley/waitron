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
> Every `file:line` below was read at `main` `4e14618aa` on 2026-10-21. Every claim about how the
> engine or the store behaves cites a probe in "Measured for this plan", run that day on macOS,
> Node v26.11.1, `node:sqlite`, from scratch files under `~/waitron-campaign-b/a798-plan-probe/`
> (outside the repository). Nothing was measured on Linux.

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
| 3 | `feat/a798-3-refuse-before-reader` | The till names the red refusals; both checks before the reader refuse | fiscal invariants (settle handlers), cross-package contract | FULL | no | **lands itself** | 1 |
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
3. **Lands itself, conditionally.** It refuses earlier — before a card is charged — sales that are
   refused anyway today (a full disk, a clock before 28-10-2024), and words them. No invoice that
   is issued today stops being issued, and none changes. **If slice 3's plan puts its check inside
   series selection or invoice numbering** (`invoice-selection.ts` sits beside both), it parks.
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
not depend on it: 10 can land while 8 and 9 wait for the owner.

**Two asesor questions** were added with this plan, as design §10 asks:
[Q51](../../compliance/asesor-questions.md#q51-a-chain-whose-record-times-step-back-once-under-a-managers-restart-added-2026-10-21)
(a chain whose record times step back once under a manager's restart) and
[Q52](../../compliance/asesor-questions.md#q52-sales-recorded-under-a-restart-whose-clock-later-proved-wrong-added-2026-10-21)
(sales recorded under a restart whose clock later proved wrong). Slices 8 and 9 build the
behaviour they ask about.

---

## Part 2 — Slice 1: the store reports a full disk as itself

### Measured for this plan

Each probe says what its failing case would have printed. Scripts: `engine.mjs`,
`disk-commit.mjs`, `vt/queue.test.ts`, `vt/migrate.test.ts`, `vt/boundary.test.ts`,
`vt/standin.test.ts`, `srv/sale.test.ts`, all under `~/waitron-campaign-b/a798-plan-probe/`. The
Vitest ones ran with `env -u AI_AGENT -u CLAUDECODE node_modules/.bin/vitest run --root <probe dir>`
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
  printed `ok` and the commit `errcode 13`. **So a page limit cannot reach the commit point.**
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
  engine behaviour at commit, which a CI runner cannot produce (E3: a page limit cannot).
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

### Decisions this plan makes that the spec does not

The owner confirms or overrides these when reviewing the plan. Each has the DEFAULT to build.

1. **The test "at commit" uses a stand-in, not a page limit.** The design asks for tests "on a
   database at its page limit … at both failure points (inside the body and at commit)" (§8 slice
   1). That cannot be done: a page limit is always met at the statement (E3). DEFAULT: the
   inside-the-body and nested cases run on a real database at its page limit; the at-commit case
   runs on the E11 stand-in, whose behaviour E7 and K measured on a real full disk. The real-disk
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
   says "rethrow the original error"; this pins which one.
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

### Behaviour slice 1 removes

Tests pinning these may change, under the commit rule above. A search found none pinning them
(read: grep of `packages/store/src` and `apps/server/src` tests for `cannot rollback`,
`no such savepoint` and errcode 13); if one turns up, it is this list's.

- A full disk reported as "cannot rollback - no transaction is active", "no such savepoint: …" or
  "Failed to run the query 'ROLLBACK'" (E8, E9).
- Statements after a full disk in the same body committing by themselves (E8 Q2, N2).
- A full disk answering `500 server.internal`, and classifying `unknown` or
  `migrations.apply_failed` at start (E9, E10).

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
  ended on its own is not one this client still believes in") and `write-queue.ts:4-13`.
- Run focused tests as each task says; CI runs the package suites.

### Review focus

The five conditions most likely to bite that no single happy path exercises, each with its test in
the task named.

1. **Code that catches the full disk and carries on**, in a body or a nested transaction, at any
   depth. Expected: every later statement refused, nothing kept, the caller told
   `storage.disk_full` (Task 3, cases Q2 and N2; Task 2 for a body that catches and returns).
2. **A refusal is not a full disk.** A unique key, NOT NULL, CHECK, an immediate foreign key,
   `RAISE(ABORT)`, `RAISE(FAIL)` and a missing table, each caught inside a nested transaction,
   must still leave the transaction usable and commit the rows around it (Task 3, the controls).
3. **The disk fills at commit.** Expected: `storage.disk_full`, no rollback issued by the queue, and
   the next transaction served (Task 2, on the stand-in). The control: a commit the engine refuses
   and leaves open (a deferred foreign key) is still rolled back (Task 2).
4. **Other callers around the failure.** A caller queued behind the failed body is served; a read
   from outside the failed body, while it is still running, gets committed rows and is not refused
   (Tasks 2 and 3).
5. **A full disk while migrating at start** reads as `storage.disk_full`, not as a failed
   migration (Task 3, case M; Task 4, the classifier).

---

### Task 1: The code `storage.disk_full` and a recogniser for it

**Files:**
- Modify: `packages/shared/src/errors.ts` (the `ErrorParams` interface, `:27-58`)
- Modify: `packages/shared/src/engine-failure.ts`
- Modify: `packages/shared/src/index.ts:139` (export beside `sqliteFailureOf`)
- Test: `packages/shared/src/engine-failure.test.ts`

**Interfaces:**
- Produces: `ErrorParams["storage.disk_full"]: Record<string, never>`, with a one-line doc comment:
  the box's disk is full, and the transaction it happened in kept nothing.
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
    statements nothing records the failure (decision 8); through drizzle Task 3's case Q2b gets
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
  connections cases FAIL because `noteEnded`, `endedBy`, `clearEnded` and `insideBody` do not
  exist. The deferred-key control PASSES before and after — it is the control.

- [ ] **Step 3: Implement** `disk-full.ts`, the four `Connections` members, and the queue's `run`
  as the Interfaces block orders it. Rewrite the queue's doc comment so it says the queue issues
  no rollback for a transaction the engine already ended, and why (E1, E7: the engine rolls the
  whole transaction back itself).

- [ ] **Step 4: Run them and watch them pass**

  Run: `pnpm --filter @waitron/store exec vitest run src/write-queue.test.ts src/connections.test.ts`
  Expected: PASS, with a `Tests` count covering the new cases. Then
  `pnpm --filter @waitron/store typecheck` exits 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/store/src/disk-full.ts packages/store/src/connections.ts packages/store/src/write-queue.ts packages/store/src/write-queue.test.ts packages/store/src/connections.test.ts
  git commit -s -m "The write queue no longer hides a full disk behind its own failed rollback"
  ```

### Task 3: The adapter refuses every statement after the engine ended the transaction

**Files:**
- Modify: `packages/store/src/node-sqlite-adapter.ts` — `prepare`'s `onWriter` and `issue`
  (`:68-84`), `transaction`'s `inMode`, `keep` and `undo` (`:126-174`), and the doc comment
  `:103-125`
- Create: `packages/store/src/disk-full.test.ts`

**Interfaces:**
- Consumes: `asDiskFull` (Task 2), `noteEnded`/`endedBy`/`clearEnded`/`insideBody` (Task 2).
- Produces, the adapter's behaviour:
  - **A statement on the writer** (`onWriter`): if `endedBy()` is set and `insideBody()` is true,
    throw `endedBy().error` without running it. If the statement text is a bare rollback
    (`/^\s*rollback\s*;?\s*$/i` on `prepare`'s `query`), the writer has no transaction open,
    `endedBy()` is set and `insideBody()` is false, throw `endedBy().error` and `clearEnded()`
    (decision 7). Otherwise run it; if it throws, map with `asDiskFull`, and if a transaction was
    open before it ran and is not open after, `noteEnded` the mapped error; throw the mapped error.
  - **A statement on the reader** that throws errcode 13: thrown mapped by `asDiskFull`; a
    read-only refusal still goes back to the writer as today (`:78-83`).
  - **`transaction()`**: on entry, if `endedBy()` is set and `insideBody()` is true, throw
    `endedBy().error` and open nothing (decision 2). An outermost transaction (no savepoint)
    calls `clearEnded()` after its `begin` and again when it finishes either way.
    `undo` does nothing when the writer has no transaction open. `keep`'s failure is mapped by
    `asDiskFull`, `noteEnded` when the transaction is gone, and otherwise undone as today. Both
    the synchronous and the asynchronous failure paths throw `endedBy()?.error ?? <the body's
    error>` (decision 6).

- [ ] **Step 1: Write the failing tests** in the new `disk-full.test.ts`. A helper opens a store on a
  temp folder (as `index.test.ts:29-38`, closed in `afterEach`), creates
  `sale (id integer primary key, body text unique, pad blob)`, and `limit(db, 4)` sets
  `pragma max_page_count = page_count + 4` through `db.execute` (E6: per connection; with no body
  running the statement goes to the writer). `fill` is
  `db.execute("insert into sale (body, pad) values ('fill', zeroblob(65536))")`. Every body runs in
  `store.venue.withWriteLock(...)`, as `withTransaction` does (`packages/db/src/tenancy.ts:35`).
  Each case asserts `bodies()` — the `body` column in id order — after the run:
  - Q2 `"refuses the statements a body runs after catching a full disk, and keeps nothing"`: inserts
    `part 1`, catches `fill`, inserts `part 2`. The run rejects `{ code: "storage.disk_full" }`;
    the `part 2` insert itself threw `{ code: "storage.disk_full" }` (record it inside the body);
    `bodies()` is `[]`.
  - Q2b `"hands back storage.disk_full for a body that caught the full disk and returned"`: catches
    `fill`, returns. Rejects `{ code: "storage.disk_full" }`.
  - N `"tells both the nested and the outer caller storage.disk_full"`: inserts `outer`, then
    `await db.transaction(async () => { insert inner; fill })` inside a try that records the error
    and rethrows. The nested caller's error and the run's rejection are both
    `{ code: "storage.disk_full" }`; `bodies()` is `[]`.
  - N2 `"refuses a nested transaction opened after a swallowed full disk"`: swallows the nested
    failure, then inserts `after nested` (record its error), then opens another nested transaction
    inserting `second nested` (record its error). Both recorded errors are
    `{ code: "storage.disk_full" }`; the run rejects the same; `bodies()` is `[]`.
  - Top `"hands back storage.disk_full from a top-level transaction opened without the queue"`:
    `await expect(db.transaction(async () => { insert x; fill })).rejects.toMatchObject({ code: "storage.disk_full" })`;
    `bodies()` is `[]`; a following `db.transaction` inserting `y` resolves and keeps it.
  - Next `"serves the next transaction after a full disk"`: after Q2's shape fails, a
    `withWriteLock` body inserting `next` resolves; `bodies()` is `["next"]`.
  - Reader `"answers a read from outside a body that filled the disk, while that body still runs"`:
    a first `withWriteLock` body inserts and commits `seen`; a second body fills, catches it, then
    awaits a promise the test releases; meanwhile a read started outside any body
    (`db.execute("select body from sale")` from the test's own context) resolves with
    `[{ body: "seen" }]` and is not refused. Then release; the second run rejects
    `{ code: "storage.disk_full" }`.
  - Refusal controls `"leaves the transaction usable after each refusal the product can meet"`,
    one `it.each` row per refusal from design §12 experiment 5: duplicate `body` (unique), a null
    into a `not null` column, a failing `check`, an immediate foreign key, `RAISE(ABORT)`,
    `RAISE(FAIL)`, and a missing table. Each row's body inserts `before`, runs the refused statement
    inside a nested `db.transaction(...)` and catches it, then inserts `after`. The run resolves
    and `bodies()` is `["before", "after"]`. Create the extra tables and triggers the rows need in
    the case's own setup.
  - Raise-rollback `"ends the transaction on RAISE(ROLLBACK), hands back the trigger's own refusal, and keeps nothing"`:
    a `before insert` trigger with `raise(rollback, 'refused x')`; the body inserts `before`,
    catches the `x` insert, inserts `after` (record its error). The recorded error and the run's
    rejection both carry the message `refused x`, and neither is `storage.disk_full`; `bodies()`
    is `[]`. Nothing in the product uses this form (design §2.6, read); the case pins that the
    refusal mechanism is the engine's state, not the error code.
  - M `"reports a full disk while migrating as storage.disk_full"`: a migrations folder written
    into the temp folder by the test (a `meta/_journal.json` with one entry and one `.sql` file
    creating `filler` and inserting `zeroblob(262144)`, as the probe `vt/mig/` did); limit to
    `page_count + 8`; run drizzle's migrator (`migrate` from `drizzle-orm/better-sqlite3/migrator`,
    as `packages/db/src/migrate.ts:1` imports it) on `store.venue`. It throws an error for which
    `diskFullIn` (Task 1) is `true`, and whose message does not contain `cannot rollback`;
    `sqlite_master` has no `filler` table.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/store exec vitest run src/disk-full.test.ts`
  Expected FAILS, each as measured, on top of Task 2: Q2 with `bodies()` `["part 2"]` (E8 Q2) and
  the run rejecting with the queue's "ended this transaction" error, because the body caught the
  only error that named the disk; Q2b with that same queue error instead of `storage.disk_full`;
  N with the nested caller's error `no such savepoint: wt_sp_1` (E8 N); N2 with `bodies()`
  `["after nested", "second nested"]` (E8 N2); Top with `cannot rollback - no transaction is
  active`; Raise-rollback with `bodies()` `["after"]` (E1's shape); M with `diskFullIn` false and
  the message `Failed to run the query 'ROLLBACK'` (E9). Next and Reader may already pass after
  Task 2: they guard against a regression in this task. The refusal controls PASS before and
  after.

- [ ] **Step 3: Implement** the adapter behaviour in the Interfaces block, and rewrite the doc
  comment at `:103-125` so it says what happens when the engine ends a transaction itself (E1, E2,
  E7) and why a later statement in that body is refused (E8 Q2, N2).

- [ ] **Step 4: Run the store's suite and watch it pass**

  Run: `pnpm --filter @waitron/store exec vitest run`
  Expected: PASS, every file, `Tests` count shown; the existing adapter cases at
  `node-sqlite-adapter.test.ts:328-367` (a refused commit, a deferred key) still pass unchanged.
  Then `pnpm --filter @waitron/store test:coverage` holds 98/98/98/95.

- [ ] **Step 5: Audit the callers that branch on `AppError`.** A full disk used to reach callers
  as a raw engine error; now it arrives as an `AppError`. Run
  `/usr/bin/grep -rn 'isAppError(' packages apps --include='*.ts' | /usr/bin/grep -v '\.test\.' | /usr/bin/grep -v 'error.code ===\|hasCode\|\.has(error.code)'`
  and confirm each line either names its codes, rethrows, or only reads the code for a log. At
  `4e14618aa` this plan's reading found no site that treats an arbitrary `AppError` as a refusal
  that changed nothing (read, not run): `restore.ts:701` wraps it, `rebuild-first-start.ts:232`,
  `payments-api.ts:478` and `recovery-preparation.ts:110` rethrow it, `drain.ts:1579`,
  `scheduler/src/run.ts:236`, `stream/src/supervisor.ts:206` and `reconcile.ts:539` log its code,
  and `bill-payments.ts:1379` checks a named set. A site that does treat it so is a STOP: report
  it.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/store/src/node-sqlite-adapter.ts packages/store/src/disk-full.test.ts
  git commit -s -m "Nothing written after a full disk can commit, at any depth of a transaction"
  ```

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
      `{ "storage.disk_full": 503 }`; status `503`.
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
    checks each of the four fixed strings above appears, the way the
    `"restore.membership_invalid"` case below it does.

- [ ] **Step 2: Run them and watch them fail**

  Run: `pnpm --filter @waitron/server-kit exec vitest run src/error-boundary.test.ts`
  Expected: the three answer cases FAIL with status `500` and code `server.internal` (E10 printed
  that), the domain-error case with `400` (an `AppError` the table omits); the controls PASS.

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

- [ ] **Step 1: Write the failing tests.** `useVenueDb({ resetPerTest: false, … })`; setup provisions
  the venue, one catalogue product at `10.00` and a counter zone offering it. Helpers:
  - `fillDatabase()`: creates `ballast (id integer primary key, pad blob)` if absent, sets
    `pragma max_page_count = page_count + 2` through `venue.db.all(sql.raw(...))`, then inserts
    `zeroblob(16)` rows until one throws, and asserts that throw was errcode 13 (so a fixture that
    stops filling fails loudly, not silently).
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

- [ ] **Step 2: Run them and watch them fail**

  Run: `env TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server exec vitest run src/till-sale.disk-full.test.ts`
  Expected on `main` (if the implementer runs it before Tasks 1–4 are in): the refusal cases FAIL
  with `{ status: 500, json: { code: "server.internal" } }` — E12 printed exactly that — while the
  unchanged-counts assertions would hold. After Tasks 1–4 they PASS; this task's test is the
  end-to-end receipt, so record both runs in the commit message.

- [ ] **Step 3: No production change is expected.** If a case fails after Tasks 1–4, that is a
  defect in them: stop, find which layer answers what (add debug logging to the boundary's
  branch), and fix it in the task it belongs to with a test there first.

- [ ] **Step 4: Run it and watch it pass**

  Run the Step 2 command. Expected: PASS, `Tests 3 passed`.

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
  >   full disk, which ends the whole transaction** (as `RAISE(ROLLBACK)`, `INSERT OR ROLLBACK` and
  >   `ON CONFLICT ROLLBACK` do; nothing here uses them). So catching a refusal and carrying on in
  >   the same `tx` is safe; after a full disk the store refuses every later statement in that body
  >   and the caller gets `storage.disk_full`. **A TEST still catches such a refusal OUTSIDE the
  >   transaction**, around the whole `withTransaction`, and no guard enforces that. Guard:
  >   `packages/store/src/disk-full.test.ts`, weaker than its name — a page limit, not a real disk,
  >   and the at-commit case (`write-queue.test.ts`) is a stand-in. Receipt:
  >   [conventions-data.md](docs/developers/conventions-data.md#except-a-full-disk-which-ends-the-whole-transaction).

- [ ] **Step 2: Add the receipt** as a `### Except a full disk, which ends the whole transaction`
  subsection at the end of the section at `conventions-data.md:2182`, before
  `## A refusal under result code 1811`. It carries, dated 2026-10-21, Node v26.11.1, macOS, with
  each probe's command shape and what its failing case would have printed: E1, E2, E3 (a page limit
  is met at the statement, never at commit), E5, E7 (a real full disk at commit, HFS+ image), E8 and
  E9 (what the store did before this slice), and what the store does now with a pointer to
  `packages/store/src/disk-full.test.ts`. Weaker than the rule, said there: nothing was measured on
  Linux's filesystems; the commit point is tested on a stand-in.

- [ ] **Step 3: Check the pointers**

  Run, from the worktree root: `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (the root
  project, as the root `test` script runs it).
  Expected: PASS, with a `Tests` count — the two files the new line names exist.

- [ ] **Step 4: Update the backlog** (CLAUDE.md §6, in this same pull request):
  - Delete the entry "CLAUDE.md §3's rule 'a statement this engine refuses backs out ITSELF' does
    not hold for a full disk" (`:5088-5091`): this slice finishes it.
  - In A798-B (`:5260-5272`), replace "The build is to be planned as its own item" with the plan's
    link (`superpowers/plans/2026-10-21-a798-b-degraded-trading-build.md`) and "Slice 1 of 10 (a
    full disk reported as `storage.disk_full`; nothing written after it can commit) is built on
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
