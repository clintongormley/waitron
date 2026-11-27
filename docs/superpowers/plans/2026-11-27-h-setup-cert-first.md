# Setup reads the AEAT certificate before the venue details

On fresh live AEAT setup, choose the certificate before entering the venue details. The certificate
fills the tax number when present. You can correct the legal name printed on receipts. The queue item
is SETUP-CERT-FIRST-2. The watcher cleared planning on 27 November at 13:04, after #4489 landed.
Claude's 27 November plan review removed a proposed location step. Implementation awaits watcher
clearance and the owner lands the product PR.

1. **Open the certificate locally.** Add optional `provisioningSecret.inspect(raw)` in
   `packages/fiscal/src/contribution.ts`. Wire it in `packages/fiscal-verifactu/src/slot.ts` and share
   the file and date checks in `provisioning-secret.ts` with `validateSetupAeatCert`, which still
   compares the tax number at fiscal test and provision. Inspection returns only the current
   reader's subject tax number and organisation name as `{ taxId, legalName }`, each nullable.
   In `apps/server/src/setup-api.ts` mount `setup-certificate-inspection.ts` for a same-origin HTTPS
   JSON POST to `/setup-api/certificate/inspect`. Use `sentFromThisOrigin`, `isSecure`, a 256 KiB
   `bodyLimit` and the existing `too_large` certificate refusal. Use the existing
   `venueFiscalSelection` for the supplied territorial id and require the inspection seat for
   production. Follow `join/start` for the first-setup hold check without holding the coordinator
   during inspection, and allow one read at a time as the fiscal test does. Return no secrets,
   set no-store and keep the returned identity out of logs. Opening the file creates no reservation
   or credential and makes no AEAT request.
2. **Use admin → certificate → venue on fresh live setup.** In `apps/setup/src/setup-app.ts`, route
   Start empty and Enter new setup details through the existing `screens/cert-screen.ts`. ES-common
   is the only supported territory offered in this wizard today. Keep the venue's existing territory
   selection and refusals. Demo, Preparation, development, configuration imports and recovery
   use their existing paths. Use `api/client.ts` for inspection and discard a reply if the file,
   passphrase or screen changes. Keep source details in a private wizard field outside `ProvisionBody`;
   clear it on mode change and when the wizard accepts the frozen venue. Check the returned number
   with the current country validator before leaving Certificate and explain an invalid number at
   the file field. In `screens/venue-screen.ts`, show a valid supplied number read-only and explain
   the lock below it. Missing subject fields stay typed.
   Back from Venue opens Certificate before claim. Checking the same source details preserves a
   corrected name. A different identity replaces the old defaults and clears any old derived value
   for a field the new file omits.
3. **Continue from the saved details after claim.** In `#afterFirstOwner`, a certificate held in
   memory leads to Fiscal test. When a reload or another browser carries on without it, the
   certificate step changes only `aeatCert` and the full test still compares the frozen number.
   That same path handles replacements after claim. Replacing the taxpayer follows the existing
   abandon-and-replace route. The browser keeps the certificate only in the existing in-memory draft.
4. **Verify before and after.** In `apps/server/src/setup-certificate.test.ts` test real files, missing
   subject fields, wrong passphrase, HTTPS/origin and size refusals, no setup write, and the existing
   later mismatch. In `apps/setup/src/setup-app-cert-first.test.ts` test the native number field,
   editable name, same and different certificate on Back, stale reply, missing or invalid number,
   manual/import paths and frozen resume. Run the existing certificate, venue, first-setup and draft
   checks plus the unchanged fiscal and menu gates. Update `apps/setup/src/i18n/strings/venue.ts`
   and the `apps/server/src/guide/{en,es}/aeat-certificate.md` twins. Show the watcher the English and
   Spanish screens in both themes at phone and desktop widths. Reconcile the A1571 Mac reader and
   certificate-type changes with Lane C's branch before pushing.

Estimate: 260–340 product lines and 180–240 test lines, one PR. The scope is the wizard and local
certificate inspection. Allocation, fiscal records, recovery copies and certificate policy are outside it.
