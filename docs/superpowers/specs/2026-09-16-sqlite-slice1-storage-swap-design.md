# Slice 1 of the SQLite switch: the storage swap — design

**Status:** design approved by the owner 2026-09-16; plan not yet written.

> **Dated pointer, 2026-09-21.** Task P10 has been built, and two things this document says are no
> longer true of the code.
>
> **The two helpers it names no longer exist.** `pgErrorConstraint` and `uniqueViolationConstraint`
> were deleted from `packages/db/src/unique-violation.ts`, which keeps only `isPgError` and
> `isUniqueViolation` — the two that answer which CLASS of refusal this is. A write path that has to
> identify ONE refusal now asks `refusalOn(error, sqlstate, { table, columns })`, or
> `constraintTarget(error)` with `sameTarget`, from `packages/db/src/constraint-target.ts`; the
> SQLSTATE literals it is given live in `packages/db/src/sqlstate.ts`. §6.4 below still names
> `uniqueViolationConstraint` as the helper to change, and the P10 row in §9's table still lists the
> work as ahead.
>
> **The Provenance row "92 error-helper call sites in 23 non-test files" is wrong, and so is the
> command that produced it.** A grep for those four helpers cannot see a caller that walks the cause
> chain itself, and FIVE did: `packages/reporting/src/record-daily-close.ts`,
> `apps/server/src/tables.ts`, `packages/core/src/settle-sale.ts`,
> `packages/fiscal-verifactu/src/chain.ts` and `packages/workforce/src/chain.ts`. The last two were
> already on the task's Files list for another reason, which is why an earlier version of this
> pointer counted three. Two greps are needed, not one.
> `grep -rn "constraint?: unknown" --include='*.ts' packages apps` finds a hand-rolled walk that goes
> on to read the constraint NAME, which is two of the five; the other three read a SQLSTATE and stop,
> so only `grep -rn 'cause?: unknown' --include='*.ts' packages apps` reaches them — at the
> cost of also returning walks that translate no refusal at all, so its output is read rather than
> counted. Treat the row's number as unverified rather than as a size.
>
> **What SQLite reports is unchanged**, and so is the reasoning in §6.4 that the question had to
> change. What the task built, the callers it moved, and the measurements taken on both of today's
> drivers are in task P10 of
> [2026-09-16-sqlite-slice1-storage-swap.md](../plans/2026-09-16-sqlite-slice1-storage-swap.md).
> Everything below is left as it was written.

> **Dated pointer, 2026-09-21.** Tasks P4a and P4b have been built, and §6.2's sentence "Each
> becomes a claim by update under the write queue" held for one of the four places it lists.
>
> **What each caller actually became.** The printing runtime
> (`packages/printing/src/runtime.ts`) is the one that became a claim by update: it asks `claimRows`,
> which stamps the batch it locked in a single statement. Payment forwarding
> (`packages/payments/src/store.ts`) became a claim by LOCKING that stamps nothing — a payment's own
> state is the queue, so there is no claim column to stamp, and putting it through `claimRows` would
> have meant a no-op UPDATE writing a new version of every row a forward pass merely looked at. The
> fiscal drain (`packages/fiscal-verifactu/src/drain.ts`) became a claim by locking as well, and a
> narrowed one that locks the `envios` rows alone: it stamps only the part of its window whose
> `entorno` agrees with the host's, so stamping the whole window would stamp rows it is about to
> refuse, and `app_user` is granted `select, insert` alone on `registros_facturacion`, which refuses
> an unnarrowed lock over the drain's join. The read-only gate
> (`apps/server/src/read-only-gate.ts`), the fourth place §6.2 names, turned out to carry no SQL at
> all — only a comment describing a claim — so nothing there changed.
>
> All of it lives in `packages/db/src/job-claim.ts`, which is still the one file task F1 edits; what
> F1 is left to strip from each function differs, and that is written up in step 16 of
> [2026-09-16-sqlite-slice1-storage-swap.md](../plans/2026-09-16-sqlite-slice1-storage-swap.md).
> §6.2 below is left as it was written.

This is slice 1 of the build order in
[2026-09-16-sqlite-litestream-topology-design.md](2026-09-16-sqlite-litestream-topology-design.md)
§11. That document decides *what* Waitron's storage and failover become; this one decides *how the
first slice reaches `main`*, and settles the questions the topology design left to the plan.

Slice 1's job, in one sentence: **a standalone venue runs end to end on SQLite** — take an order,
sell it, file it to the fiscal chain, print it, report on it, close the day — with no streaming, no
object store, and no second node. Replication arrives in slices 2–5.

---

## 0. Decisions taken with the owner (2026-09-16)

