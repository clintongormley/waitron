# Shared Cloud signing formats

Use `@waitron/contract` inside Waitron when you need the bytes that a box and Cloud
sign and verify. The package exports the `waitron-cloud-pair-v3`, `waitron-cloud-pair-v4`,
`waitron-cloud-machine-v1` and `waitron-cloud-access-v1` formats for Node.js.
It has no runtime dependencies on other Waitron packages.

Use `pairingPayload` and `verifyPairingProof` for pairing requests. Pass an empty
`venueId` to request a new Cloud venue, or its existing Cloud UUID to pair again.
Put the venue's display name in `venueName` on `start` through `pairingVenueName`,
which trims it and keeps at most 120 Unicode code points; send it empty on `status` and `complete`,
or when the venue has no name.

Use `pairingV4Payload` and `verifyPairingV4Proof` for the test-only Cloud sign-in
round trip. Give the encoder the tuple for the action you are signing. The v4
verifier accepts up to 8,192 encoded payload characters.
The receiving app checks the configured callback and box key, accepts the
one-use code and decides whether the account may register the venue.

For an installed box, use `encodeMachine` and `verifyMachine`. `readMachineClaims` parses an envelope
without verifying its signature; authenticate its claims with the stored installation key through `verifyMachine`
before using them. Use `createLeaseIssuer` to sign access leases and give
`verifyLease` your trusted issuer keys. Keep the venue, installation, environment
and permission checks in the application that receives the claims.

Run the format checks and the independent installed-package checks:

```sh
pnpm --filter @waitron/contract exec vitest run src/signing/pairing-proof.test.ts src/signing/installation-proof.test.ts src/signing/access-lease.test.ts
pnpm --filter @waitron/contract test:package
```

The package check installs both a workspace tarball and a locally prepared
`@waitron-io/contract` tarball outside the workspace, checks their types and runs a
Node consumer. [Prepare a tarball](../../docs/developers/shared-ui-preparation.md#inspect-the-signing-package-locally)
when you need to inspect exact bytes. The shared publishing workflow checks and publishes both packages when either package
changes on main. Confirm its registry result before selecting a release; Cloud adoption
and an installation with Cloud’s own token remain separate checks.
