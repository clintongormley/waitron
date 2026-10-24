# Set up your first Live fiscal identity

Set up boxes for the same taxpayer one at a time, including boxes at other venues. Each fresh
setup names its series from the box's clock: five symbols for the UTC minute. Two boxes that know
nothing of each other and take a name in the same minute can choose the same names, so your
coordination matters even when both clocks are correct.

## Review the business and clock

Choose Live in the local setup wizard. Enter the business, location and administrator details.
If you imported a prepared configuration, review whether it belongs to this same taxpayer before
continuing. Complete the applicable certificate, email and separate preproduction readiness steps.
The readiness sample uses its own database and grants no production identity.

Review the country, location, time zone and displayed date and time together. The box compares
its clock with the clock of the device showing the page, and with the internet's when it reaches
it, by itself; nobody types a time
(`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "automatically compares clocks
and shows combined country, place, zone and local time before selection"). A page shown on the
box's own screen runs on the box's clock, so it does not count as the second clock
(`apps/server/src/request-from-box.test.ts` sorts a request from the box's own address as the box;
`packages/fiscal-verifactu/src/hour-setup-clock.test.ts`, "a browser on the box itself is never
the second clock"). The box's clock must be within 30 seconds of every
other clock it reads, ahead or behind, and there is no confirmation to get past it
(`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a name needs a second clock within 30
seconds of the box"). There is no "last hour" question: the page has no such field
(`packages/fiscal-verifactu/src/setup/first-hour.browser.test.ts`, "asks no last-hour question and offers no clock confirmation"). Before you
press **Make the series**, the page explains nothing and retries nothing
(`first-hour.browser.test.ts`, "a preview refused for %s on load shows the readings with no
failure and no explanation").

After you press it and the clocks pass, the box waits 90 to 150 seconds before it takes the name,
and the page counts down; keep it open (`packages/fiscal-verifactu/src/hour-selection.test.ts`,
"setup checked at %s waits until %s"; `first-hour.browser.test.ts`, "explains a waiting setup with
a countdown that goes back to the server at zero"). A reload during the wait shows the time the
box has left (`first-hour.browser.test.ts`, "a reload during a wait shows the server's time
left"). What the page shows when it cannot go ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or till on the venue's network and enter the setup
  password. It checks again every 15 seconds and carries on by itself (`first-hour.browser.test.ts`,
  "with no second clock it explains itself and carries on when the internet arrives").
- **The clocks differ by more than 30 seconds**: the page shows both readings and asks you to try
  from another phone or till; if they still differ, the box's time may be wrong, so ask for help.
  It does not retry by itself; press **Check again** (`first-hour.browser.test.ts`, "a clock
  refusal shows both readings and no countdown, and waits for Check again").
- **A later minute is already in use**: the page names the time from which the series can be made,
  with no countdown (`first-hour.browser.test.ts`, "a later minute in use names its time and does
  not count down").

For example, a setup whose clocks are compared at 09:00:00 UTC on 24 October 2026 (11:00 Madrid
summer time) waits until 09:02:00 (`hour-selection.test.ts`, the setup test above), and that
minute's code is `0D0RY` (`hour-selection.test.ts`, "restore waits until a minute start 90 to 150
seconds after its check"). Prefixes `A`, `FF` and `R` become `A-0D0RY`, `FF-0D0RY` and `R-0D0RY`.
A later setup must use a minute later than every name already known to that box. Correct clocks
and surviving history reduce accidental reuse; they cannot discover another box whose activity
you did not report.

## Keep the recovery PDF

Download, print, or both from the recovery-document step. Both actions use the same document
within that delivery session. Check the business, node and key name, then confirm that you kept
the sheet before continuing. There is no separate signing key, custodian computer, register or
downloadable tool.

Keep the PDF or paper outside the box and its backups. It contains the recovery secret.
Your Cloud login, or the downloaded archive's password, stays separate. Keep the older named
sheet while you retain backups that need its key. The box stores a verifier for the key;
it cannot recover the old secret from that verifier.

The sheet shows one grouped recovery key and no installation code
(`packages/fiscal-verifactu/src/recovery-pdf-node.test.ts`, "refuses a sheet that still carries an
installation code"). You can select the saved PDF during recovery or type its key. The typing
check catches mistakes; opening the selected backup still authenticates the complete secret.
See [recovering a box](hour-recovery.md).

## Resume an interruption

Reconnect to inspect the attempt before starting another setup. The repair page lets you prove
ownership with the setup password and recover the same attempt. An eligible interrupted marker
can be repaired; preserve the state and venue folders when the page reports an uncertain or
conflicting outcome. Do not delete records to get past a refusal.

**Finish** publishes an exactly checked committed result. It does not activate another identity,
reset counters or require a new name because the clock has advanced. Starting again is limited
to a positively empty, never-activated attempt; it retains the original evidence and spends the
former name. A missing database is a different condition.

Repair-page recovery from backup remains queued as A731. Secure-connection repair is available:
choose **Set up secure connection** on the repair page and follow the
[connection repair procedure](../../apps/server/README.md#repairing-the-secure-connection).
A732's proposed fresh-workspace action and recovery desk were withdrawn by the owner on
21 October 2026. Promotion's browser screen and complete venue-copy adoption remain separate work.

## When both credentials are lost

If you have lost both the administrator password and recovery sheet, reinstall the box and set
it up again (owner, 2026-10-21). Reinstallation loses the box's local data. The new setup starts a
fresh fiscal identity and chain; it does not reopen the old account or continue its history.
Keep any separately held archive, bucket or managed Cloud copy: recovering one still requires
its named recovery key and the [ordinary restore checks](hour-recovery.md). Reinstalling cannot
replace that key. This documentation change does not authorise a reset or reinstall now.

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

Follow the venue, password and kept-document prompts; the command asks nothing about the clock or
recent setups. It needs the internet's clock: with only the box's own, it explains why and stops
(`packages/fiscal-verifactu/src/initial-hour-setup.test.ts`, "the terminal with only the box's
clock explains and cancels without a question"). When the name must wait, it prints why and the
time it continues at, and stops; run it again within a minute after that time, or it waits again
(same file, "the terminal asks nothing, prints why it waits and until when, and keeps the wait"
and "a terminal run more than a minute after its wait's target waits again"). `--yes` does not
answer the retention question. Production additionally needs the accepted readiness
receipt. Supply login secrets through their private prompts or supported environment variables,
never command arguments. `WAITRON_INITIAL_VENUE_INPUT` cannot supply Live activation authority.
The [provisioning reference](../../packages/provisioning/README.md) describes the options.

The [15 October procedure](first-live-fiscal-setup-2026-10-15.md) records the superseded
custodian protocol and its historical qualification; it is not a setup route on this candidate.
