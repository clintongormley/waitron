# First venue: working-time configuration

For the first venue's agreement, set the rest and break-warning limits in its prepared
configuration before importing it during setup. Keep the existing schema defaults for other
agreements. The [labour research](../compliance/research/2026-11-06-adviser-labour.md#limits-to-load-into-the-configuration-l23-to-l26-answered)
identifies the first venue's figures.

In `tables.convenio_config`, set these fields on the venue's row. Keep its other fields, including
its row and location references and creation time:

```json
{
  "weekly_rest_minutes": 2880,
  "break_threshold_minutes": 300,
  "min_break_minutes": 20
}
```

These are fields of the row inside a complete configuration bundle, not a standalone import file.
If you are preparing a configuration with no agreement row, include one with its `id`,
`location_id` and `created_at` as well. The other columns retain their database defaults when
omitted. The import maps the location reference to the new venue.

After import, rota warnings use a 48-hour weekly rest and request a 20-minute break for a shift
longer than five hours. A shift lasting exactly five hours does not raise that break warning.
The rota can still be published with warnings.

Paid-break accounting is still open in A1406-2. The existing `breaks_count_as_worked` field describes
split-shift policy; changing it does not currently add a recorded break to worked minutes.
Keep it unchanged when preparing these limits. The separate continuous paid-break policy must
also distinguish the break from the unpaid gap between split shifts.

Working-time PDF summaries call the calculated amounts minutes above their daily or period target.
These figures do not decide whether the excess is overtime or complementary hours. Existing record
keys and recorded amounts stay the same, including the raw CSV column keys.

The row-to-warning case is exercised by `packages/workforce-es/src/convenio-roster.test.ts`.
The configured source row and imported values are exercised by the “copies declared configuration”
case in `apps/server/src/configuration-transfer.test.ts`.
