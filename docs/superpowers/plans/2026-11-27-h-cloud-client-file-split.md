# Split the Cloud connection factory

Give connection setup and signed-in services their own Server files, each under 1,000 lines.
Lane H’s `SPLIT-SERVER-FILES` records the owner’s 24 November size request and the watcher’s
27 November 19:03 assignment. At `400c64363c`, `cloud-client.ts` is 1,705 lines and
`createCloudConnection` spans 294–1702. Before building, get watcher clearance for the factory
breakdown and the `CloudConnectionOptions` type import path in `boot.ts`.

## PR 1. Sign-in

- Use `node scripts/move-ts-declarations.mjs scripts/cloud-client-split.json` to move
  `CloudRegistration`, `CloudPairingView`, `CloudConnectionOptions`, `SavedEmergencyHints`,
  `CloudInstallationCredentials` and `SavedCloudState` to `cloud-client-types.ts`. Import them
  directly from their new home, including the `boot.ts` type import if cleared.
- In `cloud-client-sign-in.ts`, take `exchangeSignIn`, `signInState` through `recoverSignIn`, and
  `setupSignInAvailable` plus `setupAddressLookup` through `returnSignIn`. Create the group once
  per connection with `options`, `run`, `readState`, `writeState`, `save` and `requestPairing`.
  Keep the setup address symbol and provisional lease in this group. Return `recoverSignIn`
  internally for the factory’s existing `refresh`. Preserve the generic `run` and `requestPairing`
  signatures when passing them across the file boundary.
- Move `installedSignInFixture` through “refuses invalid venue text before sending completion”
  to `cloud-client-sign-in.test.ts`, with the `loadCloudSignInCallback` case and the filesystem
  spy in `cloud-client.test.ts`. Run both suites, `setup-api.test.ts`, `cloud-address-lookup.test.ts`
  and `boot.box-emails.test.ts`. Keep the file-size guard green by lowering the temporary cap to
  the smallest 250-line cap that fits the measured retained file, expected near 1,220 lines.

## PR 2. Signed-in services

- In `cloud-client-services.ts`, take `leaseState`, `recordRefusal`, `ownerRecovery`, `billingRead`,
  `addressLookup`, `emailRelayEnabled` through `sendEmail`, and `ownerRecoveryRead` through
  `translationService`. Take `StaffReportDelivery`. Create the group once per connection after
  `registrationOf` with `options`, `run`, `read`, `save` and `registrationOf`. Return `leaseState`
  and `recordRefusal` internally for the retained `emergency`. That method, its two caches and
  `emergencyHints()` stay with their saved hint state in the factory.
- Keep the single process-wide `connectionTurns` and the same resolved-path `run` default in the
  factory. Keep saved state, pairing, installation, tunnel, replacement and capture there. Put
  public methods back into their original return slots. Add the registry import at the new throwing
  files and retarget the lease/refusal and billing pointers in `docs/developers/cloud-connection.md`.
- Run `cloud-client.test.ts` and its billing, emergency, error-report and staff-report suites,
  `cloud-api.test.ts`, `cloud-api.owner-recovery.test.ts`, `cloud-address-lookup.test.ts`,
  `cloud-installation.test.ts`, `cloud-translation.exchange.test.ts`, `cloud-email.test.ts`,
  `cloud-staff-certificate.test.ts`, `cloud-tunnel-provision.test.ts` and `cloud-replacement.test.ts`.
  The retained factory should finish near 920–970 lines. Remove its cap once measured under 1,000.

## Checks for both PRs

- Use whole named cuts in each hand-made extraction. Check function body bytes, signature tokens,
  public keys and their order, moved test blocks and import cycles among the pieces. Put the one-off
  comparison and import results in the PR body. List open branches touching the source or its
  importers and tell them which code moved before they rebase.
- Run Server typecheck, every suite with a changed import or mock, and the staged file-size guard.
  Run unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`, Server
  `till-api.sell-published.test.ts` and Till `till-app-menu-refresh.test.ts`. Both changes go
  through the normal hook, Claude’s branch reviews and selected current-head CI.
- Budget about 31 files across both PRs, including 22 type importers. Move about 775 product lines
  and 570 test lines. Expect 60–110 product wiring and import lines, test import edits and 25–40
  map lines. Each PR should fit the three-hour build window.
