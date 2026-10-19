# Recover a box with its recovery sheet

Choose a usable archive, bucket copy or Waitron Cloud backup, then find the recovery sheet whose
key name matches that copy. A newer sheet may contain a replacement key that an older backup
does not accept. Keep the archive password or Cloud login separate from the node recovery key.

## Check the selected copy

Open Restore in setup and select the copy. Review its taxpayer, environment, source, saved node
and key name. Keep production and preproduction separate. Use a saved PDF through the recovery
picker or enter its grouped key and current four-character installation code. A typed key still
has to authenticate the selected backup; its short typing check is not authentication.

Confirm that the former seller is stopped and no parallel recovery is underway. Selecting a
fresh code does not stop a copied or returning machine. Arrange recovery with the business's
other venues so that only one fresh setup or recovery runs at a time.

## Select the new hour

Check the displayed location, time zone and clocks. Answer the recent-setup question for the whole
taxpayer. Yes or an unknown answer waits for the next UTC hour. The box also checks the selected
backup and surviving host history. A supplied older copy cannot lower a known floor, and a new
identity requires a strictly later eligible hour. Missing history can still hide later activity.

With prefixes `A`, `FF` and `R`, selecting `06RC` prepares `A-06RC`, `FF-06RC` and `R-06RC` for
future invoices. Recovery keeps recorded invoices and their recovered counters, retires the old
active series from further issuance and starts the new series at one. It does not reuse the old
series from the restored counter position.

Follow the form's preparation and restore steps. Preserve the exact selected source and retained
operation if interrupted. The host checks the event, source, target and recovery authority again;
a started marker by itself grants no activation. Do not delete a staged request, key file or
spent-hour record to retry. An uncertain outcome needs inspection rather than a new submission.

## Keep the resulting evidence

Ordinary reboot, exact completion and recovery-document reissue keep the current activation.
They do not allocate another hour. Keep the recovery sheet needed by each retained backup and
check the restored server's outcome before using the till. The sheet shows only this node's
current installation code; backup and surviving-host evidence carry their own additional floors.

Signed paper allocations, Cloud allocation receipts and random emergency identities are historical
formats. Their old environment-file collectors do not provide authority through the current
production preparation API. Shared Cloud accounts, backup access and recovery approvals continue
to serve their separate purposes. The [hour-code design](../superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
records the limits of clock and operator assurance.


## Re-register an existing node from the operator command

Use this command only with an operation already selected by the authenticated preparation host.
It does not ask the recent-setup question or choose an hour for you. Keep the operation file and
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
An unavailable second clock refuses `sif.allocation_invalid` with reason `clock_unconfirmed`.
Do not delete the retained state to bypass that refusal.

A new event starts the selected series at one and retains the retired series and counters. An
exact replay returns the original installation and preserves subsequent counter advances.
