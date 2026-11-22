# A1048. Opt-in automatic error reports from the box

In Prepare and Live, Setup's Review screen offers **Send automatic error reports
to Waitron Cloud**, unticked. Someone with the **Manage the system** permission
can change it under **System → Cloud services** while Cloud is offline. Explain in
English and Spanish that reports help fix Waitron, contain codes, sources, version,
time and counts, and are linked to this box's Cloud registration. Delivery starts
after registration. Turning reporting off discards unsent reports. A later opt-in
starts at the end of the current incident history.

1. Carry a strict optional boolean through Setup's `review-screen.ts`, `setup-app.ts`,
   API client and first-setup session. In Live, use `first-fiscal-activation.ts`'s
   `sealSettings` and bind a true choice in `first-setup-publication-digest.ts`.
   Keep the submitted choice in the existing same-tab resume. For the ordinary
   provision route, use `setup-api.ts`'s `secret_sealed` phase beside the mail setting. Repeating
   either phase keeps the original choice and cursor. The Cloud services screen,
   dashboard client and `cloud-api.ts` reuse the existing permission, primary check
   and same-origin protection.
2. Read committed error-severity `incidents` in SQLite insertion order. Stamp one
   nullable stable release field in the two existing core incident INSERTs. The
   other direct writers emit warnings. This preserves the version through a
   restart or offline upgrade with the same database write. Rebuild the core
   baseline with the existing dedup index. Skip rows that lack a Cloud-supported
   stable version. Handled errors still count once if they were recorded after opt-in.
3. In `cloud-error-reports.ts`, keep the choice, last scanned row and at most one
   pending body in one box-local file, registered in `state-layout.ts` and written
   with `writeFileDurable`. Leave it out of backups and configuration exports.
   Serialize short local state changes. Turning off invalidates a pending send
   and aborts an active request where possible. Use `venueDbIdentity` and the
   incident UUID to check cursor continuity. A replaced database, lost anchor or
   revoked or replaced registration clears the cursor and batch. Keep the choice
   for the same venue on the same box, and start the scan after existing history
   when resuming. A fresh box or venue starts off.
4. Group adjacent rows with the same code, fixed source and version. Send the last
   time in that group, carry excess rows forward and supply `logs: []`. Save the
   exact body and operation ID before the first request. Extend the Cloud client
   and `cloud-translation.ts`'s `serviceExchange` for `error-report`, using
   `ensureLease` and its unversioned reply path for `{ accepted: true }`. Retry outages and lost replies
   with the same body and ID. Advance past permanent refusals. Run on the primary
   in `boot.ts` and `job-catalogue.ts`, with stepdown cancellation and a rate below
   ten requests per minute.
   [Cloud receiver contract](https://github.com/waitron-io/waitron-cloud/blob/8a01c948da6abe35b03967e9e09b3e62bc2c7465/docs/box-error-reports.md#send-a-report).
5. Update the English and Spanish Servers and full privacy-notice guides with
   how to change the choice and what Waitron Cloud receives (Q57-3). Close A1048's
   two backlog references and record the structural-only contract. Staff reports,
   crash files and release holds have separate items.

**Checks.** Setup and dashboard cover the default, resume, access and off/on changes.
An incident case fixes version attribution and deduplication. Sender cases cover
the signed payload, outage and restart, lost acknowledgement, opt-out and replaced
database or registration. Run the core migration guards and unchanged fiscal and
menu gates. Inspect both languages and themes at phone and desktop widths.

**Estimate.** 430–570 production lines and 250–350 test lines, plus generated
schema and guide edits.
