# Keep backup keys and investigate a box

## Keep the recovery pack

In **Backups**, choose **A folder on this box**, a **Bucket**, or both, then save. Bucket
archives copy the current bucket settings when you save. Later edits to the continuous
bucket copy do not move those archives.

The **Recovery pack** card at the top of **Backups** makes one PDF holding the restore codes for
the bucket copy and bucket archives, the recovery key for archives in a folder, and the server key
or where it is: see [Make a new recovery pack](recovery-document.md). Keep the pack secret and off
the box, outside the bucket. Keep earlier packs and keys for archives made before a replacement:
changing the recovery key does not re-encrypt older files. After changing the recovery key, or
the bucket copy or archive settings on **Backups**, the card says the pack is out of date; make a new one.

If rotation reports `backup.rotation_metadata_failed`, the new key is already in effect.
Keep that key and make a new recovery pack. Do not assume that the failed metadata step kept
the former key active. See the [archive settings reference](../../apps/server/README.md)
and [restore procedures](../developers/offline-fiscal-restore.md) for the separate archive
and node recovery keys.

## Recover from an interrupted first setup

Choose **Recover from backup** on the repair page: it deletes the failed setup as Start again does,
and after the box restarts **Reconnect** opens "Join or recover an existing restaurant", where you
restore as on a new box ([procedure](hour-recovery.md#recover-while-first-setup-is-blocked)). Keep
the selected copy's named node key and any archive key or source credentials ready.

## Capture detailed logs while reproducing a problem

Open **Diagnostics** using an account with `diagnostics.view`. Choose **Turn on detailed
logging**, reproduce the problem, and note its time. The dashboard raises logging for 15
minutes and shows its expiry.

**Pause** freezes refresh; **Resume** starts it again. **Clear** removes only the displayed
lines. It does not delete saved logs, so the next refresh can display them again.

The [diagnostics screen](../../apps/dashboard/src/screens/diagnostics-screen.ts),
[API](../../apps/server/src/diagnostics-api.ts) and
[verbosity controller](../../apps/server/src/verbosity.ts) describe these controls.
The proposed one-touch problem-report system is separate work.

## Reconnect a print agent

Open `http://<agent-host>:9110`, or its configured setup port. A connected agent refuses
network access to its setup page; inspect that page on the agent's host through localhost.

If it cannot reach the venue, **Join a new network** starts a five-minute wait.
**Cancel reset** or a successful reconnect cancels it. If the wait ends while still
disconnected, the agent forgets its approval and saved server list. On a separate agent,
save the new server address and approve its join in the dashboard. A container-fixed server
address cannot be changed on that page.

This resets print-agent connectivity, not the venue database or fiscal identity. The
[setup page](../../apps/print-agent/src/setup-page.ts) and
[agent](../../packages/print-agent/src/agent.ts) retain the connection and reset rules.

## Pair a Bluetooth printer

In **Printers**, open **Add a printer** and scan. Choose **Pair and add** beside an
unpaired Bluetooth printer, enter the PIN from its manual, then complete the add form.
Use **Show all devices** if the scan result is hidden by the printer filter.

**Pair** on an already active printer pairs it again without adding a registration.
Use **Unpair** to remove the Bluetooth pairing. Do not infer that a successful unpair
removed every other route through which an agent can serve that printer.

See the [printer screen](../../apps/dashboard/src/screens/printers-screen.ts),
[printer API](../../apps/server/src/print-api.ts) and the
[box installation instructions](../../deploy/README.md) for the host's Bluetooth setup.
