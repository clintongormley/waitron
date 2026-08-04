# The provisioning tool — design

**Date:** 2026-07-29
**Status:** designed, not implemented
**Depends on:** [the deployment environment](./2026-07-29-deployment-environment-design.md), which
should land first so `instance` can write the stamp, and `tenant` can validate a Stripe credential
against it, rather than bolting either on later.

> **2026-08-04 note:** this design predates `waitron-provision venue`. Where it describes running
> `bootstrap-tenant.sql` — §1's hand-execution walkthrough, and "Keeping `bootstrap-tenant.sql` as
> the mechanism" under the alternatives (§ below) — that file has since been retired (Task D2,
> `feat/locations-provisioning`) and `venue` replaces it, with its own tests. See
> [`2026-08-04-locations-provisioning-design.md`](./2026-08-04-locations-provisioning-design.md). The
> text below records what was true when written.

## 1. The problem

Standing up a Waitron deployment currently means executing a plan document by hand: create a
database and two roles from a prose recipe in `apps/server/README.md`, boot the host once to
migrate, run `bootstrap-tenant.sql` as a superuser with seven `psql` variables, copy three UUIDs out
of its output, build the credentials CLI, seal a certificate through a JSON payload on stdin, run
`register-till` with the UUIDs, then `record-one-sale` with four more arguments.

Executing that plan found **six operational errors** in it — a bash-ism that fails in zsh, a wrong
bundle name, a wrong default port, a key ring loaded before the step that generates it, a false
claim about RLS and the owner, and a boot command missing the key ring entirely. Every one was found
by a human hitting it, because there was no code to hold the ordering.

The gap is already recorded as a product gap, not merely a plan gap: the first customer till in any
real deployment hits it, and the eventual provisioning surface must cover SIF registration, not
merely tenant/location/till/series.

## 2. Shape

A new package `@waitron/provisioning`, one bin `waitron-provision`, matching how
`@waitron/credentials` ships `waitron-credentials`.

| Command | Privilege it needs | How often |
| --- | --- | --- |
| `keyring` | none | once per deployment |
| `instance` | an admin connection with `CREATEDB` and `CREATEROLE` | once per deployment |
| `tenant` | the provisioning role | once per customer |
| `status` | read-only | any time |

The split between `instance` and `tenant` is a privilege boundary, not a convenience. In the cloud
deployment, tenants share one database isolated by RLS, so `tenant` runs for every customer forever
while `instance` runs once. Whoever onboards customer #47 must not be holding a connection string
that can create roles.

**No superuser anywhere.** Verified on PostgreSQL 18 against the real migrations: a LOGIN role with
`rolsuper = f` and `rolbypassrls = f` inserts tenant, location, till and series successfully, given
**both** of the following — the first is about RLS, the second about grants, and the first attempt
failed on the second, which is what made the old "superuser is required" belief look confirmed:

1. It chooses the tenant's UUID itself and sets `app.tenant_id` to that value before inserting.
   `tenants_tenant_isolation` is `WITH CHECK (id = current_tenant_id())`, so the row satisfies its
   own policy — it adopts the scope of the tenant it is creating. There is no circularity; the
   earlier belief came from letting the database generate the id.
2. It holds `INSERT ON tenants`. Without it the first statement fails `permission denied for table
   tenants`, which is a grant failure and not an RLS one.

This matters because managed Postgres (Neon, Supabase, RDS) grants `CREATEDB` and `CREATEROLE` but
never true superuser, so "superuser required" would have read as "not deployable there".

**A third role, `waitron_provisioner`**, holds `INSERT ON tenants`, which `app_user` deliberately
does not (`0001_tenancy_rls.sql` grants it `SELECT` only). The running POS therefore cannot create
tenants; only this tool can.

## 3. Interaction

An interactive wizard. It reads the database to discover what already exists, prompts only for what
is missing, echoes a complete summary for confirmation, and applies on approval.

**No configuration file**, as input or as state. The database is the single source of truth for what
is provisioned, so there is nothing that can disagree with it — no stale file claiming a till exists
that was dropped, or missing one added by hand.

**Confirmation before anything is written.** The summary shows the tenant's NIF, legal name, and
every id about to be created. The NIF becomes part of records the Agencia Tributaria keeps, so it is
displayed for checking, not merely accepted.

## 4. Idempotency

Every step establishes what already exists before acting. Running any command twice is safe.

`instance`:

| Step | Existence check |
| --- | --- |
| Database | `pg_database` |
| Roles `waitron_migrator`, `waitron_app`, `waitron_provisioner` | `pg_roles`, verifying **attributes** (`rolcreaterole`, `rolcanlogin`), not merely the name |
| Grants | `information_schema.role_table_grants` |
| Migrations | the migrator's existing advisory lock and journal — already idempotent |
| Deployment stamp | the stamp row; refuse if present and disagreeing with `WAITRON_ENV` |

> **Implementation note, 2026-07-30.** The Migrations row above delegates idempotency to "the
> migrator's existing advisory lock and journal", and the code shipped in #11 did not: `planInstance`
> added a second gate in front of it, on journal-TABLE existence, which is weaker than "the set
> finished" and let an interrupted provision be reported as complete. The gate was removed on
> `fix/provisioning-migrate-gate`; `migrate` is now emitted on every run, as this row always
> described. See [`2026-07-30-provisioning-migrate-gate-design.md`](2026-07-30-provisioning-migrate-gate-design.md).

