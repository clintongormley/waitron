# Recover a box with its recovery sheet

Choose a usable archive, bucket copy or Waitron Cloud backup, then find the recovery sheet whose
key name matches that copy. A newer sheet may contain a replacement key that an older backup
does not accept. Keep the archive password or Cloud login separate from the node recovery key.

## Check the selected copy

Open Restore in setup and select the copy. Review its taxpayer, environment, source, saved node
and key name. Keep production and preproduction separate. Use a saved PDF through the recovery
picker or enter its grouped key. There is no installation code to type: the form has no field for
one and sends none (`packages/fiscal-verifactu/src/setup/recovery-hour.browser.test.ts`, "has no
installation-code field" and "sends no installation code"). A typed key still has to
authenticate the selected backup; its short typing check is not authentication.

The box checks the backup once, when it is uploaded, and keeps that checked copy for the clock
steps that follow. If a newer restore page uploads the backup again and it passes its check, that
copy replaces the first, and the older page stops working until the box restarts (after a
restart, each open page uploads again once and the later upload holds the copy): open restores in one page only
(`apps/server/src/hour-recovery-staged.test.ts`, "lets the newest restore event's checked upload
replace the copy"). If the box restarts while the page is open, or the copy goes unused for an
hour, the page's next clock step uploads the backup again by itself under the same restore
(`apps/setup/src/screens/recovery-copy.test.ts`, "uploads again under the same restore event when
the box no longer holds the staged copy").

Confirm that the former seller is stopped and no parallel recovery is underway. Selecting a
fresh name does not stop a copied or returning machine. Arrange recovery with the business's
other venues so that only one fresh setup or recovery runs at a time.

## Make the new series

There is no "last hour" question (`recovery-hour.browser.test.ts`, "asks no last-hour question and
offers no clock confirmation"). Press **Compare clocks**: the box compares its own clock with the
clock of the device showing the page and with the internet's, by itself; nobody types a time. A
page shown on the box's own screen runs on the box's clock, so it does not count as the second
clock (`apps/server/src/request-from-box.test.ts`;
`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`, "a browser on the box itself
is no second clock"). The box's clock must be within 30 seconds of every other clock it reads, ahead
or behind, and nothing confirms past it (`packages/fiscal-verifactu/src/hour-clock.test.ts`, "a
name needs a second clock within 30 seconds of the box").

The new series are named from the box's clock: five symbols for the UTC minute. The box also reads
the selected backup and any database still on the disk, and the name must be a later minute than
every name in that history (`packages/fiscal-verifactu/src/minute-selection-unknown-name.test.ts`,
"D1: a known later name in the surviving database" and "D2: the old database still on the disk"),
and not before the backup's newest invoice record or
the moment the backup was made (`apps/server/src/hour-recovery-host.test.ts`, "a backup's own
floors"). Names
made after the backup, or by a box this one never saw, are invisible to it.

After the clocks pass, the box waits 90 to 150 seconds before it takes the name, and the page
counts down (`packages/fiscal-verifactu/src/hour-selection.test.ts`, "restore waits until a minute
start 90 to 150 seconds after its check"; `recovery-hour.browser.test.ts`, "explains a waiting
restore with a countdown that goes back to the server at zero"). Keep the page open. A reloaded
page is a new restore and starts a new 90 to 150 seconds: the page makes a new restore event each
time it opens (`apps/setup/src/screens/recovery-allocation.ts`, `eventId: crypto.randomUUID()`),
and the box keeps each event's wait apart (`packages/fiscal-verifactu/src/hour-selection.ts`,
`sameEvent`); no test reloads a restore page end to end. What the page shows when it cannot go
ahead, and what it asks for:

- **No second clock** (no internet, and the page is on the box itself): connect the box to the
  internet, or open the page on a phone or laptop on the venue's network that has the backup. It
  checks again every 15 seconds and carries on by itself (`recovery-hour.browser.test.ts`, "Compare
  clocks with no second clock explains the wait and checks again by itself" and "with no second
  clock it explains itself and carries on when the internet arrives").
- **The clocks differ by more than 30 seconds**: the page shows both readings and asks you to try
  from another phone or laptop that has the backup; if they still differ, the box's time may be
  wrong, so ask for help. It does not retry by itself; press **Check again**
  (`recovery-hour.browser.test.ts`, "a clock refusal shows both readings and no countdown, and waits
  for Check again").
- **A later minute is already in use**: the page names the time from which the series can be made,
  with no countdown (`recovery-hour.browser.test.ts`, "a later minute in use names its time and does
  not count down").

For example, a restore whose clocks are compared at 09:00:04 UTC on 24 October 2026 waits until
09:02:00 and takes `0D0RY` (`hour-selection.test.ts`, the same restore test). With prefixes `A`,
`FF` and `R`, that prepares `A-0D0RY`, `FF-0D0RY` and `R-0D0RY` for future invoices. Recovery
keeps recorded invoices and their recovered counters, retires the old active series from further
issuance and starts the new series at one. It does not reuse the old series from the restored
counter position.

Follow the form's preparation and restore steps. Preserve the exact selected source and retained
operation if interrupted. The host checks the event, source, target and recovery authority again;
a started marker by itself grants no activation. Do not delete a staged request, key file or
spent-name record to retry. An uncertain outcome needs inspection rather than a new submission.

## Keep the resulting evidence

Ordinary reboot, exact completion and recovery-document reissue keep the current activation.
They do not take another name. Keep the recovery sheet needed by each retained backup and check
the restored server's outcome before using the till. The sheet carries the node recovery key and
no installation code (`packages/fiscal-verifactu/src/recovery-pdf-node.test.ts`, "refuses a sheet
that still carries an installation code").

Signed paper allocations, Cloud allocation receipts and random emergency identities are historical
formats. Their old environment-file collectors do not provide authority through the current
production preparation API. Shared Cloud accounts, backup access and recovery approvals continue
to serve their separate purposes. The [hour-code design](../superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
records the limits of clock and operator assurance; the
[two-box design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md), §6.5 and §6.7,
replaces its hour names with minute names and its clock confirmation with the 30-second rule.


## Re-register an existing node from the operator command

Use this command only with an operation already selected by the authenticated preparation host.
It asks no question and does not choose a name for you. Keep the operation file and
its host state together; editing its event, source or target does not create a new authorisation.

Stop the server before opening its venue folder. Set `WAITRON_STATE_DIR` to the state directory
that retains the selection. Set `WAITRON_VENUE_DIR` if the venue is outside that directory's
`venue` subdirectory. `WAITRON_RECOVERY_OPERATION_FILE` names the selected operation file;
`WAITRON_NODE_RECOVERY_KEY` supplies the matching secret through the environment, never an argument.
After building the server, run:

```sh
node apps/server/dist/register-till.js <nodeId> --confirm-old-box-gone --confirm-sole-recovery
```

Those confirmations attest that the former seller is stopped and no parallel recovery is running.
The command checks the key again, refreshes its clock comparison and checks the retained selection
before activation. This non-interactive entry needs usable internet time alongside the box clock.
An unavailable second clock refuses `sif.allocation_invalid` with reason `second_clock_missing`
(`apps/server/src/hour-promotion.test.ts`, "register-till refuses %s without changing the
selected venue", row "offline clock").
Do not delete the retained state to bypass that refusal.

A new event starts the selected series at one and retains the retired series and counters. An
exact replay returns the original installation and preserves subsequent counter advances.
