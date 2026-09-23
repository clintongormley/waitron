# Conventions — data, migrations and module boundaries

This file holds the evidence behind the data- and module-boundary conventions in the repo root
`CLAUDE.md` section 3: the mechanisms, measurements, error codes, drizzle internals and the incidents
that paid for each rule. `CLAUDE.md` keeps the one-line version of each rule and points here for the
rest.

**A note on the error codes, because they change shape partway down this file.** The five-character
SQLSTATEs below — `23505`, `42501`, `22003` and the rest — are PostgreSQL's, and every one of them is
now history: the storage switch took the engine that raised them. `node:sqlite` reports a numeric
`errcode` instead. Measured 2026-09-22 on Node v26.7.0, in one transaction: a duplicate primary key
is 1555, a null in a `not null` column 1299, and a trigger's `RAISE(ABORT)` 1811. The tree spells it
that way too (`packages/migrations/src/apply.ts`, `packages/provisioning/src/errors.ts`). A passage
kept for a measurement taken on PostgreSQL says so in its own words; read every SQLSTATE here as a
reading from that engine and not as something a box can still print.

**Naming and error codes**

## Error codes name the DOMAIN CONCEPT, never the throwing package

`series.not_found`, not `db.series_not_found` (design note atop `packages/shared/src/errors.ts`).
Codes are **never renamed once shipped**; deprecate and add a sibling. `server.*` is reserved for
facts about the process itself (`apps/server/src/errors.ts`). Every file that throws a code imports
its registry (`import "./errors.js"`); reachability is guarded once, in the root project (§4).

## A recorded incident code needs an area claim and English and Spanish alert wording

An incident whose code no module claims (`alerts.events` on its module descriptor, matched by the
longest prefix) is shown under diagnostics, to `diagnostics.view` only
(`UNCLAIMED` in `apps/server/src/alerts.ts`). A code with no entry in
`apps/dashboard/src/i18n/alert-messages.ts` is shown as a generic sentence with the raw code beneath
it. The guard, `scripts/alert-codes.test.ts` (root project), collects code-shaped string literals
from the files in its `INCIDENT_CODE_SOURCES` list, minus `NOT_RECORDED`, and checks each has a claim
and both wordings. It reads text, which makes it weaker than its name in the same ways its opening
comment lists:

- It matches only double-quoted literals with one dot and nothing but lowercase letters and
  underscores (`/"([a-z_]+\.[a-z_]+)"/`). A single-quoted or backtick code, a code with a digit or a
  second dot, and a code built at runtime all escape the scan.
- A listed code counts as recorded because its text appears in a listed file, not because anything
  in production raises it. The guard's opening comment names the codes counted that way.
- A file that only names a code and hands it to a writer elsewhere (as `packages/fiscal/src/clock.ts`
  builds the clock warnings that `packages/core/src/record-sale.ts` records) is scanned only if it is
  listed.
- It spots a new writer only by the call shapes `recordIncident(`, `recordIncidentOnce(` and
  `incidents(tx`. A file recording through a sink under another name, or through a transaction
  variable not named `tx`, is not caught, and neither are the codes that file names.
- It looks for writers only in `.ts` files under `packages/*/src` and `apps/*/src`, skipping any
  `testing` directory, so a writer elsewhere (such as `apps/server/scripts/`) is not seen.

The guard also requires wording for `alert.source_unavailable`, the alert the server builds in place
of an ongoing check that failed.

A sibling guard, `scripts/ongoing-alert-codes.test.ts`, holds the ongoing (non-incident) source codes
to the same English-and-Spanish wording bar; it too reads source TEXT and hand-lists its two source
files (`apps/server/src/alert-sources.ts`, `packages/fiscal-verifactu/src/submission-alerts.ts`), so an
ongoing source added in a third file is silently missed until it is added to that list.

## Spanish domain terms are deliberate, and a module declares its own

The guard (`packages/db/src/english-only.ts`; suite `scripts/english-only.test.ts`, root project)
forbids, in every generic package, a base list of generic Spanish plus every module's declared
`vocabulary` seat; an owner's own package (derived from `migrations.from`) is never scanned. One
declaring home per word: a fiscal term goes in `FISCAL_VOCABULARY` (`packages/fiscal-verifactu`), a
labour term in `WORKFORCE_ES_VOCABULARY` (`packages/workforce-es`), never the base list — the suite
fails on a clash. `apps/*`
is out of scope by a recorded decision, so Spanish IDENTIFIERS in app UI code are caught only by
review. Design: `docs/superpowers/specs/2026-09-05-module-sp3b-vocabulary-design.md`.

**Module and package boundaries**

## The composition list lives in `@waitron/composition`, and it is the only place that names every module

Generic provisioning code imports neither that list nor a REGIME package (`@waitron/fiscal-verifactu`,
`@waitron/verifactu`) — `packages/provisioning/src/bin.ts` excepted, it is the CLI's composition root
— and no file under `apps/server/src` imports a regime package outside the allowlisted runtime pass.
The regime is reached through the descriptor's `provisioning` and `fiscal` seats. The boundary is the
swappable SLOT, not "any module": provisioning's `@waitron/identity` and `@waitron/layouts` imports
are legitimate. `scripts/module-seams.test.ts` (root project, reads text) pins it, each allowlist
entry carrying its deferral reason — shrink that list in `fiscal-none`, never grow it. A module's
per-node seed runs INSIDE `applyVenue`'s one transaction: a seed that throws rolls the venue back.
Cost of the old shape: the generic venue runner, the node runner, the standby reservation and
establishment, and the till's backend construction imported the Spanish regime directly, and
`fiscal-none` could not land. Design:
`docs/superpowers/specs/2026-09-05-module-sp3c-gated-provisioning-design.md`. On the browser side
`@waitron/dashboard-modules` is the composition list's twin — the one place that names every
UI-bearing module (guarded by `module-seams` + `dashboard-browser-purity`), so `apps/dashboard`
mounts modules without naming one, exactly as generic provisioning does not.

## A test-only dependency closes a workspace dependency loop as surely as a runtime one

pnpm counts `devDependencies` when it looks for a loop, and prints "There are cyclic workspace
dependencies" on every install. Two test-only links made one: `@waitron/migrations` listed twelve
modules to compare their journal table names with the manifest, while those modules used
`@waitron/migrations` in their own tests; and the PostgreSQL replication suites in `@waitron/sync`
used `@waitron/provisioning`, which reached `@waitron/sync` again through `@waitron/composition`. The
journal-table test moved to `packages/composition/src/composition.test.ts`, and the replication suites
moved to a package nothing depends on. Receipt, 2026-09-13:
`scripts/workspace-cycles.test.ts` listed the ten-package loop before the move; on the finished tree
it passed, failed again when `@waitron/provisioning` was added back to `sync`'s `devDependencies`, and
`pnpm install` printed no loop warning.

The two packages named in that receipt — `@waitron/sync` and the replication-test package — were both
deleted with the PostgreSQL failover machinery on 2026-09-19, so the loop they closed no longer exists.
The RULE and the guard stand: any future test that needs packages from both ends of a loop needs the
same home.

The guard reads each member's `package.json` rather than asking pnpm for its graph, and counts every
dependency whose name is another workspace member.

## A command name is declared under `waitron.commands`, never `bin`

pnpm links a `bin` while it INSTALLS and skips one whose target is missing, and nothing here builds
at install time, so a `bin` under `dist/` is never linked by the install that reads it. Every CLI is
run by path anyway (`node /app/bin-restore.js` in the image). Cost: repeated `Failed to create bin`
warnings on every install, in every worktree and in the image build, plus an AEAT runbook whose
`pnpm --filter … exec waitron-credentials` steps could never have run; the measurements are in that
runbook's dated note (`docs/superpowers/plans/2026-07-28-first-aeat-submission.md`, Task 3). Guards:
`scripts/manifest-commands.test.ts` (a declared `bin` target must be tracked by git; a
`waitron.commands` target must appear as an `--outfile=` in its own package's `build` script, which
is a text match) and `scripts/deploy-image-env.test.ts` (the image ships every name the server
declares).

## `@waitron/db`'s `exports` map is enumerated, not a wildcard

Every entry is written out one by one in `packages/db/package.json` — the main entry, plus one per
test helper this package deliberately publishes to other packages. Read that file for the current
list rather than any copy of it kept here; a copy in prose is a thing to maintain, and this one had
already gone stale once. A wildcard would publish the whole harness. Consequence: `apps/server`
cannot deep-import `packages/db`'s `errors.ts`.

## A new product domain lands as a MODULE, not as new code in the core

A domain is a package that fills the contract seats (schema, sync, provisioning, fiscal,
vocabulary…) and is named only by `@waitron/composition`; generic code never learns it exists. Cost
of the other shape: a whole regime wired straight into `apps/server`, the till backend and the venue
runners, so `fiscal-none` could not be added until SP-3 pulled it back behind the slot — after which
the no-op regime was a package with an empty runtime duty and `apps/server` imported no regime at all
(`fiscal-none`, this branch; design `docs/superpowers/specs/2026-09-06-module-fiscal-none-design.md`,
SP-3).

## A country pack is a browser-safe preset over modules, not a module

Generic contracts live in `@waitron/country`; each country owns its validation and geography in a
separate package; and `@waitron/country-packs` is the only package that names every installed
country implementation. Packs name module and fiscal contribution ids as strings and never carry an
external-provider credential. Setup derives geography-dependent values in the browser and repeats the
derivation at the server boundary. Guarded by `scripts/module-seams.test.ts`; design:
`docs/superpowers/specs/2026-09-09-country-packs-and-address-entry-design.md`.

## `packages/db/src/schema/columns.ts` is the only file that names the engine's column and table types

