# A1323-6E — Choose a Waitron Cloud backup on the box

After approving Cloud recovery, choose a checked backup on the box. Show each copy’s time, newest
first with the newest chosen. Review and restore the chosen copy through the existing steps. With
no checked copies, show the empty message and offer **Check approval** again.

**Sources.** A1323 draft PR 6e and §6, drawing `03-restore.html`, and Cloud’s [version 2 recovery
contract](https://github.com/waitron-io/waitron-cloud/blob/46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8/docs/waitron-integration-contract.md#choosing-a-checked-snapshot-on-the-box).
The owner said “why? it would be much friendlier to do it from the box” (23 November, 19:00, draft O1).

**Prerequisite.** Cloud #1382 implements `points` and `select` for version 2. Setup currently opens
version 1 requests in `boot.ts`. The version 2 switch and post-restart report belong to the
[backup verification release qualification](../../operations/backup-verifier-release.md#complete-the-joint-qualification).
This plan starts from a qualified version 2 setup caller and a checked backup for its exact build.
It covers snapshot copies in test venues. The master-key field, Live restore, continuous copies and
Cloud’s approval page are separate work. Allow about 200 product and 250 test lines.

- [ ] **List and select.** In `cloud-recovery.ts`, reuse the version 2 signed transport and recovery
  lock. Sign an empty value for `points` and the copy ID for `select`. Validate each listed point
  against Cloud’s approved venue, and expose only the browser-safe summary. Approved status can
  call `info` once a choice is saved. Check the selected ID, venue, archive and exact-target check
  together before saving the chosen point and its verification. On `400 invalid_input`, fetch one
  fresh list and ask the person to choose again. Retry the same choice after a lost reply. On `410`,
  show the expired view. `409 conflict` preserves the last confirmed choice. Use the existing
  refusal mapping where it fits, including `setup-api-errors.ts` for any distinct outcome needed.
  Add list and choice in `setup-cloud-recovery-session-routes.ts`, using the body validation pattern
  in `setup-operation-routes.ts` and the recovery lock to refuse overlapping archive work.
  `cloud-recovery-v2.test.ts` checks the signed calls, unchecked or wrong-venue points, stale and
  expired replies and the chosen archive read. `setup-api.cloud-recovery.test.ts` checks route input
  and the browser-safe response.
- [ ] **Show the choice.** Extend `apps/setup/src/api/client.ts`, `events.ts`, `setup-app.ts` and
  `screens/cloud-restore-screen.ts`. Reuse setup’s labelled radios and the shell’s busy and
  navigation checks. On the first list, explicitly select the first copy even with a named Cloud
  approval, and show Cloud’s confirmed choice before enabling **Review backup**. Keep the saved
  choice on reload. Review sends the first archive read, which fixes the choice in Cloud. Tell the
  person before Review, lock the choices during Review and after success, and explain how to close
  the Cloud request and start over if Cloud reports the choice is fixed. A successful change resets
  earlier confirmations. Use §6’s English and Spanish wording in `i18n/strings/restore.ts`. Update
  both `guide/*/backup-recovery.md` files and the A1323 backlog. Screen and shell tests cover the
  default, choosing another, a stale list, no copies and the Review boundary.

Run each changed test file before and after its change, then the field, guide, language and box word
checks. Look at both languages and themes, including phone width. The owner lands 6e after the two
Claude reviews and availability in the Cloud they test. Cloud’s approval page follows the box.
