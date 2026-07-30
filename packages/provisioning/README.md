# `@waitron/provisioning`

Stands up a Waitron deployment: one bin, `waitron-provision`, matching how `@waitron/credentials`
ships `waitron-credentials`.

Design: [`docs/superpowers/specs/2026-07-29-provisioning-tool-design.md`](../../docs/superpowers/specs/2026-07-29-provisioning-tool-design.md).
This document is the operational half of that spec — written for whoever runs the tool, not whoever
reads its source.

**The thing to know before anything else:** `instance` **generates** the three roles' passwords and
prints each one **once**, in a connection string, at the end of the run. Nothing stores them. This
deliberately corrects the design spec's §5, which says `instance` "involve[s] no secrets at all" —
not achievable, because a LOGIN role needs a password. The spirit of §5 is kept and is the actual
rule here: **secrets are OUTPUT, never input, and never in `argv`.**

## Building and running it

```bash
pnpm --filter @waitron/provisioning build   # copies the migrations, then bundles src/bin.ts
node packages/provisioning/dist/bin.js <command>
```

The build does two things, and both are needed. `esbuild` produces `dist/bin.js`, and
`scripts/copy-migrations.mjs` copies every package's `drizzle/` folder to `dist/drizzle` — which is
where the bundle looks, because esbuild collapses every module's `import.meta.url` onto the bundle's
own location. Running `dist/bin.js` without that copy step does not fail silently: `instance` throws
`migrations.set_missing` naming the folder it looked in.

Running from source (`vitest`, `tsx`) needs no copy step — `bin.ts` detects that `dist/drizzle` is
absent and lets `@waitron/migrations` resolve each set from `packages/migrations` instead.

## The three commands

| Command    | What it needs                                        | How often           |
| ---------- | ---------------------------------------------------- | ------------------- |
| `keyring`  | nothing at all — no database, no connection string   | once per deployment |
| `instance` | an admin connection with `CREATEDB` and `CREATEROLE` | once per deployment |
| `status`   | the same admin connection; reads only                | any time            |

There is no `tenant` command yet. Creating a tenant, a location, a till and a series is still
`apps/server/sql/bootstrap-tenant.sql` plus `register-till`, per spec §4 and §6.

```text
usage: waitron-provision <command> [options]

  keyring                                            generate the credential key ring
  instance [--database <name>] [--environment <env>] [--yes]
  status   [--database <name>]
```

Every option is prompted for when omitted, so a bare `waitron-provision instance` is a complete
interactive session.

### `keyring`

Generates the credential key ring `@waitron/credentials` seals every tenant credential under, prints
`WAITRON_CREDENTIALS_KEY` and `WAITRON_CREDENTIALS_KEY_VERSION` **once**, waits for an
acknowledgement, then clears the screen and the scrollback.

There is no way to recover this key. Losing it means re-sealing every certificate and every Stripe
key by hand — which for the fiscal certificate means obtaining it again.

Clearing the scrollback is a real improvement and **not** a guarantee, and the tool says so on
screen rather than implying the key is gone: a terminal configured to log its sessions to disk, or
tmux's own buffer under some configurations, still has it.

### `instance`

Takes a cluster to a migrated, stamped, granted database with the three roles the host and this tool
need:

| Role                  | What it is for                                                      |
| --------------------- | ------------------------------------------------------------------- |
| `waitron_migrator`    | `WAITRON_MIGRATIONS_DATABASE_URL` — runs the migrations             |
| `waitron_app`         | `DATABASE_URL` — the least-privilege role every duty pass runs over |
| `waitron_provisioner` | holds `INSERT ON tenants`, which `app_user` deliberately does not   |

It reads what already exists, prints the plan — headed by `Cluster: <user>@<host>:<port>`, so the
operator confirming it can see which cluster is about to be written to — asks for confirmation
(`--yes` skips that), applies, then prints the roles.

**What it prints once.** One connection string per role **it created on this run**, then the same
"stored nowhere, cannot be recovered" framing and screen clear `keyring` uses. A role that **already
existed** gets a line saying so and **no connection string** — this tool did not generate that
role's password, cannot read one back out of `pg_authid`, and a connection string with a wrong
password is worse than none, because it looks usable and fails at the host's first connect.

