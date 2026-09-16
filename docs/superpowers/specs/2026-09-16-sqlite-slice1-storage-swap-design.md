# Slice 1 of the SQLite switch: the storage swap — design

**Status:** design approved by the owner 2026-09-16; plan not yet written.

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
6. **Archiving moves into the flip**, not into slice 2 as the topology design had it. The pull request
   that deletes the `pg_dump` path is the one that must supply its replacement, or `main` lands with
   no way to take a copy of a venue at all (§6.4).

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

Both are mechanical, reviewable, and independently valuable: they put the engine's vocabulary in one
place, which is where it should have been anyway.

---

## 3. The storage layer — `packages/store`

A new package opens the database and hands out connections. Nothing else in the repo opens a file.

### 3.1 The driver

**Node's own built-in SQLite (`node:sqlite`), behind a small adapter for Drizzle.** This keeps a
compiled C++ add-on off the box image, and it is the same engine the gate-2 prototype rig already
drives (`docs/superpowers/plans/2026-09-16-sqlite-failover-prototype.md`, "Tech Stack").

Two things were established by running them, on 2026-09-16, on Node v26.7.0 with `drizzle-orm@0.45.2`:

- **Drizzle ships no driver for `node:sqlite`.** Listing the package's export map — for the installed
  0.45.2 and for the newest published version, which is also 0.45.2 — returns `better-sqlite3`,
  `libsql`, `bun-sqlite`, `expo-sqlite`, `op-sqlite`, `d1`, `durable-sqlite`, `sqlite-proxy` and
  `prisma/sqlite`. There is no `node-sqlite` entry.
- **A ~20-line adapter makes `node:sqlite` work behind Drizzle's `better-sqlite3` driver.** The
  differences are confined to statement handling: Drizzle toggles a raw-array mode through `raw()`,
  which maps onto `node:sqlite`'s `setReturnArrays`. With that adapter a `select()`, a `get()` and an
  `insert()` returned correct rows.

  **What that experiment did not exercise, stated so nobody assumes it did:** transactions, blob
  columns, prepared-statement reuse across calls, and Drizzle's migration runner. **The plan's first
  storage task re-runs the adapter against all four before any other work depends on it**, and falls
  back to `better-sqlite3` — which Drizzle supports directly, at the cost of a native module in the
  box image — if any of them cannot be adapted.

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
| `numeric(12,2)` money | whole cents, as an integer |
| `numeric(12,3)` quantity | whole thousandths, as an integer |
| `numeric(5,2)` rate | whole basis points, as an integer |

The money and quantity rule is **not** a blanket one, and the columns were counted rather than
assumed. Across the 72 table-defining files on 2026-09-16 there are 30 `numeric` columns: **23 money
columns** at precision 12 scale 2 (`amount` ×3, `unit_price` ×5, `line_total` ×2, `total` ×2,
`price_delta` ×2, `base`, `tax`, `gross_price`, `unit_price_gross`, `cash_tendered`, `tip_amount`,
`offline_amount_cap`, `pay_rate`, `split_shift_premium`), **2 quantity columns** at 12/3, and **5 rate
columns** at 5/2 (`vat_rate` ×2, `deductible_proportion`, `night_premium_pct`, `rate`). This matches
what the topology design's §8.3 predicted from the Fable review; it is now measured.

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
(`packages/fiscal-verifactu/src/schema/registros.ts:95-96`), so what the change can break is the
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

- **Append-only tables keep a trigger that refuses changes**, as `RAISE(ABORT)` — the topology design's
  §8.2, and the defence CLAUDE.md §5 relies on for `registros_facturacion`. A guard asserts every
  `ledger` table carries them.
- **Everything else becomes a guard that reads the source** and fails when a write path touches a table
  it has no business writing.

**That guard lands while grants still exist** (item P9 in §9). Written then, it can be checked against
what the database actually refuses today; written after the flip, it would be written from memory with
the evidence already deleted.

### 6.4 Archiving

The flip deletes `apps/server/src/pg-restore.ts` and the `pg_dump` path, so **the same pull request supplies
`VACUUM INTO` in their place**. The topology design put archiving in slice 2; moving it forward is
decision 6 in §0. Without it, `main` would sit between two slices with no way to take a copy of a
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
3. **The `node:sqlite` adapter is proven for three operations only** (§3.1). If transactions, blobs,
   statement reuse or the migration runner cannot be adapted, the driver becomes `better-sqlite3` and
   the box image gains a native module. Decided by the plan's first storage task, before anything
   depends on it.
4. **Single-writer throughput is unmeasured.** Nothing in this repository says what a venue's write
   load costs under one serialised writer. No sentence here claims it is sufficient; the gate-2
   prototype measures sale latency under an offline write load, and that measurement — not this design
   — is what the claim will rest on.
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
- **The `node:sqlite` adapter's four unexercised areas** (§3.1).
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
| `node:sqlite` works behind Drizzle with an adapter | Ran a `select`, a `get` and an `insert` through a ~20-line shim; no other operation exercised |
| A Drizzle table cannot name an attached file's table | Read the emitted SQL: `select "id", "token" from "node.sessions"` |
| Overlapping async transactions on one connection lose writes | Ran both the failing case and the serialised control; they print different results |
| 106 tables, 35 enum types, 795 column definitions, 72 files | grep over the non-test files containing `pgTable(` |
| 23 money / 2 quantity / 5 rate `numeric` columns | grep for `numeric("…", { precision, scale })` in those files |
| 1,556 transaction call sites, 274 outside tests | grep for `withTransaction(` |
| `asAppUser` in 266 files, 197 of them tests | grep |
| 211 files choose a test database; 66 `*.pg.test.ts` | grep and `find` |
| One server process per venue | `deploy/compose.yml` defines a single `app` service |
| Fiscal and secret hashing are synchronous | `createHash` in `packages/verifactu/src/huella.ts`; `scryptSync` in `packages/identity/src/secret-hash.ts` — a spot check of two files |