1. **Many pull requests, not one long branch.** The owner first chose a single branch, then changed
   to separate pull requests so the unattended campaign runner can drive the work
   (`~/waitron-campaign/`, memory `autonomous-away-campaigns`). §2 is the decomposition that makes
   that possible.
2. **A synchronous driver with a write queue**, not a rewrite of the write paths into synchronous
   code, and not libsql. `withTransaction` keeps its signature; only its body changes (§4).
3. **Delete what is PostgreSQL-shaped, rebuild it in slices 3–4.** `packages/sync` and the routes that
   depend on publications, subscriptions and write-position fences go. Everything engine-agnostic
   stays: membership documents, trust sets, enrolment, rate limiting, node retirement. **From slice 1
   landing until slice 3, `main` has one node and no failover at all** (§8).
4. **Convert the PostgreSQL-only tests where they still mean something, delete the rest, and list
   both.** No test is deleted without its reason appearing in the plan (§7.3).
5. **Append-only tables keep an abort trigger; the rest of what grants enforce becomes a guard that
   reads the source.** Not a trigger per grant, and not a convention with nothing checking it (§6.3).
6. **Slice 1 does not wait for the gate-2 prototype** (2026-09-16). The prototype is not dropped — it
   moves to immediately before slice 2, where all five of the risks it checks actually live. The
   reasoning and the risk-to-slice mapping are in the topology design's §12.2. Slice 1 therefore starts
   now, and what it commits the repository to is SQLite as its engine, not Litestream, generations,
   seats or the object store as the hub.
7. **Archiving moves into the flip**, not into slice 2 as the topology design had it. The pull request
   that deletes the `pg_dump` path is the one that must supply its replacement, or `main` lands with
   no way to take a copy of a venue at all (§6.5).

---

## 1. What slice 1 is, and is not

**Delivers:** every venue-facing thing the product does today, on SQLite, on one node.

**Does not deliver, stated so nobody assumes otherwise:** Litestream, the object store, generations,
`current.json`, seats, promotion, return, the tail shipper, the mirror box. None of it. A venue that
lands on slice 1 has exactly one copy of its data plus whatever archive the operator takes.

**The failover gap is real and is accepted because Waitron is pre-production.** Today `main` carries a
working two-box failover on PostgreSQL logical replication. Slice 1 deletes it. Nothing replaces it
until slice 3. The backlog's "MVP for go-live" still requires two boxes plus cloud failover, and that
requirement is met by slices 3–5, not by slice 1.

---

## 2. Three phases, and why the middle one cannot be split

The obstacle is simple: every package shares one database connection and one Drizzle dialect. A table
defined with Drizzle's PostgreSQL builder and a table defined with its SQLite builder cannot live in
one schema, so there is no package-by-package migration and no half-flipped state. Something must
change everything at once.

What can be arranged is **how much** that something has to change. Three phases:

- **Prepare.** Land everything that is true on both engines, on today's PostgreSQL, each piece green
  and useful on its own.
- **The flip.** One pull request, carrying only what genuinely cannot land separately.
- **Tidy.** Delete what the flip left inert. Each of these is green on SQLite and lands on its own.

The prepare phase is what makes the flip tractable, and two items carry most of that weight.

**The column vocabulary.** Measured on 2026-09-16 by grep over the 72 non-test files that define
tables: **106 tables, 35 enum types and 795 column definitions** (258 `uuid`, 196 `text`, 126
`timestamp`, 86 `integer`, 50 `jsonb`, 32 `boolean`, 30 `numeric`). If those 795 definitions first
move to shared helpers — `id()`, `ts()`, `json()`, `money()` and so on — that emit exactly today's
PostgreSQL types and change nothing observable, then the flip swaps a handful of helper bodies instead
of rewriting 795 lines spread across 72 files.

**The test-database helper.** 211 files choose their database through `usePgliteDb`, `useRealPostgres`
or `describeEachTarget`. Collapse those behind one neutral helper first and the flip changes one
function body rather than 211 files.