**Idempotency.** Running it twice is safe. The second run creates nothing and re-issues only the two
grants — the plan is never empty, because grants are re-issued unconditionally rather than diffed
(`src/instance-plan.ts` explains why: `information_schema.role_table_grants` does not cover
database- or schema-level `CREATE` at all).

**No superuser is needed.** An admin holding exactly `login createdb createrole` provisions a blank
cluster end to end. Verified through the built bundle, not inferred: against a `postgres:18-alpine`
container, a role created with `create role probe_admin login createdb createrole password 'probe'`
ran `instance` to completion — five migration sets applied, three roles created, both grants made,
the stamp written — and `status` then reported every set `applied` and `deployment stamp:
preproduction`. That matters because managed Postgres (Neon, Supabase, RDS) grants `CREATEDB` and
`CREATEROLE` but never true superuser.

### `status`

Prints what the deployment has: whether the database exists, each role's attributes and memberships,
which migration sets are applied, and the deployment stamp. Reads only; writes nothing. It carries
no secret by construction — see `src/status-command.ts`'s doc comment for the field-by-field
argument.

It is also the tool to reach for after a failed `instance`: it names which roles exist.

## Secrets

Three, handled differently, **none ever in `argv`**.

| Secret                  | How it gets in or out                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Credential key ring     | OUTPUT of `keyring` only. Printed once, acknowledged, then screen and scrollback cleared.       |
| Role passwords          | OUTPUT of `instance` only. Generated here, printed once in a connection string, stored nowhere. |
| Admin connection string | INPUT. `WAITRON_ADMIN_DATABASE_URL`, or an echo-off prompt. There is no flag.                   |

`--admin-url` is **not** an option, and neither is `--password` or `--key`. `argv` is world-readable
in `ps` and lands in shell history, so the parser is `strict` and any such flag is a parse error
rather than something silently accepted — `src/cli.test.ts`'s "refuses any flag that would put a
secret in argv" and "refuses --admin-url as a flag, in both argv forms" are what keep it that way.

Set the environment variable for a non-interactive run:

```bash
WAITRON_ADMIN_DATABASE_URL=postgres://admin:secret@host:5432/postgres \
  node dist/bin.js instance --database waitron --environment preproduction --yes
```

If neither source supplies one, the run stops with `provisioning.admin_uri_missing` — it does not
fall back to a default. `pg` resolves an **empty** connection string to `localhost:5432` as the OS
user rather than rejecting it, so without that refusal an unset or misspelled variable plus a
non-interactive stdin would have `instance` create, migrate and **stamp** a database on whatever
cluster answers there.

**The admin's PASSWORD never appears in anything this tool prints**, from either source, and neither
does the connection string as a whole. Its **username, host and port do**, deliberately, in two
places: `instance`'s plan summary prints `Cluster: <user>@<host>:<port>` above the actions, and each
role connection string is the admin's own URI with the userinfo and the database path replaced, so
the host, the port and any query string (`sslmode=require`, say) are carried through — which is what
makes the printed string one the host can actually connect with.

That is a **narrowing** of what this section used to promise, which was that the username never
appeared either. A confirmation that cannot name the cluster cannot reveal the mistake it exists to
catch, and that mistake is the fiscally expensive one: one database per environment, and `instance`
stamps whatever it is pointed at. A username is not a credential on its own, the operator supplied it
in the first place, and the printed role strings carry usernames regardless.

## What it refuses, and what to do about it

Every refusal is a structured code and its params on stderr — never a raw driver message, which for
this package would quote a `CREATE ROLE … PASSWORD '<generated>'` statement back verbatim.

