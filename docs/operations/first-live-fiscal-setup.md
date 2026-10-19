# Set up your first Live fiscal identity

Set up boxes for the same taxpayer one at a time, including boxes at other venues. Each fresh
setup selects a four-character code from a UTC hour. Two boxes choosing the same hour can choose
the same names, so your coordination matters even when both clocks are correct.

This procedure describes the A679 candidate. Final integration, both installed reviews and
current-head CI remain open. The owner approved the generated recovery sheets on 19 October.
See the [qualification inventory](a679-changed-checks.md) for the checks and their limits.

## Review the business and clock

Choose Live in the local setup wizard. Enter the business, location and administrator details.
If you imported a prepared configuration, review whether it belongs to this same taxpayer before
continuing. Complete the applicable certificate, email and separate preproduction readiness steps.
The readiness sample uses its own database and grants no production identity.

Review the country, location, time zone and displayed date and time together. The box compares
its clock with your browser and an available authenticated internet reading. If it cannot compare
them, or the readings disagree, check the box's displayed time before confirming it. Correct the
clock and check again when it is wrong. Confirmation cannot override known history or the
software's release-time limit.

Answer **Has anyone set up a Waitron box for this business in the last hour?** for the whole
business, including interrupted setups, replacements and recoveries at its other venues.
**No** permits the current eligible hour. **Yes** and **I don't know** wait for the next UTC hour.
Keep operations in turn: two boxes waiting together can still reach the same code.

For example, at 13:40 Madrid summer time on 16 October 2026, the UTC hour's code is `06RB`.
Prefixes `A`, `FF` and `R` become `A-06RB`, `FF-06RB` and `R-06RB`. A later setup must use an
eligible hour later than every hour already known to that box. Correct clocks and surviving
history reduce accidental reuse; they cannot discover another box whose activity you did not report.

## Keep the recovery PDF

Download, print, or both from the recovery-document step. Both actions use the same document
within that delivery session. Check the business, installation code, node and key name, then
confirm that you kept the sheet before continuing. There is no separate signing key, custodian
computer, register or downloadable tool.

Keep the PDF or paper outside the box and its backups. It contains the recovery secret.
Your Cloud login, or the downloaded archive's password, stays separate. Keep the older named
sheet while you retain backups that need its key. The box stores a verifier for the key;
it cannot recover the old secret from that verifier.

The current sheet shows one installation code and one grouped recovery key. You can select the
saved PDF during recovery or type its key. The typing check catches mistakes; opening the
selected backup still authenticates the complete secret. See [recovering a box](hour-recovery.md).

## Resume an interruption

Reconnect to inspect the attempt before starting another setup. The repair page lets you prove
ownership with the setup password and recover the same attempt. An eligible interrupted marker
can be repaired; preserve the state and venue folders when the page reports an uncertain or
conflicting outcome. Do not delete records to get past a refusal.

**Finish** publishes an exactly checked committed result. It does not activate another identity,
reset counters or require a new hour because the clock has advanced. Starting again is limited
to a positively empty, never-activated attempt; it retains the original evidence and spends the
former hour. A missing database is a different condition.

Repair-page recovery from backup, authorised fresh setup while keeping old data, and secure-
connection repair remain separately queued as A731, A732 and A733 before go-live. This candidate
does not add a promotion browser screen or complete venue-copy adoption.

## Use the provisioning command

Build the provisioning bundle with `pnpm --filter @waitron/provisioning build`, then run its
`venue` command against the intended migrated venue directory with `WAITRON_STATE_DIR` set.
Choose an absolute `--recovery-pdf` destination outside the host-state and venue folders.
For example, with your real paths:

```sh
WAITRON_STATE_DIR=/var/lib/waitron/state \
  node packages/provisioning/dist/bin.js venue \
    --venue-dir /var/lib/waitron/state/venue \
    --recovery-pdf /media/recovery/olivo-recovery.pdf
```

Follow the venue, clock, recent-setup, password and kept-document prompts. `--yes` does not
answer the clock or retention questions. Production additionally needs the accepted readiness
receipt. Supply login secrets through their private prompts or supported environment variables,
never command arguments. `WAITRON_INITIAL_VENUE_INPUT` cannot supply Live activation authority.
The [provisioning reference](../../packages/provisioning/README.md) describes the options.

The [15 October procedure](first-live-fiscal-setup-2026-10-15.md) records the superseded
custodian protocol and its historical qualification; it is not a setup route on this candidate.
