# Cloud registration from the box

The owner set the setup flow on 20 November at 13:49 and made Cloud sign-in skippable at 13:54
(Lane D questions.md). On test Cloud, sign in or register from the box after completing the
administrator form and before entering the venue details. Cloud registers the box automatically.
If you skip, enter the address and use your own mail server. You can connect later from the box.
Lane D owns Waitron. Lane K owns Cloud and the contracts below. Watcher clearance is pending.

## 1. Connect from Cloud services after setup

Use the dashboard’s existing Cloud services entry for a test box with no Cloud venue ID. Keep
the local primary, management permission, same-origin and fresh sign-in checks in
`apps/server/src/cloud-api.ts:315–371`. The administrator completes Cloud sign-in or signup and
its required checks in Waitron. The box registers automatically. Send the saved venue name,
trading address, country and tax number from local settings. Cloud finds or creates the business
within that account by tax number, then creates the venue without a matching prompt. Boxes with
a Cloud venue ID retain it. Restore and replacement keep their own paths.

Agree with K on proposed `POST /api/box-registration/{login,signup-request,signup-complete}`
and their challenge continuations. K owns email verification on the box and the required Cloud
sign-in checks. Completed authentication returns an installation and lease for the box public key.
Save that key and operation ID before calling Cloud. Replay within the same account returns the
same installation. Reuse
`apps/server/src/{cloud-client,cloud-signed-request,cloud-installation}.ts` and the existing
connection state and venue ID write. Send the profile to that installation with the same signed
request used in setup. Keep Cloud passwords and challenges transient and out of logs.

Change `apps/dashboard/src/{screens/cloud-services-screen.ts,api/client.ts}`,
`apps/server/src/{cloud-api.ts,cloud-client.ts,boot.ts}` and the signing contracts it uses. Add
failing cases in `cloud-services-screen.test.ts`, `cloud-api.test.ts` and `cloud-client.test.ts`
for in-box sign-in, management refusal and retry of the same registration. Make them pass before the
joint walkthrough. On test Cloud, connect a previously unpaired box, finish every check on the
box and see one correctly associated Cloud venue. Estimate 300–390 code and 120–190 test lines.

Cloud owners can remove an old venue with the existing **Remove venue** action (Cloud #1330,
`apps/portal/src/installation-screen.ts:48`). It hides the venue and revokes its connection.
Billing and backup history remain in Cloud.

## 2. Reuse registration during fresh setup

There is no existing setup-owner proof before Venue. Admin Next writes a browser draft and
navigates to Venue (`apps/setup/src/screens/admin-screen.ts:188–208`). The setup routes are
unauthenticated at that point (`apps/server/src/setup-api.ts:695–711)). The server creates the
first-fiscal owner capability only after receiving the venue and administrator together
(`apps/setup/src/setup-app.ts:1280–1286`, `apps/server/src/setup-first-fiscal-api.ts:383–445`).
The setup password verifier comes from that claim
(`packages/provisioning/src/first-setup-owner.ts:191–235`). An origin check identifies the page
(`apps/server/src/own-page.ts:12–19`). A browser on the venue network can load that page.

Keep the administrator form staged. Before this slice, agree with the watcher on authority that
can distinguish the installer before Venue on the intended test box. After Admin and that
proof, reuse PR 1’s account flow and keep **Skip**. Hold a pending installation and lease in the
Cloud connection state, linked to this setup attempt. The setup client has no local venue row.
Supply the Venue screen’s `addressProvider` with signed `POST /api/installations/address-lookup`
suggest and validate calls. At the server-accepted Venue save, send the saved name, address,
country and tax number to proposed signed `POST /api/installations/profile`. The first save
creates the venue under the right business. A retry returns its ID. A later accepted save updates
that same venue. Provision writes that ID with the local venue settings. K must supply address
access and the test relay grant before those screens need them.

On the Email step, offer Cloud account email with its active grant from signed
`POST /api/installations/configuration`. Accept it without SMTP. Keep manual entry and the SMTP
test for Skip. Reuse account email through `/v1/installations/email/{submit,status}`. Signup
verification uses Cloud's account mail. The relay acceptance is an existing account message.

Change `apps/setup/src/{setup-app.ts,api/client.ts,screens/venue-screen.ts,screens/email-screen.ts}`
and `apps/server/src/{boot.ts,setup-api.ts,setup-first-fiscal-api.ts,provision.ts,first-fiscal-activation.ts}`.
Test Skip, address selection and Cloud email in the setup browser suites. Test the owner boundary,
saved profile after a lost reply and both provision paths in the setup API and first-fiscal suites. On test
Cloud, complete a fresh setup with an address suggestion and Cloud email, then receive a
password-reset email from the box. Estimate 350–500 code and 170–270 test lines, assuming the
authority agreed with the watcher can be reused.

## 3. Keep explicit trial consent for remote access

From Cloud services, offer the trial for the current venue when remote access requires Connected.
Propose the existing Cloud Billing selector and `POST /api/account/billing/start-trial`.
Confirm the destination with the watcher. Exercise the same venue before and after explicit
consent in `apps/dashboard/src/screens/cloud-services-screen.billing.test.ts` and the test Cloud
walkthrough. Estimate 60–110 code and 60–100 test lines.

Update affected EN/ES strings and guides and check both themes at phone and desktop widths.
Guest-menu tier remains with the owner. A1186, SMS, upgrades and production are separate work.
