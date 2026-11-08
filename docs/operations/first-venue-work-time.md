# First venue: working-time configuration

For the first venue's agreement, add its rest, break and split-shift rules to the prepared
configuration before importing it during setup. The command adds an agreement row if the export has none. The
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
  split_min_segment_minutes: 180,
  split_max_segment_minutes: 300,
  split_min_gap_minutes: 90,
  continuous_paid_break_minutes: 20,
});
writeFileSync(process.env.WAITRON_RULES_OUTPUT, encodeConfigurationBundle(bundle, passphrase), {
  flag: "wx",
  mode: 0o600,
});
console.log("Prepared configuration: weekly rest 2880; break threshold 300; minimum break 20; split stretches 180–300; split gap 90; paid continuous break up to 20 minutes.");
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

A completed continuous session longer than five hours counts up to 20 minutes of its recorded
pauses as worked time. Each session qualifies separately. A single pause of 90 minutes or more
makes the session split, with no break credit. Shorter pauses share one 20-minute allowance.
Use Start break and End break for pauses; clock out when work ends. The recorded pause duration
stays visible beside the worked total. Keep `breaks_count_as_worked` unchanged.

For a person with split stretches on the same local start day, the rota warns about stretches
shorter than 180 or longer than 300 minutes, or gaps shorter than 90 minutes. Touching assignments
form one continuous stretch. These warnings do not prevent publishing a rota.

Working-time PDF summaries call the calculated amounts minutes above their daily or period target.
These figures do not decide whether the excess is overtime or complementary hours. Existing record
keys and recorded amounts stay the same, including the raw CSV column keys.

The additive migration was rehearsed on one populated agreement row with `node:sqlite`: its
original fields survived and the four new fields were null before configuration. No table was
rebuilt. This rehearsal measures that table, not every venue row.

The boundary and warning cases are exercised by `packages/workforce/src/projection.test.ts`
and `packages/workforce/src/roster-validation.test.ts`. The configured source row and imported
values are exercised by the “imports a current-version paid-break policy” cases in
`apps/server/src/configuration-transfer.test.ts`.
