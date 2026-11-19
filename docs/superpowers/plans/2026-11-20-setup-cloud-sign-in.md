# Sign in to Waitron Cloud during setup

When you start a new venue, you can sign up or sign in to Waitron Cloud before entering its details.
On return, address lookup and account email can use the basic services Cloud makes available to you.
You can also continue local setup. Choose a Connected service later to register the box and opt into
a free trial. Cloud sign-in by itself never starts a trial.

## What each level offers

- **Registered.** Account email and address lookup. Cloud's billing design also places automatic
  upgrades and SMS codes here. This work adds neither an updater nor SMS delivery. Cloud must settle
  how its per-venue SMS allowance will work without Connected registration.
- **Connected.** Remote staff access, Cloud backups and recovery, translation, the rota solver and
  eligibility for Cloud failover, under their existing service rules. Hosted remains its own choice.
  I recommend Connected for public guest menu publishing because Cloud publishes for a specific
  venue, with a venue URL and owner takedown. Cloud's current publisher requires a paired
  installation but no Connected trial. The watcher needs to settle this tier before changing it.
  Local preview and print stay available without Cloud.

## 1. Get the basic services through setup

- In `apps/setup/src/setup-app.ts`, `api/client.ts` and a
  `screens/cloud-sign-in-screen.ts` with EN/ES strings, offer **Sign in to Waitron Cloud** on the
  new-venue path before the venue form. Open the configured Cloud origin for its existing sign-up,
  sign-in and verification. Show the result on the box with **Continue without Cloud** and **Try again**
  as applicable. Restore, join and resumed first-fiscal setup keep their current entrances.
- In `apps/server/src/{boot,setup-api,setup-first-fiscal-api}.ts` and a small `cloud-basic-services.ts`,
  use an expiring, browser-bound setup attempt over the box's secure same-origin setup page. The box
  generates the signing key locally. Cloud issues a revocable basic-services grant bound to that
  public key and the verified account, and the box retrieves it directly from the configured Cloud
  origin. Cloud and Waitron must agree on the exchange before build. The browser gets only the sign-in
  link and setup status. Use the staged grant for the setup browser's address lookup and retain the
  successful setup's credential under the local `cloud/` state directory using `writeFileDurable`.
  Preserve manual addresses, existing email configuration and local provisioning when Cloud is skipped
  or unavailable.
- Connect the existing address provider in `apps/setup/src/screens/venue-screen.ts`. In
  `apps/server/src/{boot,cloud-email}.ts` reuse the account-mail sender through the basic grant once
  Cloud supports it, retaining existing delivery failure behaviour and paired-box support. Invoice
  email continues through its own settings.
- Test first. `apps/setup/src/setup-app-cloud-sign-in.test.ts` owns the new-venue sign-in, return and
  continue-offline paths. `apps/server/src/setup-api.cloud-sign-in.test.ts` owns the setup-attempt
  boundary, refusal of a different browser's result, and adoption by both new-venue completion paths.
  Extend the existing first-setup restart fixture to show the saved grant reaches the trading start.
  `apps/server/src/cloud-email.test.ts` owns actual account-mail request and response handling.
  Estimate 350–510 production lines and 160–240 test lines.

## 2. Register only when requesting a Connected service

- In `apps/dashboard/src/screens/cloud-services-screen.ts` and `apps/server/src/cloud-api.ts`, take a
  primary administrator who chooses a Connected service through lane K's one-click pairing. Reuse
  the Open Cloud link, business choice and approval in force when that slice lands. The existing
  Cloud Billing trial requires a venue ID, so finish registration then offer **Start free trial** for
  that venue through Cloud. Cloud must confirm an active trial or existing entitlement before the
  requested service opens. Declining the trial leaves basic services available.
- Test first in `apps/dashboard/src/screens/cloud-services-screen.test.ts` and `apps/server/src/cloud-api.test.ts`.
  The screen owns the offered action and return status. The server owns primary and manager admission. Lane C owns the pairing-link change in
  `cloud-client.ts`.
  After both Cloud changes land, prove on a disposable box that sign-in enables one basic service,
  remote access remains closed until trial consent, and the registered box can then use it. Verify
  EN/ES in both themes at phone and desktop widths. Update the EN/ES Servers and Email guides and
  narrow A1186 in `docs/backlog/setup.md`. Estimate 75–150 production lines and 65–110 test lines.

Sources from Cloud main `a7fdc97feb`: billing design §2, `venue-service-rules.ts`,
`address-lookup.ts`, `relay-grants.ts`, `guest-menu.ts` and `billing-account.ts`.
Pairing plan: `2026-11-19-cloud-one-click-pairing.md` on lane K's `a116601879`.
