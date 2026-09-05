# schema-equivalence.sh — how to read a non-empty diff

`scripts/schema-equivalence.sh <OLD_ROOT> <NEW_ROOT> <OUT_DIR>` applies every migration set of each
checkout to its own `postgres:18-alpine` container as `waitron_migrator` (a non-superuser owner, the
shape the provisioner produces), takes `pg_dump --schema-only --no-owner` of both, normalises, and
diffs. Exit 0 prints `EQUIVALENT`; exit 1 prints the diff and leaves it beside both raw dumps, both
normalised dumps, the role lists and the residue table in `<OUT_DIR>`.

It normalises exactly this, the same list on **both** dumps (spec
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

Nothing else. **A non-empty diff is a defect in the baseline, never something to normalise away.**

The list is applied to both sides because that is the only normalisation under which OLD vs OLD
comes out `EQUIVALENT`, and that control is what proves the script measures anything. It costs
nothing on a correct baseline, whose NEW dump contains none of the deleted objects — and the residue
table each run prints is where you check that rather than assume it: in an OLD-vs-NEW run every NEW
count must be `0` except `ENABLE ALWAYS TRIGGER`, whose OLD count must be `0`. A non-zero NEW count
means the baseline still carries something this design deletes; that is a failure even when the diff
is empty.
