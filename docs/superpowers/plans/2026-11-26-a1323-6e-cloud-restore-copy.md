# A1323-6E — Choose a Waitron Cloud backup on the box

After approving Cloud recovery, choose a checked backup on the box, newest first and selected by
default. Use the time in each row to decide. Review and restore the chosen backup through the
existing steps. With no checked backups, show the empty message and offer **Check approval** again.

**Source.** A1323 draft PR 6e and §6, drawing `03-restore.html`, and Cloud’s
[version 2 recovery contract](https://github.com/waitron-io/waitron-cloud/blob/46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8/docs/waitron-integration-contract.md#choosing-a-checked-snapshot-on-the-box).
The owner said “why? it would be much friendlier to do it from the box” (23 November, 19:00, draft O1).
This slice covers test venues and snapshot copies. The master-key changes, Live restore, continuous
copies and Cloud’s approval page are separate work. Expected size is about 260 product and 300 test lines.

- [ ] **Use the existing verified Cloud recovery protocol.** Wire `boot.ts`’s setup recovery client
  to version 2 and `currentBackupVerificationTarget` for an identified box build. Keep version and
  target checks on the saved request through `node-entry.ts`’s restart report and the report caller
  in `cloud-replacement.ts`. Source-only and other existing v1 callers keep their current path.
  Never downgrade a v2 request. Test the setup start and post-restart acknowledgement through their
  real entry points with a controlled target, alongside the v2 client tests.
- [ ] **List and select.** In `cloud-recovery.ts`, send `points` and `select` through the existing
  signed transport and recovery lock. Keep Cloud’s newest-first order, validate each point and its
  venue, and expose only the existing browser-safe summary. Before selection, an approved v2 status
  needs no `info`. Check the returned choice, archive and exact-target verification together, then
  save the point and verification together. A stale-choice `400 invalid_input` replaces the list
  and asks for a new choice. A `410` shows the expired view. Preview already sends the first `read`,
  which fixes the choice in Cloud. On a subsequent `409 conflict`, keep the confirmed choice and
  explain how to start another recovery in Cloud. Preview, restore and `restored` keep their existing
  binding and grant checks. Add list and choice to `setup-cloud-recovery-session-routes.ts` using its
  existing setup guard and JSON validation. `cloud-recovery-v2.test.ts` owns signed requests, a
  rejected unchecked or wrong-venue point, stale/expired choices and the selected archive read.
  `setup-api.cloud-recovery.test.ts` checks route input and the browser-safe reply.
- [ ] **Show the choice.** Extend `apps/setup/src/api/client.ts`, `events.ts`, `setup-app.ts` and
  `screens/cloud-restore-screen.ts`. Reuse setup’s labelled radio pattern and the shell’s busy and
  navigation checks. Auto-select the newest only for the first list, keep the saved choice on reload,
  and show the backup time in the chosen row. Enable preview only after Cloud confirms the choice.
  Changing that choice clears the earlier preview and confirmations. Use §6’s English and Spanish
  wording in `i18n/strings/restore.ts` and update both `guide/*/backup-recovery.md` files and the
  A1323 backlog. Screen and shell tests cover the first choice, choosing another, refreshing a
  stale list, the empty view and the preview reset. Keep existing restore checks.

Run each changed test file before and after its change. Run the named field, guide, language and box
word guards. Look at the chooser and empty view in both languages and themes, including phone width.
Cloud #1382 shipped the server change to Cloud main. Before the owner lands 6e, confirm those routes
are available in the Cloud they test and exercise the chooser with a copy checked for that build.
Cloud’s portal change follows 6e. Use two Claude run-it reviews for the restore and Cloud contract.
