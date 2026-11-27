# Setup reads the AEAT certificate before the venue details

On fresh live AEAT setup, choose the certificate before entering the venue details. The certificate
fills and locks the tax number when present. You can correct the legal name printed on receipts. Queue item
SETUP-CERT-FIRST-2 names the scope. The watcher wrote on 27 November at 13:04 in Lane H's
`questions.md`: “#4489 is on main (79a1b1dfaf): SETUP-CERT-FIRST-2 may be planned now.” Two Claude
reads led to this draft. Implementation awaits watcher clearance and the owner lands the product PR.

1. **Open the certificate locally.** Add optional `provisioningSecret.inspect(raw)` in
   `packages/fiscal/src/contribution.ts`. Wire it in `packages/fiscal-verifactu/src/slot.ts` and share
   the file and date checks in `provisioning-secret.ts` with `validateSetupAeatCert`, which still
   compares the tax number at fiscal test and provision. Inspection returns only the current
   reader's subject tax number and organisation name as `{ taxId, legalName }`, each nullable.
   In `apps/server/src/setup-api.ts` mount `setup-certificate-inspection.ts` for a same-origin HTTPS
   JSON POST to `/setup-api/certificate/inspect`. Use `sentFromThisOrigin`, `isSecure`, a 256 KiB
   `bodyLimit` and the existing `too_large` certificate refusal. Use the existing
   `venueFiscalSelection` for the supplied territorial id and require the inspection seat for
   production. Add it beside `join/start` in the first-setup hold check so inspection runs without
   holding the coordinator. Its own busy flag allows one read at a time, with a retry message.
   Set no-store and keep the identity and secrets out of logs, and secrets out of the reply.
   Opening the file creates no reservation or credential and makes no AEAT request.
2. **Use admin → certificate → venue on fresh live setup.** In `apps/setup/src/setup-app.ts`, route
   Start empty and Enter new setup details through Certificate for live, non-development attempts
   without an import. The app calls `api/client.ts` with ES-common, the only supported territory
   this wizard offers, and checks the returned number with Spain's validator. The existing
   `screens/cert-screen.ts` shows progress and file refusals, with Back to Admin and Next to
   Venue after success. Ignore a reply once its file, passphrase or screen changes. The app keeps
   the source details outside `ProvisionBody`, tied to the certificate in the in-memory draft. Clear both
   when accepting an import preview or discarding the draft for Start empty. Clear the source
   details on mode change and when the app accepts the frozen venue.
   `screens/venue-screen.ts` shows a valid supplied number read-only with a reason below it. Missing
   subject fields stay typed. Back opens Certificate before claim. The same source details preserve
   a corrected name. After an abandoned attempt, keep the old name for the same tax number and
   use the new name if the number changed. A replacement clears earlier certificate-derived values
   that it omits. Demo, Preparation,
   development, imports, recovery and the venue's existing territory refusals use their current paths.
3. **Continue from the saved details after claim.** In `#afterFirstOwner`, a certificate held in
   memory leads to Fiscal test. When a reload or another browser carries on without it, the
   certificate step changes only `aeatCert` and the full test still compares the frozen number.
   That same path handles replacements after claim. Replacing the taxpayer follows the existing
   abandon-and-replace route. The browser keeps the certificate only in the existing in-memory draft.
4. **Verify before and after.** In `apps/server/src/setup-certificate.test.ts` test real files, missing
   subject fields, wrong passphrase, HTTPS/origin and size refusals, no setup write, and the existing
   later mismatch. In `apps/setup/src/setup-app-cert-first.test.ts` test the native number field,
   editable name, same and different certificate on Back, stale reply, missing or invalid number,
   reselecting Live and importing after a file check, and frozen resume. Pin the offered live
   territory assumption in the wizard test. Run existing certificate, venue, first-setup and draft
   checks plus the unchanged fiscal and menu gates. Update `apps/setup/src/i18n/strings/venue.ts`
   and the `apps/server/src/guide/{en,es}/aeat-certificate.md` twins. Show the watcher the English and
   Spanish screens in both themes at phone and desktop widths. Reconcile the A1571 Mac reader and
   certificate-type changes with Lane C's branch before pushing.

Estimate: 280–360 product lines and 220–320 test lines, including updates to wizard navigation
fixtures, in one PR. Scope is the wizard and local certificate inspection. Allocation, fiscal
records, recovery copies and certificate policy are outside it.
