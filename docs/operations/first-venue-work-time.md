# First venue: working-time configuration

For the first venue's agreement, add the rest and break-warning limits to its prepared
configuration before importing it during setup. A fresh export has no agreement row. The
[labour research](../compliance/research/2026-11-06-adviser-labour.md#limits-to-load-into-the-configuration-l23-to-l26-answered)
identifies the first venue's figures.

The exported file is encrypted, so you cannot edit it as JSON. From this repository's root, after
installing its dependencies, run the following with the paths to your export and a **new** output
file. Enter the same passphrase you used when exporting. This keeps the original file and changes
only the agreement row in the new encrypted copy; it does not open a venue database.

```bash
WAITRON_RULES_INPUT=/absolute/path/prepared.wbk \
WAITRON_RULES_OUTPUT=/absolute/path/prepared-with-time-rules.wbk bash <<'SHELL'
set -e
cd apps/server
IFS= read -r -s -p 'Export passphrase: ' rules_passphrase </dev/tty
printf '\n' >/dev/tty
printf '%s' "$rules_passphrase" | node --import tsx --input-type=module -e '
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { decodeConfigurationBundle, encodeConfigurationBundle } from "@waitron/provisioning";

const passphrase = readFileSync(0, "utf8");
const bundle = decodeConfigurationBundle(readFileSync(process.env.WAITRON_RULES_INPUT), passphrase);
if (!Object.hasOwn(bundle.modules, "workforce-es")) {
  throw new Error("The prepared configuration must already include workforce-es");
}
const rows = bundle.tables.convenio_config ??= [];
if (rows.length > 1) throw new Error("Expected at most one agreement row");
if (rows.length === 0) rows.push({
  id: randomUUID(),
  location_id: randomUUID(),
  created_at: new Date().toISOString(),
});
Object.assign(rows[0], {
  weekly_rest_minutes: 2880,
  break_threshold_minutes: 300,
  min_break_minutes: 20,
});
writeFileSync(process.env.WAITRON_RULES_OUTPUT, encodeConfigurationBundle(bundle, passphrase), {
  flag: "wx",
  mode: 0o600,
});
console.log("Prepared configuration: weekly rest 2880; break threshold 300; minimum break 20 minutes.");
'
SHELL
```

The passphrase travels through standard input, without being put in a command argument or an
environment variable. The output refuses to overwrite an existing file. The command leaves any
other fields on an existing agreement row unchanged. For a new row, the other rule columns take
their database defaults when imported. The import maps the location reference to the new venue;
the generated location reference above is only a placeholder for that mapping.

Import the new encrypted copy during setup. Rota warnings request a 20-minute break for a shift
longer than five hours. A shift lasting exactly five hours does not raise that break warning.
Weekly-rest warnings compare against 48 hours only for a person with shifts in both an earlier
and a later week; a one-week rota alone does not get this check. You can still publish a rota
with warnings.

Paid-break accounting is still open in A1406-2. The existing `breaks_count_as_worked` field describes
split-shift policy; changing it does not currently add a recorded break to worked minutes.
Keep it unchanged when preparing these limits. The separate continuous paid-break policy must
also distinguish the break from the unpaid gap between split shifts.

Working-time PDF summaries call the calculated amounts minutes above their daily or period target.
These figures do not decide whether the excess is overtime or complementary hours. Existing record
keys and recorded amounts stay the same, including the raw CSV column keys.

The row-to-warning case is exercised by `packages/workforce-es/src/convenio-roster.test.ts`.
The configured source row and imported values are exercised by the “copies declared configuration”
and “first venue” cases in `apps/server/src/configuration-transfer.test.ts`.
