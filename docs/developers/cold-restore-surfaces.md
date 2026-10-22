# Cold-restore operator surfaces

After recovering a backup, you still need to reach the replacement at the right address and
reconnect any Cloud services. The restore entry, local certificate repair and first-start address
rebinding already exist. The remaining operator work is configuring replacement addresses and
installing a replacement Cloud tunnel and staff certificate.

## Steps exercised on 2026-10-22

This audit ran the existing tests at commit `2c46e869bd01d0eafab257abff3c27b54e60a229`, with
Node `v26.11.1` and Vitest `4.1.12`. It changed no implementation, fixture or assertion.

| Step                                              | Existing test and observed result                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select and authenticate a backup, then restore it | `hour-recovery-placement-1.test.ts` exercises archive and bucket commands and an HTTP archive request through staging and reconstructed activation. It also refuses the wrong node key before replacing the destination. Its HTTP case checks recovered records and counters after placement. |
| Recover local HTTPS                               | `connection-bootstrap.entry.test.ts` exercises the real recovery listeners with missing, malformed, mismatched and expired certificate material. Repair returns to verified HTTPS while protected recovery work remains separate.                                                             |
| Publish the replacement address                   | The first-start case in `boot.restore.test.ts` boots a venue with a restore marker. Its served certificate contains the replacement IP and omits the former IP; its signed membership row names `https://box.example.test`, and the marker is removed.                                        |
| Configure the addresses                           | `config.test.ts` checks the explicit advertised origin and its fallback to the dashboard origin, including an empty environment value. These are configuration inputs, not a recovery form.                                                                                                   |
| Enter through an authenticated route              | The email-login case in `management-api.test.ts` returns a session cookie. `cloud-api.test.ts` checks manager permission, the request origin and primary status before Cloud replacement preparation, including a status change while the request waits.                                      |
| Reconnect a managed test replacement              | `cloud-replacement.test.ts` exercises fresh saved keys, lost replies, completion import and restart recovery. It refuses an unrestored recovery. The production-refusal case in `cloud-recovery.test.ts` refuses before creating private recovery state.                                      |
| Capture and place a local file                    | `restore-artifact-file.test.ts` runs scheduled capture, local file storage and default file restore with real SQLite. This fixture does not qualify a production fiscal recovery.                                                                                                             |

Run these commands from an isolated checkout after `pnpm install --frozen-lockfile`:

```sh
node scripts/run-with-deadline.mjs 600 -- pnpm --filter @waitron/server exec vitest run \
  src/hour-recovery-placement-1.test.ts src/cloud-replacement.test.ts \
  src/connection-bootstrap.entry.test.ts --maxWorkers=1
node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/server exec vitest run \
  src/boot.restore.test.ts -t 'finishes a restore at its first trading start' --maxWorkers=1
node scripts/run-with-deadline.mjs 300 -- pnpm --filter @waitron/server exec vitest run \
  src/cloud-api.test.ts src/config.test.ts src/restore-artifact-file.test.ts --maxWorkers=1
node scripts/run-with-deadline.mjs 240 -- pnpm --filter @waitron/server exec vitest run \
  src/cloud-recovery.test.ts src/management-api.test.ts \
  -t 'refuses production recovery before creating private state|logs in with email' --maxWorkers=1
```

These runs passed 85, 1, 117 and 2 tests respectively, with exit status 0. The two name-filtered
runs skipped 16 and 195 cases respectively. They do not represent their full suites.

## Operator work that remains

**Replacement addresses still require configuration.** `loadConfig` in
[`config.ts`](../../apps/server/src/config.ts) reads `WAITRON_MANAGEMENT_ORIGIN`,
`WAITRON_MANAGEMENT_RP_ID` and `WAITRON_ADVERTISED_ORIGIN`; the last falls back to the first.
The first trading start consumes that origin when it rewrites membership. The deployment's
[`compose.yml`](../../deploy/compose.yml) exposes the management settings, and
[`deploy/README.md`](../../deploy/README.md) documents them. A guided recovery step should check
the replacement's address against these settings. A917 owns chosen local names; A947 owns
failover addressing. Neither a successful database restore nor certificate repair chooses these
deployment settings for you.

**Cloud replacement has a narrower surface.** Follow
[Reconnect a restored test server](cloud-connection.md#reconnect-a-restored-test-server-to-its-cloud-venue)
only for its stated non-production, managed-snapshot path. A completed registration still leaves
the new WireGuard tunnel and staff TLS certificate as operator steps. The same guide's
[staff-certificate procedure](cloud-connection.md#reissue-staff-tls-after-a-restore) explains why
the old staff key is excluded. Keep production recovery and final-write handover open under the
existing Cloud integration backlog; this audit does not extend that protocol to local archives
or bucket copies.

## Qualification limits

These are separate synthetic fixtures. The archive placement, restored first-start boot and
manager login are not one continuous test using the same restored account. Cloud replacement
uses controlled HTTP replies; the boot test supplies the advertised origin. No real Cloud route,
WireGuard installation, production recovery, hardware replacement, browser trust installation or
new operator screen was exercised. The HTTP restore test uses the real restore route mounted on
its test app; it does not establish the setup boot's complete browser journey.

Use [recovery with a recovery sheet](../operations/hour-recovery.md) for the current fiscal
procedure and [the disposable authorised fixture](authorised-cloud-restore-fixture.md) for Cloud's
separate ordinary-restore exercise. This audit grants no recovery authority and changes no
fiscal rule.
