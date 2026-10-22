# Replace a lost recovery sheet

If the server still runs and you have lost its recovery PDF, create a replacement from the
dashboard. You need the system-management permission and a secure connection to that server.

1. Open **Backups**, then find **Recovery PDF**.
2. Choose **Create recovery PDF**. Read the warning, then choose **Replace key**.
3. Choose **Download PDF**, **Open to print**, or both. Keep the resulting sheet outside the
   server and its backups. Download and print use the document you just created; creating
   another PDF replaces the key again.
4. Keep older sheets for older backups. New backups use the replacement key; an older backup
   still needs the key it was captured with. Replacing today's key cannot unlock an older
   backup whose matching key you have lost.

For example, keep Monday's sheet while you retain Monday's backup, even if you replace the
server's key on Tuesday. Check the key name on the selected copy when you
[recover the box](hour-recovery.md).

**Clear PDF** removes the displayed document from this browser panel. Download or print it
before clearing it or leaving the page. If you need another copy while the document is still
shown, use its download or print link instead of replacing the key again.

During an unfinished first setup, resume the same attempt with its setup password and use
that flow's recovery-document step. Follow [first Live setup](first-live-fiscal-setup.md);
do not start a fresh identity just to obtain another sheet.

## Implementation references

The dashboard panel is [recovery-document-panel.ts](../../apps/dashboard/src/screens/recovery-document-panel.ts).
The server's [reissue and download routes](../../apps/server/src/recovery-document-api.ts)
check `system.manage`, create the replacement verifier and retain the corresponding PDF for
download. [Route tests](../../apps/server/src/recovery-document-api.test.ts) cover the request
boundary; [panel tests](../../apps/dashboard/src/screens/recovery-document-panel.test.ts)
cover the actions. This procedure retains A679's recovery-document instructions; it grants no
restore or fiscal activation authority.
