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

## No new table enters the core migration set without a stated reason in the commit

A `tenant_id`-bearing domain table belongs to its module's own migration set (`migrations.from`),
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

**Grants and roles**

## Never widen a grant to make a test pass

`app_user` holds `SELECT` on `tenants` and not `INSERT` deliberately.

## A new table is classified `ledger`, `state` or `local` (swap design §2.1) in its module's `<MODULE>_CLASSIFICATION` list via `classify()` (`@waitron/sync-enrolment`), and an append-only table's `reject_mutation()` triggers are `ENABLE ALWAYS`

The replication apply worker skips ordinary triggers, and a copy of a corrupted row is exactly what
those triggers exist to refuse. No policies, no `ROW LEVEL SECURITY`: one tenant per database (owner
decision 2026-09-05). Two root guards enforce this on every non-docs push:
`scripts/classification-complete.test.ts` (every table in every module's `drizzle/` is classified
exactly once) and `scripts/append-only-enable-always.test.ts` (every `reject_mutation` trigger is
`ENABLE ALWAYS`); `packages/fiscal-verifactu`'s `inmutabilidad` suite still scans the triggers
themselves. Run them after adding any table anywhere.

## The two publications a node holds are created by the table OWNER, and the replication role is a bootstrap the app provisioner only verifies

`waitron_migrator` creates `waitron_<env>_ledger` / `_state` from the module classification
(`@waitron/sync`). A SUPERUSER/box-image bootstrap holds the rest, each on its own role SHAPE:
`waitron_repl` is a `LOGIN REPLICATION` role; the migrator (`waitron_migrator`) is granted
`pg_create_subscription`; and `wal_level=logical` / `track_commit_timestamp=on` are restart-required
CLUSTER settings held by no role (the box image's `postgresql.conf`). The app performs none of it —
`assertReplicationReady` (`provisioning.replication_not_ready`) verifies it instead. A subscription's
connection string carries the `waitron_repl` password, so its statement is never logged and a failure
throws only a SQLSTATE (`sync.subscription_failed`), like `CREATE ROLE`; `sqlStateOf` lives in
`@waitron/shared`. Pointer:
`docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` §2.2/§3.

## `waitron-provision instance` migrates AS the migrator, via a `role=` session option, never as a plain admin

The migrator (`waitron_migrator`) OWNS the instance's database, and native replication's
`CREATE PUBLICATION … FOR TABLE` is owner-only, so every table must be migrator-owned: a plain admin
connection to a migrator-owned database cannot even `CREATE TABLE` in `public` (probe A —
`permission denied for schema public`). Any new provisioning path that creates schema carries
`withRole(uri, waitron_migrator)` (`@waitron/provisioning`); `apps/server/scripts/dev-setup.ts` does
the same on the shared dev `postgres` database, granting the migrator the CREATE privileges db
ownership would otherwise confer. Receipt: `feat/outbox-swap-s4-s5`, probe A.

## A module/migration dependency graph has TWO kinds of cross-set edge

FK `REFERENCES` and a `CREATE [CONSTRAINT] TRIGGER … EXECUTE FUNCTION <f>` where `<f>` is owned by a
DIFFERENT migration set. Today NO module creates such a cross-set trigger — the outbox's capture
triggers, which enrolled other modules' tables, were deleted with the application outbox (swap S5) —
so every surviving migration cross-set edge is an ordinary FK. The generic live-update trigger is
installed at boot and sits outside this migration-text guard; its behavior is exercised by
`packages/db/src/change-feed-replication.pg.test.ts`. `scripts/module-graph-honesty.test.ts` still
derives the trigger edge (reads text and says so), so a future one is caught.

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

**Transactions and tenant isolation**

## Multi-table writes share ONE transaction, and `withTenant` IS that transaction

(`packages/db/src/tenancy.ts`). Write-path functions take a `tx: Transaction` and never open their
own; a route handler opens exactly one `withTenant` per request (`recordSale`'s header says why —
`packages/core/src/record-sale.ts`). A convention, not a compiler guarantee: `Database` is assignable
to `Transaction`, and an ESLint backstop was declined (2026-09-03). **Splitting one logical change
across transactions is a commented decision, never a default** — the two that do it
(`provisionVenue`'s latch, `adoptFromPrimary`'s idempotent steps) say so in their headers because a
non-DB step sits between the writes.

## A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)` — one-tenant-per-database is NOT the query's isolation boundary

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

`new Client({ connectionString: "" })` resolves to localhost with every default (`pg@8.22.0`).
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
