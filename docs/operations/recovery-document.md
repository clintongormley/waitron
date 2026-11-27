# Print a new recovery pack

The recovery pack is one PDF holding what you need when the box fails. Its first page holds the
master key, with its name and QR code. Until later
changes remove them, the other parts the box has follow, a page each: the restore codes for the
bucket copy and the archives. When emergency start in Cloud is available, the first page also
holds a QR code for the venue's Cloud address. Printing another copy needs the current master key; if you have lost the
recovery pack, [make a new master key](#make-a-new-master-key) instead. You need the system-management
permission and a secure (HTTPS) connection to that box.

1. Open **Backups**. The **Recovery pack** card at the top says which pack is the latest and
   whether it is up to date. Choose **Print the recovery pack**.
2. Type the current master key, or choose the recovery pack PDF that holds it. Printing changes no
   key: the new pack holds the same master key. A wrong master key prints nothing. If the master
   key is lost, choose **Make a new master key** instead (below).
3. Choose **Print the recovery pack**. When Waitron asks you to confirm it is you, use your password or
   **Use your passkey**. If your account uses an authenticator app, also enter a code from it or one
   of your recovery codes. This confirmation covers protected actions in this browser for 15 minutes
   or until your session ends.
4. Choose **Download PDF**, **Open to print**, or both. The box keeps no copy, so save or print the
   pack before you leave the page. Keep it locked away, off the box.
5. Keep older packs for older backups. After **Make a new master key**, restoring a
   backup made after that needs the new master key, and restoring an older backup still needs the
   master key that was current when it was made. A new master key cannot authorise restoring an
   older backup whose master key you have lost.

For example, keep Monday's pack while you keep Monday's backup, even if you make a new master key
on Tuesday. Check the key name on the selected copy when you [recover the box](hour-recovery.md).

If the pack did not reach this browser, the dialog says so and explains each choice: print it again,
or stop and change nothing.

## Make a new master key

Choose **Make a new master key** on the card. The dialog says until when to keep the old pack;
choose **Make a new master key** and confirm it is you as above. It makes a new master key in a
new pack. The dialog then shows the master key with its name: use **Download** or **Print**, then
**Continue**. **Copy** copies the master key alone and does not count: the pack holds more than the key, so use
**Download** or **Print** before **Continue**. It is shown only this once, so **Stop** and Escape do nothing while the box is making
it. The button is offered once the card has read the box's status.
New backups then use a backup key from the new master key. If the card says backups still use a backup key from the old master key, choose **Change the backup key**.

During an unfinished first setup, carry on in the tab that was doing it (reloading that tab
carries on until activation starts) and use that flow's recovery-pack step. Follow [first Live setup](first-live-fiscal-setup.md); do not start a
fresh identity just to obtain another pack.

## Change the backup key

Choose **Change the backup key** on the card and type the master key, or choose the recovery pack PDF. New backups then use the next backup key, which a box you removed can't read. A wrong master key changes nothing. Then choose **Print the recovery pack** and keep the new pack: restoring your bucket copy after the change needs it. Backup files from before and after the change open with your master key.

## Implementation references

The dashboard card is [recovery-pack-card.ts](../../apps/dashboard/src/screens/recovery-pack-card.ts)
and its dialogs [recovery-pack-dialog.ts](../../apps/dashboard/src/widgets/recovery-pack-dialog.ts)
and [backup-key-dialog.ts](../../apps/dashboard/src/widgets/backup-key-dialog.ts).
The server's [recovery pack routes](../../apps/server/src/backup-recovery-pack-api.ts) check
`system.manage`, the secure connection and a fresh sign-in, check a typed master key before printing, make a new master key when asked,
and keep a record of each pack and each master key's name and check value, never the
key itself or the pack's contents. [Route tests](../../apps/server/src/backup-recovery-pack-api.make.test.ts)
cover the request boundary; [dialog tests](../../apps/dashboard/src/widgets/recovery-pack-dialog.test.ts)
and [card tests](../../apps/dashboard/src/screens/recovery-pack-card.test.ts) cover the actions.
This procedure grants no restore or fiscal activation authority.
