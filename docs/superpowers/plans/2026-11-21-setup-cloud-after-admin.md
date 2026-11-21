# Prepare the administrator before Cloud sign-in

On a configured test box, complete Admin, then sign in to Cloud or Skip before opening the venue form. The same tab returns with the mode, language and administrator details intact. The account can sign in locally once the venue is saved.

The owner confirmed the order at 18:01 on 21 November in Lane D’s questions.md. Claude reviewed the draft. The watcher cleared a validated copy held by the box at 18:40, split the work into two pull requests, and confirmed the split at 19:05.

## Prepare

- Reuse the Cloud start route in `setup-cloud-sign-in.ts` and `api/client.ts`. Validate and hash the credentials before sending Cloud a request. Hold the validated administrator in the existing private Cloud connection file, outside the attempt cancellation removes. Reuse the cookie and tab binding and bound the request size. Discard an expired draft when read and discard it on Start again.
- Move Cloud after Admin in `setup-app.ts` and `screens/cloud-sign-in-screen.ts`. Keep the tab’s language and display fields through the trip. Success and Skip open the venue. Cancellation lets you retry or skip. From the venue, Back opens `screens/admin-screen.ts`, where a blank password or PIN keeps the held credential.
- Consume the held credentials in `setup-api.ts`, derive the locale when the venue province is available, and keep credentials through an unfinished save. Return a completed operation’s recorded result before reading the draft. Clear the credentials once the save is complete.
- Test the bound draft, expiry, size limit, cancellation, save after Skip and replay in `setup-api.test.ts`, Start again at the resolution action, and the screen sequence in `setup-app-cloud-address.test.ts`. Update both Servers guides and A1438. Check both languages, themes and widths, then rehearse the same-tab trip. Lane K’s hosted and live Google check can start after this pull request.

Estimate 290–360 production and 200–260 test lines added.

## Development Live

- Reuse the Prepare handoff. Update the development Live claim in `setup-first-fiscal-api.ts` and give `packages/provisioning/src/first-setup-owner.ts` a server-only entry for already-hashed credentials. Read the held copy under the current binding and clear it once the claim can resume. Fix Admin’s Back to return to the Live source step.
- Test one owner claim in `setup-first-fiscal.route.test.ts` and the development Live flow in `setup-app-first-fiscal.test.ts`. Existing tests continue to exercise Demo, production Live, import and installed-box sign-in. Update both Servers guides and A1438.

Estimate 80–140 production and 50–100 test lines added. Both pull requests reuse the current schema and Cloud contract.
