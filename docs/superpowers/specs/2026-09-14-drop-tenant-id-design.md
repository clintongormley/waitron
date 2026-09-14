# Drop the tenant id from every table and every write path

Owner decision, 2026-09-14. Brainstormed on Fable; spec written on Fable at the owner's request.

## The decision

Every table loses its `tenant_id` column. The `tenants` table stays, as a table that holds exactly
one row: the taxpayer this database belongs to — country, tax id, legal name. Nothing references
that row by id any more, because there is nothing to choose between.

The one-row-per-database rule was decided on 2026-09-05 ("one tenant per database everywhere, the
cloud included", `docs/backlog.md` → Standing decisions). Row-level security went in #255. Since
then the tenant column has done no work at runtime: `withTenant` (`packages/db/src/tenancy.ts`)
takes a tenant id and ignores it, and every `where tenant_id = …` clause compares a row against the
only tenant that can exist in that database. What the column still costs is real: it appears in
483 lines of 43 migration files, 265 of them in unique or foreign-key constraints; 586 query
clauses of the form `eq(x.tenantId, cfg.tenantId)`; roughly 325 non-test and 400 test source
files; a parameter threaded through every write path; a review rule ("a by-id read still needs its
own tenant clause") whose incident was a multi-tenant database that no longer exists; and 74 test
files that stage a second tenant to prove an isolation the deployment does not rely on.

The owner also confirmed that no database anywhere — the preproduction trial demo included — holds
more than one tenant. Nothing in this spec supports a shared database; if one is ever wanted, that
is a new design, not a revert.

### Why now

Nothing is in production, so schema changes drop and recreate with no data to carry
(`CLAUDE.md` §3, "No backwards-compatibility or data-migration code until Waitron is in
production"). The day a venue is live this becomes a data migration across every module set.

### Why not a JSON file for the one-row tables

Asked and answered: the split between files and tables is already the right one, and the row count
is not the criterion. Everything in `<stateDir>/` is about this machine and either has to be read
before the database is reachable (`modules.json` is read before migrations; `secrets.env` holds the
database password) or must never be copied to another machine (`tls/`, the node identity). The
one-row tables — `tenants`, `tenant_themes`, `tenant_receipts`, `payment_policy` — are about the
venue and are classified `state`, so the cloud standby receives them through replication, the
nightly dump carries them, a cold restore brings them back, and a dashboard edit commits with the
same guarantees as any other write. A file would need its own sync, backup, atomic write and
conflict story. The criterion is "does the standby need it?", and it stays.

## What changes

### Schema

- Every `tenant_id` column goes, in every module's migration set: `db` (core), `identity`,
  `fiscal-verifactu`, `payments`, `credentials`, `workforce`, `workforce-es`, `bookings`, and any
  other set `grep -l tenant_id packages/*/drizzle/*.sql` lists on the day.
- Every foreign key to `tenants(id)` goes with it.
- Every composite unique or primary key that led with `tenant_id` keeps its remaining columns:
  `UNIQUE (tenant_id, credential_id)` becomes `UNIQUE (credential_id)`, and so on. Under one tenant
  the meaning is unchanged. A key that was `tenant_id` alone becomes the one-row constraint below.
- `tenants` becomes: `country`, `tax_id`, `legal_name`, `created_at`, plus a one-row constraint.
  The `id` column goes: nothing references it once the foreign keys are gone. The constraint is the
  standard shape — a `singleton boolean NOT NULL DEFAULT true` column with `CHECK (singleton)` and a
  unique index on it — so a second insert is a constraint violation, not a convention.
- `tenant_themes`, `tenant_receipts` and `payment_policy` get the same one-row constraint in place
  of their `tenant_id` primary key. `tenant_credentials`' primary key becomes `purpose` alone.
- Table names do not change. `tenant_themes` with no tenant column reads oddly, but the names are
  pinned by classification lists and dashboard subscription names, and renaming them is churn with
  no behaviour behind it. A later change may rename them; this one does not.
- The pre-production practice for a schema change applies: the plan's first task checks the most
  recent schema-changing PR on `main` to confirm whether it rewrote the module's baseline or appended
  a migration, and follows that. Whatever the mechanism, drizzle's journal is never hand-edited
  (`CLAUDE.md` §3), and `scripts/journal-monotonic.test.ts` must stay green.
- Classification lists (`<MODULE>_CLASSIFICATION`) are unchanged: the tables still exist and still
  replicate as before. `tenants` stays `state`; `tenant_credentials` stays `local`.

### The taxpayer row

- `deriveTenantId` (`packages/provisioning/src/tenant-id.ts`) is deleted. Its purpose was a stable
  id for re-run idempotency and for the foreign keys; both are gone.
- `applyVenue` inserts the one row. A re-run reads the row back: if `country` and `tax_id` match the
  request (after the same trim-and-uppercase canonicalisation the derivation used), it is the
  idempotent no-op it is today; if they differ, it refuses with a domain error. Today a differing
  re-run silently minted a second, permanent tenant; refusing is strictly better, and the fiscal
  reasoning is unchanged — one taxpayer is one database, one chain. The error code is chosen in
  the plan after grepping the siblings in `packages/provisioning/src/errors.ts`; `provisioning.*`
  is the existing prefix.
- `provisionVenue`'s double-provision guard in `apps/server` moves to the same read-the-row check.

### Code

- `withTenant(db, tenantId, fn)` becomes `withTransaction(db, fn)`. The convention it carries —
  one transaction per request, write paths take a `tx` and never open their own — is unchanged and
  the `CLAUDE.md` §3 line is reworded to the new name. 267 non-test call sites.
- The `tenantId` field leaves `TillConfig` (`apps/server/src/till-config.ts`), the
  `WAITRON_TILL_TENANT_ID` environment variable is removed from config parsing, `.env.example`,
  `deploy/README.md`, `dev-setup`, the break-glass command and the boot tests that set it. A box
  with the variable still set boots normally: unknown variables are ignored today, and the plan
  confirms that by test rather than assuming it.
- Every `cfg: { tenantId: string; … }` shape and every `eq(table.tenantId, …)` clause goes.
- `authorizeManager` (`packages/identity/src/manager-login.ts`) stops returning `tenantId`. The
  route-level "compare the session's tenant with the configured tenant" checks go with it.
- `ResourceChange.tenantId` (`packages/shared/src/live-updates.ts`) and the tenant filter in
  `apps/server/src/live-api.ts` go. The `tenantId` brand in `packages/shared/src/ids.ts` goes.
- `configuration-transfer` and `configuration-export-api` read the one row instead of looking a
  tenant up by id. Exported bundles from before this change are not readable afterwards; that is
  the pre-production rule, not a regression.
- The fiscal hash is untouched, and this is a checked fact rather than a belief: on 2026-09-14
  `grep -rn tenant packages/verifactu/src` prints nothing — the package that computes the chain
  never mentions a tenant. `registros_facturacion` loses its `tenant_id` column like every other
  table; `node_id` and the taxpayer's NIF are what identify a record to AEAT and they stay.

### Tests

- The two-tenant isolation probes are deleted, not rewritten. They assert a property the schema no
  longer has; a test rewritten to pass without the second tenant would be asserting nothing. The
  plan lists them explicitly (`grep -rl 'other tenant\|tenant B\|otherTenant\|second tenant'
  --include='*.test.ts'` is the starting list, 74 files today) so a reviewer can see each deletion
  was deliberate.
- Fixtures that `insert into tenants … returning id` become "ensure the one row exists" helpers
  returning nothing. `seedTenant` and the per-package fixture files are the places.
- Every other test keeps its behavioural assertions. A test that only loses a `tenantId` argument
  or a `tenant_id` column is a mechanical edit; a test whose assertion changes is a review item.

### One new guard

`scripts/no-tenant-column.test.ts`, in the root Vitest project so the hook and the `lint` job run
it on every non-docs push: no `tenant_id` in any `packages/*/drizzle/*.sql`, and no `tenantId`
identifier in non-test source under `packages/` and `apps/`, with the `tenants` table's own
columns the only allowed mention. It reads text and says so in its header — it cannot see a column
introduced by a name that avoids the string. Prove it by deletion: reintroduce one column in a
scratch branch and watch it fail.

### Rules and documents

- `CLAUDE.md` §3: retire "A by-id read still needs its own `eq(table.tenantId, cfg.tenantId)`" and
  "A configuration route checks the TENANT returned by `authorizeManager`", and say in the commit
  why. Replace them with one line: _There is no tenant column. The taxpayer is the one row in
  `tenants`, enforced by a constraint; a query that wants "this tenant's rows" just reads the
  table._ Reword the `withTenant` line to `withTransaction`. The `app_user`-holds-`SELECT`-on-
  `tenants` grant line stays true and stays.
- `docs/developers/conventions-data.md`: the two retired sections get a dated "superseded" note
  pointing here, kept as history (historical docs are not rewritten). The transaction section is
  reworded to the new name.
- `docs/backlog.md` → Standing decisions: the one-tenant line gains "and the schema carries no
  tenant column (2026-09-14)".
- Every prose claim about tenant scoping across `docs/`, READMEs and runbooks is read, not
  grepped for an identifier — `CLAUDE.md` §1's "the PATH SET matters" applies. The
  `WAITRON_TILL_TENANT_ID` mentions in `docs/superpowers/plans/` are history and get a one-line
  dated pointer at the top of each file, not an edit.

## What does not change

- The file/table split described above.
- Which module owns which config table; no shared settings table.
- Node identity, membership keys, installation counters, invoice series, the fiscal chain, the
  working-time chain: all keyed by node, none by tenant, none touched.
- Replication publications: the same tables, classified the same way.
- Grants: nothing is widened. Dropping a column from a table `app_user` already has DML on needs no
  new grant; the plan reads the ACLs back after migration rather than trusting the migration's
  exit code (`CLAUDE.md` §3).

## Risks, and the experiment that retires each

| Risk | What could go wrong | What is run |
| --- | --- | --- |
| A composite key silently changes meaning | A unique that was really "per tenant AND per something" now over-constrains | The plan lists every altered constraint with its new shape; the package suites run against the regenerated schema |
| The fiscal hash included the tenant | Every existing test chain would fail to verify | `packages/verifactu` and `packages/fiscal-verifactu` suites including `inmutabilidad` and the chain concurrency tests, on real PostgreSQL |
| Replication breaks on the regenerated tables | A published table lost its primary key, or a publication names a dropped column | `packages/replication-tests` in full, plus `scripts/classification-complete.test.ts` and `scripts/append-only-enable-always.test.ts` |
| Boot paths relied on the env variable | Mirror, promote or break-glass boot fails | `boot.mirror`, `boot.promote`, `boot.singleton`, `promote-endpoint-e2e` suites, then `wa-wt reset demo <worktree>` and a real boot |
| A stale claim survives in prose | A runbook tells an operator to set a variable that no longer exists | The read-every-claim sweep above, with the path set stated in the PR |
| The guard is weaker than it looks | A tenant column returns under another name | The guard's header says it reads text; the deletion proof is in the PR |

## How the work is cut

One branch, one PR, several commits — one per migration set, then the shared code, then the
docs and rules. Intermediate commits are allowed to leave some tables with the column and others
without: nothing enforces tenant equality across modules, so each set can be converted on its own
and its suite run. The branch changes shared config (`packages/shared`, `packages/db`), so CI
runs the whole workspace; that is the intended scope, not something to narrow. The diff touches
migrations and a cross-package contract, so it takes the full review ceremony: per-task reviews,
the plan-vs-spec read, the simplify lenses and the run-it seat.

The run-it seat's brief: the two-tenant probes are gone, so its experiment is the other way
round — insert a second `tenants` row as `app_user` and confirm the constraint refuses it; boot a
box with `WAITRON_TILL_TENANT_ID` still set and confirm it is ignored; and re-run `applyVenue` with
a different tax id and confirm the refusal.

## Out of scope

- Renaming the `tenant_*` tables.
- Moving any one-row table to a file.
- Anything about Waitron Cloud's control plane, which is a separate service that has not started
  and holds no tenant ids from this schema.
