# Make a new recovery pack

The recovery pack is one PDF holding what you need when the box fails: the restore codes for the
bucket copy and the archives, and, on a box that files invoices, the box key or the name of the
pack or sheet that holds it. If the box still runs and you have lost its recovery pack, or an
older recovery PDF, make a new pack from the dashboard. You need the system-management permission
and a secure (HTTPS) connection to that box.

1. Open **Backups**. The **Recovery pack** card at the top says which pack is the latest and
   whether it is up to date. Choose **Make recovery pack**.
2. The pack does not change any key: its first page names the pack that holds the current master
   key, and its box key page names the pack or sheet that holds the box key. If the master key or
   the pack holding the box key is lost, choose **Make a new master key** instead (below).
3. Choose **Make pack**. When Waitron asks you to confirm it is you, use your password or
   **Use your passkey**. If your account uses an authenticator app, also enter a code from it or one
   of your recovery codes. This confirmation covers protected actions in this browser for 15 minutes
   or until your session ends.
4. Choose **Download PDF**, **Open to print**, or both. The box keeps no copy, so save or print the
   pack before you leave the page. Keep it locked away, off the box.
5. Keep older packs and sheets for older backups. After **Make a new master key**, new backups
   use the new box key, and an older backup still needs the key it was made with. A new key cannot unlock an older
   backup whose matching key you have lost.

For example, keep Monday's pack while you keep Monday's backup, even if you make a new box key
on Tuesday. Check the key name on the selected copy when you [recover the box](hour-recovery.md).

If the pack did not reach this browser, the dialog says so and explains each choice: make it again,
or stop and change nothing.

## Make a new master key

Choose **Make a new master key** on the card. The dialog says until when to keep the old pack;
choose **Make a new master key** and confirm it is you as above. It makes a new master key and a
new box key together, in a new pack. The dialog then shows the master key with its name: use
**Download**, **Print** or **Copy**, then **Continue**. It is shown only this once. The button is
not offered while the box has no box key, since the master key is made with the box key's
replacement until the box key goes.

During an unfinished first setup, carry on in the tab that was doing it (reloading that tab
carries on until activation starts) and use that flow's recovery-pack step. Follow [first Live setup](first-live-fiscal-setup.md); do not start a
fresh identity just to obtain another pack.

## Implementation references

The dashboard card is [recovery-pack-card.ts](../../apps/dashboard/src/screens/recovery-pack-card.ts)
and its dialog [recovery-pack-dialog.ts](../../apps/dashboard/src/widgets/recovery-pack-dialog.ts).
The server's [recovery pack routes](../../apps/server/src/backup-recovery-pack-api.ts) check
`system.manage`, the secure connection and a fresh sign-in, make the replacement box key when
asked, and keep a record of each pack, never its contents. [Route tests](../../apps/server/src/backup-recovery-pack-api.make.test.ts)
cover the request boundary; [dialog tests](../../apps/dashboard/src/widgets/recovery-pack-dialog.test.ts)
and [card tests](../../apps/dashboard/src/screens/recovery-pack-card.test.ts) cover the actions.
This procedure grants no restore or fiscal activation authority.
