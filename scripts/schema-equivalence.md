# schema-equivalence.sh — how to read a non-empty diff

`scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR> [--gate-new]` applies every migration
set of each checkout to its own `postgres:18-alpine` container as `waitron_migrator` (a
non-superuser owner, the shape the provisioner produces), takes `pg_dump --schema-only --no-owner` of
both, normalises, and diffs. Exit 0 prints `EQUIVALENT`; exit 1 prints the diff and leaves it beside
both raw dumps, both normalised dumps, the applied file lists, the role lists and the residue table
in `<OUT_DIR>`.

It removes exactly this, the same list from **both** dumps (spec
`docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` §2):

- whole statements matching `^CREATE POLICY `, `ROW LEVEL SECURITY;`,
  `FUNCTION public.current_tenant_id`, `ENABLE ALWAYS TRIGGER`, or the name of one of the seven
  deleted roles — `tenant_provisioner`, `credentials_enumerator`, `envios_drainer`,
  `payments_webhook_resolver`, `sales_coverage_checker`, `sync_tailer`, `sync_retention`. The role
  match is word-bounded, so `sync_tailer_cursor` survives — but a table or column named exactly one
  of the seven would be dropped from both sides without a word about it;
- the `SECURITY DEFINER` clause of the five seam functions — `credential_tenants`,
  `envios_tenants_with_work`, `resolve_payment_tenant`, `sales_assert_tenders_cover`,
  `sale_settlements_check_coverage` — the clause only, so their bodies stay in the comparison; the
  run fails if any of the five is missing from the NEW dump;
- every `GRANT` or `REVOKE … ON FUNCTION public.<seam>(…)` statement, for those same five. This is
  the one strip that is not on the design's delete-or-add lists; the section below is why;
- pg_dump's own noise: every line that starts at column 0 with `--`, and every line that starts at
  column 0 with `SET` or `SELECT pg_catalog.set_config`, anywhere in the dump rather than only in the
  preamble — an indented `SET search_path` inside a `CREATE FUNCTION`, or an indented comment inside
  a function body, is untouched — plus the `\restrict` / `\unrestrict` pair, whose token is random
  per dump.

It also makes one **representational** change, and only one: the column definitions inside each
`CREATE TABLE` block are sorted. Column order is not an object — the old chain accretes columns with
`ALTER TABLE` while a baseline declares them in schema-file order, so `pg_dump`'s attnum order
differs for a table that is otherwise identical, and every query in the app names its columns.
pg_dump's inline `CHECK` constraints follow the columns in NAME order rather than creation order
(measured on PostgreSQL 18.6: a table created with `CONSTRAINT z_chk` inline and `a_chk` added
afterwards dumps `a_chk` first), so that trailing run is already canonical and is left alone. **Any
other difference is fixed in the baseline, never here.**

## Why the seam functions' EXECUTE grants are stripped from both sides

Three of the five carry `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO app_user` in the old
chain — `packages/credentials/drizzle/0002_credentials_tenant_seam.sql:74-75`,
`packages/fiscal-verifactu/drizzle/0004_envios_drainer_seam.sql:111-112`,
`packages/payments/drizzle/0008_payments_webhook_resolver.sql:68-69`. In each file those two lines
run **after** the function has been handed to a helper role (`ALTER FUNCTION … OWNER TO …`, through a
temporary membership grant that the next line revokes), so the migrator is by then neither the owner
nor a member of the owner. PostgreSQL accepts both statements and does nothing:
`WARNING: no privileges could be revoked for "credential_tenants"` /
`WARNING: no privileges were granted for "credential_tenants"`, exit 0. Six such lines per container,
twelve per run, are on this script's stderr every time; psql prefixes each with the file and line
above, which is the quickest way to confirm nothing else has joined them.

The experiment, on `postgres:18-alpine` (PostgreSQL 18.6): one container, a `LOGIN CREATEROLE`
migrator owning the database, two identical `CREATE FUNCTION`s, the same
`REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO app_user` run against each — the second after
the old chain's ownership dance (`GRANT CREATE ON SCHEMA public`, `GRANT helper TO CURRENT_USER WITH
INHERIT FALSE`, `ALTER FUNCTION … OWNER TO helper`, both revoked) — then `pg_proc.proacl` and
`pg_dump --schema-only --no-owner`:

| the migrator …              | `proacl`                      | on stderr        | in the dump                                                         |
| --------------------------- | ----------------------------- | ---------------- | ------------------------------------------------------------------- |
| still owns the function     | `{mig=X/mig,app_user=X/mig}`  | nothing          | `REVOKE ALL … FROM PUBLIC;` and `GRANT ALL … TO app_user;`          |
| handed ownership away first | `{=X/helper,helper=X/helper}` | the two warnings | nothing — PUBLIC keeps EXECUTE (`=X/helper`), app_user gets nothing |

So pg_dump emits each half of the pair only when that half took effect, and the old dump carries no
ACL for any of the five (grep it: zero hits). In the baselines the helper roles are gone, the
functions stay owned by the migrator, and the same statements — carried verbatim, as spec §2
requires — finally take effect. A **correct** new dump therefore differs from the old one by exactly
those ACL statements, which is why they are stripped from both sides rather than read as a defect.
`--gate-new` is what makes that safe: it requires both halves to be there.

Three, not five: `sales_assert_tenders_cover` has an `OWNER TO` and no grant at all
(`packages/db/drizzle/0005_sales.sql:279`), and `sale_settlements_check_coverage` has neither, so a
baseline carrying the old SQL verbatim grants on three.

## `--gate-new`

Pass it in a real OLD-vs-NEW run. Because the lists above are applied to both sides, a baseline that
still carried a policy — or kept a `SECURITY DEFINER`, or dropped a seam grant — would be normalised
into agreement and diff clean. The flag reads the RAW new dump, before normalisation, and refuses it:

- **still present:** `CREATE POLICY`, `ROW LEVEL SECURITY`, `current_tenant_id`, any of the seven
  deleted roles, or `SECURITY DEFINER` on one of the five seam functions;
- **unexpected:** an `ENABLE ALWAYS TRIGGER` in the **old** dump — only the new side may add those;
- **missing:** for `credential_tenants`, `envios_tenants_with_work` and `resolve_payment_tenant`,
  both halves — `REVOKE … ON FUNCTION public.<fn>(…) FROM PUBLIC` as well as
  `GRANT … ON FUNCTION public.<fn>(…) TO app_user`. A baseline that kept the grant and lost the
  revoke would leave PUBLIC's default `EXECUTE` in place, which the stripped diff cannot see.

The two OLD-vs-OLD controls (the self-run, and the probe that proves a one-column change is caught)
do not pass the flag, because their NEW side is deliberately an old chain.

The residue table each run prints is the same information in a form you can read at a glance. In an
OLD-vs-NEW run:

- every NEW count is `0` — those are the objects the design deletes, and `--gate-new` refuses the run
  if one is not;
- `ENABLE ALWAYS TRIGGER` is the mirror image: the OLD count is `0` (gated too) and the NEW count is
  whatever the baselines add;
- `seam function ACL (both sides)` reads `0` OLD and `6` NEW — the three functions above, a `REVOKE`
  and a `GRANT` each, taking effect for the first time;
- `CREATE TABLE columns sorted` counts tables rather than differences, so the two sides should match;
  a table count that differs is a defect the diff catches anyway.
