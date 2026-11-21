# Sign in to Waitron Cloud before Admin

The owner's 19 November request is to sign in or register during setup for the basic services, and start a trial only for second-level services. Claude read the address-first plan at `7aeaeb24b5`. At 11:19 on 21 November the watcher cleared the work in three PRs. The staff email choice follows Lane K's consent handoff.

## A. Sign-in and filing after the venue is saved

On a configured HTTPS test box, choose **Sign in to Waitron Cloud** or **Skip** before Admin in Prepare and development Live. The same tab returns with its chosen mode and language; setup saves locally and the next primary start files the saved venue. A configuration import connects later from the dashboard. Production Live has its existing setup flow because it restarts in production and the configured key is for test Cloud.

- Setup's app, API client and Cloud sign-in screen reuse the wizard's controls and send the tab marker on both publication paths. The server routes use the existing callback path in setup mode, a fixed hashed script, an expiring setup cookie and the fresh-setup checks. `cloud-client.ts` uses the v5 proof for setup and keeps it separate from installed v4 sign-in. The server can hold provisional IDs and only files when local publication marked the bound tab and node. It reads the saved profile in boot and uses the signed status to recover a lost completion reply.
- Wizard tests cover the two paths, Skip, return and unchanged language. The HTTPS callback tests cover the cookie across sites. The two local publication routes prove the matching installer is marked after saving. The Cloud client tests cover v5 with and without provisional IDs, v4 after Skip and the lost reply. Rehearse a disposable box with Cloud [#1351](https://github.com/waitron-io/waitron-cloud/pull/1351) and [#1352](https://github.com/waitron-io/waitron-cloud/pull/1352). Look at English and Spanish, both themes and screen widths. Update the two Servers guides and backlog.
- Estimate 500–700 production lines and 250–400 test lines. Installed sign-in #3893 took +615 production and +502 test/support lines. This uses that existing callback, signer client and Cloud fixture.

## B. Address completion

In the test pilot, Cloud registers early only for an account with exactly one Spanish business, no tax number and no venues. An existing customer adding a venue enters the address manually. Use provisional IDs with the existing lease to call the signed suggest and validate route, and use the existing venue form widget only when Spain is selected. Test the Spain switch in `venue-screen.address-lookup.test.ts`, the setup widget mapping in its own test (new search ID, text as ID and label, validation without fields), and Cloud refusals in `cloud-address-lookup.test.ts`. Rehearse address fill on the disposable setup browser. Estimate 230–350 production and 140–220 test lines.

## C. Recover an expired or signed-out setup sign-in

Use Cloud's v5 resumption for the same account and box key from the installed dashboard. Test an expired attempt with no provisional IDs and a resumed placeholder. Until this lands, follow the test operator route in the guide. Estimate 120–220 production and 90–170 test lines.

## Staff email

After Lane K supplies the versioned consent write, add the default-unticked **Send email through Waitron Cloud** checkbox to setup. Name invitations, password resets and email changes. Unticked keeps SMTP. Rehearse those three staff types on disposable Cloud and Mailpit.
