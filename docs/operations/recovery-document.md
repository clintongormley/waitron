# Make a new recovery pack

The recovery pack is one PDF holding what you need when the box fails: the restore codes for the
bucket copy and the archives, and, on a box that files invoices, the server key or the name of the
pack or sheet that holds it. If the server still runs and you have lost its recovery pack, or an
older recovery PDF, make a new pack from the dashboard. You need the system-management permission
and a secure (HTTPS) connection to that server.

1. Open **Backups**. The **Recovery pack** card at the top says which pack is the latest and
   whether it is up to date. Choose **Make recovery pack**.
2. Sign in again in the dialog: your password, or **Use your passkey**. If your account uses an
   authenticator app, also enter a code from it or one of your recovery codes.
3. Tick **Also make a new server key** only if the pack or sheet holding the current server key is
   lost. Without the tick the pack does not change the key: its server key page names the pack or
   sheet that holds it.
4. Choose **Make pack**, then **Download PDF**, **Open to print**, or both. The box keeps no copy,
   so save or print the pack before you leave the page. Keep it locked away, off the box.
5. Keep older packs and sheets for older backups. With the tick, new backups use the new server
   key, and an older backup still needs the key it was made with. A new key cannot unlock an older
   backup whose matching key you have lost.

For example, keep Monday's pack while you keep Monday's backup, even if you make a new server key
on Tuesday. Check the key name on the selected copy when you [recover the box](hour-recovery.md).

If the pack did not reach this browser, the dialog says so and explains each choice: make it again,
or stop and change nothing.

During an unfinished first setup, resume the same attempt with its setup password and use that
flow's recovery-document step. Follow [first Live setup](first-live-fiscal-setup.md); do not start a
fresh identity just to obtain another sheet.

## Implementation references

The dashboard card is [recovery-pack-card.ts](../../apps/dashboard/src/screens/recovery-pack-card.ts)
and its dialog [recovery-pack-dialog.ts](../../apps/dashboard/src/widgets/recovery-pack-dialog.ts).
The server's [recovery pack routes](../../apps/server/src/backup-recovery-pack-api.ts) check
`system.manage`, the secure connection and a fresh sign-in, make the replacement server key when
asked, and keep a record of each pack, never its contents. [Route tests](../../apps/server/src/backup-recovery-pack-api.make.test.ts)
cover the request boundary; [dialog tests](../../apps/dashboard/src/widgets/recovery-pack-dialog.test.ts)
and [card tests](../../apps/dashboard/src/screens/recovery-pack-card.test.ts) cover the actions.
This procedure grants no restore or fiscal activation authority.
