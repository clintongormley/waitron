# Sign in to Waitron Cloud during setup

When you start a new venue, Waitron offers Cloud sign-up or sign-in. A successful sign-in gives the
box access to basic services. You can continue local setup and sign in later from Cloud services.
A free trial starts only when you choose a Connected service and explicitly accept the trial.

## Decide when Cloud registers the venue

The owner's 19 November 18:58 request puts box registration at the point you ask for Connected.
I recommend following that order. A Cloud account can authorise a box for basic use before Cloud
creates a venue. Claude proposed silently registering the box when setup completes. That reuses
the current installation credential and lets Billing start the trial directly, but creates the Cloud
venue before a Connected service is requested and leaves address lookup unavailable in the initial
venue form. The watcher needs to settle this choice before either route is built.

Registered covers account email, address lookup, automatic upgrades and SMS codes in Cloud's billing
design. This item wires the sign-in and existing services. The updater and SMS gateway have their
own work, and SMS's existing per-venue counting design still assumes registration. Connected covers
remote access, Cloud backups and recovery, translation, the rota solver and Cloud failover eligibility.
Hosted has its own opt-in. I recommend keeping guest menu publishing at its current access level:
it requires a registered venue today, with no trial check. Settle where that registration belongs
under the deferred approach before changing who can publish. Local preview and printing stay local.

## 1. Get access to basic services

- If registration is deferred, Lane K owns the Cloud exchange and its authority over basic requests.
  Reuse Cloud's account verification. The box creates a signing key and retrieves a revocable grant
  tied to that key and account directly from the configured Cloud origin. Agree how the same key can
  acquire installation authority later, which account may attach the venue and how revocation and
  allowances work at each level. Retain the relay's origin and consent checks. Current email,
  address lookup and the trial route are limited to test Cloud paths. First qualify there.
- In `apps/setup/src/setup-app.ts`, `api/client.ts`, a Cloud sign-in screen and EN/ES strings, offer the
  link on the new-venue path. A refusal offers retry and continue locally. In the dashboard's
  `cloud-services-screen.ts`, offer basic sign-in later to a local administrator. Restore and join
  can use that existing dashboard entrance after setup.
- With the agreed contract, add the setup endpoints in `apps/server/src/{boot,setup-api,setup-first-fiscal-api}.ts`
  and a basic Cloud client. Keep the attempt on the secure setup origin and tied to its browser.
  Give that browser only the link and status. Persist the successful setup's credential with
  `writeFileDurable` in local `cloud/` state. In `cloud-email.ts`, reuse account message and response
  handling with the agreed request signing. Keep existing local mail choices and invoice email.
  The A1171 provider bridge remains a separate qualified slice. For the setup venue form it must
  supply the existing address field with suggestions, attribution, confirmation, allowance feedback
  and region mapping. Add the guide and privacy wording for each form when that form uses it.
- Test first in `setup-app-cloud-sign-in.test.ts`, `setup-api.cloud-sign-in.test.ts` and
  `cloud-email.test.ts`. Prove sign-in and skip, browser binding, grant adoption at both provision
  paths, persistence on trading restart and a real relay request with the agreed signing. For A1171,
  use the venue screen's address test and a joint test of suggestion and confirmation. Budget the
  Waitron sign-in and email slice at 350–510 code lines and 160–240 test lines, excluding A1171.

## 2. Enable a Connected service

Reuse Lane K's one-click pairing and Lane C's box link from `cloud-services-screen.ts` and
`cloud-api.ts`. Keep the confirmation in force when pairing lands. Once Cloud returns a venue ID,
take the administrator to that venue's existing **Start free trial** action. Cloud owns trial
eligibility. Remove A1186's proposed completion-screen trial invitation. Update the EN/ES Servers
and Email guides. Budget 75–150 code lines and 65–110 test lines for the Waitron part after pairing.

Test the screen and administrator admission in the existing dashboard and server Cloud API suites.
On a disposable test box prove a basic service before the trial, refusal of remote access before
consent, and remote access after the trial starts. Check EN/ES in both themes and at phone and
desktop widths. Cloud's tunnel-provision suite already exercises the plan refusal.

Sources from Cloud main `a7fdc97feb` include billing design §2, `venue-service-rules.ts`,
`address-lookup.ts`, `relay-grants.ts`, `guest-menu.ts` and `billing-account.ts`.
The watcher cleared Lane K's pairing slice with both approvals on 19 November at 23:42 in its
questions.md. The updated Cloud pairing plan is on `7e15a5445`.
