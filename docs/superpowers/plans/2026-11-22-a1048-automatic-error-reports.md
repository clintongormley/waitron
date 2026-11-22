# A1048. Opt-in automatic error reports from the box

In Prepare and Live, Setup's Review screen offers **Send automatic error reports
to Waitron Cloud**, unticked. Someone with Box administration permission can
change it under **System → Cloud services** while Cloud is offline. Explain in
English and Spanish that reports help fix Waitron, contain codes, sources, version,
time and counts, and are linked to this box's Cloud registration. Delivery starts
when the box is registered. Turning it off clears pending reports and stops sends.
A new opt-in starts at the end of the current incident history.

1. In Setup's `review-screen.ts`, `setup-app.ts`, API client and first-setup session,
   carry a strict optional boolean. Bind the submitted choice to the existing
   first-fiscal publication digest and its same-tab resume. Read it in `setup-api.ts`
   and `first-fiscal-activation.ts`, and save it in the existing `provision.ts`
   transaction. Use a non-transferring settings document, default off. Add the
   Cloud services setting in its screen, dashboard API client and `cloud-api.ts`.
   Reuse `system.manage`, the primary check and same-origin protection.
2. Read committed error-severity `incidents` in insertion order. In the two existing
   INSERTs in `packages/core/src/incidents.ts`, stamp the nullable stable build version
   from `builtRelease()` into one new column. That preserves the actual version across
   outages and upgrades without another write on an incident transaction or relying
   on a successful boot to label the previous release. Rebuild the core baseline.
   Keep consent, the last scanned row and one pending signed-body input in the
   settings document. Use SQLite row order with the row's UUID as an anchor and the
   existing `venueDbIdentity` to detect copies or replacements. Reset to off on a
   changed database or lost anchor. Incident IDs and metadata used for scanning stay local.
3. In `cloud-error-reports.ts`, take a bounded run of adjacent occurrences that share
   a code, source and version. Use the last occurrence time and leave any remainder
   for the next scan. Validate Cloud's grammar and set `logs: []`. Save the exact
   body, operation ID, ending row and installation binding before sending. Reuse the
   Cloud client's signed `serviceExchange` for `error-report` with a current lease.
   Advance on `{ accepted: true }`. Keep the same ID and body after a lost reply,
   expired lease or outage. Discard pending work and turn off when a known
   registration is revoked or replaced. Register a primary-only, stepdown-stopped
   job in `boot.ts` and `job-catalogue.ts` with a send rate below Cloud's ten per minute.
   [Cloud receiver contract](https://github.com/waitron-io/waitron-cloud/blob/8a01c948da6abe35b03967e9e09b3e62bc2c7465/docs/box-error-reports.md#send-a-report).
4. Update the English and Spanish Servers guides and name Waitron Cloud in the
   full privacy-notice checklist for venues that enable this setting (Q57-3).
   Record that the receiver accepts structural reports and close A1048's two
   backlog references. Staff reports, crash files and release holds have separate items.

**Checks.** Setup and dashboard browser cases cover the unchecked choice and both
changes in the dashboard. Provision and Cloud API cases cover persistence, Live
resume, input and permission. Incident and sender cases cover the same INSERT,
old/handled/deduplicated/rolled-back rows, signed payload without private fields,
mixed releases, outage and restart, lost reply, opt-out and replacement. Run the
core migration guards and unchanged fiscal and menu gates. Inspect both languages
and themes at phone and desktop widths.

**Estimate.** 420–560 production lines and 250–350 test lines, plus generated
schema and guide edits.
