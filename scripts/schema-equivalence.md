# schema-equivalence.sh — how to read a non-empty diff

`scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR> [--gate-new]` applies every migration
set of each checkout to its own `postgres:18-alpine` container as `waitron_migrator` (a
non-superuser owner, the shape the provisioner produces), takes `pg_dump --schema-only --no-owner` of
both, normalises, and diffs. Exit 0 prints `EQUIVALENT`; exit 1 prints the diff and leaves it beside
both raw dumps, both normalised dumps, the role lists and the residue table in `<OUT_DIR>`.

It removes exactly this, the same list from **both** dumps (spec
`docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md` §2):

- whole statements matching `^CREATE POLICY `, `ROW LEVEL SECURITY;`,
  `FUNCTION public.current_tenant_id`, `ENABLE ALWAYS TRIGGER`, or the name of one of the seven
  deleted roles — `tenant_provisioner`, `credentials_enumerator`, `envios_drainer`,
  `payments_webhook_resolver`, `sales_coverage_checker`, `sync_tailer`, `sync_retention`;
- the `SECURITY DEFINER` clause of the five seam functions — `credential_tenants`,
  `envios_tenants_with_work`, `resolve_payment_tenant`, `sales_assert_tenders_cover`,
  `sale_settlements_check_coverage` — the clause only, so their bodies stay in the comparison; the
  run fails if any of the five is missing from the NEW dump;
- pg_dump's own noise: `--` header lines, the leading `SET` / `set_config` lines, and the
  `\restrict` / `\unrestrict` pair, whose token is random per dump.

It also makes one **representational** change, and only one: the column definitions inside each
`CREATE TABLE` block are sorted. Column order is not an object — the old chain accretes columns with
`ALTER TABLE` while a baseline declares them in schema-file order, so `pg_dump`'s attnum order
differs for a table that is otherwise identical, and every query in the app names its columns.
pg_dump's inline `CHECK` constraints follow the columns in NAME order rather than creation order
(measured on PostgreSQL 18.6: a table created with `CONSTRAINT z_chk` inline and `a_chk` added
afterwards dumps `a_chk` first), so that trailing run is already canonical and is left alone. **Any
other difference is fixed in the baseline, never here.**

Pass `--gate-new` in a real OLD-vs-NEW run. Because the list above is applied to both sides, a
baseline that still carried a policy would have it normalised away and could diff clean; the flag
reads the RAW new dump, before normalisation, and fails the run naming what it found —
`CREATE POLICY`, `ROW LEVEL SECURITY`, `current_tenant_id`, or one of the seven roles. The two
OLD-vs-OLD controls (the self-run, and the probe that proves a one-column change is caught) do not
pass it, because their NEW side is deliberately an old chain.

The residue table each run prints is the same information in a form you can read at a glance: in an
OLD-vs-NEW run every NEW count must be `0` except `ENABLE ALWAYS TRIGGER`, whose OLD count must be
`0`, and `CREATE TABLE columns sorted`, which counts tables and should match on both sides.