A table file declares its columns from that vocabulary — `id`, `ts`, `day`, `money`, `quantity`,
`rate`, `label`, `flag`, `count`, `json`, `binary`, `enumText`, `table` and the rest — and never
calls `integer(…)`, `text(…)` or `sqliteTable(…)` straight from `drizzle-orm/sqlite-core`, which is
where the vocabulary itself imports from now. That import line is also what the guard derives its
forbidden set from, so the list moves when the vocabulary's does. Task F1 is what the rule bought:
the switch replaced the bodies in that one file rather than every column declaration in the tree
(`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, task P1).

What it cost: fourteen pull requests, #393 through #414, most of them one package at a time. Each
conversion proved "no schema change" the same way — generate that package's migrations into a copy
of its migration folder, diff the copy against the real one, expect no difference. Two changed what a
CALLER is handed rather than what the database stores, both in the same direction: the hand-rolled
`bytea` block behind `print_jobs.payload` in `packages/db` (#396) and the three sealed columns in
`packages/credentials` (#413) typed their values as node `Buffer`s, where the shared `binary` helper
hands a `Uint8Array`. `packages/media`'s block already declared the `Uint8Array` shape, so converting
it changed nothing a caller sees.

No `pgEnum` column was left behind in the end. A closed vocabulary is `enumText`: a `text` column
whose permitted values are listed in a `check()` constraint that `enumCheck` builds from the same
array the TypeScript type is derived from, so the type and the constraint cannot state different
sets. On this engine that constraint is the only thing between the column and any string at all.

Guarded by `scripts/column-vocabulary.test.ts`, whose own header says what it reads and where it is
blind — read that before changing it, rather than this. Two things about it belong here, because they
are decisions rather than mechanism:

- **It is a ROOT guard, not a case in `packages/db`'s own suite**, which is where the plan put it. CI
  runs a package's suite only when the scoping selects it, and the expansion is to a changed
  package's DEPENDENTS: measured 2026-09-18, `pnpm --filter "...@waitron/bookings" ls --depth -1
  --json` lists seven packages and `@waitron/db` is not among them, so the check would never have run
  on a pull request adding a table file in `packages/bookings`. Same defect that moved the repo-wide
  guards out of `packages/db` on 2026-08-01; the root `vitest.config.ts` header carries that history.
- **One exception, scoped to a single builder rather than to the file**: `text` in
  `packages/fiscal-verifactu/src/schema/registros.ts`, whose `cuota_total` and `importe_total` store
  the exact bytes hashed into the Veri\*Factu huella and so must not pass through a helper that could
  re-render them. A different builder in that same file is still reported.

The rule landed in the same change as the guard and not earlier, although a reviewer asked for it
after the first package converted: root `CLAUDE.md` §7 says a written rule with standing violations
needs a guard rather than another paragraph, and until the last package converted every unconverted
one was such a violation.

## No new table enters the core migration set without a stated reason in the commit

A domain table a module owns belongs to that module's own migration set (`migrations.from`),
where its append-only declaration travels with it — the module declares the table with
`appendOnly()`, and `MigrationSet.appendOnlyTables` carries the names to `applyMigrations`
(`packages/migrations/src/manifest.ts`). A core-set addition is a deliberate exception and says why
it is not a module's. Same defect class as §1's unstated claims — an unexplained core table is a boundary
decision no future reader can audit.

**Writing SQL safely**

## Never build SQL by string concatenation — except for an identifier, which SQLite will not bind

Drizzle's `` sql`… ${value}` `` parameterises (verified: `o'brien; drop table x --` round-trips
intact), but no engine binds an IDENTIFIER, and this one says so plainly. Measured 2026-09-22 on Node
v26.7.0: `db.prepare("delete from ?")` throws `near "?": syntax error`, and `delete from "?"` is a
query against a table literally called `?` (`no such table: ?`) — both errcode 1. So a table or
trigger name that has to reach a statement arrives as text or not at all, which leaves the same two
options as before: **escape** (`quoteIdent`/`quoteLiteral`,
`packages/provisioning/src/identifiers.ts`) or **validate and throw** (`assertSafeIdentifier`,
`packages/db/src/testing/identifiers.ts`, which records the same reading at its own head). Neither is
not acceptable; "the callers only pass safe values" is the §1 defect class.

The old dead examples, kept only so a reader meeting them elsewhere knows what they were: on
PostgreSQL the unbindable statements were the utility ones — `CREATE ROLE … $1`, `CREATE DATABASE`,
`GRANT`. None of the three exists here.

## A `sql` scalar subquery correlated to the OUTER query's table breaks silently when that table is the `.from()` base rather than a join

