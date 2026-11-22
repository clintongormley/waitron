# A1048. Opt-in automatic error reports from the box

An installer can tick **Send automatic error reports to Waitron Cloud** on Setup's
Review screen. The box starts with the choice off. An administrator can change it
under **System → Cloud services** even while Cloud is unreachable. Explain in
English and Spanish that the box sends error codes, their source, the Waitron
version, time and counts to help fix Waitron. Off stops new reports and clears
unsent reports. A fresh opt-in applies to new errors.

1. Carry an explicit boolean through Setup's `review-screen.ts`, `setup-app.ts` and
   API client into the normal and first-fiscal provisioning paths. Save it with
   `defineSettingsDocument` and `saveSettings` in the existing provision transaction.
   Existing venues and configuration bundles start off. Add the Cloud services
   checkbox and local read/write in its screen, dashboard API client and
   `apps/server/src/cloud-api.ts`. Reuse `system.manage`, the primary check and
   same-origin change protection. Save the choice and clear pending reports
   in one transaction when switching off.
2. Use the existing `packages/core/src/incidents.ts` writers to count successfully
   inserted error-severity incidents. Use their fixed incident source and declared
   code, the event time and the actual stable build version from `builtRelease`.
   Validate the receiver's code and version grammar. Never copy parameters, log
   text or person, device or receipt IDs. Each report sends `logs: []`. Add one
   internal queue table to the core schema and baseline. Incident rows lack the
   version at recording time and a place to freeze what a retry must send.
   Queue a structural entry in the same transaction as the incident. The sender
   freezes the selected group of code, source and version under one fresh operation
   ID and installation binding before the first request, capping the count at
   Cloud's limit. An acknowledgement removes that batch. A retry uses the frozen
   body and ID with the current lease. Pending entries stay out of configuration
   exports and failed requests stay off the sale path.
3. Add the sender in `apps/server/src/cloud-error-reports.ts`. Reuse the existing
   signed `serviceExchange` and Cloud connection credentials for `error-report`.
   Register a primary-only, stepdown-stopped job in `boot.ts` and `job-catalogue.ts`.
   Limit sends to Cloud's allowance, wait on transient refusals and leave old
   batches bound to their original installation. Send only after opt-in and
   on a supported release. Use Cloud's receiver contract in
   `docs/box-error-reports.md:18–64` at `8a01c948da6abe35b03967e9e09b3e62bc2c7465`.
4. Update the English and Spanish Servers guides and name Waitron Cloud in the
   full privacy-notice checklist when this option is enabled (Q57-3). Describe
   the payload and its installation authentication without calling it anonymous.
   Close A1048's two backlog references. Leave the staff report and release updater
   to their own items.

**Checks.** Setup and dashboard browser cases cover the unticked default, opt-in
and switching off. Provision and Cloud API cases cover persistence, strict input and
access. The incident test proves deduplicated and rolled-back raises queue nothing.
The sender test exercises the signed HTTP body, outage and restart, lost reply,
same-ID retry, exact count, authentication and opt-out. Run the core migration
guards and the lane's unchanged fiscal and menu gates. Look at both choices in both
languages and themes at phone and desktop widths.

**Estimate.** 470–610 production lines and 270–350 test lines, plus generated schema
and guide edits.