`tenant`:

> **Superseded detail, 2026-07-30.** The `Tenant` row below gives the idempotency check as
> "`tenants` by NIF — unique, and the natural key". That check cannot work as specified, and branch
> `feat/provisioning-cli` disproved it live: `tenants_tenant_isolation`'s
> `USING (id = current_tenant_id())` hides an EXISTING row from
> `select … from tenants where nif = …` whenever no tenant scope is set — and a lookup that precedes
> knowing which tenant it would be has no scope to set. Granting the provisioning role SELECT on
> `tenants` makes no difference; a grant does not defeat a policy. What works instead: attempt the
> INSERT and catch `23505` on `tenants_nif_key`. The reasoning and the receipt live in
> `packages/db/drizzle/0011_provisioner_role.sql`'s comment on its `GRANT INSERT ON "tenants"`. The
> table below is left as written.

| Step | Existence check |
| --- | --- |
| Tenant | `tenants` by NIF — unique, and the natural key |
| Location, till, series | by name / code under that tenant |
| SIF registration | a live `registro_sif` row for the till |
| Certificate | the vault, via the same read `waitron-credentials list` uses |
| Verification | a read-only `consultar`, which writes nothing and is always safe to repeat |

Two rules that fall out of this:

**Re-running is not re-registering.** A till with a live SIF is reported and skipped. `registerSif`
would otherwise mint a fresh installation number and start a new chain — correct for a reimaged
till, destructive for a working one. Re-registration is an explicit `--reregister` flag that states
what it will end.

**Provisioning creates; it never reconciles.** A tenant whose NIF matches but whose legal name
differs is an error, not an update. Silently rewriting the legal name on a tenant that has already
filed would change what the next record claims about the obligado.

## 5. Secrets

Three, handled differently, none ever in `argv`:

| Secret | Path |
| --- | --- |
| Credential key ring | `keyring` only. Generated, printed once, confirmed, then screen and scrollback cleared with `ESC[3J ESC[H ESC[2J`. |
| `.p12` passphrase | Read from the tty with echo off. Never a file, never an argument — the rule `waitron-credentials` already follows. |
| Admin connection string | Prompt or environment variable, used only by `instance`, dropped after the privileged phase. |

Clearing the scrollback is a real improvement, not a guarantee: it does nothing about a terminal
configured to log sessions to disk, nor about tmux's own buffer in some configurations. The tool says
so rather than implying the key is gone.

**Consequence, and part of the point:** `instance`, and every step of `tenant` except sealing the
certificate, involve no secrets at all. They can therefore be run by an agent. The two steps that
touch secrets are the operator's. Because resume reads the database, the two can interleave in any
order.

## 6. Where it stops

`tenant` ends by sealing the certificate and running a read-only `consultar`, proving the
certificate, the mTLS chain, the endpoint and the response parser — without creating a fiscal
record.

It then **offers** to record one real sale, and refuses outright when `WAITRON_ENV` is
`production`.

The offer is worded as recording a real sale, showing the invoice number it will consume, because
there is no such thing as a test sale against a real deployment: the `registros_facturacion` row is
permanent, it chains, and it burns a number that is never reused. The plan's existing position is the
right one — the first sale should be "small, real, and defensible as a genuine transaction".

## 7. Testing

The `instance` command is the biggest win available here. `apps/server/README.md` records that its
empty-database grant recipe is "verified by hand against a real Postgres 18 container while writing
this document, not carried over from an existing automated test". Implementing it as code with a
real-Postgres suite closes a gap the README flags about itself.

- `instance` against a blank container: creates database, roles with the right attributes, grants,
  migrates, stamps. Re-run: reports everything present, changes nothing.
- The provisioning role can insert a tenant; `app_user` **cannot**. Proven by deletion of the grant.
- `tenant` against a migrated database: full chain through SIF registration, then a second run that
  changes nothing.
- A till with a live SIF is skipped, not re-registered, unless `--reregister` is passed.
- A NIF that exists with a different legal name is an error.
- Secrets never appear in `argv` or in any log line — asserted, in the shape
  `packages/credentials`'s CLI suite already uses.

## 8. Rejected alternatives

**A configuration file describing the desired deployment.** Reviewable and scriptable, but it
becomes a second source of truth that can disagree with the database, and the operator has to know
which fields exist — the situation the plan documents already create.

**One `deploy` command doing everything.** Simpler to document, but it forces an admin connection
string into the hands of whoever onboards a customer, which in the cloud deployment is the common
case rather than the rare one.

**A provisioning UI first.** It cannot bootstrap the first deployment — it would have to run on the
host that does not exist yet. A UI is worth building for everything after first boot (adding a till,
a location, a re-registration) and depends on this tool existing.

**Keeping `bootstrap-tenant.sql` as the mechanism.** It requires superuser, cannot generate its own
tenant id without hand-passed variables, produces UUIDs that must be copied by hand into two further
commands, and has no test. It stays in the repository as the documented manual fallback.
