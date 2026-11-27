# Setup reads the AEAT certificate before the venue details

An administrator starting a live venue that files with AEAT chooses its certificate before entering
the venue details. The certificate fills the tax number and legal name. The number is read-only
when present. The administrator can correct the name that will appear on receipts. Queue
`SETUP-CERT-FIRST-2`, cleared for planning by the watcher on 27 November at 13:04 after #4489 landed.

1. **Read the file using the existing setup checks.** In
   `packages/fiscal-verifactu/src/provisioning-secret.ts` and `slot.ts`, share the reader and
   date checks between a new optional `provisioningSecret.inspect(raw)` in
   `packages/fiscal/src/contribution.ts` and the existing `validate(raw, { taxId })`. Inspection
   returns only `{ taxId: string | null, legalName: string | null }` from subject
   `organizationIdentifier` and `O`; the taxpayer comparison stays in validation. In
   `apps/server/src/setup-api.ts` mount a small `setup-certificate-inspection.ts` behind the
   setup guards. Its same-origin HTTPS JSON POST `/setup-api/certificate/inspect` caps the request
   at the reader's input limit, derives the regime from the selected country and province just as
   `setup-provision-input.ts` does, and uses the optional seat for production only. Use existing
   setup errors. Send no secrets in the reply or logs. This reads the file locally and makes no setup
   reservation, credential, or AEAT request. Keep the full fiscal test and provision checks.
2. **Put the certificate before the venue form.** In `apps/setup/src/setup-app.ts` and `events.ts`,
   insert a short location step for a fresh live production setup. Use the country and province
   choices and jurisdiction rules already in `screens/venue-screen.ts`. On AEAT territory the
   path is location, certificate, venue, existing claim, fiscal test. Other territories go from
   location to typed details. Add `api/client.ts`'s `inspectCertificate` and reuse
   `screens/cert-screen.ts` for early checking and existing later replacement. Settle the child
   draft on success and keep the result in the wizard's in-memory draft. Ignore a reply if its file,
   passphrase, or screen changed. The venue screen uses the existing field primitive and explains the
   locked number beneath it. Missing number or name stays editable. Use wizard Back to change
   location or certificate before claim; a different location or replacement cannot inherit the
   previous certificate's values. An address suggestion that changes jurisdiction sends the
   operator back through the location choice before claim. Keep Demo, Preparation, development,
   certificate-free imports and recovery on their current entry paths. A resumed or frozen attempt
   keeps its saved details and today's replacement check; use the existing abandon-and-replace flow
   to change taxpayer. Do not persist the inspection reply, file or passphrase in new storage.
3. **Verify from the two entry points.** First fail and then pass the new cases in
   `apps/server/src/setup-certificate.test.ts` (real file, missing subject fields, bad passphrase,
   no writes, and existing later mismatch refusal) and `apps/setup/src/setup-app-cert-first.test.ts`
   (real wizard navigation, editable name, read-only number, Back/replacement and stale reply,
   manual path without a number, other territory, import and frozen resume). Run the changed
   certificate, venue, first-setup and unsaved changes suites, plus the queue's unchanged fiscal and
   menu guards. Update `apps/setup/src/i18n/strings/venue.ts`, setup help and both
   `apps/server/src/guide/{en,es}/aeat-certificate.md` guides. Review the screens in English and
   Spanish, light and dark, phone and desktop. Send the pictures to the watcher before the owner
   lands it. Reconcile A1571's open Mac and certificate-type branches before pushing.

Estimate: 390–490 product lines and 210–270 test lines in one PR. No changes to allocation, recovery
copies, fiscal record construction, or certificate policy.