Drizzle renders `` `${table.column}` `` as the bare quoted column; joined tables are aliased so it
resolves outward, but a base table's bare `"id"` binds to the SUBQUERY's table — no error, a wrong
answer (#152: a null table label). Copying a correlated subquery: check base-vs-join and READ the
emitted SQL with `.toSQL()`.

## An untargeted `.onConflictDoNothing()` absorbs every unique conflict, not only the primary key's

`writeItems` in `packages/catalogue/src/extras.ts` inserted each of an extras list's items with a
bare `.onConflictDoNothing()` and read "nothing came back" as "another transaction already holds
this id". Verified with `.toSQL()` on drizzle 0.45.2: the untargeted call emits
`… on conflict do nothing`, and the same insert with `{ target: extraListItems.id }` emits
`… on conflict ("id") do nothing`. The table also carries
`extra_list_items_list_product_uq` over `(list_id, product_id)`, so the bare clause swallowed a
PRODUCT collision too: a body adding an item for the product a retained item was moving away from
came back as `extras.invalid` naming `items.0.id`, an `id` field that body never sent, which breaks
the rule that a refusal is placed beside a field by what the error carries.

Name the target whenever the table has more than one unique constraint and the code reads the empty
result as a specific cause. Other untargeted calls are still in the tree and nothing guards this;
`grep -rn 'onConflictDoNothing()' --include='*.ts' packages apps` finds them.

## Editing rows one at a time can break a unique index the final state satisfies

That same `writeItems` kept the rows a save still named and updated each where it stood, so a body
exchanging two items' products put both rows on the same product midway through and
`extra_list_items_list_product_uq` refused the first update with
`23505 duplicate key value violates unique constraint`, although the body's final product set was
legal. Reproduced on real PostgreSQL by `saves a body that exchanges two retained items' products`
(`packages/catalogue/src/extras.concurrency.test.ts`). It now deletes every one of the list's rows and
inserts the body's fresh, each under the id the body sent or a new one, which removes the
intermediate state rather than ordering around it.

That is safe under two conditions, and the second one is easy to miss. The FIRST is that nothing
outside the table holds a key into it, so the rows may lose their identity — and it is
`extra_list_items` that is being rewritten, so what matters is who references THAT table. The grep
had to be respelled for the storage switch: the generated SQLite baselines quote with backticks and
name no schema, so the old `REFERENCES "public"."extra_l` pattern matches nothing at all now. Run
``grep -rn 'REFERENCES `extra_l' --include='*.sql' packages`` — three lines on 2026-09-22, all in
`packages/catalogue/drizzle/0000_baseline.sql` and all naming `extra_lists`, the PARENT. None names
`extra_list_items`, so the condition still holds; the count does not stand on its own, because the
pattern matches the parent's name as well. Scope it to `packages` rather than `packages apps`:
`apps/server/dist/drizzle` holds built copies of the same baselines, and it is git-ignored build
output rather than a second place a key could live. A table something else references cannot be
rewritten this way.

The SECOND is that two writers replacing the same set must be serialised. That condition is about
the WRITE, not about row identity, and the grep says nothing about it: an unserialised second
transaction's `delete` cannot see the first's uncommitted inserts, so it removes nothing, and its own
inserts then meet the first's committed rows on `(list_id, product_id)`. On PostgreSQL that collision
was a `23505` reaching `writeItems` as a drizzle `Failed query:` error carrying no `code` of its own,
which the server's error boundary answered as an opaque 500 rather than as a domain refusal, and
`updateExtraList` and `deleteExtraList` took a `select … for update` on the `extra_lists` row to keep
two saves of one list apart.

**What serialises them now is the venue file's write queue, and there is no lock left to take.**
`withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
`packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`, so the
next caller's `begin` does not run until that `commit` has returned. That holds for every row in the
file rather than for the one a clause named. SQLite has no row locks to take instead, and drizzle's
SQLite query builder has no `.for()` at all — so `assertExtraListForWrite`
(`packages/catalogue/src/extras.ts`, under the heading *Why this stopped being a lock*) is now the
404 it always also was, and nothing else.

**The control moved with the lock.** It used to be two connections and a `pg_blocking_pids` poll for
"the second one is BLOCKED"; the thing to observe now is "the second one has not STARTED". That is
`racePair` in `packages/catalogue/test/fixtures.ts`, which every concurrency case in the package goes
through, and its header records the reading in both directions taken back to back: two bodies started
through `withTransaction` report `secondStarted === false` while the first is held, and the same two
bodies started without it report `true`.

**The `23505` reading itself has not been re-taken on this engine.** `saves a body that exchanges two
retained items' products` (`packages/catalogue/src/extras.concurrency.test.ts`) still runs and still
passes, so what is known today is that the case passes — not that deleting the delete-then-insert
would still turn it red. `writeItems`'s own header says the same thing at the site.

## Resolve shared catalogue data once before a basket's line loop

The Products review found that each basket line called `resolveZoneOffer`, which reloaded the whole
zone offer catalogue, then performed separate product-variant and menu-variant reads. Repeated items
therefore repeated the same sequential database work. `priceOrderLines` now reads one zone snapshot
and one batch of product variants before its in-memory line loop. The focused
`working-order.test.ts` probe spies on both contribution methods: one `listZoneOffers` call and no
per-line `resolveZoneOffer` calls for a repeated-offer basket. Kitchen routing follows the same
rule: `fireLines` makes one `resolvePreparationRoutes` call per fire, which answers for every product
with at most three reads; `working-order.test.ts` checks the single call and
`packages/venue-service/src/operations.test.ts` checks the read count for one product and for five.

**Tables the application code may read and never write**

## Four tables are read-only to the application, and one guard is the whole of the enforcement

`tenants`, `nodes`, `deployment` and `mirror_config`. NOTHING BUT `scripts/write-path-tables.test.ts`
REFUSES THEM. The database used to: a request was served on a connection wearing `app_user`, which
held `SELECT` and no write on the four, so PostgreSQL answered a write with `42501`. SQLite has no
roles and no grants — one process opens one file, and every path, request and provisioning alike,
shares that one venue handle. So the rule survives as a convention over source text, and that guard
is not a second opinion on an engine that would refuse the write anyway.

The list comes from `packages/fiscal-verifactu/src/privileges.expected.ts`, the matrix that recorded
`app_user`'s table privileges. It is a FROZEN RECORD now rather than a measurement: the suite its
header points at, `privileges.test.ts`, read every table's privileges back from a live PostgreSQL
catalogue and is gone with the engine. The guard says so itself, and states four ways it is weaker
than "no write path touches a forbidden table" — it reads TEXT; it judges a FILE rather than a call
chain; it walks `<member>/src` under `apps` and `packages` alone; and what the grants refused one
operation at a time it does not cover at all (`docs/backlog.md` → B9). Read those hedges in the guard
rather than trusting this line.

Real code does write all four, legitimately: the promote route reaches `deployment`, and the
setup-mode provision and adopt routes reach `tenants`, `nodes` and `mirror_config`. Each does it by
calling into one of the four files `scripts/write-path-tables.json` names, which is where such a
write is allowed to live. Keeping them in a handful of named files is the whole of the property now,
because no connection makes the distinction for us any more.

HISTORICAL, and the reason the guard exists. Asked of the database rather than of the file, in
PGlite against the core migrations inside a transaction that had run `set local role app_user`: an
insert and an update of `tenants`, an insert of `nodes`, an update of `deployment` and a delete from
`mirror_config` each came back `42501 permission denied for table <name>`, while `select 1 from
tenants` in the same shape was allowed. Read on 2026-09-19, on PostgreSQL. Nothing in the tree
prints that now.

## A money column holds a count of whole cents, and the conversion happens at the row

Landed 2026-09-20 as task P5 of the SQLite storage swap
(`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`). EVERY column declared through
`money()` stopped being `numeric(12, 2)` and became an integer counting cents: the storage engine
the vocabulary exists to switch to has no exact decimal type, and a float cannot hold a cent
exactly. The property is the rule, not a number — the set grows, and a number written here would be
wrong the next time a table lands. To see today's set:
`grep -rn '\bmoney(' packages apps --include='*.ts' | grep -v '\.test\.ts'` — read the lines rather
than counting them. The pattern matches any line naming the helper, so a COMMENT that mentions
`money()` is a hit like a declaration, and the next comment to mention it will be another one:
check each line is a column. The one prose hit on 2026-09-22 is
`packages/db/src/schema/daily-closes.ts`.

**Where the boundary is, and why it is there.** The database is the edge and only the database.
A read turns the stored count into the exact `Decimal` that `packages/shared/src/money.ts`
already works in; a write turns it back; both happen at the row. Above that line nothing moved —
the arithmetic, the HTTP contract both single-page apps consume, the receipt strings and the
literals a fiscal record hashes. The alternative, cents as the in-memory type through core,
catalogue, payments, reporting and `apps/server`, reaches the same storage with a far larger
change and a live risk of rounding drift in the arithmetic the hash chain depends on.

The converters live alone in `packages/shared/src/cents.ts` (which also uses
`packages/shared/src/scales.ts`'s literal renderer and raw pattern) rather than beside the arithmetic.
`money.ts` is read as TEXT by `packages/shared/src/conventions.test.ts` and fails on any
float-shaped operation in it, including the number constructor; keeping that check that strict is
worth more than one module. `cents.ts` has its own version of the check, which allows the number
conversion it exists for and forbids the rest.

**There is no column width left to measure, and that is the change.** SQLite's INTEGER is 64-bit
whatever the declared type says (`packages/db/src/schema/columns.ts` states it at
`smallCount`/`bigCount`), so nothing below the converters bounds a money value at all. The bound the
system states is twelve integer digits — 99999999999999 cents, `MAX_MONEY_INTEGER_DIGITS`, enforced
by `assertMoney` and by `packages/catalogue`'s price validators — and it is now the only thing
enforcing anything. That figure is well inside the 9007199254740991 a JavaScript number counts
exactly, so nothing in range loses a cent to the number type.

**Kept as the dated PostgreSQL receipt that chose eight bytes**, run 2026-09-20 against the
development PostgreSQL container `waitron-db-1` (`show server_version` reported 18.6), with a control
in both directions:

```
docker exec waitron-db-1 psql -U postgres -Atc "select 2147483647::integer"
# 2147483647          (exit 0)
docker exec waitron-db-1 psql -U postgres -Atc "select 2147483648::integer"
# ERROR:  integer out of range   (exit 1)
```

As cents a four-byte column stopped at 21,474,836.47, which left a band of amounts the converters
accepted and the column refused with a bare `22003`. That band is what turned a catalogue projection
test red while money was being moved into whole cents (#475); the test itself went with the old
modifier model in Task 13, so the receipt was the two `psql` lines above rather than a file. No money
column is stored in PostgreSQL any more, so nothing can raise that refusal, and the band is enforced
only by the converters — the point the paragraph above makes. The `psql` above will not run against
anything the dev stack starts either: `docker-compose.yml` declares mailpit and nothing else.

**HISTORICAL, PostgreSQL only, and the reason the raw-read rule below exists: an uncast `bigint`
COLUMN read differently on the two test targets, and a `::text` cast made them agree.** Measured
2026-09-20, when there were two targets, over a table `probe(amount bigint not null, dec
numeric(12, 2) not null)` holding (1234, 6.75) and (2147483648, 6.75).

**What the instrument could see mattered, so it is named rather than summarised.** The probe was a
node script printing `typeof` beside every value, run through two clients: this repository's own `pg`
(8.23.0) against the development container `waitron-db-1`, where `show server_version` reported 18.6,
and the `@electric-sql/pglite` 0.5.8 JavaScript API. It could not be `psql`: psql renders every value
as text, so no psql output can tell a driver returning a JavaScript string from one returning a
number.

| expression | `pg` 8.23 / PostgreSQL 18.6 | PGlite 0.5.8 |
| --- | --- | --- |
| `select amount::text` | `"1234"`, a string | `"1234"`, a string |
| `sum(amount)::text` | `"2147484882"`, a string | `"2147484882"`, a string |
| `coalesce(sum(amount), 0)::text` over no rows | `"0"`, a string | `"0"`, a string |
| `sum(round(dec, 0))::text` | `"14"`, a string | `"14"`, a string |
| `select amount` — CONTROL, no cast | `"1234"`, a STRING | `1234`, a NUMBER |
| `select sum(amount)` — CONTROL, no cast | `"2147484882"`, a string | `"2147484882"`, a string |
| `sum(dec)::text` — CONTROL, unrounded | `"13.50"`, a string | `"13.50"`, a string |

The uncast COLUMN was the control that made the rest of the table mean anything: without a cast the
two engines really did differ, so a raw money read a PGlite suite passed on a number arrived as a
string against the real server. The uncast AGGREGATE narrowed that rather than widening it — `sum()`
over a `bigint` is a `numeric`, which BOTH drivers rendered as a string, so the disagreement was
about the int8 column and not about raw reads in general. The remaining rows are the cases a reader
would reasonably worry about: an empty aggregate, which gave `"0"` rather than a null or an empty
string; a rounded `numeric`, which gave `"14"` with no decimal point; and the unrounded `numeric`
sum, which keeps its scale in the text and is what a dropped `round(…, 0)` would look like. Nothing
in this repository sets an int8 type parser (`grep -rn "setTypeParser"` over `packages`, `apps`,
`scripts` and `deploy` still returns nothing, 2026-09-22), so the difference in the control row was
the driver's default and not something we chose.

**There is one driver and one target now**, so none of that is a live disagreement to guard against.
What survives it is the habit: a raw read is untyped at both ends, and the cast is what decides the
JavaScript type the value arrives as.

Drizzle's typed `.select()` needs no cast at all: the column maps the value, and the read mapping is
now the ONLY thing separating helpers that emit the same SQL type — `money`, `quantity`, `count` and
`flag` are all `integer`. The pin is `gives flag a boolean where every other integer helper gives a
number` in `packages/db/src/schema/columns.test.ts`, which is the one case that can tell them apart
at all; nothing distinguishes `money` from `quantity` there, because nothing in the column does.
Those call sites hand the number straight to `centsToDecimal`.

**Raw SQL is not safe, and a raw read that produces an AMOUNT casts to text.** A raw money read — a
`tx.execute`, or a `sql` fragment inside a select list, both untyped at each end — whose value becomes
an amount wraps the expression in `cast(<expr> as text)` and passes the string to `rawCentsToDecimal`
(`packages/shared/src/cents.ts`), which checks the shape, refuses anything past a safe integer with
`shared.invalid_cents`, and returns the exact `Decimal`. Product source obeys it —
`packages/reporting/src/cash-up.ts`, `top-sellers.ts`, `input-vat.ts` and
`packages/core/src/list-outstanding-sales.ts` among them. **Only the spelling changed**: this engine
has no `::` cast operator at all. Measured 2026-09-22 on Node v26.7.0, `select count(*)::int` is
`unrecognized token: ":"`, errcode 1.

**A test asserting the stored COUNT is not reading an amount, and several cast to int.** The shape is
`select cast(unit_price_gross as int) as unit_price_gross` followed by
`expect(...).toEqual([{ unit_price_gross: 325 }])` (`apps/server/src/working-order.test.ts`);
`till-api.test.ts` and `till-api.transfer.test.ts` carry the same shape. Nothing converts, so there
is no amount to get wrong, and the cast is there only to give the assertion a number.

**That cast used to fail LOUDLY and now refuses nothing, and the direction is the whole point.** On
PostgreSQL `::int` raised `22003` over 2147483647 cents, so a test that outgrew four bytes went red
rather than wrong — which is why it was chosen. `cast(x as int)` on SQLite raises nothing at all: the
declared type carries no width. What keeps these assertions safe is only that their literals are
small, and `apps/server/src/till-api.test.ts` says so at its own call site. A test that converts an
amount is a different thing and casts to text like production:
`apps/server/scripts/demo-seed/seed-sales.test.ts` is the live example.

**What the compiler could not see.** Three classes, each found by hand and each worth re-checking
whenever a money column is added:

- The hundredfold hazard, which is real on any engine: a raw read that renders a money count as a
  DECIMAL rather than as a count hands back a plausible string a hundred times too LARGE — a stored
  7734 cents is €77.34 and renders as `"7734.00"`, which a consumer reads as €7734.00. The direction
  is worth getting right: too large is a bill a hundred times the price, not a rounding slip. The
  PostgreSQL spelling that did it, `::numeric(12, 2)::text`, will not even parse here, so what to
  watch for now is any raw read handing a count to a consumer expecting an amount. That sentence is written
  once, in `rawCentsToDecimal`'s doc comment (`packages/shared/src/cents.ts`) — the near-duplicates
  that had grown beside the converted call sites were deleted in favour of a pointer to it, so
  `grep -rn "hundred times" packages apps --include='*.ts' | grep -v '\.test\.ts'` returns that one
  line; `packages/core`, `packages/reporting` and `apps/server` each carried one or more of the
  deleted duplicates. **What was actually run:** in `core` and
  `reporting` the old cast was restored and tests went red, recorded as nineteen of twenty-seven in
  `reporting` and five in `core`. What those two figures count is not written down anywhere, so read
  them as "the control fired in both packages" and not as per-cast coverage. `apps/server`'s two —
  the held-order list and the table-state query, both in `apps/server/src/working-order.ts` — were
  converted without being put through that control at all.
- Raw-SQL inserts, where the storage switch made things WORSE rather than better: **nothing is
  refused any more, in any form.** Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, against a plain
  `integer` column, by bound parameter and by raw SQL alike — `25.00` and `"25.00"` each store the
  integer 25, `"21.50"` stores the REAL 21.5, and `"abc"` stores the text `abc`. Not one of the four
  raised anything. On PostgreSQL a QUOTED decimal at least failed loudly with `22P02`; that half of
  the old rule is gone, and a bare whole number still succeeds and still means cents. One instance was
  found and corrected while money was moving to cents: a fixture inserting `('cash_only', 50)` into
  `payment_policy` had meant an offline cap of fifty euros and silently became fifty cents. It reads
  `('cash_only', 5000)` today — `apps/server/src/configuration-transfer.test.ts:320`. Whether that was
  the only one in the tree is not established; what was run was a hand sweep, not a check anything
  re-runs.
- Money held as strings inside a JSON document — `sales.vat_breakdown` and the hashed
  `daily_closes.snapshot`. Both are above the line and stay decimal strings, so a reader applying the
  cents rule to them would break working code. **The grouping and the summing moved out of SQL
  altogether**, because this engine has no exact decimal type and summing filed cuotas in SQL would
  sum them as binary floating point. `packages/reporting/src/vat-summary.ts` reads one row per
  breakdown ELEMENT and folds them with `@waitron/shared`'s Decimal arithmetic at the money scale,
  which is exact by construction; its own header records the whole-query comparison against PGlite
  and the two controls that break it.

  What that costs belongs in this list, and the file states it: `::numeric(12, 2)` REFUSED an element
  past ten integer digits with a `22003` and `::numeric(5, 2)` refused a rate past three, and neither
  refusal survives — an out-of-range filed amount is summed now rather than rejected.
  `packages/fiscal-verifactu/src/monetary-columns.test.ts` states the twelve-TOTAL-digits against
  twelve-INTEGER-digits split in its own comment but does not hold it down: it neither imports
  `assertMoney` nor reads `MAX_MONEY_INTEGER_DIGITS`, and what it would catch is those two fiscal
  columns ceasing to be `text`. The bound itself is pinned in `packages/shared/src/money.test.ts`.

**Every document written before 2026-09-20 that states a money column as `numeric(12, 2)`
describes the old storage.** There are dozens, nearly all dated plans and specs recording what was
true when written; they were not rewritten.

The documents corrected in place are named here rather than described as a class, because the
class was not swept: `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`'s
conventions block, `docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md` and
`docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` where they tell a future
session what a money column is or what a package contains, and this file plus `CLAUDE.md` §3,
which carry the rule.

**Other dated plans still state the retired type, including ones that instruct.** Two that a
reader will meet: `docs/superpowers/plans/2026-08-30-ordering-modifiers.md:24` still opens its
conventions block with "Money is GROSS (VAT-inclusive) `numeric(12,2)`", and
`docs/superpowers/plans/2026-08-29-dashboard-sales-takings.md` — around sixty of its steps still
unchecked — states `line_total numeric(12,2)` at line 130 and
`sum(sl.line_total)::numeric(12, 2)::text as total` at line 189. They were left as the records
they are. The rule for the class is stated once, here and in `CLAUDE.md` §3, rather than by
editing each plan; a session picking one of those up reads this section first.

A second pass on 2026-09-20 did the same for source comments that still named the retired column
type in `apps/till` (`src/api/client.ts`, `src/state/working-order.ts`) and
`apps/server/scripts` (`demo-seed/menu.ts`) — the same sentence restated somewhere the first sweep
did not look. `till-demo.ts` is in this branch for the cast, not for that sweep: it never named the
column type (`git grep -n numeric HEAD~1 -- apps/server/scripts/till-demo.ts` returns nothing).

> **2026-09-22:** `till-demo.ts` was deleted, with `catalogue-demo.ts`, `integrated-card-demo.ts`
> and `park-retrieve-demo.ts`, when the storage swap left them reading a connection string that no
> longer exists. The paragraph above records what the 2026-09-20 sweep found; the file it names is
> gone.

**The migration rounded, and that was deliberate.** `ALTER COLUMN ... SET DATA TYPE bigint` cast an
existing decimal by rounding, so a development database holding rows ended up holding whole euros. No
data-migration code is allowed before production, so the generated migration was left unedited and a
box needed `wa-wt reset demo <name>`. _Dated 2026-09-20._ The SQLite flip (F1) regenerated every set,
and there is no `ALTER COLUMN ... SET DATA TYPE` left anywhere in the tree, so this describes a
migration that no longer exists.

## A quantity counts whole thousandths and a rate whole basis points, and neither is the money scale

Task P6, 2026-09-21. Seven columns followed money out of `numeric`: two quantities
(`working_order_lines.quantity`, `sale_lines.quantity`) and five rates (`vat_rate` twice,
`purchase_invoices.deductible_proportion`, `purchase_invoice_vat.rate`,
`convenio_config.night_premium_pct`).

**Why they are not cents.** A quantity carries three decimal places and the money scale holds two,
so one conversion cannot serve both. Five grams — `0.005` kg — is the count 5 at the quantity scale
and the count 1 at the money scale, because `decimalToCents` ROUNDS that third place half away from
zero rather than dropping it: `decimalToCents(decimal("0.005"))` returns 1, measured 2026-09-21. An
earlier draft of this paragraph said it returned 0, which is why the measurement is written down —
the shared conversion nobody wrote would not have refused anything or emptied the line, it would
have returned a number five times too small. That is the whole reason the scales
are separate, and it is the second case in `packages/shared/src/scales.test.ts`; the
`the two scales do not share a conversion` case reads
one literal, `"21.00"`, in both scales and gets 21000 and 2100, so a caller reaching for the wrong
converter by autocomplete gets an answer that is wrong by a factor of ten rather than one that
looks plausible.

**Where the conversions live, and why not where the plan put them.** The plan said
`packages/db/src/schema/columns.ts`. They are `packages/shared/src/scales.ts`, beside
`packages/shared/src/cents.ts`, because that is where the money crossing went and where a reader
greps. `columns.ts` is the engine vocabulary; a conversion in it would be the second thing the
SQLite switch has to think about in the one file that exists so it only has to think about one.
The names follow `cents.ts`'s pair, not the plan's shorter ones, for the same reason.

**The bodies could not be written the way the plan sketched them.** `Number(value) * 1000`,
`Math.round` and `.toFixed(3)` are all float operations, and
`packages/shared/src/conventions.test.ts` reads this family of files as text and fails on every one
of them. The rounding is `toScale`'s, in BigInt, half away from zero — which is also the rule the
decimal columns applied on the way in, so the conversion is exact rather than close. The guard was
extended to `scales.ts` and proved by deletion: a `Math.round` added to the file turns
`contains no Math.round` red.

**The two widths differed, and choosing them was not decoration — but no width survived the flip.**
`numeric(12, 3)` admitted 999999999.999, which is 999999999999 thousandths, past `integer`'s
2147483647, so `quantity` was declared `bigint`; `numeric(5, 2)` admitted 999.99, which is 99999
basis points, so `rate` was `integer`. Both are `integer()` in `packages/db/src/schema/columns.ts`
today and both emit plain `integer`, because SQLite's INTEGER is 64-bit whatever the declared type
says. What is left of the widths is the digit bounds in the converters, which is the next paragraph.

**Each decimal column's bound moved into the converter.** `numeric(12, 3)` refused a quantity past
nine integer digits with a `22003` and `numeric(5, 2)` refused a rate past three; an integer column
takes both silently. `MAX_QUANTITY_INTEGER_DIGITS` and `MAX_RATE_INTEGER_DIGITS` are where those
refusals live now. The raw readers carry the same bound, which is what `top-sellers.ts`'s old
`sum(sl.quantity)::numeric(12, 3)::text` cast was enforcing.

**A rate's CHECK constraint does not follow the column.** Four of them compared a rate against 100.
`ALTER COLUMN ... SET DATA TYPE` keeps a check and CASTS it, so left alone every one of them would
have refused every rate above one percent. Changing their SQL text in the schema made drizzle
generate the DROP/ADD itself — unlike P5, where the checks' text did not change and drizzle
therefore saw nothing. The two QUANTITY checks are P5's case exactly: `quantity <> 0` reads the
same in either scale, so drizzle generated nothing and PostgreSQL kept
`((quantity)::numeric <> (0)::numeric)`. Both were named by the core set's schema-conformance
suite, which builds a database from the migrations and compares every check expression with the
schema's, and both were rebuilt by hand in the core set's hand-written migration
0048_scaled_integers_sql. At that point the suite covered the CORE set only and the module sets had
nothing equivalent, which is the same asymmetry P5 recorded.

_Dated 2026-09-21, the SQLite flip (F1)._ That migration file no longer exists: the flip regenerated
every set as ONE baseline, so the whole core history — the hand-written custom migrations included —
was replaced. The file is named above without a backticked path deliberately, because
`scripts/claude-md-pointers.test.ts` reads a backticked path under `packages/` as a live pointer and
would fail on a deleted one. What survives the deletion is the measurement, not the file. The
MECHANISM behind it does not survive either: there is no `ALTER COLUMN ... SET DATA TYPE` in a single
baseline, so a check constraint has nothing to be carried across and cast by. Read this paragraph as
the reason the guard exists, not as a description of the tree.

_Dated 2026-09-23._ Both facts about the guard in that paragraph have since changed, and it is left
as the record of what was true when the work was done. The comparing machinery is no longer in
`packages/db/src/schema/schema-conformance.test.ts` — that file is a short call site now — and it is
no longer core-only. It lives in `packages/db/src/testing/schema-conformance.ts` as a suite factory
that any migration set can call, and when this note was written `catalogue`, `payments`, `workforce`
and `workforce-es` did. Which sets have a call site now is `ls
packages/*/src/schema/schema-conformance.test.ts`; a set with none is still unguarded.

**Three ways a raw-SQL site can be wrong, and NONE of them is loud any more.** Measured on
PostgreSQL in 2026-09-21 only the first was loud; the storage switch took that one too. The readings
behind the change are in the money rule's raw-insert bullet above, re-taken 2026-09-22 on
`node:sqlite`, Node v26.7.0.

1. A QUOTED literal with a fractional part used to fail: `'21.00'` into an `integer` column gave
   `22P02`, `invalid input syntax for type integer`, routine `pg_strtoint32_safe`. It fails at
   nothing now — `"21.50"` is simply stored as the REAL 21.5.
2. An UNQUOTED numeric literal never failed. `25.00` into an `integer` column took PostgreSQL's
   assignment cast and stored 25 — a hundredfold wrong, nothing red — and it stores 25 here too.
   Found in `packages/workforce-es/src/convenio.test.ts`, where the test PASSED before the conversion
   because the reader was unconverted too and the two errors cancelled. CLAUDE.md §1's
   "a measurement taken where both answers look alike", with a green suite attached.
3. A value whose text is already a whole number is accepted silently in either form and means a
   thousandth of what the author meant: a quantity sent as `'2'` stores 2, which is 0.002 units.
   Seen in `packages/core`'s pre-fix failure dump.

**The migration rounded, exactly as P5's did, and which of two bad outcomes a development database
got turned on whether it held a small quantity.** `ALTER COLUMN ... SET DATA TYPE` cast each existing
decimal by rounding with no scaling `USING` expression — none was allowed, because no data-migration
code may exist before production. Measured on PostgreSQL 18.6 against populated old-type tables,
2026-09-21: any quantity below half a unit rounded to `0` and tripped `quantity <> 0` with a `23514`
(`0.320::numeric(12,3)::bigint` and `0.499` are both `0`, `0.500` is `1`), which errored the whole
`ALTER` and left the database un-migrated; and without such a row it succeeded quietly with every
value wrong — a quantity of `1.500` became `2`, reading back as 0.002 units, and a rate of `21.00`
became `21`, reading back as 0.21%, both inside the rebuilt CHECK constraints. Either way a box
needed `wa-wt reset demo <name>`.

_Dated 2026-09-21, and folded under the F1 note above._ There is no `ALTER COLUMN ... SET DATA TYPE`
in the tree, so there is no migration left for this to describe — only the reason the guard exists. A
box a demo command had already written a small quantity into is still in whatever state it reached.

**A column-level codec was weighed and not taken.** Drizzle's `customType` with `toDriver`/`fromDriver`
would put each crossing in `columns.ts` once and leave every typed `.select()` and `.values()` call
site handling decimal strings unchanged — roughly twenty-five hand-written conversions that would not
exist. It was not taken, for the reason *Where the conversions live, and why not where the plan put them*
gives above: `columns.ts` is the
one file the SQLite switch has to think about, and a conversion living in it is a second thing to
think about there. The helpers would still be `scales.ts`; only the crossing would move. The raw-SQL
readers would be needed either way. Recorded here rather than left as a silent default, because the
cost is now paid twice (money and these two scales) and a third scale would pay it again.

So a green run is not evidence that every raw-SQL site was found. They were found by grep, and the
sites that stayed green got more attention than the ones that went red.

**What the byte-identical fiscal gate does and does not establish.**
`packages/fiscal-verifactu/src/money-conversion.huella.test.ts` passed against the same literals,
which is the gate this task was required to clear. Read it narrowly: the breakdown a sale files is
built by `buildVatBreakdown` from the sale's own `RecordSaleLine.vatRate`, a domain value, and
never from a stored row — traced through `record-sale.ts`, `record-correction.ts` and
`record-substitution.ts`, each of which calls it on `input.lines`. So on the converted tree the
rate reaching the fiscal record does not cross the storage boundary at all. The gate would have
caught a conversion placed ABOVE the row; it cannot see one placed below it.

**A guard got quietly weaker and had to be shored up.** With `quantity` and `rate` converted, the
vocabulary stopped importing `numeric` at all — and `scripts/column-vocabulary.test.ts` DERIVES its
forbidden set from the vocabulary's own import block, so `numeric` would have become legal in every
table file on the same day it stopped being used in any. The guard now carries a hand-written
`RETIRED` set beside the derived one, holding `numeric`. That list GROWS as builders retire, where
the `ALLOWED` list only shrinks. It still cannot cover a builder the vocabulary never imported —
`bigserial` is the standing example.

**The module set was probed rather than grepped**, and the probe itself is dated PostgreSQL work.
The schema-conformance suite covered the CORE set only then, and P5's nine stale objects were all
found by applying the migrations and reading the catalogue back. The one module set this task
touched is `workforce-es`. Probed 2026-09-21 by applying `CORE_MIGRATIONS` then
`WORKFORCE_ES_MIGRATIONS` and querying `information_schema.columns` and `pg_get_constraintdef` over
`convenio_config`:
`night_premium_pct` was `integer` with a null default, `split_shift_premium` was `bigint` from P5,
and not one of the nineteen constraints on the table named either column. So there was nothing to
re-derive there — established by running it, not by reading the migration.

**Neither half of that probe can be re-run**, and the two columns read differently now. SQLite has no
`information_schema` and no `pg_get_constraintdef`; and
`packages/workforce-es/src/schema/convenio-config.ts` declares `nightPremiumPct` with `rate(…)` and
`splitShiftPremium` with `money(…)`, both of which emit plain `integer`. What stands is the method:
probe a module set, do not grep it.

_Dated 2026-09-23._ Those two paragraphs are the record of a hand probe, and they stay as written.
By the date of this note, four module sets no longer needed one (`ls
packages/*/src/schema/schema-conformance.test.ts` gives the current list) — `catalogue`, `payments`,
`workforce` and `workforce-es` each call the shared schema-conformance suite factory
(`packages/db/src/testing/schema-conformance.ts`) from a
`packages/<pkg>/src/schema/schema-conformance.test.ts` of their own, so for those four the method is
a suite that runs with the package's own tests rather than something to remember to do (which pushes
run which packages is CI's scoping question, and is in ci-and-gates.md). For a set with no call site
the paragraphs above still describe the only option, minus the two PostgreSQL readers: the SQLite
equivalents are `pragma table_info` and the CREATE statement SQLite stores verbatim in
`sqlite_master.sql`, which is what the factory reads.

**What the conversion did NOT touch.** The pricer, `assertQuantityPrecision`, the purchasing
validators, every receipt and ticket formatter, the HTTP contract, `apps/till` and `apps/dashboard`.
All of them work in decimal strings and all of them still do.

### The database never rounds a quantity — the converter owns the third place

`packages/catalogue`'s precision guard — the `rejects excess precision before anything downstream
can round it` case in `packages/catalogue/src/units.operations.test.ts` — used to hold a
`select 1.2345::numeric(12,3)::text` probe beside `decimalToThousandths`, as a control that SQL and
the converter rounded the same tie the same way, both to `1.235`. The storage switch retired the
probe: this engine has no exact decimal type, so there is no value the line can be rewritten to
that still says what it was there to say. Run on 2026-09-22:

```
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); const q = (s) => JSON.stringify(db.prepare('select ' + s + ' as v').get().v); console.log(q('round(1.2345, 3)'), q('cast(1.2345 as numeric(12,3))'), q(\"printf('%.3f', 1.2345)\"), q('round(1.2355, 3)'));"
```

On Node v26.7.0 that prints `1.234 1.2345 "1.234" 1.236`. So `round` takes the tie DOWN where
PostgreSQL's `numeric` took it up; a cast's declared scale is ignored entirely, because SQLite's
`numeric(12,3)` is a type name carrying NUMERIC affinity and no scale; and the fourth reading is
the control in the other direction — `round(1.2355, 3)` going up says this is binary float
representation rather than "SQLite always rounds down".

The probe was deleted rather than rewritten, because a quantity column holds a whole count of
thousandths and `decimalToThousandths` has already decided the third place before any value reaches
storage. A test asking SQL to round a quantity asks about something no product path does. The
converter's own rounding is still pinned, by the `rounds a fourth decimal place half away from
zero` case in `packages/shared/src/scales.test.ts`. The case's other two assertions —
`decimalToThousandths(decimal("1.2345"))` is `1235`, and `assertQuantityPrecision` throwing
`quantity.invalid` — are its actual subject and are untouched.

## A new table is classified `ledger`, `state` or `local` (swap design §2.1) in its module's `<MODULE>_CLASSIFICATION` list via `classify()` (`@waitron/sync-enrolment`), and a table that must never be corrected is declared with `appendOnly()` instead

**`ENABLE ALWAYS` and its guard are both gone — task F1 step group 6, 2026-09-21.** Everything from
here down to the paragraph headed *2026-09-21, task F1 step group 6* is the history behind that, not
a description of the tree; the live account starts there.

A replication apply worker skips ordinary triggers, and a copy of a corrupted row is exactly what
those triggers exist to refuse: that is what the flag bought on PostgreSQL. It was kept for a while
after the PostgreSQL replication that motivated it was removed on 2026-09-19, for the plain reason
that the tree still stored everything in PostgreSQL — the flag was a live setting on a live trigger,
and its guard still ran on every push.

Do not read that as a prediction about the replacement — the design this branch points at says the
opposite. `docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md` lists `ENABLE
ALWAYS` triggers in §8.1, *Deleted* — the subsection of §8, *What the repo deletes, keeps, adds* —
giving as the reason "the follower is our own restore, not a replication apply worker"; §4 states the
mechanism behind that — "a mirror is not a database that receives rows. It is a place the stream
lands, plus optionally a follower that keeps a local read-only copy warm". What §8.2 KEEPS is the
classification, "now also choosing the file". So the CLASS carries into the replacement and the flag
does not, and §8.1 sends their guards the same two ways: it names `append-only-enable-always` among
the guards it deletes alongside the flag. That was a statement about the storage switch rather than about the
day it was written, when both halves were still guarded on every non-docs push. Only the CLASS is
guarded now: the live guards are `scripts/append-only-triggers.test.ts` and
`scripts/classification-complete.test.ts`, with `scripts/two-file-foreign-keys.test.ts` beside them,
and nothing guards a flag that no longer exists.

**2026-09-21, task F1 step group 6: everything above the line is now history, and it went the way
§8.1 said.** The flag and its guard are both deleted. `ENABLE ALWAYS` was a PostgreSQL trigger state
and SQLite has no equivalent, so the thing the flag protected — an apply worker copying a corrupted
row past an ordinary trigger — has no path left to take. The enforcement is no longer written into
each migration by hand: `installAppendOnlyTriggers` (`packages/store/src/append-only.ts`) puts a
`RAISE(ABORT)` trigger pair on each named table, and `applyMigrations`
(`packages/migrations/src/apply.ts`) calls it after each set migrates, so boot
(`apps/server/src/boot.ts`), the cold restore (`apps/server/src/restore.ts`) and `rejoin-command` all
install them. `waitron-provision instance` is NOT one of them any more: the instance-provisioning
path went with the PostgreSQL deployment model on 2026-09-22, and the `venue` command that survives
it migrates nothing — no non-test file under `packages/provisioning/src` calls `applyMigrations` at
all (the one caller left there is `schema-ahead.migrate.test.ts`, which migrates its own fixture).
The two dev scripts, `apps/server/scripts/dev-setup.ts` and `apps/server/scripts/dev-onboard.ts`,
are converted: each calls `applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null))`, so
each installs the triggers the way everything else does. The five demo scripts beside them
(`allergens-demo.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`,
`recipes-demo.ts`) call it the same way with their own set list.

**2026-09-22: the names do NOT come from the `ledger` class, and for one step group they were
going to.** The first design said "every table the modules classify `ledger`", and the guard that
stood here asserted exactly that — against a database it migrated and then installed the triggers
on itself, so it proved the installer and never the product. Nothing in the product called the
installer at all, which is why the mismatch stayed invisible. Measured when the wiring went in: with
the trigger set taken from the class, nine tables came back refusing an update and a delete that
ordinary product code performs — `payments` (nine call sites in `packages/payments/src/store.ts`,
a card payment's row moving through its states), `cadenas` and `registro_sif`
(`packages/fiscal-verifactu`), `ticket_items` (`apps/server/src/working-order.ts`),
`daily_close_chain`, `purchase_invoices`, `purchase_invoice_vat`, `workforce_chains` and `envios` —
and `order_amendments` came back with no trigger at all, although PostgreSQL's hand-written
`reject_mutation()` triggers DID protect it, because it is classified `state`. The class is wrong in
both directions.

So the declaration is its own marker: `appendOnly(table, class, reason)` beside `classify()` in
`@waitron/sync-enrolment`, read by `orderedMigrationSets` off the descriptor's `classification` seat
and carried to `applyMigrations` through `MigrationSet.appendOnlyTables`. The set it names is the
set PostgreSQL protected, table for table — `sales`, `sale_lines`, `tenders`, `sale_settlements`,
`sale_voids`, `sale_substitutions`, `daily_closes`, `order_amendments`, `registros_facturacion`,
`time_entries` — read out of `origin/main`'s six trigger-carrying baselines with
`grep -oiE "BEFORE (UPDATE OR DELETE|DELETE OR UPDATE) ON ..."` before anything was written. The
cost of the class-derived version was never paid in production because the installer was never
wired; it would have been paid by the first card capture after the flip.

Three things about the replacement that a reader should not have to re-derive:

- **`PRAGMA recursive_triggers` is not optional.** SQLite's default is off, and with it off the
  delete that `INSERT OR REPLACE` performs internally does not fire a `BEFORE DELETE` trigger, so
  that one statement rewrites a ledger row and nothing is raised. Plain `UPDATE`, plain `DELETE` and
  `INSERT … ON CONFLICT DO UPDATE` are refused either way — which is the trap, because a suite that
  omits the replace case passes while the hole is open. Measured 2026-09-21 on Node v26.7.0 by
  turning the pragma off in `packages/store/src/append-only.test.ts` and re-running: exactly one
  case of nine went red, the replace one. The store sets the pragma in `openConnection`
  (`packages/store/src/index.ts`), beside `foreign_keys`.
- **`DROP TABLE` is not refusable.** SQLite has no trigger event for it, and no `TRUNCATE` statement
  at all, so the truncate-blocking trigger each append-only table carried on PostgreSQL has no
  equivalent and was not replaced. A caller that can issue DDL can drop a ledger table.
- **A row trigger needs a row.** SQLite's only trigger granularity is `FOR EACH ROW`, so an `UPDATE`
  or `DELETE` against an EMPTY ledger table succeeds and changes nothing whether the triggers exist
  or not. Any test of this has to seed a row first; the root guard does, and states it.

No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner
decision 2026-09-05). Two root guards enforce the classification on every non-docs push:
`scripts/classification-complete.test.ts` (every table in every module's `drizzle/` is classified
exactly once) and `scripts/append-only-triggers.test.ts` (every declared table refuses a plain
`UPDATE` and a plain `DELETE`, tried against a database `applyMigrations` migrated — the product's
own entry point, not one the guard builds and protects itself). The second is narrower than its name
in two ways it states itself: it covers those two statement shapes only, because the other two need
a conflicting key, which is per-table — those are proven once against the trigger pair in
`packages/store/src/append-only.test.ts`; and it drives the DESCRIPTOR path, leaving the
manifest-JSON path that `rejoin-command`, `dev-setup` and `dev-onboard` take to
`packages/composition/src/composition.test.ts`'s `toEqual` of the two, plus
`packages/migrations/src/apply-append-only.test.ts`, which runs it end to end. It also PINS the set
by name rather than counting it, so adding or dropping an append-only table costs a deliberate edit.
Run both after adding any table anywhere.

## The class also chooses the database FILE, so no foreign key may join a `local` table to a `ledger`/`state` one

The storage switch keeps every `local` table in `node.db` and the rest in `venue.db` (topology design
§2.1), which is what lets a standby hold an exact copy of the venue without overwriting who it is. A
key across the two files stops either being restored on its own, in either direction. Guard:
`scripts/two-file-foreign-keys.test.ts`.

**What it reads, and the two things it therefore cannot see.** It reads drizzle's own generated head
snapshot for each migration set — `meta/_journal.json` names the head and `tables[*].foreignKeys[*]`
holds the graph — so a key declared in TypeScript but not yet generated is invisible to it, and so is
one added by hand-written migration SQL, because a custom migration leaves the snapshot alone. Both
gaps are stated in the guard's own header with the date they were last compared. The reading was
chosen over the TypeScript deliberately: a reading taken from the TypeScript passes the moment
somebody edits a table file, while the constraint is still live in every migrated database, and it
would have gone silently vacuous at the flip, when `PgTable` stops matching anything.

**How the six that existed were resolved (task P7, 2026-09-19).** All six were a `local` row naming a
venue row by id — a person, a till, a location — so neither of the two routes §2.1 named applied: an
id is the payload, not a value that can be copied elsewhere. The constraint was dropped and the column
kept, with what now establishes the id's target named at the column. Five take their id from a row the
request had already read. The sixth, `join_requests.location_id`, is the node's configured location: it
is checked by nothing when the row is written, and its refusal moved to accept, where the accepted row
(`devices` or `print_agents`) still holds a key to `locations`. Never weaken a classification to make
this guard pass — that is the one wrong answer §2.1 rules out.

HISTORICAL, kept for the mechanism it records: while `ledger`/`state` tables were PUBLISHED for
PostgreSQL logical replication (removed 2026-09-19), such a table also needed a PRIMARY KEY, not a
bare UNIQUE constraint. A published table with no replica identity accepts INSERTs and refuses UPDATEs, with
`ERROR: 55000: cannot update table "t" because it does not have a replica identity and publishes
updates`. Reproduced on a real PostgreSQL server on 2026-09-13 — `create table t (a int, b int,
unique (a, b)); create publication p for table t; insert; update` gives the error above, and the same
sequence with `primary key (a, b)` instead reports `UPDATE 1`. Cost: `product_units` shipped with only
a unique `(tenant_id, product_id)`, so creating a product worked and changing its unit answered 500;
the table now carries a primary key. It was created by the catalogue set's migration
0000_catalogue_baseline, a file the SQLite flip (F1) deleted on 2026-09-21 when it regenerated every
set as one baseline — named here without a backticked path for that reason. The primary key itself is
declared in the schema and is in the regenerated baseline.
No guard covers this. The defect passed every existing test because no test published the table;
one was written that did, and **the SQLite flip deleted it on 2026-09-21** — SQLite has neither
publications nor a replication identity, so there is no statement left to make and nothing to
reproduce. The reasoning above records what was true on PostgreSQL. A per-table check would have to
read each module's `_CLASSIFICATION` list against its schema file's primary keys.

## A migration set depends on another through a foreign key, a trigger on its table, or a trigger body naming its table

FK `REFERENCES`, and a `CREATE TRIGGER … ON <table>` where the TABLE is owned by a different
migration set. Both exist in the tree today, but the second kind is no longer spelled the way it was.
It used to be `EXECUTE FUNCTION <f>` with `<f>` owned by another set — the `reject_mutation()` case —
and none of that survives: `grep -rni reject_mutation packages --include='*.sql'` returns nothing,
because append-only refusals are not written into migrations at all now
(`installAppendOnlyTriggers` puts them on at runtime).

The live instance of the trigger edge is `packages/media`. Its
`drizzle/0001_image_references.sql` carries eight triggers standing in for two foreign keys, and four
of them sit on tables another set owns: `products`, created by core in
`packages/db/drizzle/0000_baseline.sql` and rebuilt by core's
`0003_variant_inherited_nullable.sql`, and `category_details`, created by catalogue. Both are
declared — media's descriptor reads `requires: { core: "*", modules: { catalogue: "*" } }`
(`packages/media/src/module.ts`) — which is what the guard checks; the guard's job is the case where
such an edge is NOT declared. Core's own triggers, in its migration files under
`packages/db/drizzle/`, sit on core tables and name only core tables, and so are not edges at all.
The live-update triggers are installed at boot and sit outside this migration-text guard; their
behaviour is exercised by `packages/db/src/change-feed.test.ts`.

**A core rebuild of a table that another set's trigger BODY names applies fresh and fails on an
upgrade; a trigger ON the rebuilt table is dropped with it, silently.** Core's
`0003_variant_inherited_nullable.sql` rebuilds `products`. On a fresh database core migrates before
media creates its triggers, and the whole chain applies. On a venue `main` had already migrated, the
core set aborted at the rebuild's final rename of `__new_products` to `products` with
`error in trigger products_media_image_fk_parent_delete: no such table: main.products` — a trigger
on `media_images` whose body reads `products` — and rolled back: afterwards core's journal still held
its two earlier rows and `products` had no `parent_id` (measured 2026-09-23 through
`applyMigrations`: every set's folders at `5bc04408e`, then `feat/variants-parent-id`'s). The two
shapes separated, measured 2026-09-23 on `node:sqlite` (Node v26.7.0) with the same
create-copy-drop-rename sequence inside `begin`: a trigger ON `products` raised nothing and was gone
afterwards, while a trigger on another table whose body reads `products` failed the rename with
`error in trigger t_body: no such table: main.products`. What that means for venues is in
`docs/backlog.md`, Track A, the paragraph opening **Task 1 (`feat/variants-parent-id`)**.

**A drizzle table rebuild runs with foreign keys ON, so its `DROP TABLE` acts on every row that
points at the table.** Drizzle rebuilds a SQLite table to change a column's nullability, with the
sequence `PRAGMA foreign_keys=OFF`, create `__new_<table>`, copy the rows, `DROP TABLE <table>`,
rename, `PRAGMA foreign_keys=ON`. SQLite ignores `PRAGMA foreign_keys` inside an open transaction,
and the migrator runs each set inside one. Measured 2026-09-23 on `node:sqlite` (Node v26.7.0), with
that sequence on a parent holding one row and a child holding one row that points at it: inside
`begin … commit`, an `ON DELETE CASCADE` child went from 1 row to 0 with no error, while a child
with no `ON DELETE` action, and separately one with `ON DELETE RESTRICT`, failed the drop itself with
`FOREIGN KEY constraint failed`. The control, the same sequence outside a transaction, kept the
child row in all three cases and raised nothing. Two rebuilds in
the variants plan hit it. Task 1's rebuild of `products` (core's
`packages/db/drizzle/0003_variant_inherited_nullable.sql`) cascade-deleted `product_categories` on a
venue without the media triggers (the plan,
`docs/superpowers/plans/2026-09-23-variants-as-products.md`, the section "Task 1 cannot upgrade an
existing venue"). Task 4's rebuild of `menu_items`
(`packages/catalogue/drizzle/0003_menu_price_nullable.sql`), measured 2026-09-23 through
`applyMigrations`, emptied `menu_item_extra_lists`, `menu_item_extra_items` and
`menu_item_variant_overrides` while reporting success, and failed with
`FOREIGN KEY constraint failed` when a `working_line_contexts` row named the offer. A paid order
keeps such a row (measured 2026-09-23: after a completed walk-up cash sale from a menu offer, its
`working_line_contexts` row was still there on a `settled` order), so that failure is any venue that
has sold from a menu. Today this costs
nothing beyond a reset, while the rule of no data-migration code until production stands. Once a
venue is live, a rebuild has to carry the child rows across by hand.

`scripts/module-graph-honesty.test.ts` derives both edge kinds from the SQL text, and says so. **Two
hedges from its own header belong here, because a failing test can never restore them.** The
`EXECUTE (FUNCTION|PROCEDURE)` detector was DELETED as dead syntax — SQLite has no functions, so
`CREATE FUNCTION` and `FOR EACH ROW EXECUTE FUNCTION f()` are both syntax errors on it. And a SQLite
trigger's BODY is read by nothing: a trigger carries statements between `BEGIN` and `END`, and an
`INSERT INTO` or a `SELECT … FROM` naming another module's table in there — media's triggers on
`media_images` read `products` and `category_details` that way — is a real cross-module edge that
NEITHER remaining detector sees. That edge is uncovered today, and the engine does not catch it
either. Measured 2026-09-23 on `node:sqlite` (Node v26.7.0): a trigger whose body reads or writes a
table that does not exist is created without complaint, and the insert that fires it fails with
`no such table: main.<name>`; create the table and the same insert succeeds. The control in the
other direction: a trigger ON a missing table is refused when it is created. So a missing
dependency of this shape surfaces only when the trigger first fires.

**Transactions**

## Multi-table writes share ONE transaction, and `withTransaction` IS that transaction

(`packages/db/src/tenancy.ts`). Write-path functions take a `tx: Transaction` and never open their
own; a route handler opens exactly one `withTransaction` per request (`recordSale`'s header says why —
`packages/core/src/record-sale.ts`). A convention, not a compiler guarantee: `Database` is assignable
to `Transaction`, and an ESLint backstop was declined (2026-09-03). **Splitting one logical change
across transactions is a commented decision, never a default** — the two that do it
(`provisionVenue`'s latch, `adoptFromPrimary`'s idempotent steps) say so in their headers because a
non-DB step sits between the writes.

Queries sharing one transaction are awaited one at a time, never started together with
`Promise.all`. The MECHANISM changed with the engine; the rule did not. On this one there is nothing
to overlap in the first place: the driver is synchronous — `execute` hands back its rows rather than
a promise of them (`packages/store/src/node-sqlite-adapter.ts`) — and a venue file takes one write
transaction at a time, because `withTransaction` runs its body inside `db.withWriteLock`
(`packages/db/src/tenancy.ts`, `packages/store/src/write-queue.ts`). So `Promise.all` over a
transaction's queries buys nothing and hides the order the statements really run in. **No timing has
been taken on this engine**, and none is claimed here.

HISTORICAL, PostgreSQL: a transaction held one connection and the driver queued a second query on it
until the first finished, so starting them together saved nothing. Measured with `pg@8.22.0` against
`postgres:18-alpine` on 2026-09-14: two 200 ms `pg_sleep` queries took 426 ms through one client
under `Promise.all` and 214 ms through two clients (Codex measured 411 ms and 203 ms on the same
branch). That driver also warned _"Calling client.query() when the client is already executing a
query is deprecated and will be removed in pg@9.0"_, printing for three queries started together and
not for two, because it fired only when a query was already waiting behind the running one.
`computeDailyClose` (`packages/reporting/src/daily-close.ts`) started three this way until
2026-09-14.

**No test or guard enforces this rule anywhere.** The `fireLines` single-call test and the
preparation-route read-count test count calls and queries; neither can tell whether queries overlap.
The missing guard is a Track C item in `docs/backlog.md`.

## A read taken while ANOTHER caller's write transaction is open sees committed rows only

The store opens two connections per database file: the single writer, and a reader opened
`readOnly: true` beside it (`packages/store/src/index.ts` → `openReadConnection`). A statement goes
to the reader only while one of the store's own transactions is running AND the caller's
asynchronous context is outside THAT transaction's body — `packages/store/src/connections.ts` →
`forStatement`. A read written inside the body still sees the body's own rows, which is what a
transaction is for.

Two refinements the first implementation did not have, each with its own control below. The window
spans the whole transaction, `commit` and `rollback` included, not the body alone. And each body
carries its own TOKEN rather than a shared mark, because asynchronous context is inherited and never
expires.

**What it fixed.** The flip landed one connection per file and recorded the consequence rather than
hiding it: measured 2026-09-21 on Node v26.7.0, with a second connection to the same file as the
control, a read issued while the write lock held a transaction open returned that transaction's
rows — including a row a rollback then removed — where the second connection returned committed
rows only. A second connection is what node-postgres's pool used to hand a reader, so this was a
behaviour CHANGE and not something SQLite forces. It is reachable rather than theoretical: the
write queue holds the lock across the body's awaits, so the event loop serves other requests inside
that window.

**Why the rule counts the store's own bodies instead of asking the engine.**
`DatabaseSync.isTransaction` is the engine's own truth about whether a transaction is open, and
keying the routing on it reads as equivalent. It is not. Drizzle's migrator opens and closes its
transaction by RUNNING `begin`, `commit` and `rollback` as ordinary statements through the session,
never through the transaction shim, so every statement between them routed to the read-only
connection: the writes were refused errcode 8 and re-run on the writer, but `rollback` there is
refused `cannot rollback - no transaction is active`, errcode 1 — not the read-only refusal, so
nothing could route it back. Measured on the branch that built this: 54 of `packages/db`'s 65 test
files failed that way on 2026-09-23 — a reading of that day's tree, not a standing count — and the
case is now pinned as `keeps to the writer for a transaction opened as an ordinary statement`.

**Three exposures left open deliberately**, all recorded in `docs/backlog.md`. A transaction opened
by running `begin` is not one the store is told about, so a read concurrent with it still lands on
the writer and sees its rows. A write issued from outside a running body while one is open is
refused by the reader and re-run on the writer, where it joins that transaction and commits or rolls
back with it — which is what one connection did, and nothing refuses it. And `readOnly: true`
refuses a write to the database FILE rather than every write: measured 2026-09-23 on Node v26.7.0, a
`create temp table` succeeds on such a connection, because SQLite keeps a temporary table outside
that file.

**Two things the review wave found by RUNNING, and both were real.** The window first closed when a
transaction's BODY settled rather than when the transaction itself finished — the queue issues its
`rollback` after the body, and a handler registered on the body's own promise runs in that gap and
read the writer's still-uncommitted rows. And the asynchronous context first carried a plain "inside
a body" mark, which never expires, so a callback detached inside one transaction and settling during
a LATER one was read as inside that later one. Each is now a case in
`packages/store/src/index.test.ts`, and each fails when its fix is reverted.

The window fix is marked in TWO files, and it took a case each to pin them, because reverting one
alone left the other's case green. Narrowing the window in `packages/store/src/write-queue.ts` back
to the body alone reddens `sends a read registered on the write lock's body promise to the reader`;
narrowing it in `packages/store/src/node-sqlite-adapter.ts`, which marks a transaction taken
directly rather than through the lock, reddens
`sends a read registered on a direct transaction's body promise to the reader` — measured by
reverting that file alone, which fails that case on `expected [ { id: 1 } ] to deeply equal []` and
passes restored. The never-expiring mark is pinned separately: replacing the per-body identity set
in `packages/store/src/connections.ts` with a plain inside-a-body flag reddens the detached-callback
cases in `index.test.ts` and `connections.test.ts`.

**The routing cases are not all controls, and the set is weaker than its name.** Deleting the
routing outright — `forStatement` replaced by `return write;`, so every statement goes to the writer
— leaves `serves a read routed to the reader on a file with no tables in it` green: that case passes
whichever connection serves it, so it is a smoke test over the read path rather than evidence about
where a statement lands. Re-run that mutation before treating any single case in these files as a
control; what the other cases in the set catch is not what this one catches.

## A refused statement does NOT abort the transaction here, and the savepoints that remain confine a losing attempt's own writes

**The direction reversed with the engine, and this is the sentence in the file most worth getting
right.** PostgreSQL would not let a transaction continue once it had refused a statement: everything
sent afterwards failed with `25P02`, and the `COMMIT` at the end was carried out as a rollback. SQLite
does not do that. Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, inside one `begin immediate`: a
duplicate primary key (errcode 1555), a null in a `not null` column (1299) and a trigger's
`RAISE(ABORT)` (1811) were each caught and the next statement ran normally, and at `commit` the rows
written before AND after every refusal were all present while the refused rows were not.
`bench/sqlite-failover/README.md` records the same codes from its own probe, plus 2067 for a
two-column `UNIQUE`.

**So the savepoints in the tree are there for a different reason now, and each says so at its site.**
`enqueueSuccessor` (`packages/scheduler/src/store.ts`), `appendToChain`
(`packages/fiscal-verifactu/src/chain.ts`) and `insertClose`
(`packages/reporting/src/record-daily-close.ts`) wrap a statement that may be refused in a nested
`tx.transaction(...)`, which the adapter emits as `savepoint` / `release` / `rollback to` whenever a
transaction is already open (`packages/store/src/node-sqlite-adapter.ts` — SQLite refuses a `begin`
inside a `begin`). What that buys is CONFINEMENT: a losing attempt's own partial writes are backed
out with it rather than left for the enclosing transaction to commit.

HISTORICAL, PostgreSQL, and the cost that put the savepoints there in the first place. Measured on
PostgreSQL 18.6 (`postgres:18-alpine`, 2026-09-21): in one transaction, an insert into a second table
and then a duplicate key on a primary key; the next statement answered `ERROR: current transaction is
aborted, commands ignored until end of transaction block`, `COMMIT` printed `ROLLBACK`, and the second
table held 0 rows afterwards — the control being the same sequence without the duplicate key, which
left 1 row. `enqueueSuccessor` caught the duplicate key a lost race produces and returned `false`,
with no savepoint. Its only caller writes the run completion first and enqueues second on the same
transaction — `completeRun` at `packages/scheduler/src/run.ts:217`, `enqueueSuccessor` at `:231` — so
the completion was already written when the abort happened, and it went away when the transaction
committed as a rollback. The run stayed `running` with a `started_at` that never cleared, which is
the state another runner reclaims as stale once it is older than `staleAfterMs` (one hour by default,
`DEFAULTS` in `packages/scheduler/src/derive.ts`). Nothing raised an error at any point. The guard is
the loser's second enqueue in `packages/scheduler/src/store.concurrency.test.ts`.

Since 2026-09-21 `withTransaction` ends every transaction with a drain of `change_log`
(`packages/db/src/tenancy.ts`). On PostgreSQL that made the mistake above at least loud, because a
transaction that had already aborted failed on the drain rather than committing quietly as a
rollback. On this engine the drain is there for the change feed alone.

**The test corollary, and its REASON is gone.** A test for a refusal caught it around the whole
`withTransaction` call and never inside the callback, because inside, the expectation itself ran in
an aborted transaction. That reason is retired by the measurement above. Two test files had it the
other way round and were changed by hand on the branch that added the drain
(`packages/purchasing/src/operations.test.ts` and `packages/db/src/schema/join-requests.test.ts`);
they were not changed back, and no guard reads for the shape either way. Whether catching inside the
callback is now harmless has NOT been established, so the outside-the-call shape is still the one to
copy — as a habit whose receipt has expired, not as a rule with one.

## A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is NOT the query's isolation boundary

> **Superseded 2026-09-14.** There is no tenant column to compare against any more: the taxpayer is
> the one row in `tenants` (`id = 1`), and nothing filters by a tenant. Spec:
> `docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md`. The rest of this section is kept as
> the record of why the rule existed; the probe it describes cannot be written any more, because a
> second taxpayer row cannot be inserted. What survives it is the habit, not the clause: only the
> seat that RAN a probe found the defect four reading passes had cleared.

Since RLS was dropped (#255) `withTenant` no longer isolates SELECTs, so every read scopes to the
tenant itself — a by-id read as much as a list read, never trusting a globally-unique UUID or the
deployment invariant. Cost: `getHeldOrder`/`abandonHeldOrder` keyed on the `working_orders.id` UUID
alone, so tenant A could read AND abandon tenant B's order in a multi-tenant DB (till-reroute S3). The
per-task review and four quality lenses all reasoned it "safe under one-tenant-per-db"; only the
run-it seat, which RAN a two-tenant probe as `app_user` (rolsuper=f), caught it — reading missed it,
running caught it (§1, §4).

## No backwards-compatibility or data-migration code until Waitron is in production

Nothing is deployed; schema changes drop and recreate. A backfill for an empty database is code to
maintain that buys nothing — and the first draft of the settlement design carried one that could only
ever GUESS which tender a tip belonged to, which is worse than discarding. This rule expires the day a
real venue is live; add its replacement in the same change.

## An empty value is a valid value (first met as: an empty connection string is a valid connection string)

`new Client({ connectionString: "" })` resolved to localhost with every default (`pg@8.23.0`), so an
empty string was never "no value given". **No reader of a connection string is left** — the storage
switch took the last two with it on 2026-09-22, `waitron-provision instance` with the PostgreSQL
deployment model and then `venue`'s own admin string when that command was repointed at a venue
directory. The rule is kept because the SHAPE outlived the driver.

The SQLite shape, and the same one-line answer: a path variable that is unset OR empty falls back to
its default through `isUnset` (`apps/server/src/env-value.ts`) and never through `resolve("")`,
which is the process's working directory. `apps/server/src/config.ts` states it at `stateDir`,
`venueDir` and `logDir`. The refusal shape is the other half, for a reader with no default to fall
back to: `resolveVenueDir` (`packages/provisioning/src/cli.ts`) takes `--venue-dir`, then
`WAITRON_VENUE_DIR`, then a prompt, and throws `provisioning.venue_dir_missing` when all three give
nothing — because every path the store builds is `join(directory, …)`, so an empty directory is the
RELATIVE `venue.db` rather than no directory at all.

**Migrations**

## A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the snapshots or `_journal.json`

At the paused rebase, reset the migrations dir to main's exact state
(`git checkout origin/main -- packages/db/drizzle/`; keep the branch's `src/schema/*.ts`), then
`pnpm --filter @waitron/db db:generate --name <foo>` (and `db:generate:custom --name <foo>_sql`,
pasting back any hand-written SQL you saved first — a regeneration DROPS it, which is exactly how
core's nine behavioural triggers and media's two image foreign keys were lost at the flip; both
replacement files record it in their own headers). Stage only your migrations, `rebase --continue`,
and verify by RUNNING `scripts/append-only-triggers.test.ts` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`. Paid for on #165.

The justification this used to carry — "works because the snapshot chain deliberately lags the DB,
custom migrations being snapshot-less" — is not something this tree bears out, and it has not been
re-taken since the storage switch: the two hand-written `--custom` migrations in the tree each carry
their own `meta/000N_snapshot.json`, and each differs from the one before it. Treat the procedure as
the receipt rather than the explanation.

## Drizzle picks what to apply from `max(created_at)` alone

Never from a position in the journal file, so an entry whose `when` sits AT OR BELOW one the database
already recorded never runs, and DRIZZLE raises nothing — it applies part of a set and returns
cleanly. The dialect that runs is `sqlite-core`: in `drizzle-orm@0.45.2/sqlite-core/dialect.js`,
`SQLiteSyncDialect.migrate` takes the watermark with
`SELECT id, hash, created_at FROM <table> ORDER BY created_at DESC LIMIT 1` at lines 653-655 and
applies a migration only when
`!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis` at line 660, so an EQUAL
value is skipped too; `SQLiteAsyncDialect.migrate` carries the same two statements at 690-692 and
696. Those line numbers are copied from `scripts/journal-monotonic.test.ts` rather than re-derived,
which is also where they are kept current.

**Waitron no longer exits 0 on that**: `applyMigrations` counts the journal afterwards and throws
`migrations.incomplete` (next entry). The two error registries — `packages/migrations/src/errors.ts`
and `packages/provisioning/src/errors.ts` — point at `CLAUDE.md` §3, and so here, instead of
repeating the citation. That is where the pointer stops: the citation is still restated under
`packages/`, `scripts/`, `apps/` and `docs/` — `git ls-files | xargs grep -ln 'dialect.js'` finds
every copy, one of them inside a migration `.sql` file — and nothing enforces the pointer, so a
drizzle bump starts with that grep and fixes each one by hand.

**The core journal's contradictory shape went with the history that had it.** A database at core
release point 2 and one at release point 3 both carried entry 1's `when` as their watermark, because
entry 2's RECORDED value sat below it: point 2 needed entry 2's `when` ABOVE that watermark or `0002`
was skipped, while point 3 needed it AT OR BELOW or `0002` re-applied — contradictory for any single
value, so a database at core release points 1–6 could not reach HEAD at all. Found only while
investigating the 2026-09-10 bricked box. The flip regenerated the sets, so neither that history nor
a database carrying it exists, and `KNOWN_NON_MONOTONIC` in the guard is EMPTY on purpose — empty
being the strong state rather than an unfinished one.

Guard: `scripts/journal-monotonic.test.ts`, and what it can prove today is worth knowing. A ONE-entry
journal cannot be out of order, so a per-set case over one such set is true by construction and is not
evidence that any `when` in the tree is right; most sets are in that state. The sets that carry more
than one entry are the ones whose case compares something — `packages/db`, `packages/identity` and
`packages/media` when counted on 2026-09-23; count again rather than trusting that list. What is really
exercised is `outOfOrder` itself, pinned by a synthetic negative control, plus the anti-vacuity anchor
that every journal is on disk. The tree-scanning half becomes a real check again at the first
`drizzle-kit generate` after a baseline, which is why it is in place now rather than written
afterwards.

## `applyMigrations` refuses to report success on a short set

It compares the journal rows a set recorded against the entries the image ships and throws
`migrations.incomplete` when fewer applied, so a boot against an old release point fails loudly
instead of serving a half-migrated schema. Cost: a database at the core set's entry 1 reached HEAD
with 10 of 15 applied and no error, and the wrong schema surfaced later as an unclassified driver
failure. Pointer: `packages/migrations/src/apply-complete.test.ts`.

**Provisioning and boot**

## The box's BOOT path carries an ahead-of-image check; no other migrating path does, and `waitron.sh install <ref>` is a one-way door

`assertNotAhead` (`@waitron/provisioning`) compares the database's journal hashes against the image's
files and throws `provisioning.database_ahead`; there is no backward migration, so installing an
older ref after a newer one has already migrated the database can fail to boot with this error.
`waitron.sh`'s advice on that failure depends on the box: on one that is not stamped production,
`waitron.sh reset` wipes the database and is the clean way back to a working box; on a production box
the script refuses to suggest that (a reset there would destroy the fiscal chain) and says to install
a newer ref instead (`docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md` §3 step 6,
§4.1). Its only caller anywhere is `apps/server/src/node-entry.ts` (`grep -rn assertNotAhead` before
believing otherwise), and WHERE it sits changed with the storage switch. It used to run after
`ensureInstance`, which had already migrated a behind database forward; `ensureInstance` no longer
exists. It now runs after `runStagedRestore` — the restore that replaces the venue files — and BEFORE
`startServer`, so it reads a database nothing has migrated yet, because boot owns the migration now
(`apps/server/src/boot.ts`). The ordering, and the one-direction comparison that lets a virgin venue
directory pass it, are stated at `runEntry` in `apps/server/src/node-entry.ts`.

The GAP, stated so nobody assumes coverage: BOOT is the only migrating path carrying the check, and
every other caller of `applyMigrations` runs without one. Re-grepped 2026-09-22, those callers are
the cold restore taken from the `waitron-restore` CLI (`apps/server/src/restore-command.ts`, which
calls `apps/server/src/restore.ts`), `apps/server/src/rejoin-command.ts`,
`apps/server/src/fiscal-readiness-runner.ts`, and seven scripts under `apps/server/scripts` —
`dev-setup.ts`, `dev-onboard.ts` and the five demo scripts. An ahead database reached through any of
them is still undetected. A restore staged
at BOOT is the one case that IS covered, because the check runs after it. The `instance` command
headed this list until 2026-09-22 and no longer exists. Cost: without the check, an ahead database
re-migrates CLEANLY — drizzle applies nothing and throws nothing (measured with a control,
2026-09-10) — so the mismatch showed up only as an unclassified driver error in whatever query first
touched the changed schema. Pointer:
`docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md` §4.2/§4.5/§9.

## A configuration route checks the tenant returned by `authorizeManager`, as well as scoping its queries

> **Superseded 2026-09-14.** `authorizeManager` returns `{ authorizedBy, role }` and no tenant, and
> there is no configured tenant to compare it with — one database, one taxpayer. Spec:
> `docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md`. The two regression cases named below
> were deleted with the column. What the route still scopes its queries by is the deployed LOCATION
> — `apps/server/src/location-settings-api.ts` filters on `eq(locations.id, deps.cfg.locationId)` —
> a separate boundary this change did not touch.

The permission check returns the session's tenant; it does not compare it with the configured tenant.
A2's two-tenant route probe returned 200 for the other tenant's manager until the caller compared
them. Regression: `apps/server/src/location-settings-api.test.ts`, "refuses a manager session
belonging to another tenant". Printer routes enforce the same check; their regression is
`apps/server/src/print-api.printer-wiring.test.ts`, "refuses another tenant's manager…".

**Carried from the retired Copilot instructions file** (deleted 2026-09-12; read it with
`git show f5941462:.github/instructions/waitron.instructions.md`). What was checked before deleting it: Copilot's automatic review was removed from
this repo's ruleset on 2026-09-06, no workflow under `.github/workflows/` references the file, and
Claude does not load `.github/instructions/`. Not checked: whether anyone's IDE Copilot still reads
it — an `applyTo: "**"` instructions file would be picked up there.

## Two more packages are Spanish by design, and one guard runs on a different axis

`packages/reporting` (the modelo-303 form, Spain's VAT return) is Spanish by design, alongside
`packages/fiscal-verifactu` and `packages/workforce-es`. Since 2026-09-07 the
English-only guard (`scripts/english-only.test.ts`) scans comment prose as well as identifiers in
the generic packages, leaving only `«…»` quotes and backtick citations exempt.
`packages/fiscal/src/no-regime-vocabulary.test.ts` enforces a different axis — a domain's vocabulary
rather than a language. Its forbidden set is regime vocabulary in ANY language: English (`chain`,
`hash`, `fingerprint`) and Spanish alike (`huella`, `cadena`, `encadenamiento`, `registro`,
`incidencia`), plus the regime's proper nouns (`verifactu`, `ticketbai`, `sif`, `csv`, `aeat`). What
it refuses inside `packages/fiscal` is naming a regime mechanism at all, however it is spelled. It
strips comments first, so a comment citing AEAT is fine while `export const aeatEndpoint` fails.
Read the `FORBIDDEN` list in that file, not its header comment, which says "ENGLISH regime
vocabulary" and is wrong — half the list is Spanish. Measured 2026-09-12 on a copy of
`packages/fiscal/src`: planting `export const huellaValue = 1;` and `export const cadenaValue = 1;`
each turned the suite red. A PR introducing a Spanish
identifier into a generic package, a regime term in any language into `packages/fiscal`, one that adds a
module's word to the base list instead of the module's own declaration, or one that drops a generic
package from `GENERIC_PACKAGES` (and its pin) to make a scan pass, is a design question to raise,
not a nit to wave through.

## Schema-qualify helpers used by expression indexes — RETIRED

PostgreSQL only, and nothing it turned on survives: this engine has no schemas, no `search_path` and
no user-defined SQL functions at all. Kept as one dated sentence because the incident is worth
recognising if it recurs in another form. On 2026-09-12 a restore rebuilt an index with an empty
`search_path` and the populated-image restore failed with `media_text_config` missing, until the
media search functions named their schema as `public.media_text_config`. That function no longer
exists — `packages/media/src/images.ts` records what replaced it.

## Default optional input only when it is absent

The modifier contract tests rejected explicit null for availability, required, Boolean defaults,
price and preselection. `value ?? default` initially accepted those nulls, and comparing
`String(vatClass)` accepted an array such as `["general"]`. Defaults now use `undefined` explicitly,
and enum comparison follows a string type check.

That suite went with the old modifier model in Task 13, and the assertion was carried across rather
than dropped with it: `refuses an explicit null where a default is only taken on absence` exists in
both `packages/catalogue/src/extra-contract.test.ts` and
`packages/catalogue/src/option-contract.test.ts`. Neither is a test that merely passes — each was
proven by mutating the code it covers, widening `bool`/`flag`'s `value === undefined` to
`value == null` (and, in the extras file, the two `=== undefined ?` defaults beside it) and watching
exactly that case go red while the rest of the file stayed green.

**One field is deliberately outside the rule**, and a reader who takes the rule as universal will
get it wrong: an extras list's `maxPicks` accepts an explicit null, because there null is the VALUE
— it means uncapped — rather than a missing field (`row.maxPicks == null ? null : …`,
`packages/catalogue/src/extra-contract.ts`). That is pinned by its own case, `keeps an explicit null
maxPicks, because there null is the value`, so the exception cannot quietly spread.

## A missing unique target now fails at WRITE time, not at migrate time

**"Order new unique targets before their foreign keys" is retired as advice, and what replaces it is
not an ordering rule at all.** Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, with a control: a
table can be created naming a parent that does not exist yet, and the whole set applies clean. The
first INSERT into the child is then refused `foreign key mismatch - "child" referencing "parent"`,
errcode 1, and keeps being refused until a unique index over the parent's referenced columns exists —
the control being the same insert passing the moment that index is created. So the refusal moved from
migrate time to the first write, which is a worse place to find it. A generated set that references a
parent's unique target is checked by WRITING a row, never by watching the migration finish.

HISTORICAL, PostgreSQL, 2026-09-13. Products' generated catalogue migration created the
`menu_item_variants` foreign key before adding its `(tenant_id, id, product_id)` unique target to
`menu_items`, and PostgreSQL rejected the whole migration with `42830`; moving the generated
unique-constraint statement before the foreign key made it succeed, with the journal and snapshot
unchanged. (That target became `(id, product_id)` when the tenant column went, 2026-09-14.) The
receipt was `pnpm --filter @waitron/catalogue test src/variants.db.test.ts`, which exercised the
migration; the suite still exists, while the `TESTCONTAINERS_RYUK_DISABLED=true` prefix it ran under
does not — there is no Testcontainers PostgreSQL tier any more.
