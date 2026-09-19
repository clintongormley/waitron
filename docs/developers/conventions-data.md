# Conventions — data, migrations, grants and module boundaries

This file holds the evidence behind the data- and module-boundary conventions in the repo root
`CLAUDE.md` section 3: the mechanisms, measurements, SQLSTATEs, drizzle internals and the incidents
that paid for each rule. `CLAUDE.md` keeps the one-line version of each rule and points here for the
rest.

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
fails on a clash. `packages/verifactu` is an unlisted library (in no list, never scanned); `apps/*`
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

— `.`, `./testing/postgres.js`, `./testing/seed.js`, `./testing/lifecycle.js`,
`./testing/shared-container.js`. A wildcard would publish the whole harness and give `asAppUser` a
second import path. Consequence: `apps/server` cannot deep-import `packages/db`'s `errors.ts`.

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
calls `uuid(…)`, `timestamp(…)` or `numeric(…)` straight from `drizzle-orm/pg-core`. The point is
task F1: the SQLite switch replaces the bodies in that one file rather than every column declaration
in the tree (`docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`, task P1).

What it cost: fourteen pull requests, #393 through #414, most of them one package at a time. Each
conversion proved "no schema change" the same way — generate that package's migrations into a copy
of its migration folder, diff the copy against the real one, expect no difference. Two changed what a
CALLER is handed rather than what the database stores, both in the same direction: the hand-rolled
`bytea` block behind `print_jobs.payload` in `packages/db` (#396) and the three sealed columns in
`packages/credentials` (#413) typed their values as node `Buffer`s, where the shared `binary` helper
hands a `Uint8Array`. `packages/media`'s block already declared the `Uint8Array` shape, so converting
it changed nothing a caller sees.

Left alone deliberately: a `pgEnum` column. `enumText` emits `text`, so converting one is a real
schema change rather than a rename.

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
where its grants travel with it; a core-set addition is a deliberate exception and says why it is
not a module's. Same defect class as §1's unstated claims — an unexplained core table is a boundary
decision no future reader can audit.

**Writing SQL safely**

## Never build SQL by string concatenation — except for utility statements, which PostgreSQL will not bind

Drizzle's `` sql`… ${value}` `` parameterises (verified: `o'brien; drop table x --` round-trips
intact), but `CREATE ROLE … $1`, `CREATE DATABASE`, `GRANT` are syntax errors. For those, either
**escape** (`quoteIdent`/`quoteLiteral`, `packages/provisioning/src/identifiers.ts`) or **validate and
throw** (`probeRoleStatement`, `packages/db/src/testing/identifiers.ts`). Neither is not acceptable;
"the callers only pass safe values" is the §1 defect class.

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
(`packages/catalogue/src/extras.pg.test.ts`). It now deletes every one of the list's rows and
inserts the body's fresh, each under the id the body sent or a new one, which removes the
intermediate state rather than ordering around it.

That is safe under two conditions, and the second one is easy to miss. The FIRST is that nothing
outside the table holds a key into it, so the rows may lose their identity — and it is
`extra_list_items` that is being rewritten, so what matters is who references THAT table.
`grep -rn 'REFERENCES "public"."extra_l' --include='*.sql' packages apps` returned one line when
this was written and returns three now (2026-09-20): all three name `extra_lists`, the parent —
the items' own key, `menu_item_extra_lists`' key, and `product_modifiers`' key. None names
`extra_list_items`, so the condition still holds; the grep's count no longer stands on its own,
because it matches the parent's name as well. A table something else references cannot be
rewritten this way.

The SECOND is that two writers replacing the same set must be serialised. That condition is about
the WRITE, not about row identity, and the grep says nothing about it: the second transaction's
`delete` cannot see the first's uncommitted inserts, so it removes nothing, and its own inserts then
meet the first's committed rows on `(list_id, product_id)`. That `23505` leaves `writeItems` as a
drizzle `Failed query:` error carrying no `code` of its own, which the server's error boundary
answers as an opaque 500 rather than as a domain refusal. `updateExtraList` and `deleteExtraList`
now take a `select … for update` on the `extra_lists` row first, so two saves of one list run one
after the other. That is a ROW lock, not an advisory lock: spec §7 bars advisory locks from new code
and does not reach it, and `lockProduct` in `packages/catalogue/src/variants.ts` already takes the
same shape on a product row.

The lock made explicit something the code was already doing by accident, which is why the test for
it needed a control. `updateExtraList` updates the list's own row before it calls `writeItems`, and
an `UPDATE` takes that row's lock, so the two saves were already serialised — `keeps the later of
two overlapping saves of the same list` (`packages/catalogue/src/extras.pg.test.ts`) passed on the
code as it stood. Removing the accident is what measured it: with the lock absent AND that `update`
moved after `writeItems`, the test read `["saved", "23505"]`; with the lock restored and the
`update` still moved, both saves succeeded. So what the lock buys is that `writeItems` no longer
depends on an unrelated statement's position for its correctness.

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

**Grants and roles**

## Never widen a grant to make a test pass

`app_user` holds `SELECT` on `tenants` and not `INSERT` deliberately.

Four tables are in that shape, not one. Read on 2026-09-19 from
`packages/fiscal-verifactu/src/privileges.expected.ts`, the matrix whose own suite reads every
table's privileges back from the live catalogue, `app_user` holds `SELECT` and no write on
`tenants`, `nodes`, `deployment` and `mirror_config`. Asked of the database rather than the file, in
PGlite against the core migrations inside a transaction that had called `asAppUser`: an insert and
an update of `tenants`, an insert of `nodes`, an update of `deployment` and a delete from
`mirror_config` each came back

```
42501 permission denied for table <name>
```

while `select 1 from tenants` in the same shape was allowed.

Real code does write all four — the setup-mode provision and adopt routes, the boot adoption worker
and demote, the promote path, the break-glass mint, the fiscal-readiness runner and the
`waitron-provision` command line. None of them serves the write on the connection the request
arrived on, which is why PostgreSQL does not refuse them, but they do not all reach the database the
same way: most open a handle on `adminDatabaseUrl`, the boot adoption worker uses the separate
`migrationsDatabaseUrl` pool (`apps/server/src/boot.ts` insists on the distinction in capitals), the
command line assumes the migrator role explicitly, and the readiness runner opens no URL at all — it
writes into an in-process PGlite database. So the rule is about the role the connection wears, not
about being a request.

SQLite has no roles, so at the flip that refusal disappears. `scripts/write-path-tables.test.ts` is
the replacement, written while the grants still existed to check it against: it reads production
source text under `apps/<app>/src` and `packages/<package>/src` and fails when a file outside
`scripts/write-path-tables.json`'s allowance list writes one of the four. Its own header states four
ways it is weaker than "no write path touches a forbidden table", and the two paragraphs on its
comment reader and its detector state what each of those gives up in turn. What it does not cover at
all is what the grants refuse one operation at a time (`docs/backlog.md` → B9).

## A new table is classified `ledger`, `state` or `local` (swap design §2.1) in its module's `<MODULE>_CLASSIFICATION` list via `classify()` (`@waitron/sync-enrolment`), and an append-only table's `reject_mutation()` triggers are `ENABLE ALWAYS`

A replication apply worker skips ordinary triggers, and a copy of a corrupted row is exactly what
those triggers exist to refuse. `ENABLE ALWAYS` is kept although the PostgreSQL replication that
motivated it was removed on 2026-09-19, for the plain reason that the tree still stores everything in
PostgreSQL until the storage switch lands: the flag is a live setting on a live trigger, and its guard
still runs on every push.

Do not read that as a prediction about the replacement — the design this branch points at says the
opposite. `docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md` lists `ENABLE
ALWAYS` triggers in §8.1, *Deleted* — the subsection of §8, *What the repo deletes, keeps, adds* —
giving as the reason "the follower is our own restore, not a replication apply worker"; §4 states the
mechanism behind that — "a mirror is not a database that receives rows. It is a place the stream
lands, plus optionally a follower that keeps a local read-only copy warm". What §8.2 KEEPS is the
classification, "now also choosing the file". So the CLASS carries into the replacement and the flag
does not, and §8.1 sends their guards the same two ways: it names `append-only-enable-always` among
the guards it deletes alongside the flag. That is a statement about the storage switch and not about
today — both halves are guarded on every non-docs push right now, the flag by
`scripts/append-only-enable-always.test.ts` and the class by
`scripts/classification-complete.test.ts` and `scripts/two-file-foreign-keys.test.ts`.

No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner
decision 2026-09-05). Two root guards enforce this on every non-docs push:
`scripts/classification-complete.test.ts` (every table in every module's `drizzle/` is classified
exactly once) and `scripts/append-only-enable-always.test.ts` (every `reject_mutation` trigger is
`ENABLE ALWAYS`); `packages/fiscal-verifactu`'s `inmutabilidad` suite still scans the triggers
themselves. Run them after adding any table anywhere.

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
the table now carries a primary key, created by `packages/catalogue/drizzle/0000_catalogue_baseline.sql`.
No guard covers this: the defect passed every existing test because no test published the table
(`packages/catalogue/src/units.pg.test.ts` now creates the publication to reproduce it), and a
per-table check would have to read each module's `_CLASSIFICATION` list against its schema file's
primary keys.

## `waitron-provision instance` migrates AS the migrator, via a `role=` session option, never as a plain admin

The arrangement: `instance` creates the database `OWNER waitron_migrator`
(`packages/provisioning/src/instance-plan.ts` emits the `create-database` action with that owner, and
`packages/provisioning/src/instance-apply.ts` runs `create database … owner …`), runs the migrate over
a connection carrying `options=-c role=waitron_migrator`, and refuses a database owned by anyone else
(`provisioning.database_not_owned`). Every table the migrate creates is migrator-owned as a
CONSEQUENCE of those two choices, not as a separate step.

**The reason the migrator was chosen over the admin is gone, and nothing has replaced it.**
`git log -S "owner waitron_migrator"` names `e82588f3` (#280, 2026-09-08) as the commit that put the
clause into the `create database` statement; its two other hits are the S2 plan document and a
`packages/sync` test fixture, plus this branch's own deletion. That diff replaces a bare
`create database <name>` with the `owner` form, and the comment it adds gives the reason as logical
replication's `CREATE PUBLICATION … FOR TABLE`, which CLAUDE.md §3 records as owner-only. The same
commit deletes the two plan actions that had reached the same ability by grant —
`grant-database-create` and `grant-schema-create`, which before #280 handed the migrator CREATE on the
database and CREATE WITH GRANT OPTION on schema `public` while the ADMIN created the database, owned
it and ran the migrate (`git show e82588f3^:packages/provisioning/src/instance-plan.ts` for the
grants; the `case "migrate"` comment in
`git show e82588f3^:packages/provisioning/src/instance-apply.ts` for the admin — "Migrate with the
admin connection string … that admin just created the database and owns it"). So replication is
exactly why this changed. The failover deletion of 2026-09-19 (`8faa3033`) then took the last
`CREATE PUBLICATION` out of shipped code:
`grep -rniE "create (publication|subscription)" packages apps` now matches only test suites — two
real-PostgreSQL ones in `packages/db`, and `packages/catalogue/src/units.pg.test.ts`, which creates
its publication on its own container for the stated reason that "nothing in the tree does it today".

**What holds the arrangement in place today** — three things, none of them "it could not be otherwise":

- The refusal is a POLICY, not something PostgreSQL forces. `instance` does not try to re-own a
  database it finds; it refuses it (owner decision 2026-09-07, recorded at the refusal in
  `packages/provisioning/src/instance-plan.ts`). Do not restate that decision the way its own comment
  does — "ownership is fixed at CREATE" overstates it. Measured on PostgreSQL 18.6,
  `alter database probe_db owner to waitron_migrator` SUCCEEDS when the role running it owns the
  database and is a member of the target role, which is the shape of this tool's own admin on a
  database it created; the control, the same statement from a `createdb createrole` role that does
  NOT own the database, fails `must be owner of database probe_db`. The arrangement could be undone
  in place. Nobody has decided to.
- Ownership is how the migrator gets CREATE on the database and on schema `public`, which is why the
  plan carries no CREATE grant at all (`REQUIREMENTS` in
  `packages/provisioning/src/instance-plan.ts`; `packages/provisioning/src/instance-plan.test.ts`
  pins that a plan contains neither deleted action). The grant-based alternative is not hypothetical
  — it is what `apps/server/scripts/dev-setup.ts` does on the shared dev `postgres` database, which
  the migrator does not own.
- Callers depend on the consequence: on a migrator-owned `public` a plain admin connection is refused
  `CREATE TABLE` with `42501`, which is why any new provisioning path that creates schema carries
  `withRole(uri, waitron_migrator)` (`@waitron/provisioning`). Live receipt:
  `packages/provisioning/src/instance-apply.pg.test.ts`, "lets the migrator, but not a plain admin,
  write the migrator-owned schema (C5)" — it runs both halves against a real server and asserts
  `42501` for the admin. The message text, `permission denied for schema public`, was read off probe A
  in `docs/superpowers/plans/2026-09-07-outbox-swap-s4-s5-promotion-and-deletion.md`.

Two justifications that do NOT hold. The first was this section's own text until 2026-09-19: that
`42501` is not the reason for the ownership. The database being migrator-owned is a choice this tool
makes and the refusal is its consequence, so offering the refusal as the cause argues in a circle.
The second: saying the migrations issue their own grants from that ownership does not establish it
either — an admin that had created the tables would own them and could grant just as well, so that
sentence leaves out the part that makes it the migrator.

## A module/migration dependency graph has TWO kinds of cross-set edge

FK `REFERENCES` and a `CREATE [CONSTRAINT] TRIGGER … EXECUTE FUNCTION <f>` where `<f>` is owned by a
DIFFERENT migration set. Both exist in the tree today. The second kind is `reject_mutation`: the
`workforce` and `fiscal-verifactu` append-only tables install `reject_mutation()` triggers, and that
function is owned by `core` (`packages/db/drizzle`) — a cross-set trigger-function edge. It is
harmless because both modules already declare `requires.core`, which the "the function must exist
first" ordering needs anyway; the guard's job is to catch the case where such an edge is NOT declared.
The outbox's capture triggers, which enrolled OTHER modules' tables, were deleted with the application
outbox (swap S5). The generic live-update trigger is installed at boot and sits outside this
migration-text guard; its behavior is exercised by
`packages/db/src/change-feed-replication.pg.test.ts`. `scripts/module-graph-honesty.test.ts` derives
both edge kinds from the SQL text (reading text, and saying so): it now scans every
`EXECUTE (FUNCTION|PROCEDURE)` call, resolves the function's owner, and flags a cross-module one — so
the `reject_mutation` edges surface and any future undeclared edge is caught.

## An object-privilege `GRANT` PostgreSQL accepted is not a `GRANT` that did anything

Measured on PostgreSQL 18.4 from a non-owning `createdb createrole` admin: no privilege held →
`42501`; some privilege without grant option → `WARNING: no privileges were granted`, rc 0; grant
option on part of the list → `WARNING: not all privileges were granted` (and `GRANT ALL` suppresses
even that). `PUBLIC`'s default `CONNECT`/`TEMP` counts as "held", so the hard error is rarely reached.
Read the ACL back (`pg_database.datacl` / `pg_namespace.nspacl`): a failed `GRANT` still materialises
`datacl` from NULL, a grantee holds one entry PER GRANTOR, and `has_*` functions see grant options but
also count privileges held only through group membership — a false positive a provisioner must not
accept. Role-membership grants are different: they always ERROR. Cost: a Critical plus three fix
rounds on `feat/provisioning-instance`.

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
`Promise.all`. A transaction holds one connection, and the driver queues a second query on it until
the first finishes, so starting them together saves nothing. Measured with `pg@8.22.0` against
`postgres:18-alpine` on 2026-09-14: two 200 ms `pg_sleep` queries took 426 ms through one client
under `Promise.all` and 214 ms through two clients (Codex measured 411 ms and 203 ms on the same
branch). The installed driver also
warns: _"Calling client.query() when the client is already executing a query is deprecated and will
be removed in pg@9.0"_ (`node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/client.js:36`, and the
same text at line 36 of the `pg@8.22.0` that run used). In that run
the warning printed for three queries started together and not for two, because it fires only when
a query is already waiting behind the running one. `computeDailyClose`
(`packages/reporting/src/daily-close.ts`) started three this way until 2026-09-14.

**No test or guard enforces this rule anywhere.** The `fireLines` single-call test and the
preparation-route read-count test count calls and queries; neither can tell whether queries overlap.
The missing guard is a Track C item in `docs/backlog.md`.

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

## An empty connection string is a valid connection string

`new Client({ connectionString: "" })` resolves to localhost with every default (`pg@8.23.0`).
Anything reading a URL from env or a prompt refuses `""` explicitly (`isUnset`);
`waitron-provision instance` would otherwise have stamped whatever answered on localhost.

**Migrations**

## A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the snapshots or `_journal.json`

At the paused rebase, reset the migrations dir to main's exact state
(`git checkout origin/main -- packages/db/drizzle/`; keep the branch's `src/schema/*.ts`), then
`pnpm --filter @waitron/db db:generate --name <foo>` (and `db:generate:custom --name <foo>_sql`,
pasting back the triggers and grants you saved first), stage only your migrations,
`rebase --continue`, and verify by RUNNING the package's grant assertions and `privileges.test.ts`
plus `inmutabilidad`. Works because the snapshot chain deliberately lags the DB (custom migrations
are snapshot-less). Paid for on #165.

## Drizzle picks what to apply from `max(created_at)` alone

Never from a position in the journal file, so an entry whose `when` sits AT OR BELOW one the database
already recorded never runs, and DRIZZLE raises nothing — it applies part of a set and returns
cleanly (`drizzle-orm@0.45.2/pg-core/dialect.js:57` reads the watermark; `:62` applies only where
`recorded < candidate`, so an EQUAL value is skipped too). **Waitron no longer exits 0 on that**:
`applyMigrations` counts the journal afterwards and throws `migrations.incomplete` (next entry). The
two error registries this branch touched — `packages/migrations/src/errors.ts` and
`packages/provisioning/src/errors.ts` — point here instead of repeating the `dialect.js` citation.
That is where the pointer stops: the citation is still restated under `packages/`, `scripts/`,
`docs/` and `packages/provisioning/README.md`, and nothing enforces the pointer, so a drizzle bump
starts with `grep -rn 'dialect.js'` and fixes every copy by hand. The core journal is already in that
shape, and no edit repairs it: a database at release point 2 and one at release point 3 both carry
entry 1's `when` as their watermark, because entry 2's RECORDED value sits below it — so point 2 needs
entry 2's `when` ABOVE that watermark or `0002` is skipped, while point 3 needs it AT OR BELOW or
`0002` re-applies. Contradictory for any single value. Cost: a database at core release points 1–6
cannot reach HEAD at all — since `migrations.incomplete` the attempt fails LOUDLY rather than serving
a half-migrated schema, but it still fails; found only while investigating the 2026-09-10 bricked box.
Guard: `scripts/journal-monotonic.test.ts`.

## `applyMigrations` refuses to report success on a short set

It compares the journal rows a set recorded against the entries the image ships and throws
`migrations.incomplete` when fewer applied, so a boot against an old release point fails loudly
instead of serving a half-migrated schema. Cost: a database at the core set's entry 1 reached HEAD
with 10 of 15 applied and no error, and the wrong schema surfaced later as an unclassified driver
failure. Pointer: `packages/migrations/src/apply-complete.pg.test.ts`.

**Provisioning and boot**

## The box's BOOT path carries an ahead-of-image check; no other migrating path does, and `waitron.sh install <ref>` is a one-way door

`assertNotAhead` (`@waitron/provisioning`) compares the database's journal hashes against the image's
files and throws `provisioning.database_ahead`; there is no backward migration, so installing an
older ref after a newer one has already migrated the database can fail to boot with this error.
`waitron.sh`'s advice on that failure depends on the box: on one that is not stamped production,
`waitron.sh reset` wipes the database and is the clean way back to a working box; on a production box
the script refuses to suggest that (a reset there would destroy the fiscal chain) and says to install
a newer ref instead (`docs/superpowers/specs/2026-09-11-waitron-sh-box-command-design.md` §3 step 6,
§4.1). Its only caller anywhere is `apps/server/src/node-entry.ts`, which runs it after
`ensureInstance` and before `startServer` (`grep -rn assertNotAhead` before believing otherwise). The
GAP, stated so nobody assumes coverage: `waitron-provision instance`
(`packages/provisioning/src/instance-apply.ts`), the cold restore (`apps/server/src/restore.ts`),
`apps/server/src/rejoin-command.ts` and `apps/server/scripts/dev-setup.ts` each call `applyMigrations`
against a live database with no ahead check, so an ahead database reached through any of them is
still undetected. Cost: without the check, an ahead database re-migrates CLEANLY — drizzle applies
nothing and throws nothing (measured with a control, 2026-09-10) — so the mismatch showed up only as
an unclassified driver error in whatever query first touched the changed schema. Pointer:
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
them. Regression: `apps/server/src/location-settings-api.pg.test.ts`, "refuses a manager session
belonging to another tenant". Printer routes enforce the same check; their regression is
`apps/server/src/print-api.pg.test.ts`, "refuses another tenant's manager…".

**Carried from the retired Copilot instructions file** (deleted 2026-09-12; read it with
`git show f5941462:.github/instructions/waitron.instructions.md`). What was checked before deleting it: Copilot's automatic review was removed from
this repo's ruleset on 2026-09-06, no workflow under `.github/workflows/` references the file, and
Claude does not load `.github/instructions/`. Not checked: whether anyone's IDE Copilot still reads
it — an `applyTo: "**"` instructions file would be picked up there.

## `packages/verifactu` must never import another workspace package, `@waitron/ui` included

`packages/verifactu` (Spain's Veri\*Factu invoicing-compliance library — landed in `7938e1b`, see
`docs/superpowers/specs/2026-07-18-pos-architecture-design.md` §8) must never import from any other
`packages/*` or `apps/*` workspace package, including `@waitron/ui`. It exists to be
certified/audited in isolation; a dependency on another internal package would pull unrelated,
non-audited code inside that boundary. This is already enforced by an `import-x/no-restricted-paths`
zone in `eslint.config.js` scoped to `packages/verifactu/**/*.ts` — if a PR touching that package
needs to loosen or work around that rule, treat it as a design question to raise, not a lint config
nit to wave through.

## Two more packages are Spanish by design, and one guard runs on a different axis

`packages/reporting` (the modelo-303 form, Spain's VAT return) is Spanish by design, alongside
`packages/verifactu`, `packages/fiscal-verifactu` and `packages/workforce-es`. Since 2026-09-07 the
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

## Schema-qualify helpers used by expression indexes

Restore can rebuild an index with an empty `search_path`, so nested user-defined calls must name
their schema explicitly. The populated-image restore failed with `media_text_config` missing until
the media search functions called `public.media_text_config`. The real restore regression then
passed: `apps/server/src/restore-fiscal-e2e.test.ts`, “re-registers the SIF…”, with its command recorded
in [the image-library plan](../superpowers/plans/2026-09-12-image-library.md).

## Default optional input only when it is absent

The modifier contract tests rejected explicit null for availability, required, Boolean defaults,
price and preselection. `value ?? default` initially accepted those nulls, and comparing
`String(vatClass)` accepted an array such as `["general"]`. Defaults now use `undefined` explicitly,
and enum comparison follows a string type check. Receipt:
`packages/catalogue/src/modifier-contract.test.ts` (the adversarial cases failed before the fix).

## Order new unique targets before their foreign keys

When you generate a table that references a new unique constraint on an existing table, inspect the
statement order and run the migration. Products' generated catalogue migration created the
`menu_item_variants` foreign key before adding its `(tenant_id, id, product_id)` unique target to
`menu_items` (that target is `(id, product_id)` since the tenant column went, 2026-09-14; the
ordering rule is unchanged). PostgreSQL rejected the migration with `42830`. Moving the generated unique-constraint
statement before that foreign key made the real migration succeed; the journal and snapshot were
unchanged.

Receipt, 2026-09-13: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test
src/variants.pg.test.ts` exercised the migration, actual `app_user` writes and a publication/removal
race. The fiscal migration checks also passed with `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter
@waitron/fiscal-verifactu test src/privileges.test.ts src/inmutabilidad.test.ts`.
