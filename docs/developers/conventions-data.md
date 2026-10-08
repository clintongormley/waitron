# Conventions — data, migrations and module boundaries

This file holds the evidence behind the data- and module-boundary conventions in the repo root
`CLAUDE.md` section 3: the mechanisms, measurements, error codes, drizzle internals and the incidents
that paid for each rule. `CLAUDE.md` keeps the one-line version of each rule and points here for the
rest.

**A note on the error codes.** `node:sqlite` reports a numeric `errcode`. Measured 2026-09-22 on
Node v26.7.0, in one transaction: a duplicate primary key is 1555, a null in a `not null` column
1299, and a trigger's `RAISE(ABORT)` 1811. The tree spells it that way too
(`packages/db/src/sql-state.ts`).

**Naming and error codes**

## Error codes name the DOMAIN CONCEPT, never the throwing package

`series.not_found`, not `db.series_not_found` (design note atop `packages/shared/src/errors.ts`).
**Before a venue is live, a code may be renamed or deleted freely; once one is live, either is a
migration** (owner decision 2026-09-26, replacing "never renamed once shipped; deprecate and add a
sibling"). Either way it is one change in which every copy in the tree moves or goes. Grepping the
code finds the registry, the wording keyed
by it, the tests and the HTTP status maps. It does not find a consumer that matches a code by its
prefix — the alert area claims (`claimFor`, `apps/server/src/alerts.ts`), the setup wizard's
`provisioning.`/`fiscal.` routing (`apps/setup/src/setup-app.ts`),
`apps/server/src/rejoin-command.ts`'s `rejoin.` handling and `apps/server/src/restore-command.ts`'s
`restore.`/`recovery.`/`backup.` handling — so a rename that changes the prefix, or a deletion, is checked
against those too. It does not find the stored copies, because each store takes whatever code arrives: `incidents.code` (`packages/db/src/schema/incidents.ts`), `scheduled_runs.error_code`
(`packages/scheduler/src/schema/scheduled-runs.ts`), `print_jobs.last_error`
(`packages/db/src/schema/print-jobs.ts`), which also holds an agent's free-text report, and
`recovery.json`'s `lastErrorCode` (`apps/server/src/recovery-state.ts`). Before a venue is live they are not rewritten (CLAUDE.md
§3's no-data-migration rule); once one is live they are, and anything outside this repository that
reads the code accepts both names until both sides are deployed. Old log lines keep the old name. `server.*` is
reserved for facts about the process itself (`apps/server/src/errors.ts`). Every file that throws a
code imports its registry (`import "./errors.js"`); reachability is guarded once, in the root
project (§4).

## A refusal's HTTP status says what was wrong, by one rule for every API

The owner's rule (2026-10-08): the thing the request's path points at is missing → 404; something
the body (a form, a bundle, an import) refers to is missing or unusable → 400; a clash with stored
data → 409; a file or copy that cannot be opened → 422. So one code can rightly answer 404 on one
route and 400 on another: `service_zone.not_found` for `GET /api/service-zones/:zoneId/offers`,
and for a zone a body names. A boundary (`createErrorBoundary`,
`packages/server-kit/src/error-boundary.ts`) answers the status its table gives a code, and 400
for a code its table leaves out; a route that needs another status for one code gets a second
boundary over a spread of the table, as `runSize` in `apps/server/src/catalogue-api.ts` does.
On 2026-10-08 `git grep -E 'status (===|!==) ?[0-9]{3}'` over the client trees found three
status reads: the till's 403 check (`department-transfer-monitor.ts`), the setup app's 404 read as
"already set up" (`setup-app.ts`) and the menus screen's `!== 200`; refusals are told apart by
code. Nothing guards the rule. The routes that broke it on that date, and the follow-ups that fix
them: `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

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
review. Designed and built in #240.

**What the guard does not see.** `scripts/english-only.test.ts` is weaker than its name — it finds
comments without a parser, guessing from the code before a `/` whether it opens a regular
expression, and a wrong guess can hide a Spanish word in code on a later line.

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
`fiscal-none` could not land. Designed and built in #245. On the browser side
`@waitron/dashboard-modules` is the composition list's twin — the one place that names every
UI-bearing module (guarded by `module-seams` + `dashboard-browser-purity`), so `apps/dashboard`
mounts modules without naming one, exactly as generic provisioning does not.

**What the guard does not see.** `scripts/module-seams.test.ts` blanks comments then reads text; the
shared reader guesses whether `/` opens a regular expression, and import-like strings can still
match.

## A test-only dependency closes a workspace dependency loop as surely as a runtime one

pnpm counts `devDependencies` when it looks for a loop, and prints "There are cyclic workspace
dependencies" on every install. Two test-only links made one: `@waitron/migrations` listed twelve
modules to compare their journal table names with the manifest, while those modules used
`@waitron/migrations` in their own tests; and the replication suites in `@waitron/sync`
used `@waitron/provisioning`, which reached `@waitron/sync` again through `@waitron/composition`. The
journal-table test moved to `packages/composition/src/composition.test.ts`, and the replication suites
moved to a package nothing depends on. Receipt, 2026-09-13:
`scripts/workspace-cycles.test.ts` listed the ten-package loop before the move; on the finished tree
it passed, failed again when `@waitron/provisioning` was added back to `sync`'s `devDependencies`, and
`pnpm install` printed no loop warning.

The two packages named in that receipt — `@waitron/sync` and the replication-test package — were both
deleted on 2026-09-19, so the loop they closed no longer exists.
The RULE and the guard stand: any future test that needs packages from both ends of a loop needs the
same home.

The guard reads each member's `package.json` rather than asking pnpm for its graph, and counts every
dependency whose name is another workspace member.

## A command name is declared under `waitron.commands`, never `bin`

pnpm links a `bin` while it INSTALLS and skips one whose target is missing, and nothing here builds
at install time, so a `bin` under `dist/` is never linked by the install that reads it. Every CLI is
run by path anyway (`node /app/bin-restore.js` in the image). Cost: repeated `Failed to create bin`
warnings on every install, in every worktree and in the image build, plus an AEAT runbook whose
`pnpm --filter … exec waitron-credentials` steps could never have run; the measurement, taken both
ways, is in #326's commit message. Guards:
`scripts/manifest-commands.test.ts` (a declared `bin` target must be tracked by git; a
`waitron.commands` target must be the outfile of an `<entry>=<outfile>` pair its own package's
`build` script hands to `scripts/bundle-node.mjs`, which is a text match) and
`scripts/deploy-image-env.test.ts` (the image ships every name the server declares).

## A change adding third-party code or a binary to the image carries its licence notices

Owner decision 2026-09-24: a change that adds third-party code or a binary to the box image carries
its licence notices in the same change. They ship in the image's `/app/third-party/`, either
committed under `deploy/third-party/` or copied there by the build (libvips's notices come out of
its npm package in `deploy/Dockerfile`); `deploy/third-party/README.md` says what each file is.

What it cost. Litestream 0.5.17 landed in the image (#590) with its own Apache 2.0 licence alone,
while the binary is a statically linked Go program carrying the Go standard library and runtime
and 97 Go modules (`go version -m` on each of the two pinned linux binaries lists 97 `dep` lines).
`deploy/third-party/litestream/NOTICES.txt` now prints 68 distinct texts; counted 2026-09-24 over
those printed blocks with whitespace collapsed and case ignored, 23 contain MIT's "shall be
included in all copies" and 28 BSD's "Redistributions in binary form must reproduce the above
copyright notice" (29 counting the toolchain's `src/crypto/internal/boring/LICENSE`, where ` * `
comment markers break the phrase). That file is produced by `scripts/litestream-notices.mjs` from the
`go version -m` output of both pinned binaries, fetching each module's archive, and one
golang.org/toolchain archive per platform, from proxy.golang.org; `deploy/third-party/README.md`
has the steps to regenerate it.

What the guards leave open. The third-party blocks in `scripts/deploy-image-env.test.ts` read
text and cover libvips, Litestream, the print agent's python3-minimal, the Iosevka font, the
dashboard's Google Sans, the bundled npm notices in the two images, and the Google "G" trademark
line in the notice only; for Google Sans they check the copyright line in the notice and in
`deploy/third-party/google-sans/OFL.txt`, that the font file in the dashboard's source matches the
SHA-256 the notice records, and that image-smoke looks for `google-sans/OFL.txt`, never that a
build emits the font or that the built image serves it;
for Litestream they compare `NOTICES.txt`'s `Litestream version:` line with the pin, never the
module list with the binary; for Iosevka they check that `deploy/third-party/iosevka/LICENSE.md`
carries the copyright line `packages/printing/src/glyphs.ts`'s header names and that the
provenance file names the header's font sha256, never that the table was drawn from that font
(added 2026-10-01, C107). Bundled npm packages now have generated notice files in both images
(`scripts/npm-bundle-notices.mjs`; the image-smoke job checks that they are present). The print-agent
image (`deploy/Dockerfile`'s `print-agent` stage) also ships the Debian copyright
files of python3-minimal and the packages its install added under `/app/third-party/python3-minimal/`,
and none for bluez (`docs/backlog.md`).

**What the guards do not see.** Every third-party block but the npm one covers one named component,
so a new binary or system package is seen by none of them. npm notices are generated per bundle;
that block reads the Dockerfile and image-smoke as text for a hand-written list of apps, so it
checks that each app's notice folder is named, not that each generated file is copied.

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
(`fiscal-none`, designed and built in #262).

## A country pack is a browser-safe preset over modules, not a module

Generic contracts live in `@waitron/country`; each country owns its validation and geography in a
separate package; and `@waitron/country-packs` is the only package that names every installed
country implementation. Packs name module and fiscal contribution ids as strings and never carry an
external-provider credential. Setup derives geography-dependent values in the browser and repeats the
derivation at the server boundary. Guarded by `scripts/module-seams.test.ts`; designed and built in
#292.

## `packages/db/src/schema/columns.ts` is the only file that names the engine's column and table types

A table file declares its columns from that vocabulary — `id`, `ts`, `day`, `money`, `quantity`,
`rate`, `label`, `flag`, `count`, `json`, `binary`, `enumText`, `table` and the rest — and never
calls `integer(…)`, `text(…)` or `sqliteTable(…)` straight from `drizzle-orm/sqlite-core`, which is
where the vocabulary itself imports from now. That import line is also what the guard derives its
forbidden set from, so the list moves when the vocabulary's does. Task F1 is what the rule bought:
the switch replaced the bodies in that one file rather than every column declaration in the tree
(the vocabulary landed in #390, the switch in #489).

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
`products.ordering` has no CHECK at all: its values are refused by a trigger pair instead
(`packages/db/drizzle/0047_product_ordering_check.sql`), because adding a CHECK to an existing table
makes drizzle rebuild it.

Guarded by `scripts/column-vocabulary.test.ts`, whose own header says what it reads and where it is
blind — read that before changing it, rather than this. It forbids only the builders the vocabulary
itself imports, so one it does not import passes anywhere: measured 2026-09-23, a file importing
`blob` and a file importing `text` added side by side under `packages/fiscal-verifactu/src`, and
the guard reported only the `text` one. Two things about it belong here, because they are decisions
rather than mechanism:

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

A table declares its columns from the vocabulary so the NEXT engine change replaces one file rather
than every column in the tree.

**What the guard does not see.** `scripts/column-vocabulary.test.ts` reads the IMPORT or re-export
line as text, so a builder reached through `import * as` is invisible to it. A builder the
vocabulary STOPS importing would leave the set the same day; the hand-written list that holds such a
name forbidden sits beside the derived one, and it is empty.

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
options as before: **escape** (`quoteIdent` in `packages/provisioning/src/identifiers.ts` and
`quoteLiteral` in `packages/shared/src/sql-literal.ts`) or **validate and throw** (`assertSafeIdentifier`,
`packages/db/src/testing/identifiers.ts`, which records the same reading at its own head). Neither is
not acceptable; "the callers only pass safe values" is the §1 defect class.

The engine takes no bound value in the body of a generated trigger either. For an identifier and
for such a body, either escape (`quoteIdent`/`quoteLiteral`, as the change feed does with each
source's type, `packages/db/src/change-feed.ts`) or validate and throw (as the append-only installer
does with each table name, `packages/store/src/append-only.ts`).

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
exchanging two items' products would have put both rows on the same product midway through, which
the index refuses, although the body's final product set was legal. Measured 2026-10-02 on
`node:sqlite` (Node v26.7.0, SQLite 3.53.4), on a bare table with a unique index over `(list_id,
product_id)` holding products A and B: inside one transaction, updating the first row to B printed
`UNIQUE constraint failed: extra_list_items.list_id, extra_list_items.product_id`, errcode 2067, and
deleting both rows then inserting the swapped pair committed. The case is `saves a body that
exchanges two retained items' products` (`packages/catalogue/src/extras.concurrency.test.ts`). It
now deletes every one of the list's rows and inserts the body's fresh, each under the id the body
sent or a new one, which removes the intermediate state rather than ordering around it.

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
inserts then meet the first's committed rows on `(list_id, product_id)`.

**What serialises them now is the venue file's write queue, and there is no lock left to take.**
`withTransaction` (`packages/db/src/tenancy.ts`) runs its body inside `db.withWriteLock`, and
`packages/store/src/write-queue.ts` issues `begin immediate`, awaits the body, then `commit`, so the
next caller's `begin` does not run until that `commit` has returned. That holds for every row in the
file rather than for the one a clause named. SQLite has no row locks to take instead, and drizzle's
SQLite query builder has no `.for()` at all — so `assertExtraListForWrite`
(`packages/catalogue/src/extras.ts`, under the heading *Why this stopped being a lock*) is now the
404 it always also was, and nothing else.

**The control.** The thing to observe is "the second one has not STARTED". That is `racePair` in
`packages/catalogue/test/fixtures.ts`, which every concurrency case in the package goes through, and
its header records the reading in both directions taken back to back: two bodies started through
`withTransaction` report `secondStarted === false` while the first is held, and the same two bodies
started without it report `true`.

**The swap measurement in this section's first paragraph is on a bare table, not through
`writeItems`.** `saves a body that exchanges two retained items' products` passes; that deleting the
delete-then-insert turns it red has not been re-taken on this engine. `writeItems`'s own header says
the same thing at the site.

## Resolve shared catalogue data once before a basket's line loop

The Products review found that each basket line called `resolveZoneOffer`, which reloaded the whole
zone offer catalogue, then performed separate product-variant and menu-variant reads. Repeated items
therefore repeated the same sequential database work. `priceOrderLines` now reads one zone snapshot
before its in-memory line loop; the variants come from the offers it holds (`LiveOffer.variants`).
`working-order.test.ts` spies on `listZoneOffers` and checks that a basket repeating one offer calls
it once. Kitchen routing follows the same
rule: `fireLines` calls `VENUE_SERVICE.resolveMakers` once with the distinct product IDs for the
fire. The case "resolves every fired product's venue-service route in ONE batched call" in
`apps/server/src/working-order.test.ts` checks both that call and the stations reached by its
three fired lines. This checks batching at the service boundary, not a fixed database-read count.

## Opening hours store "no claim" as no row

Hours (A261 step 5) keeps opening hours in five venue-service tables, all classified `state`:
`hours_week_cells` and `hours_week_periods` for each department's and non-default station's
standard week, and `special_dates`, `special_date_hours` and `special_date_hours_periods` for dated
exceptions (`packages/venue-service/src/schema/hours.ts`). They replace `station_hours` and
`department_hours`, which venue-service `0022_retire_legacy_hours` drops; old rows are not carried
over (the pre-production rule in "No backwards-compatibility or data-migration code until Waitron
is in production" below).

- A stored cell is `closed`, `all_day` or `periods` (the `*_mode_ck` CHECKs). "No hours set" for a
  subject's week and "keep the standard week" for a subject on a special date are both stored as
  no row at all; `not_set` and `inherit` exist only on the wire (`packages/venue-service/src/hours-types.ts`).
  A week is seven cells or none: `replaceWeekHours` (`packages/venue-service/src/hours.ts`) writes
  all seven or deletes them, and the configuration import's `validate` refuses anything else.
- A cell names its owner as a department or a station, and the SQL cannot tie that owner to the
  cell's venue; the writers in `hours.ts` resolve each owner within the venue before writing.
- A default station's special-date cells are dormant, not deleted: a save never removes one because
  the request left it out (no request can carry it), and duplicating a date copies it. It applies
  again if the station stops being the default, so that change is refused with `hours.invalid`
  when, on a special date from the venue's yesterday on, the hours it kept would clash with the day
  before or after, or open or close at a minute the clock skips (`assertDemotedStationHours`,
  `hours.ts`). When the venue's clock cannot be read, only the clash is checked, on every special
  date. The refusal names the special date to move or delete.
- A cell's periods are replaced by deleting and inserting the whole set, so a reordering cannot trip
  the position index midway ("Editing rows one at a time can break a unique index the final state
  satisfies" above).
- One special date per venue and date (`special_dates_location_date_key`).

## Menu timetables share the special-date calendar

W98 keeps each department's menu timetable in four venue-service tables, all classified `state`
(`packages/venue-service/src/schema/menus.ts`): `menu_periods` (a named period such as "Mañanas"
and its menu), `menu_day_timetables` (one weekday of the department's week, or one special date),
`menu_slots` (a named period placed on that day, wall-clock times) and `zone_period_menus` (a
zone's own menu for one named period). They are not opening-hours rows: a menu period has its own
boundaries and a menu, and opening hours never stop a sale. What they share with Hours is the
calendar.

- A special date's menu timetable hangs off `special_dates` with a cascading key, so deleting the
  date deletes its timetables and slots. `duplicateSpecialDate`, `saveSpecialDate` and
  `deleteSpecialDate` (`packages/venue-service/src/hours.ts`) hand a date to a participant only
  when their caller passes one: the special-date routes in `packages/venue-service/src/routes.ts`
  (the PUT, the duplicate and the DELETE) pass `VENUE_SERVICE_CALENDAR_PARTICIPANTS`, whose one
  member is `MENU_TIMETABLE_CALENDAR_PARTICIPANT` (`packages/venue-service/src/menu-timetable.ts`),
  and nothing checks that a new caller does. Handed one, the participant copies a date's timetables
  to each target and refuses, with `menu_timetable.invalid` and a `reason`, a copy, move or delete
  that would leave a slot overlapping a neighbouring day's across a midnight (`overlap`), or a copied
  or moved slot opening or closing at a minute the clock skips there (`clock_skips`). A duplicate's
  copies are checked together, after every target exists.
- "No row" carries meaning twice, as for hours: a weekday with no `menu_day_timetables` row has no
  slots (the all-day menu all day), and a special date with no row for a department follows that
  department's week. A row with no slots on a special date replaces the week with the all-day menu.
- A zone's override names a named period, not a slot, so it holds on every day and special date
  that places the period. Deleting a period is refused `menu_period.in_use` while any slot places
  it, past special dates included; once none does, its zones' overrides cascade with it.
- A whole-venue closure does not close menus: the clash checks build their date state with
  `closeWholeVenue: false` (`firstMenuClash`, `packages/venue-service/src/menu-timetable-rules.ts`)
  and the resolver never reads `special_dates.close_whole_venue`.
- A day's slots are replaced by deleting and inserting the whole set; nothing references a slot.
- Pricing (`readBasketOffers` in `apps/server/src/working-order.ts`, `offersFor` in
  `apps/server/src/order-drafts.ts`) passes `withDefault: false` to `listZoneOffers`, which then
  reads no timetable table. The case "price a basket's offers without reading the timetable at all"
  in `packages/venue-service/src/menu-timetable.test.ts` pins what `listZoneOffers` reads with that
  option, by statement text; nothing checks that the pricing callers pass it.

**Tables the application code may read and never write**

## The tables `scripts/write-path-tables.json` lists are read-only to the application, and one guard is the whole of the enforcement

`tenants`, `nodes`, `deployment`, `mirror_config` and `node_roles`. `node_roles` joined on
2026-09-23, when a node's mode, singleton role and break-glass verifier left `deployment` (#548);
it inherits `deployment`'s rule and is not in the frozen matrix, which the guard's
`ADDED_SINCE_THE_MATRIX` records. NOTHING BUT `scripts/write-path-tables.test.ts` REFUSES THEM.
SQLite has no roles and no grants — one process opens one file, and every path, request and
provisioning alike, shares that one venue handle. So the rule is a convention over source text, and
that guard is not a second opinion on an engine that would refuse the write anyway.

The list comes from `packages/fiscal-verifactu/src/privileges.expected.ts`, a FROZEN RECORD rather
than a measurement: nothing checks it against a database. The guard says so itself, and states the
ways it is weaker than "no write path touches a forbidden table", among them — it reads TEXT; it
judges a FILE rather than a call chain; and it walks `<member>/src` under `apps` and `packages`
alone (`docs/backlog.md` → B9). Read those hedges in the guard rather than trusting this line.

Real code does write all five, legitimately: the setup-mode provision route reaches `tenants`,
`nodes` and `deployment`; the setup-mode adopt route reaches `deployment`, `node_roles` and
`mirror_config`; and the promote route reaches `node_roles`. Each does it by calling into one of the
files `scripts/write-path-tables.json` names, which is where such a write is allowed to live.
Keeping them in a handful of named files is the whole of the property now, because no connection
makes the distinction for us any more.

**What the guard does not see.** `scripts/write-path-tables.test.ts` reads TEXT, so a table name
reached through a variable is invisible to it; it judges a FILE against an allowance list rather
than a call chain, so a request path that calls into an allowed file writes through it unseen; and
it walks `<member>/src` under `apps` and `packages` alone, so a package's `test/` directory and
`apps/<app>/scripts` are outside it.

## A money column holds a count of whole cents, and the conversion happens at the row

Landed 2026-09-20 as task P5 of the SQLite storage swap (#475). EVERY column declared through
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
`packages/shared/src/scales.ts`'s `scaledCount` for the rounding and the bound, its literal renderer
and its raw pattern) rather than beside the arithmetic.
`money.ts` is read as TEXT by `packages/shared/src/conventions.test.ts` and fails on any
float-shaped operation in it, including the number constructor; keeping that check that strict is
worth more than one module. `cents.ts` has its own version of the check, which allows the number
conversion it exists for and forbids the rest.

**There is no column width left to measure, and that is the change.** SQLite's INTEGER is 64-bit
whatever the declared type says (`packages/db/src/schema/columns.ts` states it at
`smallCount`/`bigCount`), so nothing below the converters bounds a money value at all. The bound the
system states is twelve integer digits — 99999999999999 cents, `MAX_MONEY_INTEGER_DIGITS`, enforced
by `decimalToCents` on the amount after rounding it to cents, and by `packages/catalogue`'s price
validators — and it is now the only thing
enforcing anything. That figure is well inside the 9007199254740991 a JavaScript number counts
exactly, so nothing in range loses a cent to the number type.

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
`packages/core/src/list-outstanding-sales.ts` among them. This engine has no `::` cast operator at
all. Measured 2026-09-22 on Node v26.7.0, `select count(*)::int` is
`unrecognized token: ":"`, errcode 1.

**A test asserting the stored COUNT is not reading an amount, and several cast to int.** The shape is
`select cast(unit_price_gross as int) as unit_price_gross` followed by
`expect(...).toEqual([{ unit_price_gross: 325 }])` (`apps/server/src/working-order.test.ts`);
`till-api.test.ts` and `till-api.transfer.test.ts` carry the same shape. Nothing converts, so there
is no amount to get wrong, and the cast is there only to give the assertion a number.

**That cast refuses nothing.** `cast(x as int)` on SQLite raises nothing at all: the declared type
carries no width. What keeps these assertions safe is only that their literals are
small, and `apps/server/src/till-api.test.ts` says so at its own call site. A test that converts an
amount is a different thing and casts to text like production:
`apps/server/scripts/demo-seed/seed-sales.test.ts` is the live example.

**What the compiler could not see.** Three classes, each found by hand and each worth re-checking
whenever a money column is added:

- The hundredfold hazard, which is real on any engine: a raw read that renders a money count as a
  DECIMAL rather than as a count hands back a plausible string a hundred times too LARGE — a stored
  7734 cents is €77.34 and renders as `"7734.00"`, which a consumer reads as €7734.00. The direction
  is worth getting right: too large is a bill a hundred times the price, not a rounding slip. What
  to watch for is any raw read handing a count to a consumer expecting an amount. That sentence is
  written once, in `rawCentsToDecimal`'s doc comment (`packages/shared/src/cents.ts`), so
  `grep -rn "hundred times" packages apps --include='*.ts' | grep -v '\.test\.ts'` returns that one
  line.
- Raw-SQL inserts: **nothing is refused, in any form.** Measured 2026-09-22 on `node:sqlite`, Node
  v26.7.0, against a plain `integer` column, by bound parameter and by raw SQL alike — `25.00` and
  `"25.00"` each store the integer 25, `"21.50"` stores the REAL 21.5, and `"abc"` stores the text
  `abc`. Not one of the four raised anything. A bare whole number succeeds and means cents. One
  instance was found and corrected while money was moving to cents: a fixture inserting
  `('cash_only', 50)` into `payment_policy` had meant an offline cap of fifty euros and silently
  became fifty cents. It reads `('cash_only', 5000)` today —
  `apps/server/src/configuration-transfer.test.ts` (its `payment_policy` insert). Whether that was
  the only one in the tree is not established; what was run was a hand sweep, not a check anything
  re-runs.
- Money held as strings inside a JSON document — `sales.vat_breakdown` and the hashed
  `daily_closes.snapshot`. Both are above the line and stay decimal strings, so a reader applying the
  cents rule to them would break working code. **The grouping and the summing moved out of SQL
  altogether**, because this engine has no exact decimal type and summing filed cuotas in SQL would
  sum them as binary floating point. `packages/reporting/src/vat-summary.ts` reads one row per
  breakdown ELEMENT and folds them with `@waitron/shared`'s Decimal arithmetic at the money scale,
  which is exact by construction; the comparison it was checked by and the controls that break it
  are recorded in #601's commit message (`git log --grep='(#601)'`), not in the file.

  What that costs belongs in this list, and the file states it: nothing in that path bounds an
  element's width, so an out-of-range filed amount is summed rather than refused.
  `packages/fiscal-verifactu/src/monetary-columns.test.ts` states the twelve-TOTAL-digits against
  twelve-INTEGER-digits split in its own comment but does not hold it down: it neither imports
  `decimalToCents` nor reads `MAX_MONEY_INTEGER_DIGITS`, and what it would catch is those two fiscal
  columns ceasing to be `text`. The bound on the write path is pinned in
  `packages/shared/src/cents.test.ts` (`decimalToCents`, after rounding).

**Every document written before 2026-09-20 that states a money column as `numeric(12, 2)`
describes the old storage.** There are dozens, nearly all dated plans and specs recording what was
true when written; they were not rewritten.

The documents corrected in place are named here rather than described as a class, because the
class was not swept: this file and `CLAUDE.md` §3, which carry the rule.

**The converters, by name.** `packages/shared/src/cents.ts` has `decimalToCents` in
(`stringToCents` when the value is still a decimal string), `centsToDecimal` out, and
`rawCentsToDecimal` for a raw-SQL read of an AMOUNT, which casts the expression `cast(x as text)` —
this engine has no `::` operator, and an uncast integer arrives as a JavaScript number, which that
reader refuses.

**Guards, both narrower than their names:** `packages/db/src/schema/columns.test.ts` (`money` and
`bigCount` emit the SAME SQL type, so only its read-mode case separates them) and
`packages/shared/src/conventions.test.ts` (reads `cents.ts` as TEXT, and nothing outside
`packages/shared/src`, so a second file crossing into the number type is seen by nobody).

## A quantity counts whole thousandths and a rate whole basis points, and neither is the money scale

Task P6, 2026-09-21. Seven columns followed money out of `numeric`: two quantities
(`working_order_lines.quantity`, `sale_lines.quantity`) and five rates (`vat_rate` twice,
`purchase_invoices.deductible_proportion`, `purchase_invoice_vat.rate`,
`convenio_config.night_premium_pct`). _2026-09-27 (A68): `working_order_lines.vat_rate` was
replaced by `vat_class`._

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

**The bound is the converter's.** An integer column takes any width silently, so
`MAX_QUANTITY_INTEGER_DIGITS` (nine) and `MAX_RATE_INTEGER_DIGITS` (three) are where a too-wide
quantity or rate is refused. The raw RATE reader carries the same bound; the raw QUANTITY reader,
`rawThousandthsToDecimal`, does not (owner decision 2026-09-24). Its caller, `top-sellers.ts`, reads
sums, which can be wider than any one quantity, so its only width limit is what a JavaScript number
holds exactly, refused with `shared.invalid_thousandths` (like `rawCentsToDecimal`).

**A rate's CHECK constraint is written against 10000, not 100.** One written as `rate <= 100`
refuses every rate above one percent, because a rate column counts basis points
(`packages/db/src/schema/columns.ts` says so at the `rate` builder). A QUANTITY check such as
`quantity <> 0` reads the same in either scale. What compares the checks a set's migrations build
with the schema's is the shared schema-conformance suite,
`packages/db/src/testing/schema-conformance.ts`, a suite factory that any migration set can call.
Which sets have a call site is `ls packages/*/src/schema/schema-conformance.test.ts`; a set with
none is unguarded.

**Three ways a raw-SQL site can be wrong, and none of them is loud.** The readings are in the money
rule's raw-insert bullet above, taken 2026-09-22 on `node:sqlite`, Node v26.7.0.

1. A QUOTED literal with a fractional part: `"21.50"` into an `integer` column is stored as the REAL
   21.5.
2. An UNQUOTED numeric literal: `25.00` into an `integer` column stores 25 — a hundredfold wrong,
   nothing red. Found in `packages/workforce-es/src/convenio.test.ts`, where the test PASSED before
   the conversion because the reader was unconverted too and the two errors cancelled. CLAUDE.md
   §1's "a measurement taken where both answers look alike", with a green suite attached.
3. A value whose text is already a whole number is accepted silently in either form and means a
   thousandth of what the author meant: a quantity sent as `'2'` stores 2, which is 0.002 units.
   Seen in `packages/core`'s pre-fix failure dump.

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

_2026-09-30 (A144):_ `recordCorrection` now passes `buildVatBreakdown` the lines with each
`lineTotal` rounded to the cent; the rate is still the input's.

_2026-10-01 (A158):_ that rounding moved into `buildVatBreakdown` itself, so a sale and a
substitution take each `lineTotal` at the cent too. The three files now reach it through
`deriveVatBreakdown`, which refuses with `sale.total_mismatch` when a line total is past the cent
and the breakdown, built from the lines at the cent, does not sum to the total at the cent. A breakdown a caller supplies to `recordSale` does not go
through `buildVatBreakdown`: it has its base and tax each rounded to the cent, and is refused with
`sale.total_mismatch` if the rounded amounts no longer add up to the total.

_2026-10-02 (C126):_ a correction that credits the whole invoice (`wholeInvoice`) does not reach
`deriveVatBreakdown`: it files the invoice's stored breakdown negated
(`packages/core/src/record-correction.ts`). So for a whole-invoice credit the rates and amounts
reaching the fiscal record DO cross the storage boundary, read back from the original's
`sales.vat_breakdown`, and the "does not cross the storage boundary at all" above holds only for
a breakdown built from lines or supplied by a caller. The huella gate above records sales from
literals and does not file a whole-invoice credit, so it says nothing about that path.

**A guard got quietly weaker and had to be shored up.** With `quantity` and `rate` converted, the
vocabulary stopped importing `numeric` at all — and `scripts/column-vocabulary.test.ts` DERIVES its
forbidden set from the vocabulary's own import block, so `numeric` would have become legal in every
table file on the same day it stopped being used in any. The guard now carries a hand-written
`RETIRED` set beside the derived one, holding `numeric`. That list GROWS as builders retire, where
the `ALLOWED` list only shrinks. It still cannot cover a builder the vocabulary never imported —
`bigserial` is the standing example.

_2026-10-07: that paragraph describes the PostgreSQL-era guard. The move to SQLite (#489) emptied
`RETIRED` in `scripts/column-vocabulary.test.ts`; the current guard is described under "`columns.ts`
is the only file that names the engine's column and table types" above._

**What the conversion did NOT touch.** The pricer, `assertQuantityPrecision`, the purchasing
validators, every receipt and ticket formatter, the HTTP contract, `apps/till` and `apps/dashboard`.
All of them work in decimal strings and all of them still do.

`packages/shared/src/scales.ts` sits beside `cents.ts`, with the same two raw-SQL readers and the
same cast-to-text rule. The money rule's two guards and both its hedges apply unchanged, and
`quantity`, `money` and `bigCount` are all `integer(name)`, so only the caller separates them.

### The database never rounds a quantity — the converter owns the third place

`packages/catalogue`'s precision guard — the `rejects excess precision before anything downstream
can round it` case in `packages/catalogue/src/units.operations.test.ts` — holds no SQL rounding
probe beside the converter, because this engine has no exact decimal type to compare it with. Run
on 2026-09-22:

```
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); const q = (s) => JSON.stringify(db.prepare('select ' + s + ' as v').get().v); console.log(q('round(1.2345, 3)'), q('cast(1.2345 as numeric(12,3))'), q(\"printf('%.3f', 1.2345)\"), q('round(1.2355, 3)'));"
```

On Node v26.7.0 that prints `1.234 1.2345 "1.234" 1.236`. So `round` takes the tie DOWN; a cast's
declared scale is ignored entirely, because SQLite's `numeric(12,3)` is a type name carrying NUMERIC
affinity and no scale; and the fourth reading is the control in the other direction —
`round(1.2355, 3)` going up says this is binary float representation rather than "SQLite always
rounds down".

Nor would such a probe test anything real: a quantity column holds a whole count of thousandths and
`decimalToThousandths` has already decided the third place before any value reaches storage, so a
test asking SQL to round a quantity asks about something no product path does. The converter's own
rounding is pinned by the `rounds a fourth decimal place half away from zero` case in
`packages/shared/src/scales.test.ts`. The precision guard's own subject is its two assertions:
`stringToThousandths("1.2345")` is `1235`, and `assertQuantityPrecision` throws `quantity.invalid`.

## A time stored as text and compared or sorted as text needs one spelling across its writers

`ts`, `tsString`, `timeOfDay` and `day` (`packages/db/src/schema/columns.ts`) all emit `text`, and
the engine orders text by its characters. JavaScript's own string comparison, run on 2026-10-03
(Node v26.7.0):

```
node -e 'console.log("10:00:00Z"<"10:00:00.500Z", "2026-10-03T09:00:00+02:00"<"2026-10-03T07:30:00Z", "07:00">="6:00")'
```

It prints `false false false`, and each of the three is wrong as time: a whole second written
without milliseconds sorts after the same second with them (`Z` follows `.`), an offset spelling
sorts by its local digits, and an unpadded hour sorts after a padded one.

The database's own comparison, measured on 2026-10-03 on `node:sqlite` (Node v26.7.0):

```
node -e 'const{DatabaseSync}=require("node:sqlite");console.log(Object.values(new DatabaseSync(":memory:").prepare("select ? < ? a, ? < ? b, ? >= ? c, ? <> ? d").get("10:00:00Z","10:00:00.500Z","2026-10-03T09:00:00+02:00","2026-10-03T07:30:00Z","07:00","6:00","12:00","12:00:00")).join(" "))'
```

It prints `0 0 0 1`: the database answers the first three the same wrong way as JavaScript, and the
fourth says `12:00` and `12:00:00` are different values. The control: the same `select ? < ?` with
the first pair reversed (`"10:00:00.500Z","10:00:00Z"`) prints `1`.

**The instance (W22, #1134).** `addShift` and the shift update stored `starts_at` and `ends_at` as
the caller sent them. `shifts_interval_ck` (`packages/workforce/src/schema/shifts.ts`) and the
roster's ordering compare that text, so two valid times spelled differently were refused with a raw
CHECK error instead of `shift.invalid`, or listed in the wrong order. The fix stores both ends as
the UTC whole second through `shiftInterval` (`packages/workforce/src/clocking.ts`), and its review
found the next problem before it landed: a shift written at `+02:00` would have read back at its
UTC hour, because the roster and the shift dialog read the hour straight off the text. They now work it out from the
stored offset (`wallClock` and `instantAt`, `apps/dashboard/src/date-utils.ts`).

**The siblings, swept 2026-10-03 at `575aff691`.** Every `ts`, `tsString` and `timeOfDay` column
was listed with `grep -rn --include='*.ts' -E '\b(ts|tsString|timeOfDay)\("' packages apps`, then
each column's name was searched across `packages/` and `apps/` for a text comparison (drizzle's
`lt`/`gt`/`lte`/`gte`/`asc`/`desc`/`min`/`max`, raw SQL, a CHECK in a migration, and JavaScript `<`,
`>`, `localeCompare` and `.sort`) and for its writers. That was a reading sweep, not a run, and
`day` columns were not part of it.

- **One spelling on every product writer.** Apart from `shifts`, whose `shiftInterval`
  (`packages/workforce/src/clocking.ts`) stores the UTC whole second without milliseconds, every
  other instant column found compared or sorted as text is written through `nowIso()`, a `Date`'s
  `toISOString()` or the `ts` mapping, which is also `toISOString()` — one spelling per column
  either way. `time_entries` and `order_amendments` pin it in the database as well:
  `time_entries_event_at_second_ck` and
  `time_entries_recorded_at_second_ck` (`packages/workforce/drizzle/0000_baseline.sql`) and
  `order_amendments_event_at_second_ck` (`packages/db/drizzle/0000_baseline.sql`), each a `glob`
  for the whole-second `.000Z` spelling. The paging cursors that are compared with `created_at` or
  `issued_at` are checked against the millisecond spelling before use (the `CURSOR` pattern in
  `apps/server/src/orders-api.ts` and in `packages/adjustments/src/routes.ts`).
- **Times of day normalised by a helper.** `bookings.booking_time` and the opening periods'
  `opens_at` and `closes_at` (`hours_week_periods`, `special_date_hours_periods`) go through a
  `storedTime` helper (`packages/bookings/src/bookings.ts`,
  `packages/venue-service/src/operations.ts`) that pads `HH:MM` to `HH:MM:SS`, behind a check that
  allows `HH:MM` (for a booking, the route's pattern, which also allows `HH:MM:SS`; for an opening
  period, `CLOCK_TIME` in `packages/venue-service/src/hours-rules.ts`). The interval tables
  `station_hours` and `department_hours` this line named until 2026-10-06 are dropped by
  venue-service `0022_retire_legacy_hours`.
- **`locations.day_cutover`** is written during creation through `normalizeDayCutover`
  (`packages/provisioning/src/venue-plan.ts`), which pads `HH:MM` and stores any other string
  unchanged. Its one text comparison (`packages/venue-service/src/routing-store.ts`, `todayEnds`)
  reads only the stored value's first five characters, which `readLocationClock`
  (`packages/reporting/src/business-day.ts`) keeps. It runs only when those five pass the `HH:MM`
  check there, so a value whose first five characters are not a time switches it off, while
  anything after them is dropped unread (`06:00garbage` reads as `06:00`) — traced by reading. The
  detail editor (`apps/server/src/venue-details.ts`) separately validates a changed cutover as
  `HH:MM` or `HH:MM:00` and stores its whole-second spelling. Its real-database validation cases
  are in `apps/server/src/venue-details.test.ts`; an unrelated edit preserves the saved spelling.
  This editor displays malformed saved cutovers in full so an eligible correction is a real change;
  its preview reports the current clock as unavailable for that value.
- **Writers that skip the helpers.** The configuration import
  (`importConfigurationTables`, `apps/server/src/configuration-transfer.ts`) copies the time values
  in a bundle's rows as written, without the normalising helpers. Several `created_at` columns that
  are ordered travel in a bundle this way. A bundle a Waitron venue exported carries that venue's
  spellings, so it takes a hand-edited bundle to store another. The opening periods are the
  exception: venue-service's transfer `validate` refuses a period whose `opens_at` or `closes_at`
  is not spelled `HH:MM:00` (`STORED_TIME` in `packages/venue-service/src/configuration-transfer.ts`)
  before the import writes anything.

Nothing guards the one-spelling rule across these columns. A new text time column, or a new writer
of an old one, is seen by nothing unless its table carries a CHECK like the ones above.

## A new table is classified `ledger`, `state` or `local` (swap design §2.1) in its module's `<MODULE>_CLASSIFICATION` list via `classify()` (`@waitron/sync-enrolment`), and a table that must never be corrected is declared with `appendOnly()` instead

The enforcement is no longer written into each migration by hand: `installAppendOnlyTriggers`
(`packages/store/src/append-only.ts`) puts a `RAISE(ABORT)` trigger pair on each named table, and
`applyMigrations` (`packages/migrations/src/apply.ts`) calls it after each set migrates, so boot
(`apps/server/src/boot.ts`), the cold restore (`apps/server/src/restore.ts`) and `rejoin-command`
all install them. `waitron-provision venue` is not one of them: it migrates nothing — no non-test
file under `packages/provisioning/src` calls `applyMigrations` at all (the one caller left there is
`schema-ahead.migrate.test.ts`, which migrates its own fixture). The two dev scripts,
`apps/server/scripts/dev-setup.ts` and `apps/server/scripts/dev-onboard.ts`, are converted: each
calls `applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null))`, so each installs the
triggers the way everything else does. The five demo scripts beside them (`allergens-demo.ts`,
`daily-close-demo.ts`, `daily-close-z-demo.ts`, `modelo-303-demo.ts`, `recipes-demo.ts`) call it the
same way with their own set list.

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
and `order_amendments`, which must refuse both, came back with no trigger at all, because it is
classified `state`. The class is wrong in both directions.

So the declaration is its own marker: `appendOnly(table, class, reason)` beside `classify()` in
`@waitron/sync-enrolment`, read by `orderedMigrationSets` off the descriptor's `classification` seat
and carried to `applyMigrations` through `MigrationSet.appendOnlyTables`. The cost of the
class-derived version was never paid in production because the installer was never
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
  at all. A caller that can issue DDL can drop a ledger table.
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

Neither sees a caller that migrates with a plain options array: `applyMigrations` reads each set's
`appendOnlyTables` as `?? []`, so such a caller gets a migrated database with none of the
append-only triggers and no error. Measured 2026-09-27 on `node:sqlite`, Node v26.7.0, by
migrating the full manifest twice: through `migrationOptionsFor(...)`, `registros_facturacion`,
`sales` and `time_entries` each carried a `RAISE(ABORT)` trigger; with the same array stripped of
`appendOnlyTables`, none of them did, and `applyMigrations` returned normally.
`scripts/apply-migrations-callers.test.ts` holds that every non-test call under `packages/` and
`apps/` passes a `migrationOptionsFor(...)` result, directly or through a `const` declared once in
the file; its header lists where it is weaker than its name.

**What the callers guard does not see.** `scripts/apply-migrations-callers.test.ts` is weaker than
its name in the ways its header lists, among them: it checks the call's shape and trusts what that
function returns, never reading the sets handed to it; a `const` it accepts can be changed after it
is declared; a function injected beside it through `??` runs unseen; and a path that migrates
without `applyMigrations` (`runMigrations` called directly) is invisible to it.

## A `local` row belongs to one node, so no foreign key may join a `local` table to a `ledger`/`state` one

Every table is in `venue.db`, which a primary streams whole to the owner's bucket once one is set up
(#548, which
replaced the topology design's plan to put `local` tables in `node.db`). A `local` row means nothing to another
node, so no venue row may depend on one, and `node.db` stays reserved for a later slice that may
move `local` tables into it — which a key in either direction would block. Guard:
`scripts/two-file-foreign-keys.test.ts`.

Cost of the shape it replaced: six such keys existed and nothing would have failed at the flip.

**What it reads, and the two things it therefore cannot see.** It reads drizzle's own generated head
snapshot for each migration set — `meta/_journal.json` names the head and `tables[*].foreignKeys[*]`
holds the graph — so a key declared in TypeScript but not yet generated is invisible to it, and so is
one added by hand-written migration SQL, because a custom migration leaves the snapshot alone. Both
gaps are stated in the guard's own header. The first is caught elsewhere:
`scripts/migrations-match-schema.test.ts` runs `drizzle-kit generate` for every set into a copy and
fails when anything changes. The second is not, because `generate` compares the TypeScript with the
snapshot and never reads the SQL. The reading was chosen over the TypeScript deliberately: a reading
taken from the TypeScript passes the moment somebody edits a table file, while the constraint is still
live in every migrated database, and it would have gone silently vacuous at the flip, when `PgTable`
stops matching anything.

**How the six that existed were resolved (task P7, 2026-09-19).** All six were a `local` row naming a
venue row by id — a person, a till, a location — so neither of the two routes §2.1 named applied: an
id is the payload, not a value that can be copied elsewhere. The constraint was dropped and the column
kept, with what now establishes the id's target named at the column. Five take their id from a row the
request had already read. The sixth, `join_requests.location_id`, is the node's configured location: it
is checked by nothing when the row is written, and its refusal moved to accept, where the accepted row
(`devices` or `print_agents`) still holds a key to `locations`. Never weaken a classification to make
this guard pass — that is the one wrong answer §2.1 rules out.

_2026-09-24:_ five of the six keys were on identity tables that slice-2 Task 1b reclassified
`state` (`sessions` to `persons` and `tills`; `management_sessions`, `totp_enrollments` and
`google_oidc_states` to `persons`). Their keys were not restored; `docs/backlog.md` lists that as
open under Task 1b. _2026-10-04 (A238):_ `tills` is gone; `sessions.device_id` now holds a
`restrict` key to `devices`, and `sessions` still has none to `persons`
(`packages/identity/src/schema/sessions.ts`).

**What ties a `local` row to its node, and which ties are pinned.** A `local` table's reason says
which of three ties it uses: a `node_id` column every read and write names (`node_roles`,
`mirror_config`, `join_requests`, `node_sealed_state`), a seal only that node's key opens (`tenant_credentials`), or rows
the transaction that wrote them deletes (`change_log`). Identity has no `local` table: slice-2
Task 1b reclassified its logins and sign-in ceremonies `state`, with a login's cookie token stored
only as its hash (`packages/identity/src/classification.ts`; #554, and the owner's decision that a
login survives a rebuild and a promotion). Pinned,
each by deleting the node filter and watching a case fail: the `node_roles` and
`mirror_config` readers (`packages/db/src/node-roles.test.ts`), and every node filter on
`join_requests` in `apps/server/src/join-requests.ts` but deny's delete, which runs only after a
node-filtered read of the same id (the "belong to the node" cases in
`apps/server/src/join-requests.test.ts`), and the `node_sealed_state` reader
(`readSealedStateRow`, the "reads only the named node's row" case in
`apps/server/src/sealed-state.test.ts`).

## Anything that works as a live login is stored as a hash

**Anything that works as a live login is stored as a hash, because a primary streams the whole
database to the owner's bucket once one is set up.** The dashboard and till session cookies carry a
random token and the row keeps its SHA-256 (`hashSessionToken`, `@waitron/identity`), as pairing
tokens and the Google sign-in state already did: reading the bucket must never let anyone into the
live box.

**Guards, weaker than the rule:** the "what a copy of the database holds" cases in
`apps/server/src/me-api.test.ts` and `apps/server/src/till-api.test.ts` present the row's id alone,
and only the dashboard's stored hash is tried as a token
(`packages/identity/src/management-session.test.ts`); a new login table is seen by nothing.

## A migration set depends on another through a foreign key, a trigger on its table, or a trigger body naming its table

FK `REFERENCES`, and a `CREATE TRIGGER … ON <table>` where the TABLE is owned by a different
migration set. Both exist in the tree today.

The live instance of the trigger edge is `packages/media`. Its
`drizzle/0001_image_references.sql` carries eight triggers standing in for two foreign keys, and four
of them sit on tables another set owns: `products`, created by core in
`packages/db/drizzle/0000_baseline.sql` and rebuilt by core's
`0003_variant_inherited_nullable.sql`, and `category_details`, created by catalogue (catalogue
`0013` and media `0004` have since dropped the two on `category_details`).
`drizzle/0002_section_image_references.sql` adds four more of the same shape for `sections.image`,
two of them on catalogue's `sections`. `drizzle/0003_published_image_references.sql` adds three for
`menu_version_images.filename`: one on catalogue's `menu_version_images`, and two on `media_images`
whose bodies read catalogue's `menu_version_images` and `menu_publications` — edges
`scripts/module-graph-honesty.test.ts` now reads from their trigger bodies.
`drizzle/0008_queued_edition_image_references.sql` re-creates those two so their bodies also read
catalogue's `menu_scheduled_publications`, keeping a photo a queued edition names.
`drizzle/0009_include_folder_image_references.sql` adds four for the photo an include's folder
names (`section_members.folder_overrides`, key `image`): two ON catalogue's `section_members`, and
two on `media_images` whose bodies read `section_members`. A catalogue rebuild of any catalogue
table these bodies read — `sections`, `section_members`, `menu_version_images`,
`menu_publications` or `menu_scheduled_publications` — is the trigger-body shape described below,
which fails on an upgrade. Measured 2026-10-07 on `node:sqlite` (Node v26.7.0), with media's `0009`
applied to a stand-in `media_images` and `section_members`: drizzle's create-copy-drop-rename of
`section_members` inside `begin` failed with `error in trigger
section_members_media_image_fk_parent_delete: no such table: main.section_members`, and without
media's triggers the same rebuild committed. With the two body triggers dropped first, the rebuild
committed and the two triggers ON `section_members` were gone afterwards, with no error. A
rebuild of `menu_version_images` that got past that, by removing media's two body triggers first,
would also drop the insert trigger ON it with no error — inferred from the
`products` measurement below, not measured on this table. Media's two edges, to core and to
catalogue, are both declared — media's descriptor reads
`requires: { core: "*", modules: { catalogue: "*" } }` (`packages/media/src/module.ts`) — and for
the triggers ON another set's tables that declaration is what the guard checks; the guard's job is
the case where such an edge is NOT declared. Core's own triggers, in its migration files under
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
`docs/backlog.md`, Track A, the paragraph opening **Task 1 LANDED as #511**.

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
the variants-as-products work hit it. Task 1's rebuild of `products` (core's
`packages/db/drizzle/0003_variant_inherited_nullable.sql`, #511) cascade-deleted `product_categories`
on a venue without the media triggers (measured 2026-09-23 by a review of #511's plan, through
`applyMigrations` on a scratch copy of `packages/db`). Task 4's rebuild of `menu_items`
(`packages/catalogue/drizzle/0003_menu_price_nullable.sql`, #532), measured 2026-09-23 through
`applyMigrations`, emptied `menu_item_extra_lists`, `menu_item_extra_items` and
`menu_item_variant_overrides` while reporting success, and failed with
`FOREIGN KEY constraint failed` when a `working_line_contexts` row named the offer. A paid order
keeps such a row (measured 2026-09-23: after a completed walk-up cash sale from a menu offer, its
`working_line_contexts` row was still there on a `settled` order), so that failure is any venue that
has sold from a menu. Today this costs
nothing beyond a reset, while the rule of no data-migration code until production stands. Once a
venue is live, a rebuild has to carry the child rows across by hand.

`scripts/module-graph-honesty.test.ts` derives its edge kinds from the SQL text, and says so. **Two
hedges from its own header belong here, because a failing test can never restore them.** The
`EXECUTE (FUNCTION|PROCEDURE)` detector was DELETED as dead syntax — SQLite has no functions, so
`CREATE FUNCTION` and `FOR EACH ROW EXECUTE FUNCTION f()` are both syntax errors on it. And a SQLite
trigger's body is read as text for five statement shapes: `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`
and `DELETE FROM`. At top level it checks plain `INSERT INTO`, `UPDATE` and `DELETE FROM`
at the start of a statement. Other SQL syntax, top-level reads, WITH-prefixed writes, REPLACE and
INSERT/UPDATE OR variants can still name a table without being detected; the guard does not parse SQL. The engine does not catch a missing body target either. Measured 2026-09-23 on
`node:sqlite` (Node v26.7.0): a trigger whose body reads or writes a
table that does not exist is created without complaint, and the insert that fires it fails with
`no such table: main.<name>`; create the table and the same insert succeeds. The control in the
other direction: a trigger ON a missing table is refused when it is created. So a missing
dependency of this shape surfaces only when the trigger first fires.

**The rule in full.** A module depends on another migration set when its SQL `REFERENCES` one of
that set's tables, puts a `CREATE TRIGGER … ON` one of them, names one inside a trigger's body, or
writes one at top level — and its descriptor's `requires` must name it. Cost: the first `requires`
graph was derived from `REFERENCES` alone and missed two edges made by triggers ON another module's
tables, caught by hand in review.

## A column of a transferred table that holds another row's id is a foreign key, a declared `references` entry, a location column or left out of the export

A configuration import gives every row whose `id` is text a new one, and rewrites a value to the new
id only in a table's `id` column, its foreign-key columns, and the columns its module lists as
`references` (`importConfigurationTables`, `apps/server/src/configuration-transfer.ts`, which reads
`pragma_foreign_key_list` for the keys). It overwrites the columns a table lists in
`locationColumns` with the importing venue's location, and the export leaves out the columns a
table lists in `omit`. Any other column the export carries that holds a row's id arrives holding
the EXPORTING venue's id. Before W72a (#1230) the import replaced any text equal to a bundle id in every
column, so a product named like an id arrived renamed; the narrowing is what makes this rule
necessary. A reference the schema cannot give a foreign key goes in `references`, as
`option_lists.default_label_id` does.

Cost: W72a's narrowing (#1230) made two existing columns need a `references` entry; without them
two transfer cases failed.

Guard: `scripts/id-columns-are-references.test.ts`, which migrates a real database and reads every
transferred table's columns and keys. Weaker than its name: it knows an id column only by a name
ending `_id` or `_ids`, so a reference named otherwise is unseen; a column on its `NOT_REFERENCES`
list is trusted by the reason written there, so one that later starts holding an id passes; and a
declared `_ids` column passes, though the import replaces only a whole value equal to an id
(`configuration-transfer.ts`, the `idMap.has(value)` test), never ids inside a list.

The export also leaves behind each row whose `leaveBehindWhenSet` column is not null (a retired
device profile, `retired_at`), and then every row of a transferred table whose foreign key names a
row left behind, repeating until nothing more is left behind (`exportConfigurationTables`,
`apps/server/src/configuration-transfer.ts`). It reads the keys from `pragma_foreign_key_list`,
never the `references` lists, and follows only those between transferred tables that lead from a
table declaring `leaveBehindWhenSet` to its children, and on to theirs. A key's parent table is
matched ignoring the case of ASCII letters, as SQLite matches table names; a key that names no
parent columns points at the parent's primary key. SQLite itself decides which rows a key names,
by joining the two tables, so the parent column's collation and type rules apply, and a key with a
null in it names nothing. Among the tables it follows, the export refuses with
`setup.request_invalid`: a `leaveBehindWhenSet` name the table has no column for
(`<table>.<column>`); a table stored `WITHOUT ROWID` (`table:<table>`); a column named `rowid` in
any case, or exactly `__export_rowid` (`<table>.<column>`); and a key whose parent columns do not
number the same as its own, as when it names none and the parent has no primary key
(`table:<child>`). Both column checks count generated columns. Guard: the leave-behind cases in `apps/server/src/configuration-transfer.test.ts`.

**A module's transfer `validate` may read when and where the bundle was made.**
`ModuleConfigurationTransfer.validate` (`packages/module/src/module.ts`) takes an optional second
argument, `{ createdAt, timeZone }`, which `validateConfigurationBundle`
(`apps/server/src/configuration-transfer.ts`) fills from the bundle and passes to every module's
`validate` before the import writes anything. Core, catalogue and media take only the tables.
Venue-service uses it to leave out a clash between two days already past in the venue's zone when
the bundle was made, as a save does, so a venue's own export imports again. It reads no day
cutover: for a venue whose cutover or numeric-offset zone a save cannot read, the save checks every
pair while the import still leaves past pairs out. It also refuses a special-date period that opens
or closes at a minute the clocks skip in that zone, unless that date and the day after it were both
past when the bundle was made; a default station's kept cells are not checked.

**Transactions**

## Multi-table writes share ONE transaction, and `withTransaction` IS that transaction

(`packages/db/src/tenancy.ts`). Write-path functions take a `tx: Transaction` and never open their
own; a route handler opens exactly one `withTransaction` per request (`recordSale`'s header says why —
`packages/core/src/record-sale.ts`). A convention, not a compiler guarantee: `Database` is assignable
to `Transaction`, and an ESLint backstop was declined (2026-09-03). **Splitting one logical change
across transactions is a commented decision, never a default.** `provisionVenue` stamps the database
before its venue transaction opens, and its header says so. `adoptFromPrimary` opens no transaction
around its writes and has file writes between them, and its header does not say so (tracked in
`docs/backlog.md`, from #625's review).

A secret check that derives an scrypt key should be the exception: it takes the `Database` rather
than a `tx` and derives the key with no transaction open, because `withTransaction` is the venue's
single write lock (`packages/db/src/tenancy.ts`) and every other write would wait on scrypt. One
that must act on the row afterwards re-reads it once the key is derived, and opens a transaction
only for its own write. Sites that follow it include `tryReadDevice`
(`apps/server/src/device-session.ts`), `authenticateAgent` (`packages/printing/src/agent.ts`),
`verifyBreakGlass` (`apps/server/src/break-glass.ts`), and `readJoinStatus` and
`readAgentJoinStatus` (`apps/server/src/join-requests.ts`), which read inside one transaction and
verify after it closes.

The PIN, manager-password and own-password checks follow it in two halves (W1, #1117). The route first
calls `checkPin` (`packages/identity/src/credential.ts`), `checkManagerPassword`
(`packages/identity/src/manager-login.ts`) or `checkOwnPassword` (`packages/identity/src/profile.ts`)
with no transaction open, and hands the result to the check inside its transaction
(`verifyPersonCredential`, `authorize`'s override, `loginWithPin`, `loginManager`, `loginManagerById`,
the profile changes). That inner check re-reads the row and reuses the result only if identity issued
it, for the same person and secret, against the same stored hash
(`packages/identity/src/secret-check.ts`); otherwise it derives inside the transaction exactly as
before. A wrong-PIN or wrong-password limit that sat inside the transaction stays there, ahead of the
reuse. The server's early halves include `withPinCheckAhead` (`apps/server/src/pin-check-ahead.ts`),
`ownPasswordChanges` (`apps/server/src/own-password-ahead.ts`), `pinGated`
(`apps/server/src/payments-api.ts`) and direct `checkPin` and `checkManagerPassword` calls in the
sign-in, promote and mirror-bundle routes.
`grep -rn 'withPinCheckAhead\|ownPasswordChanges\|pinGated\|checkPin(\|checkManagerPassword(' apps/server/src --exclude='*.test.ts'`
lists the two helpers' own files and every route file with an early check. Each runs the early check when what the route can read before the transaction says the
secret will be checked, so a request the transaction refuses before its own check (an order already
cancelled, a profile save that changes the email and blanks the name) has derived a key for nothing. `withPinCheckAhead` and
`ownPasswordChanges` ask the throttle's `wouldRefuse`, which changes no state, and attempts on the
same throttle key take turns, outside the write lock, from the early check until the request's
transaction finishes (`inTurn`, `apps/server/src/attempt-turns.ts`), so attempts sent at once are
each checked only after the outcomes before them are counted. `inTurn` must never be awaited inside
a transaction, and nothing checks that. **Weaker than it looks:** nothing makes a route pass a result or take turns, so a new
route that forgets the early half still derives under the write lock, one that skips the turns derives a key for every attempt
sent at once even after the limit would refuse them, and no guard notices. The tests that see
it are per route: each converted route has a case in which another writer commits while the key is
derived, and it fails if a key is derived while the request's own transaction holds the lock.

Queries sharing one transaction are awaited one at a time, never started together with
`Promise.all`. The MECHANISM changed with the engine; the rule did not. On this one there is nothing
to overlap in the first place: the driver is synchronous — `execute` hands back its rows rather than
a promise of them (`packages/store/src/node-sqlite-adapter.ts`) — and a venue file takes one write
transaction at a time, because `withTransaction` runs its body inside `db.withWriteLock`
(`packages/db/src/tenancy.ts`, `packages/store/src/write-queue.ts`). So `Promise.all` over a
transaction's queries buys nothing and hides the order the statements really run in. **No timing has
been taken on this engine**, and none is claimed here. What was measured is an outcome, not a
timing — 2026-09-22: two reads and two `create table`s issued with `Promise.all` inside one
`withTransaction` all completed, so the hazard is ORDER, not loss. Re-run 2026-10-03 on
`node:sqlite`, Node v26.7.0, through the real `withTransaction`: both tables existed afterwards.

**No test or guard enforces this rule anywhere.** The `fireLines` single-call test and the
preparation-route read-count test count calls and queries; neither can tell whether queries overlap.
The missing guard is an item in `docs/backlog.md`, under "Modules, data and code health".

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
rows only. It is reachable rather than theoretical: the
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

**Three exposures left open deliberately**, all recorded in `docs/backlog/architecture.md`. A transaction opened
by running `begin` is not one the store is told about, so a read concurrent with it still lands on
the writer and sees its rows. A write issued from outside a running body while one is open is
refused by the reader and re-run on the writer, where it joins that transaction if it is still open
and commits or rolls back with it — which is what one connection did, and nothing refuses it; in the
moment after the queue's `commit` and before the body has ended, none is open and the write commits
by itself. And `readOnly: true`
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

**The three shapes outside the rule, as the rule states them.** Each is stated at its site: a
transaction opened by RUNNING `begin`, a write issued from outside a running body, and a statement
that changes a CONNECTION rather than the file — a temporary table, an `ATTACH` of an existing
file or `:memory:` (one naming a missing file is refused, errcode 14 — measured 2026-10-07, Node
v26.7.0), a connection-scoped pragma — which a read-only connection does not refuse.

## A refused statement does NOT abort the transaction here, and all a savepoint still buys is confinement of a losing attempt's own writes

**This is the sentence in the file most worth getting right: a refusal leaves the transaction
usable.** Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, inside one `begin immediate`: a
duplicate primary key (errcode 1555), a null in a `not null` column (1299) and a trigger's
`RAISE(ABORT)` (1811) were each caught and the next statement ran normally, and at `commit` the rows
written before AND after every refusal were all present while the refused rows were not.
`bench/sqlite-failover/README.md` records the same codes from its own probe, plus 2067 for a
two-column `UNIQUE`.

**So what a savepoint can still buy here is confinement, and the sites named below say whether they
need it.** Among the nested calls, `enqueueSuccessor` (`packages/scheduler/src/store.ts`), the two
`appendToChain` functions (`packages/fiscal-verifactu/src/chain.ts`,
`packages/workforce/src/chain.ts`) and `insertClose`
(`packages/reporting/src/record-daily-close.ts`) wrap a statement that may be refused in a nested
`tx.transaction(...)`, which the adapter emits as `savepoint` / `release` / `rollback to` whenever a
transaction is already open (`packages/store/src/node-sqlite-adapter.ts` — SQLite refuses a `begin`
inside a `begin`). What that buys is CONFINEMENT: a losing attempt's own partial writes are backed
out with it rather than left for the enclosing transaction to commit. In `enqueueSuccessor` and
`insertClose` the nested body is one insert, which SQLite backs out by itself when refused, so there
it confines nothing today. #581's review replaced `enqueueSuccessor`'s nested call with a bare
insert and reported `store.test.ts` and `store.concurrency.test.ts` passing, 24 tests, without
mentioning stubs. Re-run 2026-09-24 alongside the `insertClose` check below, the same replacement
gave 22 passed and 2 failed, because two stubs in `store.concurrency.test.ts` offer `insert` only
inside `transaction`; once those two stubs offered it outside too, all 24 passed. With
`insertClose`'s nested call replaced by a plain insert on `tx`, `@waitron/reporting`'s whole suite
passed (220 tests), and a probe run on that same modified copy refused a second close of the same
day inside a transaction that then committed and left the row count of every table unchanged, where
the control, a close for a new day, moved `daily_closes` from 1 to 2 — the table's only triggers are
its append-only pair, on update and delete (2026-09-24).

Since 2026-09-21 `withTransaction` ends every transaction with a drain of `change_log`
(`packages/db/src/tenancy.ts`). On this engine the drain is there for the change feed alone.

**The test corollary, and its REASON is gone.** A test for a refusal caught it around the whole
`withTransaction` call and never inside the callback, because inside, the expectation itself ran in
an aborted transaction. That reason is retired by the measurement above. Two test files had it the
other way round and were changed by hand on the branch that added the drain
(`packages/purchasing/src/operations.test.ts` and `packages/db/src/schema/join-requests.test.ts`);
they were not changed back, and no guard reads for the shape either way. Whether catching inside the
callback is now harmless has NOT been established, so the outside-the-call shape is still the one to
copy — as a habit whose receipt has expired, not as a rule with one.

## A refusal under result code 1811 is identified by its words

SQLite reports a delete refused by an `ON DELETE RESTRICT` key and a trigger's `RAISE(ABORT)` under
the same result code, 1811; only the message separates them. Measured 2026-09-27 on `node:sqlite`
(Node v26.7.0): a restricted delete reports 1811 with `FOREIGN KEY constraint failed`, and an insert
naming no parent reports the same words under 787 (both driven in
`packages/db/src/constraint-target.db.test.ts`). So `restrictRefused` checks the code and the
words on one layer, and it would also accept a trigger that raised exactly those words (none does
today).

The layouts stores (`packages/layouts/src/canvas-store.ts`, `device-profile-store.ts`) had asked for
1811 alone. They gave the right answer only because one trigger sat on the device-profile path,
`device_profile_form_factor_locked`, whose meaning matched `device_profile.in_use`. That store now
matches it by its own words (`FORM_FACTOR_REFUSAL`, `packages/db/src/trigger-refusals.ts`).

Cost: the two layouts stores asked for the code alone, so a second refusing trigger on either path
would have been reported as `canvas.in_use` or `device_profile.in_use`.

## One process per venue folder

**The rule.** Opening a venue folder (`openVenueStore`, and so `openVenueDatabase`) holds
`venue.lock` in it for as long as any open in the process is using the folder. A second PROCESS is
refused at once, before either database file is opened: `@waitron/store` (`lockVenueDirectory`,
`openVenueStore`) throws `VenueInUseError`, and `@waitron/db` (`openVenueDatabase`,
`lockVenueDatabase`) turns that into `AppError("provisioning.database_in_use", { database })`, the
code every caller outside those two packages sees. Opens inside one process share the hold, and the
last close gives it up. A tool documented to run beside
the server opens with `exclusive: false` and takes no lock. A command that changes the folder's files
(the cold restore, rejoin's wipe, the container start's clearing of set-aside folders) takes
`lockVenueDatabase` before its first change. The restart reset of in-flight AEAT submissions
(`apps/server/src/restart-reset.ts`) relies on one server process per folder.

**Litestream is a second process on `venue.db`, and it takes no lock.** While a primary streams its
copy to the owner's bucket, the server runs Litestream as its own child process
(`packages/stream/src/supervisor.ts`), and Litestream reads and writes `venue.db` without
`venue.lock`; it adds `_litestream_seq` and `_litestream_lock` tables inside the file and a
`.venue.db-litestream/` folder beside it (the last section of this file). It is only
ever started by the server that holds the lock, and the server's shutdown awaits its stop before
closing the store, closing the store even if that stop fails (`apps/server/src/boot.ts`).

**The mechanism: a SQLite transaction on an empty file, not a lock file.** `venue.lock` is opened
with `node:sqlite`, `pragma busy_timeout = 0`, and `begin immediate` is left open. It is the same
mechanism the migrator uses for `migrations.lock` (`packages/store/src/migration-lock.ts`).
`packages/migrations/src/apply.ts` records why an exclusively created file would not do: a crash
would leave it behind and refuse every later boot.

**Measured 2026-09-24, `node:sqlite`, Node v26.7.0, macOS 26.6.2 on arm64**, by a throwaway script
outside the repository. Each child process opened `venue.lock` with a zero busy timeout. What it
printed:

- While one process held `begin immediate` on the file, another process's `begin immediate` was
  refused `errcode=5 message="database is locked"`, in about 1.1 ms measured inside the child. A
  third connection's plain read of the file (`select count(*) from sqlite_master`) answered
  `{"n":0}`, not blocked. Control, same file with no holder: `acquired`.
- A second connection in the SAME process was refused the same way: `errcode=5 "database is
  locked"`. That is why the lock is counted per process rather than taken per open: the server opens
  its own folder more than once at a time (the backup supervisor's reload beside the long-lived
  store), and so do the restore and rejoin, whose migrate opens inside their hold.
- While held, the folder held `venue.lock (0B), venue.lock-journal (512B)`. The holder was killed
  with `SIGKILL`; both files were still there, and a new acquirer printed `acquired` at once. After
  that acquirer closed cleanly, only `venue.lock (0B)` remained.
- A holder that closed its connection with the transaction still open released it: before the close
  another process was refused `errcode=5`, after it `acquired`.
- **Never unlink `venue.lock`.** With a holder alive, unlinking `venue.lock` alone, or it and its
  journal, and then trying from another process printed `acquired` both times: the new file is a
  different lock, taken beside the holder. `apps/server/src/db-wipe.ts` records the same for
  `migrations.lock`.
- A `venue.lock` that is a DIRECTORY is refused by the constructor with errcode 14, `unable to open
  database file`, which the lock passes on as it came rather than reporting it as in use.

**That is macOS, and the box runs Linux.** The store suite's "does not stay locked after the holder
is killed" case (`packages/store/src/venue-lock.test.ts`) runs in CI on `ubuntu-latest`; that run is
the Linux reading, not this paragraph.

**Why the migrator's lock cannot serve.** It is held only while migrations run and then released, and
it WAITS (up to two minutes, `LOCK_WAIT_MS`) for another migrator, where a second server has to be
refused at once. Held for the life of the process, it would make that process's own later migrate
wait on itself, because a second connection in one process is refused (above). So the two files
nest: `applyMigrations` takes `migrations.lock`, then opens the store, which takes (or shares)
`venue.lock`.

**And why the migrator's lock is still needed beside it.** Measured 2026-09-24, same machine: two
processes each running only `applyMigrations` over every manifest set, started together on one fresh
folder, ten races, the two start-to-end windows overlapping in every race. With the lock as shipped,
all twenty runs printed `ok`, and the folder afterwards held 122 tables and 29 journal rows across 13
journal tables — the same as one migrator run alone. With the migrator's `begin immediate` removed
(a temporary edit, reverted), one process of every pair was refused
`provisioning.database_in_use`. So `migrations.lock`, taken first, is what makes the second migrator
WAIT for the first instead of being refused by the first's open. It does not help when the first
process keeps the folder open after migrating, as boot does with its long-lived store: in a race of
two processes that each migrated and then opened the folder again, one of the pair was refused in 9
of 20 races, which for two servers is the point. Guard: the "two real migrating
processes" case in `packages/migrations/src/apply.concurrency.test.ts`, whose two child hosts run the
real `applyMigrations`; with the migrator's `begin immediate` removed it fails with one host refused
`provisioning.database_in_use`. The file's older peer case holds `migrations.lock` alone and never
opens the store, so it could not see this.

**Who holds it: the holder file.** The first take of a folder in a process writes
`venue.holder.json` beside `venue.lock`, in the same synchronous step as the lock
(`packages/store/src/venue-lock.ts` → `beginHolding` in `venue-liveness.ts`). It names the holder's
`kind` (`server`, `restore`, `rejoin`, `provisioning`, or `script` for anything that did not name
itself), `pid`, `host`, `lockedAt` and `heartbeatAt`. A main-thread timer rewrites the heartbeat
every 5 s, and the last release removes the file before it lets the lock go. A program names itself
with `setVenueHolderIdentity` (`packages/db/src/venue-holder-identity.ts`), which also gives its
watchdog the report folder, the log file and the version. These do: the server (`apps/server/src/bin.ts`
and `node-entry.ts`), restore and rejoin (`bin-restore.ts`, `bin-rejoin.ts`, through
`apps/server/src/holder-identity.ts`), and the provisioning command (`packages/provisioning/src/bin.ts`).
The development and demo scripts under `apps/server/scripts` name nothing and report `script`, and
nothing checks that a new entry point names itself. `waitron-break-glass` and `waitron-credentials`
open the folder with `exclusive: false`, so they take no lock and write no holder file. A holder that
dies leaves its file behind; the next holder overwrites it.

**Two limits, on purpose.** A start refused `provisioning.database_in_use`
(`apps/server/src/node-entry.ts`) reads the file with `readVenueHolder` and `/health` with
`readVenueHolderAsync`, one parser behind both, and both call the
heartbeat stale at 30 s (`VENUE_HOLDER_STALE_MS`). A stale, missing or unreadable file makes the
refusal count toward the recovery page, as `provisioning.database_holder_stalled`; a fresh one puts
the count back. The holder's own watchdog kills it only after 120 s without a main-thread tick
(`WATCHDOG_KILL_MS`). The gap is for synchronous work that stops the timers without anything being
stuck: `VACUUM INTO` of a 2.3 GB database took 2412 ms and `wal_checkpoint(truncate)` 32 ms (Node
v26.7.0, macOS, NVMe). A box on slower storage could come near 30 s, and killing a backup in the
middle every cycle is worse than a stuck holder living 90 s longer.

**The watchdog, and how the stack is read.** One `worker_threads` worker per process watches a
tick the main thread stamps every second. After 120 s without one it connects to the main thread
through the inspector (`Session.connectToMainThread`, `Debugger.pause`), waits up to 2 s for the
paused frames, writes one line to standard error (and to the log file it was given), writes a JSON
report file to the directory it was given, and sends the process `SIGKILL`, which releases the lock
like any other death. Experiments, 2026-09-24, Node v26.7.0, macOS, against a deliberately frozen
process:

- The inspector route printed the frozen function for a `while (true) {}` and for an
  `Atomics.wait`. For a long synchronous `node:sqlite` statement and a blocking read of a FIFO it
  got no paused frames in 2 s, and the process was killed without a stack.
- `process.report.getReport()` called in the worker reported the WORKER's own stack, and included
  31 environment variables although the main thread had set `excludeEnv`.
- `reportOnSignal` with the worker sending `SIGUSR2` to its own process wrote no report within 2 s
  while the main thread spun.
- A worker's `console.error` is relayed through the main thread, so it never printed while that
  thread was frozen; the worker writes to file descriptor 2 directly.
- Control: a main thread awaiting a 4 s timer was not killed.

The report file holds exactly `code`, `stack`, `kind`, `pid`, `host`, `lockedAt`, `lastTickAt`,
`killedAt` and `version`: no environment, no command line, no venue data. The programs that
name themselves put these files in `<logDir>/crash-reports`, where `<logDir>` is `WAITRON_LOG_DIR`,
else `logs` under the state directory, an empty value counting as unset (`resolveLogDir`); on a box
that is the `logs` volume. The provisioning command has no state-directory default, so with neither
variable set it writes no file, and neither does a program that did not name itself: both write the
line to their own error output only. The recovery page reads only `waitron.log`.

**`recovery.json` has a lock of its own.** Every change to the recovery count (the count before a
boot, the classified failure, a refused start's undo, the stayed-up clear, the recovery page's
retry) is one read and one write while holding `recovery.lock` in the state folder
(`apps/server/src/recovery-lock.ts`). It is the same `begin immediate` technique, but it polls
instead of setting a busy timeout, because the engine's busy wait stops the whole thread: a second
connection in one process with `busy_timeout = 1500` blocked for 4093 ms with a 50 ms timer firing 0
times. Never unlink `recovery.lock` either. Guard: `apps/server/src/recovery-race.test.ts`. Each
of its races but the undo-after-clear one runs real child processes twice: with the lock, where no write is lost, and with the
lock held around the write alone, where the test requires that a write IS lost — another start's
counted failure in the counting races, the running server's clear in the clear-versus-undo race.
That second run is what shows each schedule races at all. The lock around the write stays in it because two writers
without one clash on `recovery.json.tmp` and crash, which is not the failure being tested.

The lock orders the writes; it does not decide what a refused start's undo takes off. For that,
`recovery.json` carries `clears`, how many times the count has been cleared, and every clear (the
stayed-up clear and the recovery page's retry) moves it on by one. An undo whose own count was made
before the latest clear takes nothing off, because the clear already removed it; without that, a
start refused after a clear took off the failure a later start had counted
(`apps/server/src/recovery-state.ts`, `withoutAttempt`). The undo-after-clear race in the same file runs that
schedule once, with the lock, in separate processes; against the code before `clears` existed it
ended with a count of 0 where 1 is right.

**What the guard does not see.** `packages/store/src/venue-lock.test.ts` proves the lock itself. It
does not prove that every caller that should take the lock does: a new caller passing `exclusive:
false` wrongly, or a new command that changes the folder's files without `lockVenueDatabase`, is seen
by nothing.

Every change to `recovery.json` goes through `updateRecoveryState` under `recovery.lock`. Its guard,
`apps/server/src/recovery-race.test.ts`, is weaker than its name in the same way: it proves the
lock, not that every writer of the file takes it.

**Every caller, and what it does** (from `grep -rln "openVenueStore\|openVenueDatabase"` over `apps`,
`packages`, `scripts` and `bench`, non-test files, 2026-09-25):

| Caller | Runs | Decision |
| --- | --- | --- |
| `apps/server/src/boot.ts` | the server | locks three times in turn: the stamp probe, the migrate, and the long-lived store, which holds it until the server closes or its start fails. Between them the folder is briefly free, unless the container entry (`node-entry.ts`) started the server: its hold covers those gaps |
| `apps/server/src/backup-supervisor.ts` (`reload`) | inside the server | shares the server's hold |
| `apps/server/src/node-entry.ts` (`clearReplacedDatabases`, `assertNotAhead`) and the staged restore and staged reset it runs | the container entrypoint, the same process as the server | the staged restore, then the staged reset, each locks on its own and releases before `runEntry` takes `lockVenueDatabase` and holds it from clearing set-aside folders (`clearReplacedDatabases`) through the ahead check until `startServer` settles or an earlier step throws. The ahead check's opens and the server's opens during its start share that hold |
| `apps/server/src/restore.ts` (`writeValidated`) | `waitron-restore` (server stopped) and the staged restore | takes the lock before its first change and holds it to the end; its migrate and hook open share it. Refused while another process holds the folder |
| `apps/server/src/restore-stream.ts` (`refuseIfArchiveSourceLive`, and `readRestoredCopy` inside `prepareStreamRestore`) | `waitron-restore`, before `writeValidated`; and the setup-mode server before it stages a restore (`boot.ts`): `refuseIfArchiveSourceLive` for `/setup-api/restore` and `/setup-api/cloud-recovery/restore`, `prepareStreamRestore` for `/setup-api/restore-bucket` | each locks (default) its own scratch folder under the state folder, made fresh per run (`archive-source-check-XXXXXX` for the archive's copy, `stream-restore-XXXXXX` for the download, which is opened once), never the venue folder; no contention |
| `apps/server/src/reset-request.ts` (`runStagedReset`) | the container entrypoint, when the setup wizard has staged a reset, before the server starts | takes `lockVenueDatabase` before its first check and holds it through the wipe; its `openVenueDatabase` for the check shares that hold, and it releases before `runEntry` locks again |
| `apps/server/src/rejoin-command.ts` | `waitron-rejoin` (server stopped) | takes the lock before its first read and holds it through the wipe and re-migrate. Refused while another process holds the folder |
| `packages/migrations/src/apply.ts` | boot, restore, rejoin, dev scripts | locks (default), inside its own `migrations.lock` |
| `packages/provisioning/src/bin.ts` (`waitron-provision venue`) | once per venue | locks; refused while another process holds the folder, printed as `provisioning.database_in_use {"database":…}` |
| `apps/server/scripts/register-till.ts` | registers a node as a Veri\*Factu SIF, closing any previous chain | locks; refused while another process holds the folder |
| `apps/server/scripts/dev-setup.ts`, `dev-onboard` through `applyMigrations` | before a dev server starts | locks; refused while another process, such as a dev server, holds the same folder |
| the dev server, `tsx watch` (`apps/server/scripts/dev-server.mjs`) | development | locks, as the server does. A restart waits for the old process's `exit` event before starting the new one: `killProcess` in `tsx@4.23.13`'s `dist/cli.mjs`, read, not run |
| `apps/server/src/break-glass-command.ts` | beside the server (`deploy/README.md`) | `exclusive: false` |
| `packages/credentials/src/bin.ts` | beside the server (`apps/server/README.md`: credentials are read fresh every pass, no restart) | `exclusive: false` |
| `apps/server/scripts/record-one-sale.ts`, `settle-invoice-first.ts` | write sales for a running server to drain | `exclusive: false` |
| `apps/server/scripts/cloud-backup-fixture.ts` `capture` | the Cloud repository's local-backups runner (`test-local-backups.mjs` in its scripts folder), while the fixture server on the same folder is still running (it stops the servers only after every capture: read, not run) | `exclusive: false` |
| `apps/server/scripts/cloud-backup-fixture.ts` `restore` | the same runner, on a fresh folder with no server (read, not run) | locks (default), through `writeValidated`, then its own open |
| `apps/server/scripts/cloud-capture-client-fixture.ts` (`schedule`), `cloud-recovery-client-fixture.ts` (`restore`, `prepareReplacement`, `statusReplacement`) | Cloud's integration runners, on a folder under the system's temporary directory; whether a server holds the same folder at that moment was not checked | locks (default); the recovery fixture's `restore` also locks through `runStagedRestore` first |
| `apps/server/scripts/cloud-integration-fixture.ts` | Cloud's runners start it as the server; a restart waits for the old process to exit before relaunching on the same folder (`stop` awaits the child's `exit` before `launch`: Cloud's runner scripts, read, not run) | locks (default); its first open runs before `startServer` in the same process |
| `apps/server/src/fiscal-readiness-runner.ts` | its own directory | locks; no contention |
| `*-demo.ts` scripts, `apps/server/scripts/testing/venue.ts`, `useVenueDb` | their own temporary directories | locks; no contention |

`deploy/waitron.sh` reads the stamp from `venue.db` with its own read-only `node:sqlite` connection,
not through the store, so it takes no lock and is never refused.

### A failed start undoes what it started, and gives the folder back

The cost: a start that failed after boot's long-lived open left the venue store open, and with it
the folder's `venue.lock`, held by a process that would never serve. Reproduced (lane A's A39,
2026-09-26) for an unreadable pending-adoption file, an empty fiscal slot, and an unreadable
certificate on an adoption-pending start and on a trading start. The review of that fix then found
the tunnel and the listeners still running after a failed start. So each step `bootServer`
(`apps/server/src/boot.ts`) starts pushes its stop onto `undoOnFailure`, and `startServer` runs
them newest first when the body throws, then re-throws. Two deletions, run 2026-09-26 against
`apps/server/src/boot.failed-start.test.ts`: without the tunnel's undo, the fake relay still
counted one connection open after the start had failed (`expected 1 to be +0`); without the trading
listener's undo, binding its port afterwards failed with `EADDRINUSE`.

What that suite does not see, each run the same day: with `.reverse()` dropped, so the store closes
FIRST, all eleven cases still pass, while the background loop's card sweep logged
`resolve_pending.failed` with `database is not open`; removing
`await loop` or `liveEvents.close()` from the undos still passes; and the setup, adoption-pending
and throwing-undo cases close a listener that has not bound yet — its close reports
`ERR_SERVER_NOT_RUNNING`, which the unwind drops — so only the trading and tunnel cases close a
bound one.

On 2026-10-03, W3 added failed-start cases for a rejecting cloud worker and a throwing change-feed
unsubscribe. Against the changed suite, removing `.reverse()` timed out in the trading and cloud
cases, and removing `liveEvents.close()` failed its assertion. Removing `await loop` still passed
all 15 cases. The 2026-09-26 deletion results above describe the suite as it stood then.

The landing listener, started last, is the one step not on the list.

**What the guard does not see.** `apps/server/src/boot.failed-start.test.ts` is weaker than its
name — it covers only the duties it names, so a new one that forgets is seen by nothing. Removing
`await loop` still passes, so not every stop is proven to finish before the store closes.

## A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is NOT the query's isolation boundary

> **Superseded 2026-09-14.** There is no tenant column to compare against any more: the taxpayer is
> the one row in `tenants` (`id = 1`), and nothing filters by a tenant. Built in #378. The rest of
> this section is kept as the record of why the rule existed; the probe it describes cannot be
> written any more, because a second taxpayer row cannot be inserted. What survives it is the habit,
> not the clause: only the seat that RAN a probe found the defect four reading passes had cleared.

Since RLS was dropped (#255) `withTenant` no longer isolates SELECTs, so every read scopes to the
tenant itself — a by-id read as much as a list read, never trusting a globally-unique UUID or the
deployment invariant. Cost: `getHeldOrder`/`abandonHeldOrder` keyed on the `working_orders.id` UUID
alone, so tenant A could read AND abandon tenant B's order in a multi-tenant DB (till reroute S3, #259). The
per-task review and four quality lenses all reasoned it "safe under one-tenant-per-db"; only the
run-it seat, which RAN a two-tenant probe, caught it — reading missed it,
running caught it (§1, §4).

## There is no tenant column

**There is no tenant column. The taxpayer is the one row in `tenants` (id = 1, singleton check); a
query that wants "this tenant's rows" reads the table.** (2026-09-14, #378.) Guard:
`scripts/no-tenant-column.test.ts`, weaker than its name in ways its own header states, among
them — it matches the column's SPELLINGS, so a column reintroduced under an unrelated name passes,
and it does not read test files.

## No backwards-compatibility or data-migration code until Waitron is in production

No real venue is live, so any installation may be reset at any time instead of carrying its data
forward (owner, 2026-10-03). A backfill for an empty database is code to
maintain that buys nothing — and the first draft of the settlement design carried one that could only
ever GUESS which tender a tip belonged to, which is worse than discarding. This rule expires the day a
real venue is live; add its replacement in the same change.

## An empty value is a valid value

A path variable that is unset OR empty falls back to
its default through `isUnset` (`apps/server/src/env-value.ts`) and never through `resolve("")`,
which is the process's working directory. `apps/server/src/config.ts` states it at `stateDir`,
`venueDir` and `logDir`. The refusal shape is the other half, for a reader with no default to fall
back to: `resolveVenueDir` (`packages/provisioning/src/cli.ts`) takes `--venue-dir`, then
`WAITRON_VENUE_DIR`, then a prompt, and throws `provisioning.venue_dir_missing` when all three give
nothing — because every path the store builds is `join(directory, …)`, so an empty directory is the
RELATIVE `venue.db` rather than no directory at all.

An env or prompt value set to `""` falls back to its default exactly as an unset one does (in
`apps/server`, through `isUnset` in `apps/server/src/env-value.ts`; the log folder through
`resolveLogDir` in `packages/db/src/venue-holder-identity.ts`), and a reader with no default refuses
`""` explicitly, as `resolveVenueDir` does with `provisioning.venue_dir_missing`.

**Migrations**

## A drizzle migration-number collision on rebase is fixed by regeneration, never by hand-editing the snapshots or `_journal.json`

At the paused rebase, reset the migrations dir to main's exact state
(`git checkout origin/main -- packages/db/drizzle/`; keep the branch's `src/schema/*.ts`), then
`pnpm --filter @waitron/db db:generate --name <foo>` (and `db:generate:custom --name <foo>_sql`,
pasting back any hand-written SQL you saved first — a regeneration DROPS it, which is exactly how
core's nine behavioural triggers and media's two image foreign keys were lost at the flip; both
replacement files record it in their own headers). Stage only your migrations, `rebase --continue`,
and verify by RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
`scripts/behavioural-triggers.test.ts` (it pins every hand-written trigger by name, so it is what
notices one dropped), `scripts/migrations-match-schema.test.ts` and
`packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
Paid for on #165.

The justification this used to carry — "works because the snapshot chain deliberately lags the DB,
custom migrations being snapshot-less" — is half right. The hand-written `--custom` migrations in
the tree (`packages/db/drizzle/0001_behavioural_triggers.sql`,
`packages/db/drizzle/0004_variant_one_level.sql`,
`packages/db/drizzle/0015_settled_order_freeze_new_columns.sql`,
`packages/db/drizzle/0019_settled_order_freeze_visit_id.sql`,
`packages/db/drizzle/0020_visit_clears_table_status.sql`,
`packages/db/drizzle/0024_bill_payment_triggers.sql`,
`packages/db/drizzle/0027_line_vat_class_triggers.sql`,
`packages/db/drizzle/0033_line_served_exception.sql`,
`packages/db/drizzle/0038_main_bill_release.sql` (two triggers on `working_orders` that clear
`parties.main_bill_id`),
`packages/db/drizzle/0042_placed_bill_moves.sql` (a presented bill changing party),
`packages/db/drizzle/0043_drop_triggers_before_rebuild.sql` and
`packages/db/drizzle/0045_recreate_triggers_after_rebuild.sql` (the three triggers around `0044`'s
rebuild of `dining_tables`, `parties` and `service_commands`),
`packages/db/drizzle/0047_product_ordering_check.sql`,
`packages/db/drizzle/0050_line_list_price_frozen.sql` (re-creates
`working_order_lines_require_open_parent_update` with `list_unit_price_gross` in both
unchanged-column lists),
`packages/db/drizzle/0053_line_sent_after_close.sql` (re-creates
`working_order_lines_require_open_parent_update` with an exception for a line's first sent stamp),
`packages/db/drizzle/0056_placed_order_handover.sql` (re-creates
`working_orders_enforce_transition` with an exception for a sent, unpaid order's handover stamp),
`packages/db/drizzle/0059_drop_product_triggers_before_rebuild.sql` and
`packages/db/drizzle/0061_recreate_product_triggers.sql` (the triggers on `products` around
`0060`'s rebuild),
`packages/db/drizzle/0064_line_locale_triggers_text_only.sql` (re-creates the two locale update
triggers on `working_order_lines` to fire only when an update changes the name map each checks or
moves the line),
`packages/db/drizzle/0066_line_make_at_station_trigger.sql` (re-creates
`working_order_lines_require_open_parent_update` with `make_at_station_id` in each of its three
unchanged-column lists),
`packages/db/drizzle/0072_device_binding_watcher_sql.sql` (re-creates the two device binding
triggers so a kitchen display binds a station or a watcher),
`packages/db/drizzle/0080_money_records_drop_triggers.sql` and
`packages/db/drizzle/0082_money_records_recreate_triggers.sql` (the triggers around `0081`'s rebuild
of `sales`, `bill_payments`, `bill_payment_refunds` and `unpaid_departures`),
`packages/db/drizzle/0083_working_orders_drop_triggers.sql` and
`packages/db/drizzle/0086_working_orders_recreate_triggers.sql` (the triggers around `0085`'s
rebuild of `working_orders`),
`packages/db/drizzle/0089_devices_drop_triggers.sql` and
`packages/db/drizzle/0091_devices_recreate_triggers.sql` (the triggers around `0090`'s rebuild of
`devices`),
`packages/media/drizzle/0001_image_references.sql`,
`packages/media/drizzle/0002_section_image_references.sql`,
`packages/media/drizzle/0003_published_image_references.sql`,
`packages/media/drizzle/0004_drop_category_image_triggers.sql`,
`packages/media/drizzle/0006_recreate_section_image_triggers.sql`,
`packages/media/drizzle/0007_recreate_product_image_triggers.sql`,
`packages/media/drizzle/0008_queued_edition_image_references.sql`,
`packages/media/drizzle/0009_include_folder_image_references.sql`,
`packages/catalogue/drizzle/0013_drop_category_image_triggers.sql`,
`packages/catalogue/drizzle/0018_sections_owned_prepare.sql` and
`packages/catalogue/drizzle/0021_sections_owned_restore.sql`) each carry their own
`meta/000N_snapshot.json`, so they are not snapshot-less; but on 2026-09-26 (2026-09-27 for
`0024_bill_payment_triggers.sql`, 2026-09-28 for `0027_line_vat_class_triggers.sql`,
`0033_line_served_exception.sql` and `0038_main_bill_release.sql`, 2026-09-29 for
`0042_placed_bill_moves.sql`, `0043_drop_triggers_before_rebuild.sql` and
`0045_recreate_triggers_after_rebuild.sql`, 2026-09-30 for `0050_line_list_price_frozen.sql`, and
2026-10-01 for `0053_line_sent_after_close.sql` and `0056_placed_order_handover.sql`, and
2026-10-02 for core `0047_product_ordering_check.sql`,
`0059_drop_product_triggers_before_rebuild.sql`, `0061_recreate_product_triggers.sql` and
`0064_line_locale_triggers_text_only.sql`, media `0004_drop_category_image_triggers.sql`,
`0006_recreate_section_image_triggers.sql` and `0007_recreate_product_image_triggers.sql`, and
catalogue `0013_drop_category_image_triggers.sql`, `0018_sections_owned_prepare.sql` and
`0021_sections_owned_restore.sql`, and 2026-10-04 for core `0066`, `0072`, `0080`, `0082`, `0083`,
`0086`, `0089` and `0091`, and 2026-10-07 for media `0008_queued_edition_image_references.sql` and
`0009_include_folder_image_references.sql`)
each of those files equalled the one before it once `id` and
`prevId` were removed and keys sorted, except that `0042`'s `_meta.columns` no longer carried
`0041`'s column rename, so the snapshot chain records none of the hand-written SQL, which is why regenerating from the TypeScript
does not reproduce it.

Two generated migrations also carry hand-written SQL:
`packages/media/drizzle/0005_photo_name_only.sql` and `packages/db/drizzle/0036_party_rename.sql`.
In `0036` the whole file is hand-written: its header says drizzle-kit's generated SQL for the rename
rebuilt every table the rename touches and failed on a fresh database, so a regeneration must paste
the file back rather than keep drizzle's. In `0005`, Drizzle generated its rebuild of `media_images`;
the drop of media's eleven reference triggers and the copy of `media_image_data` aside before it,
and the restore of the bytes and the re-creation of the triggers after it, are hand-written, so a
regeneration must paste both parts back around the regenerated rebuild. Drizzle's rebuild on its
own empties `media_image_data` through that table's cascading key (with the triggers handled and no
copy, the upgrade test found it empty; recorded in the commit "Photos keep only a name: drop alt
text and labels from the image table"), so the copy aside and the copy back sit in the same file as
the rebuild and no migration step ends with the bytes gone.

## A constraint that lives only in hand-written migration SQL is one regeneration away from gone

**A constraint that lives only in hand-written migration SQL is one regeneration away from gone,
and nothing else in the tree notices.** Declare every foreign key and every unique index in the
TypeScript schema, so `drizzle-kit generate` carries it; where one genuinely cannot be declared,
say at the column what it cost and where the refusal moved to. Cost: regenerating the thirteen
sets for the storage switch dropped 33 foreign keys and 13 unique indexes, so an insert naming a
`device_profile_id` that exists nowhere was accepted and stored the dangling id; the first thing
that would have failed was a route test several step groups later.

**What the guard does not see.** `scripts/schema-constraints.test.ts` is weaker than its name in
ways its header states — it reads the schema the migrations BUILD rather than trying an offending
insert, so it cannot tell a key SQLite records from a key SQLite enforces, and it matches a unique
index by NAME, so an index whose columns changed under a kept name passes.

## Editing a shipped migration file, even a comment, needs a venue reset

Drizzle records a hash of each migration file's whole text in the database's journal table, and
`assertNotAhead` (`packages/provisioning/src/schema-ahead.ts`) treats a recorded hash the image does
not ship as a migration from a NEWER image, refusing the start with `provisioning.database_ahead`.
`packages/migrations/src/journal-hashes.test.ts` pins how drizzle computes the hash. Measured
2026-10-02 with drizzle's own `readMigrationFiles` (`drizzle-orm@0.45.3`): editing only comment
lines in `packages/db/drizzle/0001_behavioural_triggers.sql` and
`packages/media/drizzle/0001_image_references.sql` changed exactly those two files' hashes, index 1
of 68 and index 1 of 8. So such an edit ships only with a reset of every venue already migrated,
said in the pull request's first line. Cost: #1036 had to restore both files byte for byte; the
owner then chose to edit them and reset the venues.

The unit case "reports an EDITED migration, whose hash changed although the count did not"
(`packages/provisioning/src/schema-ahead.test.ts`) covers the comparison on plain strings. The
review of the 2026-10-02 edit also ran it against real databases: one migrated with the files as
they shipped was refused with `provisioning.database_ahead` by `assertNotAhead` against the edited
files (`findAheadSets` listed the core and media sets; the refusal names only the first, core), and
one migrated with the edited files was accepted. A rebuild from the bucket runs the same check
(`apps/server/src/restore-stream.ts` calls `assertNotAhead`), so a copy streamed before the edit
carries the old hashes too, and so does an archive taken before it: a cold restore runs no ahead
check of its own, and the start after it does (`apps/server/src/node-entry.ts`). Nothing guards
against such an edit: the 2026-10-02 one passed `scripts/migrations-match-schema.test.ts`,
`scripts/migration-upgrade.test.ts`, `scripts/schema-constraints.test.ts`,
`scripts/behavioural-triggers.test.ts`, `scripts/append-only-triggers.test.ts` and
`packages/migrations`'s suite.

## Drizzle picks what to apply from `max(created_at)` alone

Never from a position in the journal file, so an entry whose `when` sits AT OR BELOW one the database
already recorded never runs, and DRIZZLE raises nothing — it applies part of a set and returns
cleanly. The dialect that runs is `sqlite-core`: in `drizzle-orm@0.45.3/sqlite-core/dialect.js`,
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
every copy — and nothing enforces the pointer, so a drizzle bump starts with that grep and fixes
each one by hand.

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
evidence that any `when` in the tree is right. The sets that carry more than one entry are the ones
whose case compares something — seven of fourteen when counted on 2026-10-03 (`db`, `catalogue`,
`venue-service`, `media`, `identity`, `adjustments` and `payments`); count again rather than trusting
that list. `outOfOrder` itself is pinned by a synthetic negative control, plus the anti-vacuity anchor
that every journal is on disk.

## A migration file's last statement takes no trailing `--> statement-breakpoint`

Drizzle's migrator splits each file on `--> statement-breakpoint` and keeps every piece, empty ones
included (`drizzle-orm` 0.45.3, `migrator.js`, the `query.split(...)` in `readMigrationFiles`), and
this engine refuses an empty statement: measured 2026-10-03 on `node:sqlite`, Node v26.7.0,
`prepare("").run()` and `prepare("\n").run()` each threw `statement has been finalized`, while
`prepare("create table t(a)\n").run()` ran. So a hand-written migration whose last statement ends in a
breakpoint fails with that message, which names nothing in the file (2026-10-01).

## A generated table rebuild can copy a new column out of the old table

For a new `not null` column with a CHECK, a single drizzle-kit generation wrote a rebuild whose
`INSERT … SELECT` copied the new column out of the old table, which does not have it, and every
migrate failed with `no such column` (2026-09-27). #750 (commit 4a4ca65c9,
`service_settings.kitchen_ticket_grouping`) split it into two generations: `0005` adds the column
and `0006` rebuilds `service_settings` to add the CHECK. #721 hit the same rebuild copy with a
nullable column: "drizzle's single-step rebuild copied bill_payment_id FROM the old table". Read
generated SQL before trusting it.

The mechanism, read in `drizzle-kit` 0.31.11's `bin.cjs` on 2026-10-04: `SQLiteRecreateTableConvertor`
(around line 25195) builds its `INSERT INTO __new_x (…) SELECT … FROM x` from the column list of the
table in the NEW snapshot, so a column the same generation adds is selected from a table that lacks
it. `sqliteCombineStatements` (around line 27546) turns a generation into a rebuild when it changes a
column's type, default or nullability, drops or changes a foreign key, adds a foreign key to a
column that is not new, changes a primary key, or adds or drops a unique or CHECK constraint, among
others; in the generations A238 wrote, an added column with none of those beside it came out as
`ALTER TABLE … ADD` (core `0077`, `0084`, `0087`). A238 paid for it a
third time on 2026-10-03: its `incidents` generation that added `source` and `device_id` with their
CHECKs wrote `SELECT … "source" … FROM incidents` and the core suite failed with
`no such column: "source" - should this be a string literal in single-quotes?` (A238);
core `0077` now adds the two columns and `0078` adds the CHECKs while it drops `till_id`. The engine
half re-measured 2026-10-04 on `node:sqlite`, Node v26.7.0 (SQLite 3.53.4): an
`INSERT INTO __new_incidents (…, "source") SELECT …, "source" FROM incidents` on an EMPTY
`incidents` without that column threw that same message, and the control naming only the columns
`incidents` has ran.

## A generated table rebuild writes an expression index as a quoted column name

`drizzle-kit` 0.31.11 re-creates a rebuilt table's indexes through `prepareSQLiteRecreateTable`
(`bin.cjs`, around line 27400), which passes no `internal` record of which index columns are
expressions, and `CreateSqliteIndexConvertor` (around line 25084) wraps every column it is not told
is an expression in backticks. So an index over an expression, such as `incidents_open_dedup`'s
`case when "device_id" is null then '' else "device_id" end`, comes back as a quoted column name;
the plain create-index path passes `internal` and writes the expression as it is. A238's `incidents`
rebuild wrote ``(`source`,`case when "device_id" is null then '' else "device_id" end`,…)`` and the
migrate failed with `no such column: case when "device_id" …` (A238, 2026-10-03).
Re-measured 2026-10-04 on `node:sqlite`, Node v26.7.0 (SQLite 3.53.4): `CREATE INDEX` over the same
expression written against `till_id`, ``case when "till_id" is null then '' else "till_id" end`` in
backticks, threw `no such column: case when "till_id" is null then '' else "till_id"
end` on a scratch table, and the same expression unquoted was accepted. What A238 did: the index
leaves the schema for the generations that rebuild `incidents` (core `0077` drops it, `0078`
rebuilds the table) and comes back alone in `0079_incident_origin_dedup.sql`, written correctly; a
note at the index in `packages/db/src/schema/incidents.ts` says so. Any later change that rebuilds a
table with an expression index keeps the index out of the schema in every generation that rebuilds
the table and adds it back in a later generation. A wrong index fails the migrate loudly,
so nothing silent is at stake, only a round trip.

## `applyMigrations` refuses to report success on a short set

It compares the journal rows a set recorded against the entries the image ships and throws
`migrations.incomplete` when fewer applied, so a boot against an old release point fails loudly
instead of serving a half-migrated schema. Cost: a database at the core set's entry 1 reached HEAD
with 10 of 15 applied and no error, and the wrong schema surfaced later as an unclassified driver
failure. Pointer: `packages/migrations/src/apply-complete.test.ts`.

**The sale path and failover**

## Nothing external may block a sale, and a till needs the venue's primary

**Nothing EXTERNAL may block a sale — and a till needs the venue's PRIMARY.** AEAT, the card network
and the internet are never on the sale path of whichever node is primary: records chain locally and
the outbox drains later; a card falls back to 4G, a standalone terminal or cash. Fiscal submission
is an outbox, never inline.

What a till DOES need is the one node accepting sales. INTENDED: the on-site box when the internet
is down, a promoted cloud when the box is dead (which needs the internet), box-down AND
internet-down together being no failover — the MVP's accepted case. TODAY there is none of it: a
venue has ONE node and no failover at all until slice 3 (2026-09-19, `docs/backlog.md` →
_Replication, membership & failover — residuals_). The till follows the primary and never chooses
(till reroute, #244 to #265); only the primary sells.

**Provisioning and boot**

## A restore re-registers a filing node; the working-time chain continues

A cold restore, or a rebuild from the bucket, of a node that was filing floors the installation
counter by the clock (the counter is in the backup, so an older artifact would otherwise re-mint a
number a previous restore used), retires the node's invoice series and opens disjoint ones, and
writes the box's identity only after that commits — #248. The working-time chain is not reset: a
survivor's forked row is refused by `time_entries_chain_position_uq`, reported by this engine as
`UNIQUE constraint failed: time_entries.node_id, …`, errcode 2067 — it names the COLUMNS, never the
index. Guard: `packages/workforce/src/restore-continuation.test.ts`.

A cold restore (`waitron-restore`) does that re-registering automatically for a node that was filing
(#248), and so does a rebuild from the bucket (`waitron-restore restore --from-bucket`, or the setup
wizard's "Restore from my bucket"), which places its copy through the same path — one restore takes
one source, never both, or one event would mint two installation numbers. UNLIKE the fiscal chain,
the working-time chain is NOT reset on a cold restore — it continues from the backup's head,
because the fiscal reset exists to mint a fresh SIF for AEAT and the working-time record has no
equivalent. A survivor's forked row is refused by the chain-position unique index however it
reaches the database; nothing carries rows between nodes today.

## On a node that files, every start puts each sale left "being sent" back to waiting

**On a node that files, every start puts each sale left "being sent" back to waiting before its
first filing pass** (`resetInFlightClaims`, `packages/fiscal-verifactu/src/drain.ts`, run by
`resetBeforeFirstDrain`, `apps/server/src/restart-reset.ts`) — safe only while no second process
files from the database: the server opens the folder exclusively (`provisioning.database_in_use`),
and the tools that open it with `exclusive: false` file nothing.

Guards: `apps/server/src/restart-reset.test.ts`, which holds that the reset runs before the first
pass, and the case in `apps/server/src/boot.test.ts` that returns a previous run's in-flight claim
to `pendiente` on a start's first pass — weaker than the rule, because nothing checks that a tool
opening the folder with `exclusive: false` never files.

## The box's BOOT path and the bucket rebuild carry an ahead-of-image check; no other migrating path does, and `waitron.sh install <ref>` is a one-way door

`assertNotAhead` (`@waitron/provisioning`) compares the database's journal hashes against the
image's files and throws `provisioning.database_ahead`; there is no backward migration, so
installing an older ref after a newer one has already migrated the database can fail to boot with
this error. `waitron.sh`'s advice on that failure depends on the box: on one that is not stamped
production, it names `waitron.sh --reset install [ref]`, which wipes the database as
`waitron.sh reset` does and installs again in one run, the clean way back to a working box; on a
production box the script refuses to suggest that (a reset there would destroy the fiscal chain) and
says to install a newer ref instead (#314). It has two callers (`grep -rn assertNotAhead` before
believing otherwise): boot, in `apps/server/src/node-entry.ts`, and the bucket rebuild's
preparation, `prepareStreamRestore` in `apps/server/src/restore-stream.ts`, which checks the
downloaded copy before anything is placed (2026-09-25, slice 2 Task 9b). Boot's call runs after
`runStagedRestore` — the restore that replaces the venue files — and `runStagedReset`, which removes
them, and BEFORE `startServer`, so it reads a database nothing has migrated yet, because boot owns
the migration now (`apps/server/src/boot.ts`). The ordering, and the one-direction comparison that
lets a virgin venue directory pass it, are stated at `runEntry` in `apps/server/src/node-entry.ts`.

The GAP, stated so nobody assumes coverage: BOOT and the bucket rebuild are the only migrating paths
carrying the check, and every other path that migrates runs without one. Re-grepped 2026-09-25
(`grep -rn applyMigrations apps packages`, non-test files, leaving out the test helper
`packages/db/src/testing/venue-db.ts`), that grep finds only DIRECT callers besides boot:
`apps/server/src/restore.ts`, `apps/server/src/rejoin-command.ts`,
`apps/server/src/fiscal-readiness-runner.ts`, and eight scripts under `apps/server/scripts` —
`dev-setup.ts`, `dev-onboard.ts`, `cloud-integration-fixture.ts` and the five demo scripts.
`restore.ts` migrates on behalf of its own callers, found with
`git grep -l "restoreFromArtifact\|writeValidated\|runStagedRestore" -- apps ':!*.test.ts'`: the
cold restore from an archive taken from the `waitron-restore` CLI
(`apps/server/src/restore-command.ts`), the staged restore (`runStagedRestore`,
`apps/server/src/restore-request.ts`) run by boot and by
`apps/server/scripts/cloud-recovery-client-fixture.ts`, the bucket rebuild
(`apps/server/src/restore-stream.ts`), and `apps/server/scripts/cloud-backup-fixture.ts` through
`writeValidated`. Of those, only the staged restore at BOOT and the bucket rebuild are checked; an
ahead database reached through the CLI, the two Cloud fixture scripts or any other path above is
still undetected. The `instance` command
headed this list until 2026-09-22 and no longer exists. Cost: without the check, an ahead database
re-migrates CLEANLY — drizzle applies nothing and throws nothing (measured with a control,
2026-09-10) — so the mismatch showed up only as an unclassified driver error in whatever query first
touched the changed schema. Designed and built in #310.

## A configuration route checks the tenant returned by `authorizeManager`, as well as scoping its queries

> **Superseded 2026-09-14.** `authorizeManager` returns `{ authorizedBy, role }` and no tenant, and
> there is no configured tenant to compare it with — one database, one taxpayer. Built in #378. The
> two regression cases named below were deleted with the column. What the route still scopes its
> queries by is the deployed LOCATION — `apps/server/src/location-settings-api.ts` filters on
> `eq(locations.id, deps.cfg.locationId)` — a separate boundary this change did not touch.

The permission check returns the session's tenant; it does not compare it with the configured tenant.
A2's two-tenant route probe returned 200 for the other tenant's manager until the caller compared
them. Regression: `apps/server/src/location-settings-api.test.ts`, "refuses a manager session
belonging to another tenant". Printer routes enforce the same check; their regression is
`apps/server/src/print-api.printer-wiring.test.ts`, "refuses another tenant's manager…".

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
Measured 2026-09-12 on a copy of
`packages/fiscal/src`: planting `export const huellaValue = 1;` and `export const cadenaValue = 1;`
each turned the suite red. A PR introducing a Spanish
identifier into a generic package, a regime term in any language into `packages/fiscal`, one that adds a
module's word to the base list instead of the module's own declaration, or one that drops a generic
package from `GENERIC_PACKAGES` (and its pin) to make a scan pass, is a design question to raise,
not a nit to wave through.

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

**Two fields are deliberately outside the rule**, and a reader who takes the rule as universal will
get them wrong. An extras list's `maxPicks` accepts an explicit null, because there null is the VALUE
— it means uncapped — rather than a missing field (`row.maxPicks == null ? null : …`,
`packages/catalogue/src/extra-contract.ts`). That is pinned by its own case, `keeps an explicit null
maxPicks, because there null is the value`. The seat-a-table
route's `guestCount` also accepts an explicit null as a value meaning no count; the absent field means
the same thing (`requireGuestCount`, `apps/server/src/till-api.ts`). Its route case `seats without a
guest count, absent or null` pins both inputs.

## A missing unique target now fails at WRITE time, not at migrate time

**"Order new unique targets before their foreign keys" is retired as advice, and what replaces it is
not an ordering rule at all.** Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, with a control: a
table can be created naming a parent that does not exist yet, and the whole set applies clean. The
first INSERT into the child is then refused `foreign key mismatch - "child" referencing "parent"`,
errcode 1, and keeps being refused until a unique index over the parent's referenced columns exists —
the control being the same insert passing the moment that index is created. So the refusal moved from
migrate time to the first write, which is a worse place to find it. A generated set that references a
parent's unique target is checked by WRITING a row, never by watching the migration finish.

## A streamed `venue.db` holds Litestream's own tables and a directory beside it

Litestream 0.5.17 adds two tables, `_litestream_seq` and `_litestream_lock`, to the database it
replicates, and keeps its own copies of what it uploaded in `.venue.db-litestream/` beside the file.
A restore of the stream carries the two tables too; a migrated database that nothing has streamed has
neither.

Measured 2026-09-25 on darwin/arm64 with the pinned binaries under `.bin/` (Litestream 0.5.17,
versitygw 1.8.0 started with `--sidecar`), on a scratch database holding one table `t`. Before
streaming, `sqlite3 venue.db "select type, name from sqlite_schema"` printed `table|t` alone and the
folder held `venue.db`, `venue.db-shm` and `venue.db-wal`. After `litestream replicate -once`, the same
query printed `table|t`, `table|_litestream_seq` and `table|_litestream_lock`, and `find` showed
`.venue.db-litestream/ltx/0/0000000000000001-0000000000000001.ltx` beside the file. A
`litestream restore -o restored.db` of that replica listed the same three tables. (The drafter of slice 2's
Task 10, #652, recorded the same result on 2026-09-23.)

So a comparison of two venue databases leaves the two tables out, as the stream loop test's
`tableContents` does (`apps/server/src/stream-loop.e2e.test.ts`), and a check that lists a live or
restored database's tables has to leave them out explicitly. The directory goes with the database it
describes: `wipeVenueDatabases` (`apps/server/src/db-wipe.ts`) and `restoreDatabase`
(`apps/server/src/restore.ts`) remove it with `venue.db`, and the stream supervisor removes it before
it starts Litestream on a new generation (`packages/stream/src/supervisor.ts`). What Litestream itself
does with a stale directory beside a replaced `venue.db` was not measured. Nothing finds a new piece
of code that lists tables or empties the folder and forgets either.


### Append-only declarations have two migration inputs

On 2026-10-05, A261-2 added `sale_receipt_headers` with `appendOnly()` but initially omitted it from
both the venue-service exported descriptor and the JSON manifest. The normal push hook refused
`scripts/append-only-migration-sets.test.ts`; after the descriptor fix, CI refused the descriptor/manifest
equality in `packages/composition/src/composition.test.ts`. Add the table to both inputs: the descriptor derives
its list with `appendOnlyTablesIn(VENUE_SERVICE_CLASSIFICATION)`, and the manifest carries the same name.

After those fixes, `pnpm exec vitest run scripts/append-only-migration-sets.test.ts` passed 15 tests,
`pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` passed 20, and
`pnpm exec vitest run scripts/append-only-triggers.test.ts` passed 48. These runs exercised the
exported-list comparison, the manifest comparison and the declared tables' update/delete refusals;
they did not test every migration caller.
