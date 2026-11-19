# Sign in to Waitron Cloud during setup

When you start a new venue, you can sign up or sign in on Cloud and give the box access to basic
services. You can finish local setup and sign in later from Cloud services. Requesting a Connected
service leads to explicit trial consent. The separate A1186 completion invitation stays parked.

**Finish line for all three pull requests is test Cloud only.** The owner named email and SMS as
basic services on 19 November at 18:50. Lane D proposes account email first. Production email
enablement, SMS, automatic upgrades and the A1171 address-provider bridge are separate work.
Cloud's billing design groups remote access, backups and recovery, translation, the rota solver
and Cloud failover eligibility under Connected. The owner is deciding when Cloud records the venue
and box, and whether public guest menus keep their current access without a trial. The watcher will
clear the chosen route before build.

## PR 1 — Setup sign-in and saved key

Offer Cloud sign-in at the start of the new-venue path. Use Cloud's existing sign-up and sign-in
pages. Proposed Waitron requests: `POST /setup-api/cloud-sign-in/start` returns a link and
`GET /setup-api/cloud-sign-in/status` reports the result to the same secure setup browser. Offer
**Try again** and **Continue without Cloud**. Reuse the dashboard's Cloud services entry for a
local administrator signing in later from the primary box.

- **Register when setup completes.** If sign-in comes first, Lane K must define how Cloud carries
  that sign-in through to registration after `POST /setup-api/provision` creates the venue. Reuse
  the signed `POST /api/pairing/start`, `/api/pairing/status` and `/api/pairing/complete` requests for
  the installation credential. Today's flow requires a Cloud business choice and a fresh local
  administrator confirmation. The early sign-in route needs a decision on those steps. After
  provision, the existing pairing flow already has the venue ID and name. Moving sign-in there
  would reuse that flow with its confirmations, and needs the owner's agreement on timing.
- **Register when a Connected service is requested.** The setup start and status requests must let
  the box obtain basic access before Cloud has a venue or installation. Lane K owns the Cloud
  exchange, including how it binds approval to the account and box and scopes revocation and
  allowances. Its design is parked until the owner answers. Defer installation to PR 3 and keep
  the basic credential out of the existing installation record, which requires venue and pairing IDs.

Keep private credentials on the box and save them with the existing durable Cloud state facilities
on successful setup. Use `apps/setup/src/{setup-app,api/client}.ts`, a setup screen and EN/ES strings,
`apps/server/src/{boot,setup-api,cloud-client}.ts` and the dashboard's `cloud-services-screen.ts`.
Start with `setup-app-cloud-sign-in.test.ts` for sign-in and finishing locally after a refusal, and
`setup-api.cloud-sign-in.test.ts` for same-browser status and key persistence through
`POST /setup-api/provision` (standard setup and the first-fiscal setup variant) and a restart.
Treat an active installation as connected, including when a restored primary holds valid credentials.
On test Cloud, complete sign-in and confirm the box retains the chosen credential. Estimate
250–380 code lines and 100–150 test lines on the Waitron side. Re-estimate if timing changes.

## PR 2 — Send account email using that key

A test venue can send a real account invitation or password reset via Cloud. Reuse message and
result handling in `cloud-email.ts`, `cloud-client.ts` and `boot.ts`. With quiet registration,
use the signed installation configuration, email submit and email status requests
(`POST /api/installations/configuration`, `POST /v1/installations/email/submit` and
`POST /v1/installations/email/status`). These currently require a test installation and its lease.
With deferred registration, Lane K must specify basic-key equivalents for reading relay permission,
submitting a message and reading its status, with local-origin and consent checks. Agree which
credential serves email after registration before implementing that route. Keep existing local mail
and invoice email choices. Test the real request and refusal in `cloud-email.test.ts` and verify
delivery on test Cloud. Update EN/ES Email guides. Estimate 100–130 code and 60–90 test lines.

## PR 3 — Open the trial from a Connected service

Lane K's Cloud pairing is on main (#1331). After Lane C's Waitron link lands and both pass joint
qualification, reuse them from `cloud-services-screen.ts` and `cloud-api.ts`. Complete pairing with
the confirmations in force if the venue is still unregistered. Open the linked venue's Billing page
for explicit consent through `POST /api/account/billing/start-trial` with its venue ID.
Test administrator admission and the Billing handoff in the existing Cloud API and dashboard suites.
On a test box, confirm remote access is refused before consent and works after a trial starts.
Update EN/ES Servers guides and inspect both languages, themes and screen widths. Estimate 75–150
code lines and 65–110 test lines.

Sources: owner's requests in Lane K questions (19 November, 18:50 and 18:58), watcher's Lane D correction
(20 November, 00:24), Cloud's pairing PR #1331 at `7806b254a7`, `billing-account.ts` and
`guest-menu.ts` in Cloud, and `cloud-client.ts` and `cloud-email.ts` in Waitron.
