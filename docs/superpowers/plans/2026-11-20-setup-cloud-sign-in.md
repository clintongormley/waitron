# Cloud sign-in at the start of setup

On test Cloud, sign up or sign in before entering the venue details. Registration lets the box
find addresses and choose Cloud for setup email. You can continue locally if Cloud is unavailable.
Connected services still require explicit trial consent. The owner set registration timing on
20 November at 13:11, recorded in Lane D's questions.md. The guest-menu tier remains open.
Cloud's billing design puts address lookup and email in Registered and puts remote access,
backups, translation, the rota solver and eligibility for Cloud failover in Connected
(Cloud `docs/superpowers/specs/2026-10-29-cloud-billing-design.md:75–76`). A1186, SMS, upgrades,
production enablement and A1171's dashboard integration are separate.

## 1. Register before the venue form and enable address lookup

- Offer **Sign in to Cloud** after choosing a fresh venue on a test box, before the venue form.
  Use the existing one-click `/connect` link (#3860 and Cloud #1331). Cloud signup creates a
  business, and the person approves the selected business on Cloud. The box completes pairing
  in the originating setup browser. Dashboard pairing still uses its administrator approvals.
- Proposed authority for the private test rollout. The initial HTTPS setup origin can start one
  pending registration. It places a secure, HttpOnly browser cookie and stores its hash with
  the request. A second browser cannot complete or replace it. Reload resumes the same request.
  This assumes the first setup browser on the test box is trusted. Ask the watcher to settle
  that before build. When first-fiscal setup is claimed, tie the pairing to that owner claim and
  use its existing headers thereafter. Place setup Cloud calls under `/setup-api/first-setup/cloud/`
  to use that authority after the claim (`setup-api.ts:725–754`, `setup-first-fiscal-api.ts:230–253`).
- The box's `POST .../start` and `.../check` reuse signed Cloud `POST /api/pairing/start`,
  `/status` and `/complete`. Start with blank venue ID and name, and omit the address. In setup
  boot, let the shared Cloud client hold a pending registration in its existing durable
  `connection.json` before a local venue exists. Resume the same request and key after restart.
  Bind the returned ID inside the shared provision transaction for both provision variants
  (`provision.ts:188`, `first-fiscal-activation.ts:130`).
- When durable provision saves the form, send the committed trading name and address to the
  same Cloud venue. Propose signed `POST /api/installations/profile` to K. The installation
  key and lease identify the venue. Keep the profile pending in the Cloud state until Cloud
  accepts it, and retry on start. Provision continues during a Cloud failure. Keep Cloud's
  business choice out of local fiscal identity. Ask the watcher to confirm that durable
  provision is the intended save point.
- Use the existing address field's provider with same-browser `POST .../address-lookup` and
  signed Cloud `POST /api/installations/address-lookup` for suggestions and selection. Keep
  manual entry. Lane K must configure the exact account, venue and installation for this test
  route (Cloud `packages/account-http/src/address-lookup.ts:51–69`). Bound Cloud waits outside
  the setup write turn. Start again, restore and join discard only the pending local setup
  registration. Unfinished requests expire. Revocation for abandoned test installations is a
  test-operator action.

Change setup's `setup-app.ts`, `api/client.ts` and sign-in step, and server `boot.ts`, setup
routes, `cloud-client.ts` and the shared provision call. In `setup-app-cloud-sign-in.test.ts`,
`setup-api.cloud-sign-in.test.ts` and `first-fiscal-setup.e2e.test.ts`, prove browser ownership,
restart before provision, both saves, restore exclusion and use of a selected address. On
test Cloud, sign up on an empty box and find an address before saving. Estimate 350–500 code
and 180–260 test lines for Waitron.

## 2. Choose Cloud as the setup email transport

Offer **Use Cloud email** on the existing Email step when the same registration has an active
test relay grant. `POST .../email-availability` reads it through signed
`POST /api/installations/configuration`. Keep the SMTP choice and test. Accept Cloud alone at
the Email step and in both provision variants, after checking the confirmed registration and
grant. Persist that choice for the existing account-email sender. Use the relay's current
invitation, reset and email-change messages through `POST /v1/installations/email/submit` and
`/status`. Cloud signup already sends verification mail during setup. Ask the watcher whether
setup needs a separate box-originated email before provision.

Lane K must make the existing test grant available for the new installation before this slice
qualifies. Change the setup Email screen and API client, server setup routes and `cloud-client.ts`.
Test the Cloud-only and SMTP choices in `email-screen.test.ts`, both provision paths and relay
refusal in `cloud-email.test.ts`. On test Cloud, finish with no SMTP details and receive an
account email. Estimate 100–160 code and 80–120 test lines for Waitron.

## 3. Offer the trial from a Connected service

When a Connected action on the dashboard's Cloud services screen requires a plan, offer Cloud
`/account/billing`. Remote access is the first walkthrough. Identify the paired venue in the existing selector by its ID.
Cloud starts the trial only on **Start free trial** via `POST /api/account/billing/start-trial`.
Keep existing pairing for unregistered boxes. Test the venue handoff in
`cloud-services-screen.billing.test.ts` and the remote-access gate before and after consent
on test Cloud. Estimate 60–100 code and 50–80 test lines.

Run focused tests before and after each implementation. Update affected EN/ES strings and guides.
Check the new screens in both themes and at phone and desktop widths.