| Code                                   | What happened                                                                       | What to do                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provisioning.admin_uri_missing`       | Neither `WAITRON_ADMIN_DATABASE_URL` nor the prompt gave an admin connection string | Set the variable, or answer the prompt. Refused rather than defaulted — see "Secrets" above for what `pg` does with an empty one.                                                                                                        |
| `provisioning.invalid_identifier`      | A database or role name outside `^[a-z][a-z0-9_]{0,62}$`                            | Rename it. A database called `Waitron Prod` is a permanent papercut for whoever operates it.                                                                                                                                             |
| `deployment.unknown_environment`       | `--environment` was not `production` or `preproduction`                             | Type one of the two.                                                                                                                                                                                                                     |
| `deployment.already_stamped`           | The database is stamped for the OTHER environment                                   | Stop. A pre-production database is never promoted — see the fiscal invariants below.                                                                                                                                                     |
| `provisioning.role_over_privileged`    | A `waitron_*` role already exists carrying `SUPERUSER` or `BYPASSRLS`               | Refused, not adopted: every grant this tool makes sits behind an RLS policy such a role ignores. Drop or fix the role.                                                                                                                   |
| `provisioning.role_unusable`           | A `waitron_*` role exists but is `NOLOGIN`, or lacks `CREATEROLE`                   | Refused rather than `ALTER`ed — this tool did not create it. Fix it by hand, or drop it and re-run.                                                                                                                                      |
| `provisioning.state_unreadable`        | The admin connection could not reach or read the deployment. `sqlState` says why    | `28P01`: wrong password. `42501`: see "When the admin did not create the database" below.                                                                                                                                                |
| `provisioning.role_creation_failed`    | `CREATE ROLE` failed. `sqlState` says why                                           | `42710`: the role already exists. `42704`: a membership target does not. `42501`: this admin may not — see below.                                                                                                                        |
| `provisioning.grant_ineffective`       | Every statement ran, and a privilege in `missing` is still absent afterwards        | Almost always the admin lacks grant option on the database or on `public` — see "When the admin did not create the database" below. If the same run also CREATED a role, read "A failed `instance` can orphan a role" before re-running. |
| `provisioning.membership_grant_failed` | `GRANT <memberOf> TO <role>` failed. `sqlState` says why                            | `42501`: this admin holds no ADMIN OPTION on the role it is granting — see below.                                                                                                                                                        |

The underlying driver error is deliberately not attached, not even as `cause`: Node's default
console formatting recurses into `.cause`, which would put a generated password one level down from
where it was withheld.

## Known limitations

### When the admin did not create the database

`instance` and `status` are best run as the admin that created the database. A **different**
`login createdb createrole` admin hits three walls in turn, and the first two are reported clearly.
Each of the following was reproduced through the built bundle against `postgres:18-alpine`, with two
admins `adm_a` (which provisioned) and `adm_b` (which did not):

1. **It cannot read the state.** Tables inside the database are owned by whoever created them, so
   the deployment-stamp read fails and `instance` prints
   `provisioning.state_unreadable {"database":"wp","sqlState":"42501"}`.
2. **It cannot create a role that is a member of `app_user`.** PostgreSQL requires ADMIN OPTION on a
   role to grant it, and an admin that did not create `app_user` holds none:
   `provisioning.role_creation_failed {"role":"waitron_app","sqlState":"42501"}`. The repair path
   for an already-existing role reports `provisioning.membership_grant_failed` with the same code.
3. **Its grants take effect nowhere, and PostgreSQL calls that success.** A `GRANT` from a role
   holding no grant option raises a **WARNING, not an error** — observed directly: as a non-owning
   admin, `grant create on database acl_db to r_app` printed
   `WARNING: no privileges were granted for "acl_db"` followed by the command tag `GRANT`, and
   `pg_database.datacl` afterwards still read `{=Tc/owner_a,owner_a=CTc/owner_a,r_mig=C/owner_a}`
   with no `r_app` entry at all. The driver reports success, so nothing can be caught.

   **This is now detected and refused**, not merely documented. After running its plan,
   `instance` reads the ACLs back **directly** — `pg_database.datacl`, `pg_namespace.nspacl`
   (including the trailing `*` that is WITH GRANT OPTION) and `pg_auth_members` — and raises
   `provisioning.grant_ineffective` naming every privilege that is not there. Direct ACL inspection
   is used rather than `has_database_privilege`/`has_schema_privilege` deliberately: those answer
   for the RECURSIVE closure, so a role holding CREATE only through a group reads as satisfied when
   the direct grant is absent, and neither can see WITH GRANT OPTION at all.

The remedy for 1 and 2, run as the admin that **did** provision the database (or a superuser), and
tested end to end — after these three statements, `adm_b` ran `instance` to completion, created the
missing `waitron_app`, and `status` reported the deployment clean:

```sql
grant select on all tables in schema public to <new_admin>;
grant app_user to <new_admin> with admin option;
grant tenant_provisioner to <new_admin> with admin option;
```

It does **not** address 3, and is not claimed to: it hands the new admin no grant option on the
database or on `public`, so a run that genuinely still needed those grants would now stop with
`provisioning.grant_ineffective` rather than pass silently.

If you do need a different admin to issue them, two more statements are enough — run as the owner:

```sql
grant create on database <db> to <new_admin> with grant option;
-- inside <db>:
grant create on schema public to <new_admin> with grant option;
```

Verified on `postgres:18-alpine`, because an earlier version of this section claimed the opposite —
that the only way was to hand over the database with `alter database <db> owner to <new_admin>`.
That was a necessity claim with no receipt, and it is false: after the two grants above, `r_mig` —
a plain role that owns nothing, with `owner_a` still the database owner — granted CREATE onward to
two further roles, leaving `r_x=C/r_mig` and `r_y=C/r_mig` in `datacl` and `r_x=C/r_mig` in
`nspacl`.

Running `instance` as the admin that created the database is still the recommendation, because it
is one fewer moving part rather than because delegation does not work. And note the irony: onward
delegation is precisely what produces a second grantor for the same grantee, which is the ACL shape
that made `aclHas` refuse a correctly-granted deployment until it was fixed to read every entry.

### A failed `instance` can orphan a role

`applyInstance` is not one transaction and cannot be — PostgreSQL refuses `CREATE DATABASE` inside a
transaction block. If a run fails after creating a role, that role exists carrying a password this
run generated in memory and never printed. A re-run will not recreate it: the planner sees it and
leaves it alone.

**`provisioning.grant_ineffective` is one of the ways to get here**, and the least obvious, because
every statement in the plan "succeeded" — the verification that follows them is what fails. On a
first provision the roles are created before the grants, so a plan that trips it has already minted
three passwords it will now never print. Treat it like any other mid-plan failure.

The tool says so on the failure path rather than leaving it to be discovered. The way back is what
it prints: run `status`, `DROP ROLE` every `waitron_*` role listed as present that you have no
connection string for, and run `instance` again.

### An unreachable host is still an opaque failure

A failure carrying no SQLSTATE — a refused socket, a DNS failure — is rethrown untouched and reaches
the operator as `unexpected failure (Error)`. That is deliberate: it is not the database's verdict
on anything, and dressing it up as one would be a claim the code cannot support. Confirmed against a
container by pointing the admin URL at a dead port.

## Fiscal invariants this tool is bound by

- **One database per environment.** A pre-production database is never promoted:
  `invoice_series.next_number` carries across, so pre-production sales would leave a permanent hole
  in the production series. `instance` refuses a database already stamped for the other environment,
  and `stampDeployment` refuses it again independently.
- **`preproduction` is the default everywhere; `production` must be typed out.** This tool has no
  default at all — `--environment` is prompted for when omitted, because the mistake is
  irreversible.

## Testing

`src/*.rls.test.ts` needs a real Postgres container: `instance` creates databases and roles and
reads `pg_roles` attributes, none of which PGlite's bundled single-superuser server can reproduce.
Everything else — the planner, the formatter, the whole CLI — is a pure function or an injected-IO
call and needs nothing.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
```

`TESTCONTAINERS_RYUK_DISABLED=true` is required locally; without it the container suites hang until
the hook timeout fires.

`src/bin.ts` is excluded from coverage deliberately: every decision it could get wrong lives in
`cli.ts`, which is injected and fully tested. What remains — a tty, a readline, a process exit
code — is verified by running the built bundle instead.
