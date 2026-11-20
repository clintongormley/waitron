# Cloud sign-in at the start of setup

On test Cloud, sign up or sign in before entering the venue details. The box registers at that
point so the setup form can look up addresses and the setup email step can send through Cloud.
You can continue locally if Cloud is unavailable. A Connected service still requires an explicit
trial choice. The owner set the registration timing on 20 November at 13:11, recorded by the watcher
in Lane D's questions.md. The guest-menu tier is still open. A1186, SMS, automatic upgrades,
production enablement and A1171's broader dashboard integration are outside these three PRs.

## 1. Register and find an address before saving the venue

- On the new-venue path, **Sign in to Cloud** starts pairing over HTTPS from the setup page.
  Reuse the one-click `/connect` link (#3860 and Cloud #1331, joint walkthrough reported by K at
  01:27). Cloud signup creates the account and business. The person approves the selected business
  on Cloud. The originating setup browser checks and completes it without a second box click.
  Keep the administrator confirmations for dashboard pairing and the existing later sign-in path.
- Add `POST /setup-api/cloud-sign-in/start` and `POST /setup-api/cloud-sign-in/check`. Start issues a
  secure browser token, stored hashed with the pending setup registration. Check requires that
  token and the setup origin, and completes only the same Cloud-approved request. Setup has no
  local administrator yet, and the first-fiscal owner claim already needs the venue form
  (`setup-api.ts:697`, `setup-first-fiscal-api.ts:383`). The setup click and Cloud approval are
  the proposed authority for this path.
- Reuse signed `POST /api/pairing/start`, `/status` and `/complete` with blank venue ID and name
  at start. Omit the address. Save the request and installation key on the box before the form.
  Reuse them on retry. At the successful venue save in `/setup-api/provision`, bind exactly the
  returned Cloud venue ID in the shared provision transaction (`provision.ts:188`,
  `first-fiscal-activation.ts:130`). Restore, join and existing bindings need their own identity.
- Send the committed trading name and address after provision, when the form's data is first
  saved as venue settings. Propose signed `POST /api/installations/profile` to K. Cloud derives
  the venue from the installation's key and lease. Pairing currently sets only the display name
  (Cloud `packages/registration/src/pairing.ts:154`). Retry a refused or interrupted sync from
  the same saved registration and committed settings. A Cloud failure leaves local setup usable.
- Hand the venue form's existing address lookup a provider using same-browser
  `POST /setup-api/cloud-sign-in/address-lookup` and Cloud's signed
  `POST /api/installations/address-lookup` for suggestions and selection. Keep manual entry.
  K must enable the private test route for the newly registered installation. It currently checks
  an exact account, venue and installation (Cloud `packages/account-http/src/address-lookup.ts:51–69`).

Change setup's `setup-app.ts`, `api/client.ts` and Cloud step, and server `boot.ts`, `setup-api.ts`,
`cloud-client.ts` and the shared provision call. Start with `setup-app-cloud-sign-in.test.ts` and
`setup-api.cloud-sign-in.test.ts` for same-browser completion, retry, local continuation, address
selection and committed profile delivery. Exercise both provision variants and a restart with the
same binding. Finish by finding an address on a newly registered test box. Estimate 350–500 code
and 180–260 test lines for Waitron.

## 2. Send email during setup

Offer a fixed Cloud test email on the existing Email step. Keep the SMTP option. Propose a
test-only `setup_test` message to K, addressed by Cloud to the verified pairing account. The setup
browser can request the message through `POST /setup-api/cloud-sign-in/email-test` with its PR 1
authority and no recipient or free text. Reuse the installation configuration, grant and lease
and `POST /v1/installations/email/submit` and `/status`. The present relay accepts invitations,
resets and email changes (`cloud-email.ts:110`). This proposal needs K's relay contract and watcher
clearance. Change setup's `email-screen.ts`, `setup-app.ts` and `api/client.ts`, and the server's
setup Cloud routes and `cloud-email.ts`. In `email-screen.test.ts` and `cloud-email.test.ts`, prove
the fixed setup send and grant refusal. Confirm a message reaches the test inbox before provision
and ordinary account email works after it. Estimate 100–160 code and 80–120 test lines.

## 3. Start a trial when asking for a Connected service

On the dashboard's Cloud services screen, offer Billing when Registered remote access requires a
plan. Use the paired venue ID to identify the venue in Cloud's existing `/account/billing` selector.
The person's **Start free trial** submits `POST /api/account/billing/start-trial` on Cloud. Preserve
the existing pairing action for unregistered boxes. In `cloud-services-screen.billing.test.ts`,
prove the handoff identifies the correct venue. On test Cloud verify the gate before consent and
availability afterwards. Estimate 60–100 code and 50–80 test lines.

Run each slice's focused tests before and after implementation. Update affected EN/ES strings and
guide sections. Check the screens in both themes and at phone and desktop widths.