> 2026-09-19: the number 211 is this document's original reading and was never reproduced. The plan
> re-measured it with the commands beside it (task P2, "The count in this paragraph used to read
> '211 files'"), and the current pair, with what it excludes and why, is in
> `docs/developers/testing-guide.md` under "A PGlite suite asks for its database through one helper, and a guard enforces it". The
> argument above does not turn on the number.
>
> 2026-09-20: that collapsing is DONE for the first of the three. Every suite that chose its database
> through `usePgliteDb` now chooses through `useVenueDb`, and asking that way is a house rule
> (`CLAUDE.md` §4) enforced by `scripts/venue-db-helper.test.ts`. `useRealPostgres` and
> `describeEachTarget` are untouched. The paragraph above puts all three in the prepare phase;
> what actually happened is that only the first was collapsed there. The plan's task P2 says
> "Leave `useRealPostgres`, `useTemplateDb` and `describeEachTarget` alone" (`:2582`), which is a
> statement about P2's scope; only `describeEachTarget` is actually routed onward, to task F1
> step 24 (`:2586`). Where `useRealPostgres` ends up is not settled by either.

Both are mechanical, reviewable, and independently valuable: they put the engine's vocabulary in one
place, which is where it should have been anyway.

---

## 3. The storage layer — `packages/store`

A new package opens the database and hands out connections. Nothing else in the repo opens a file.

### 3.1 The driver

**Node's own built-in SQLite (`node:sqlite`), behind a small adapter for Drizzle.** This keeps a
compiled C++ add-on off the box image, and it is the same engine the gate-2 prototype rig already
drives (`docs/superpowers/plans/2026-09-16-sqlite-failover-prototype.md`, "Tech Stack").

Established by running them, on 2026-09-16, on Node v26.7.0 with `drizzle-orm@0.45.2`:

- **Drizzle ships no driver for `node:sqlite`.** Listing the package's export map — for the installed
  0.45.2 and for the newest published version, which is also 0.45.2 — returns `better-sqlite3`,
  `libsql`, `bun-sqlite`, `expo-sqlite`, `op-sqlite`, `d1`, `durable-sqlite`, `sqlite-proxy` and
  `prisma/sqlite`. There is no `node-sqlite` entry.
- **A ~25-line adapter makes `node:sqlite` work behind Drizzle's `better-sqlite3` driver.** Exercised:
  `select`, `get`, `insert`, blob columns, Drizzle's `json` and `bigint` column modes, explicit
  `BEGIN`/`COMMIT` around Drizzle statements (the shape §4's queue uses), and **Drizzle's migration
  runner**, which created `__drizzle_migrations`, applied a migration and was a no-op on a second run.
  The adapter needs two things beyond the obvious: Drizzle's raw-array mode maps onto
  `setReturnArrays`, and the migrator calls a `transaction(fn)` method on the client, which the
  adapter supplies as explicit `BEGIN`/`COMMIT`/`ROLLBACK`.
- **`node:sqlite` is stable on Node 26**, not experimental: importing it on v26.7.0 emits no warning.
- **Both drivers bundle the same SQLite**, 3.53.4.

**Performance is not what decides this.** Through Drizzle — which is how all of this code runs — median
of three runs on 2026-09-16:

| | `node:sqlite` | `better-sqlite3` | |
| --- | --- | --- | --- |
| insert 10k rows in one transaction | 80 ms | 97 ms | `node:sqlite` 18% faster |
| 20k reads by primary key | 265 ms | 293 ms | `node:sqlite` 9% faster |
| 200 scans returning 1k rows each | 62 ms | 52 ms | `node:sqlite` 20% slower |

At the driver level, below Drizzle, `better-sqlite3` is genuinely faster at turning rows into objects
(2.4× on the scan case, narrowing to 1.45× when rows come back as arrays) and `node:sqlite` is
substantially faster at preparing statements (16 ms against 41 ms for 20,000 preparations). Through
Drizzle those two effects largely cancel, because Drizzle re-prepares on every call and adds roughly
three times the driver's own cost on a point read. **So the driver choice is a question of features and
dependencies, not speed**, and the scan case is the only one where it costs anything.

**Feature differences that matter here.** `node:sqlite` has no `.backup()`, no `.pragma()` helper and
no `.transaction()` helper; none is needed — archiving uses `VACUUM INTO` (§6.4), pragmas are plain
statements, and slice 1 writes its own transaction handling anyway (§4). Raw driver access returns a
blob as a `Uint8Array` rather than a `Buffer`, but a Drizzle-mapped blob column returns a `Buffer` on
both, so this only reaches code that bypasses Drizzle. `node:sqlite` additionally carries SQLite's
session and changeset extension, which `better-sqlite3` does not; slices 2–5 use Litestream and do not
need it, and it is noted here only so nobody rediscovers it as an argument later.

**The one remaining reason to switch to `better-sqlite3`** is if the adapter turns out to be a
maintenance burden in practice. Nothing found so far suggests it; the fallback costs a native module
in the box image and nothing else.

### 3.2 Two files, and why they need two Drizzle instances

The topology design (§2.1) splits the node's data across `venue.db` (everything classified `ledger` or
`state`) and `node.db` (everything classified `local`: this node's identity, sessions, pairing codes,
keys). The existing classification contribution decides which file a table lives in; no new
declaration is invented.

The design suggested reaching across the two with SQLite's `ATTACH`. **A Drizzle table definition
cannot name a table in an attached file.** Read from the SQL Drizzle emits for a table named
`node.sessions`, on 2026-09-16:

```
select "id", "token" from "node.sessions"
```

It quotes the whole string as a single identifier, so SQLite looks for a table actually called
`node.sessions`, does not find one, and fails. Drizzle's SQLite builder has no schema or
attached-database concept at all — the equivalent of `pgSchema` does not exist in `sqlite-core`.

So: **one Drizzle instance per file.** `ATTACH` stays available on the write connection for
hand-written SQL that genuinely needs both files at once, which the topology design says is rare
("identity rarely joins the venue"). A guard asserts the condition that makes the split safe: **no
foreign key crosses between the two files**, in either direction, or the two could not be backed up
independently.

### 3.3 Connections and settings

One connection for writing, serialised by the queue in §4. A small set of connections for reading,
which SQLite's write-ahead mode allows to run while the writer works. A read *inside* a write
transaction uses the write connection, so it sees its own uncommitted rows.

Settings: write-ahead mode, `busy_timeout = 5000`, `foreign_keys = ON`.

**One correction to the topology design.** Its §8.3 has the storage layer set `wal_autocheckpoint = 0`.
That setting exists because Litestream does the checkpointing instead — and Litestream does not arrive
until slice 2. **Slice 1 leaves automatic checkpointing at SQLite's default**, and slice 2 turns it off
in the same change that starts the Litestream supervisor. Landing slice 1 with checkpointing disabled
and nothing else checkpointing would let the write-ahead file grow without limit from day one.

---

## 4. The transaction helper, and the write queue

`withTransaction` keeps its exact signature (`packages/db/src/tenancy.ts`), so **none of its 1,556 call
sites change**. Its body becomes: take the write lock, `BEGIN IMMEDIATE`, run the caller's async body,
commit or roll back, release the lock.

### 4.1 Why the lock is required, not a precaution

Run on 2026-09-16 with `node:sqlite` on one connection: two request-shaped transactions started
without waiting for each other, each inserting a row with an `await` between its statements, the first
rolling back and the second committing.

```
B threw: cannot start a transaction within a transaction
rows after A rolled back and B committed: []
```

The second transaction could not begin, and the first one's rollback destroyed the row the second had
already inserted. **The control in the other direction**, the same two transactions run one after the
other:

```
rows after A rolled back and B committed: [ { who: 'B' } ]
```

Different outputs, so the measurement distinguishes the two cases rather than agreeing with itself.
This pair becomes the helper's guard test: delete the queue and the assertion must start failing.

### 4.2 What this costs, stated plainly

**A write transaction that waits on something slow now blocks every other write.** On PostgreSQL those
transactions ran side by side. SQLite permits one writer at a time whatever we do, so the queue is
matching the engine rather than working around it — but the change is real for any transaction body
that waits on something other than the database.

**The plan enumerates every such body before the flip.** The fiscal write path was spot-checked on
2026-09-16 and is clean: the hashing in `packages/verifactu/src/huella.ts` uses `createHash` from
`node:crypto`, and secret hashing (`packages/identity/src/secret-hash.ts`) uses `scryptSync` — both
synchronous. That is a spot check of two files, not a survey of the 274 non-test transaction sites,
and the plan does the survey.

---

## 5. The schema conversion

### 5.1 The vocabulary

Every column type and the table builder route through one module. Today it emits exactly today's
PostgreSQL types; the flip changes its bodies.

| Today | After the flip |
| --- | --- |
| `uuid` | text |
| `timestamp` | ISO-8601 text |
| `jsonb` | text holding JSON |
| enum type | text with a check constraint |
| array | text holding JSON |
| `numeric(12,2)` money | whole cents, as an integer (an eight-byte one — see the note below the table) |
| `numeric(12,3)` quantity | whole thousandths, as an integer |
| `numeric(5,2)` rate | whole basis points, as an integer |

**Width, added 2026-09-20 when P5 landed.** "An integer" is eight bytes, not four. PostgreSQL's
`integer` stops at 2147483647, which as cents is 21,474,836.47, while the money bound the rest of
the system states is twelve integer digits — so a four-byte column would refuse a band of amounts
the code accepts. On PostgreSQL the money columns are `bigint`; on SQLite an INTEGER is 64-bit, so
nothing about the flip changes. The receipt is in the plan's task P5, step 3.

The money and quantity rule is **not** a blanket one, and the columns were counted rather than
assumed. Across the 72 table-defining files on 2026-09-16 there were 30 `numeric` columns: **23 at
precision 12 scale 2, the money ones** (`amount` ×3, `unit_price` ×5, `line_total` ×2, `total` ×2,
`price_delta` ×2, `base`, `tax`, `gross_price`, `unit_price_gross`, `cash_tendered`, `tip_amount`,
`offline_amount_cap`, `pay_rate`, `split_shift_premium`), **2 quantity columns** at 12/3, and **5 rate
columns** at 5/2 (`vat_rate` ×2, `deductible_proportion`, `night_premium_pct`, `rate`). This matches
what the topology design's §8.3 predicted from the Fable review; it is now measured.

**That money figure is a snapshot of 2026-09-16, and the rule it justifies is a property. Added
2026-09-20.** What a future session should carry away is not "23" but "every column declared through
`money()` stores a count of whole cents"; the set grows without this document noticing. It already
has — `packages/catalogue/src/schema/extras.ts` landed on 2026-09-19 in #449 carrying two `price`
columns, so the same count taken on 2026-09-20 is 25. The command that answers the question at any
moment is
`grep -rn '\bmoney(' packages apps --include='*.ts' | grep -v '\.test\.ts'`; read its lines rather
than counting them, and check each is a declaration. The pattern matches any line naming the
helper, so a COMMENT mentioning `money()` is a hit like a column, and the next comment to mention
it will be another one — the prose hits as this is written are
`packages/db/src/schema/daily-closes.ts` and `packages/fiscal/src/testing/fake-backend.ts`, which
is why the 27 lines it prints today are 25 columns. The sentence the count was written to support — that the
mapping is not blanket, and that rate and quantity columns are mapped differently — is unaffected.

**The one the vocabulary may not fully hide is the enum.** On PostgreSQL an enum is declared at the
top of a file and produces a column builder; on SQLite it is a text column with a check. That is a
different shape, not merely a different type. **The plan's first vocabulary task converts one module,
reports exactly what the vocabulary could not hide, and only then rolls out to the other 71 files.**

### 5.2 Migrations

**Every migration set regenerates as one fresh baseline.** Waitron is pre-production and schema changes
drop and recreate (CLAUDE.md §3), so there is no history to preserve. Twelve sets regenerate; core's 38
files collapse into one.

This also disposes of a trap rather than carrying it across: CLAUDE.md §3 records that the core journal
is in a shape no edit repairs, because Drizzle picks what to apply from `max(created_at)` alone, so a
database at core release points 1–6 cannot reach the current head. A single fresh baseline has no such
history. `scripts/journal-monotonic.test.ts` continues to guard the new sets.

### 5.3 The fiscal check on the money change

The topology design's §9 and §10 both gate this, and slice 1 inherits the gate unchanged: **the same
fixture sale must produce byte-identical `CuotaTotal`, `ImporteTotal` and huella before and after the
conversion.** The stored fields are already text
(`packages/fiscal-verifactu/src/schema/registros.ts:91-92`), so what the change can break is the
arithmetic feeding the formatting, which shows up as a rounding difference and nothing else. "Passes
the validator" does not discharge this — it only proves the string is well-formed. The shared alta
fixture is re-run against the real fiscal check in the same change, per CLAUDE.md §4.

---

## 6. What replaces the PostgreSQL machinery

### 6.1 The change feed

`LISTEN`/`NOTIFY` (`packages/db/src/change-listener.ts`, consumed only by `apps/server/src/boot.ts`)
becomes an in-process feed. This is sound because a venue runs one server process against one database
— `deploy/compose.yml` defines a single `app` service beside the `db` service, and the print agent is
database-free by rule.

**The caveat, written down because it is a real behaviour change:** a development script that writes
the database directly — the demo seeds and the `scripts/*-demo.ts` family — will no longer appear on a
running dashboard, because the notification used to come from the database and now comes from the
process that did the write. Development-only, and accepted.

### 6.2 Job claiming

`FOR UPDATE SKIP LOCKED` appears in four places: the fiscal drain
(`packages/fiscal-verifactu/src/drain.ts`), payment forwarding (`packages/payments/src/store.ts`),
the printing runtime (`packages/printing/src/runtime.ts`) and the read-only gate
(`apps/server/src/read-only-gate.ts`). Each becomes a claim by update under the write queue. The job
rows stay in the database, so a crash still loses nothing; only the locking changes.

### 6.3 Grants

**Grants are a live runtime defence today, not merely a test device.** Every request transaction calls
`asAppUser` before touching data, so PostgreSQL itself refuses a request path that tries to insert
into `tenants`. SQLite has no roles, so that refusal disappears at the moment of the flip.

Two things replace it:

- **Append-only tables keep a trigger that refuses changes**, as `RAISE(ABORT)` — **and the store must
  set `PRAGMA recursive_triggers = ON`, or the triggers have a hole.** SQLite's `INSERT OR REPLACE`
  deletes the conflicting row internally, and with the default `recursive_triggers = OFF` that
  internal delete does not fire a `BEFORE DELETE` trigger. Measured on 2026-09-16 against a ledger
  table carrying both triggers, with the control in the other direction: with the pragma off,
  `insert or replace` SUCCEEDED and rewrote the row's payload **and its huella**; with it on, the same
  statement was refused. Plain `UPDATE`, plain `DELETE` and `ON CONFLICT … DO UPDATE` are refused
  either way, and `INSERT … ON CONFLICT DO NOTHING` keeps working either way. This is the difference
  between a fiscal record that cannot be rewritten and one that can be rewritten by a statement
  nobody thinks of as an update — the topology design's
  §8.2, and the defence CLAUDE.md §5 relies on for `registros_facturacion`. A guard asserts every
  `ledger` table carries them.
- **Everything else becomes a guard that reads the source** and fails when a write path touches a table
  it has no business writing.

  > **2026-09-19, what P9 actually landed.** `scripts/write-path-tables.test.ts` covers the four
  > tables `app_user` may read and never write — `tenants`, `nodes`, `deployment`, `mirror_config` —
  > and nothing else. "Everything else" turned out to be another fifty tables, where the grant
  > refuses one or two of the three write operations rather than all of them, and where no trigger
  > refuses what the grant refuses. That gap is open, with three options weighed, in
  > `docs/backlog.md` → B9. This section
  > also names only `tenants`, which was the whole list as far as anyone had checked at the time.

**That guard lands while grants still exist** (item P9 in §9). Written then, it can be checked against
what the database actually refuses today; written after the flip, it would be written from memory with
the evidence already deleted.

### 6.4 Driver errors, and the constraint name that no longer exists

This is the largest piece of work in slice 1 that neither the topology design nor the phase plan had
noticed, and it is independent of which driver is chosen.

Waitron's write paths translate a database refusal into a domain error, and several of them key on the
**name** of the violated constraint so they translate only their own and re-throw everything else —
`uniqueViolationConstraint` in `packages/db/src/unique-violation.ts`, with
`packages/identity`'s `asEmailTaken` as its first caller. PostgreSQL reports the constraint name on
the error. **SQLite does not report a constraint name at all.** Run on 2026-09-16 against a table
whose unique constraint was explicitly named `people_email_key`, both drivers reported:

```
message:    UNIQUE constraint failed: people.email
constraint: (not reported)
```

The name is gone; what SQLite gives instead is the **table and column list**. So every caller that
keys on a constraint name must key on columns, and the mapping helpers must parse them out of the
message.

The two drivers also disagree on how they report *which kind* of constraint failed: `better-sqlite3`
raises a `SqliteError` whose `code` reads `SQLITE_CONSTRAINT_UNIQUE`, while `node:sqlite` raises a
plain `Error` with `code` `ERR_SQLITE_ERROR` and the specific reason only in a numeric `errcode`
(2067 unique, 1555 primary key, 1299 not null). Either is workable; `node:sqlite` needs a small
number-to-meaning map.

**Scale:** the four helpers have 92 call sites across 23 non-test source files, including two fiscal
ones — `packages/fiscal-verifactu/src/chain.ts` and `packages/workforce/src/chain.ts` both use this to
decide whether a chain-append race is worth retrying. A misread error there does not corrupt a chain,
but it does turn a retryable race into a failed sale.

**This work starts before the flip**, as item P10 in §9: introduce the "which columns" question as the
thing callers ask, answered on PostgreSQL today from what it already reports, and answered from the
message after the flip. That keeps 23 files of churn out of the flip and keeps each step green.

### 6.5 Archiving

The flip deletes `apps/server/src/pg-restore.ts` and the `pg_dump` path, so **the same pull request supplies
`VACUUM INTO` in their place**. The topology design put archiving in slice 2; moving it forward is
decision 7 in §0. Without it, `main` would sit between two slices with no way to take a copy of a
venue.

---

## 7. Tests

### 7.1 One target

`describeEachTarget` disappears: there is nothing for two targets to disagree about. The replacement
helper opens a **real temporary file**, not an in-memory database, so write-ahead behaviour, file
locking and the two-file split are the real ones.

### 7.2 The role-assumption call

`asAppUser` appears in 266 files, 197 of them tests. **The flip makes it a no-op; a later tidy pull
request deletes the call sites.** Doing it the other way round would put 266 files of churn inside the
one pull request that can least afford them.

### 7.3 The 66 PostgreSQL-only tests

Each is converted or deleted, and the plan lists every one with its disposition and reason.

- A **contention** test mostly becomes a test that the write queue serialises writers — the subject
  survives, the mechanism changes. `packages/fiscal-verifactu/src/chain.pglite-cannot-test-contention.test.ts`
  is the clearest case: it exists to record that PGlite could not test contention, and under one writer
  the thing it warns about no longer arises.
- A **trigger-runs-as-the-deployment-role** test becomes a test of the abort trigger.
- A test whose subject genuinely stops existing — publications, subscriptions, write-position fences —
  is deleted, and its deletion is listed.

Nothing is deleted silently, and no test is kept in a converted form that passes without asserting
anything, which is the failure CLAUDE.md §4 is built to prevent.

### 7.4 Coverage

Large deletions move the numbers. `scripts/coverage-thresholds.test.ts` pins which package holds which
bar, and the split bars stay as the owner set them on 2026-09-05. A tidy pull request after the flip
revisits the numbers; **no threshold is lowered inside the flip to make it pass.**

---

## 8. What is deleted

From the topology design's §8.1, and everything it implies: the `pg` driver and PGlite; Testcontainers
and the real-PostgreSQL harness; `packages/sync` entirely; the role and grant provisioning in
`packages/provisioning`, `withRole`, `asAppUser`, the `pg_hba` and replication login; `pg-restore.ts`
and the `pg_dump` path; `LISTEN`/`NOTIFY`; `FOR UPDATE SKIP LOCKED`; `ENABLE ALWAYS` triggers; and the
guards that exist only for those — `scripts/append-only-enable-always.test.ts`, the migrator-ownership
checks, and `scripts/module-graph-honesty.test.ts`'s cross-module `EXECUTE FUNCTION` check.

Also deleted, per decision 3: the failover routes in `apps/server/src` that depend on publications,
subscriptions or write-position fences. **Kept, because they are engine-agnostic:** `packages/membership`
whole (documents, signing, canonicalisation, verification, trust), enrolment, enrolment rate limiting,
and node retirement.

Kept from the topology design's §8.2: the module contract and the `ledger`/`state`/`local`
classification, the error-code registry and its guards, the no-tenant-column guard, and the
append-only rule in its new form.

---

## 9. The work, in order

Three phases. The **Runner** column marks the campaign runner's autonomy boundary: option A lets it
land non-fiscal work by itself and leaves anything touching the unrepairable fiscal core as a
`needs-owner-review` pull request.

### Prepare — each lands on today's PostgreSQL, green, on its own

| | What | Depends on | Runner |
| --- | --- | --- | --- |
| P1 | Shared column and table vocabulary; **prove on one module first**, then roll out | — | autonomous |
| P2 | One test-database helper behind the existing three (211 files) | — | autonomous |
| P3 | In-process change feed replacing `LISTEN`/`NOTIFY` | — | autonomous |
| P4a | In-process job claiming: printing, payments, read-only gate | — | autonomous |
| P4b | In-process job claiming: the fiscal drain | P4a | owner review |
| P5 | Money to whole cents (23 columns) | P1 | owner review |
| P6 | Quantities to thousandths (2), rates to basis points (5) | P1 | owner review |
| P7 | Untangle foreign keys that would cross `venue.db` / `node.db` | — | autonomous |
| P8 | Delete `packages/sync` and the PostgreSQL-shaped failover routes | — | autonomous |
| P9 | The write-path guard, **while grants still exist to check it against** | — | autonomous |
| P10 | Re-key driver-error translation on columns rather than constraint names (§6.4) | — | owner review |

P1 and P2 are large but mechanical, and both split per package into several pull requests.

### The flip — one pull request, and it cannot be smaller

`packages/store`; the transaction helper and its write queue; the vocabulary bodies switched to
SQLite; twelve migration sets regenerated as one baseline each; the two-file split and its
cross-file foreign-key guard; the append-only triggers as `RAISE(ABORT)`; `VACUUM INTO` archiving
replacing the `pg_dump` path; `asAppUser` reduced to a no-op; the test helper's body switched; the 66
PostgreSQL-only tests converted or deleted. Depends on every prepare item. **Owner review.**

### Tidy — each green on SQLite, on its own

| | What | Runner |
| --- | --- | --- |
| T1 | Delete the `asAppUser` call sites (266 files) | autonomous |
| T2 | Drop the PostgreSQL dependencies and the `db` container from the development stack | autonomous |
| T3 | Revisit the coverage bars after the deletions | autonomous |

---

## 10. Risks

1. **The flip is one large pull request and nothing makes it small.** Mitigated, not removed, by the
   prepare phase: the vocabulary and the test helper move 795 column definitions and 211 test files
   out of it. What remains is genuinely simultaneous.
2. **The prepare items conflict with other branches in flight.** The owner runs several worktrees in
   parallel, and P1 touches 72 files while P2 touches 211. Each prepare item rebases immediately
   before it lands, and the plan sequences P1 and P2 per package so a conflict is confined to one
   package.
3. **The `node:sqlite` adapter is a piece of this repository's own code sitting under Drizzle.** It is
   now proven across reads, writes, blobs, Drizzle's column modes, explicit transactions and the
   migration runner (§3.1), so the risk is no longer whether it works but whether it stays working
   across Drizzle versions. The fallback is `better-sqlite3`, which costs a native module in the box
   image and nothing else, and the adapter is small enough to abandon cheaply.
4. **Single-writer throughput is unmeasured.** Nothing in this repository says what a venue's write
   load costs under one serialised writer. No sentence here claims it is sufficient; the gate-2
   prototype measures sale latency under an offline write load, and that measurement — not this design
   — is what the claim will rest on. *(2026-09-18, run: that measurement now exists. The
   prototype's S4 drove 7500 sales through one SQLite writer with `wal_autocheckpoint = 0` and a
   Litestream daemon pointed at a closed port: commit p50 0.128ms, p95 0.312ms, p99 0.436ms, max
   1.583ms on the recorded run, against the pglite bench's 150ms and 400ms bars, and the WAL grew
   about 41KB a sale to 310MB. Two limits on reading it: the percentiles move with the machine
   (p95 0.297–0.333ms across the offline-arm runs the README lists), and what was driven is the
   prototype's own five-table model
   in SQLite, not this design's schema. `bench/sqlite-failover/README.md` → "What S4 measures, and
   what it does not".)*
5. **`main` has no failover between slice 1 and slice 3** (§1). Accepted, because Waitron is
   pre-production; it is not acceptable at go-live, and slices 3–5 are what close it.
6. **Grants stop defending the code against itself at the flip** (§6.3). The source-reading guard is a
   weaker instrument than a privilege the database enforces: it reads text, so it can be fooled the
   way every text-reading guard in this repository can. Stated here rather than discovered later.

---

## 11. Open items the plan settles

- **Which transaction bodies wait on something other than the database** (§4.2) — a survey of the 274
  non-test transaction sites, not the two-file spot check done here.
- **What the vocabulary cannot hide** (§5.1) — reported from one converted module before the rollout.
- **How the columns come out of each driver's message** (§6.4) — the exact parse, and what a
  multi-column unique constraint reports.
- **The cross-file foreign-key list** (§3.2) — enumerated from the foreign-key graph, with each edge's
  resolution named, before P7 writes any code.
- **The disposition of each of the 66 PostgreSQL-only tests** (§7.3).

---

## Provenance

Measurements in this document were taken on 2026-09-16 against the tree at commit `67cb6d84`, with
Node v26.7.0 and `drizzle-orm@0.45.2`.

| Claim | How it was established |
| --- | --- |
| No Drizzle driver for `node:sqlite` | Listed the export map of the installed 0.45.2 and of `drizzle-orm@latest` (also 0.45.2) |
| `node:sqlite` works behind Drizzle with an adapter | Ran reads, writes, blob and JSON column modes, explicit transactions, and Drizzle's migration runner through a ~25-line shim |
| Driver performance through Drizzle | Median of 3 runs each: inserts, point reads, scans — see §3.1 |
| `node:sqlite` is stable on Node 26 | Imported it on v26.7.0; no experimental warning |
| Both drivers bundle SQLite 3.53.4 | `select sqlite_version()` on each |
| SQLite reports no constraint name | Violated an explicitly named unique constraint on both drivers; both reported the table and column only |
| 92 error-helper call sites in 23 non-test files | grep for the four helpers in `packages/db/src/unique-violation.ts` |
| A Drizzle table cannot name an attached file's table | Read the emitted SQL: `select "id", "token" from "node.sessions"` |
| Overlapping async transactions on one connection lose writes | Ran both the failing case and the serialised control; they print different results |
| 106 tables, 35 enum types, 795 column definitions, 72 files | grep over the non-test files containing `pgTable(` |
| 23 money / 2 quantity / 5 rate `numeric` columns | grep for `numeric("…", { precision, scale })` in those files |
| 1,556 transaction call sites, 274 outside tests | grep for `withTransaction(` |
| `asAppUser` in 266 files, 197 of them tests | grep |
| 211 files choose a test database; 66 `*.pg.test.ts` | grep and `find` |
| One server process per venue | `deploy/compose.yml` defines a single `app` service |
| Fiscal and secret hashing are synchronous | `createHash` in `packages/verifactu/src/huella.ts`; `scryptSync` in `packages/identity/src/secret-hash.ts` — a spot check of two files |
