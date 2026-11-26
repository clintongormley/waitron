# A1323-6E-0 — Recover a checked Cloud backup through setup

Recover a checked snapshot on the owner’s test Cloud with the continuous copy absent. The box
uses version 2 from setup through Cloud’s acknowledgment after restart. Lane K’s watcher assigned
this first PR on 26 November at 13:22. Build after Claude’s review and the watcher’s clearance.

## Build test-first

- In `apps/server/src/boot.test.ts`, use the existing setup HTTPS fixture. POST
  `/setup-api/cloud-recovery/start` with a fresh state folder. Stub Cloud and the bundled target
  using the module-spy pattern in `restore-request.verification.test.ts`. Assert the signed v2
  request, complete target, saved v2 session and awaiting-approval response. Keep the production
  gate test. Run the new case and watch it send v1. In `boot.ts`, pass `snapshotProtocol: 2` and
  the lazy `currentBackupVerificationTarget` to the client. Missing targets and incompatible
  saved sessions still refuse. Setup cannot resume a saved v1 session with v2, so use a fresh
  disposable folder for the trial.
- Extend the existing reporting tests in `node-entry.test.ts` and `cloud-replacement.test.ts`
  for a saved v2 restore with matching Cloud verification. Keep the v1 cases. Verify that boot
  reports the same point after starting and that replacement can retry a pending report before
  preparing a replacement. In both cases assert the v2 signed archive digest and target, Cloud
  acknowledgment and the local `reported` phase. Run the new cases and watch them refuse v2.
  Add one saved-version reporting helper in `cloud-recovery.ts` using `readCloudRecoveryState`
  and the existing client. Call it from `node-entry.ts` and the existing retry in
  `cloud-replacement.ts`. v2 uses the running build’s target and recognised v1 uses its existing
  proof. Keep the existing `markRestored` callback and failure behavior. Preserve unreadable
  state for diagnosis.

```sh
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/node-entry.test.ts \
  src/cloud-replacement.test.ts src/cloud-recovery.test.ts src/cloud-recovery-v2.test.ts \
  src/setup-api.cloud-recovery.test.ts src/restore-request.verification.test.ts \
  src/backup-verification-protocol.test.ts src/backup-verification-target.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## Qualify the candidate before landing

Ask the watcher to coordinate with lane G. Use the owner's test Cloud with snapshot admission
scoped to one disposable preproduction venue for the duration of the trial. Record the venue,
Cloud image and deployed revision, the way admission was scoped, and its removal afterward.
Confirm that deployment contains Cloud #1382 (`46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8`) and
that its named `pointId` approval gives setup an `info` reply. Keep ordinary admission gated.

Build and pin the PR candidate image by digest. Record its source revision, release provenance,
runtime fingerprint and complete target from `/app/backup-verification.js` using `/app/drizzle`.
Capture and verify a snapshot of the disposable source with a known sale. Record the current
verification attempt and archive digest, and confirm that Cloud has no recoverable continuous
source for the venue and setup has no bucket kit. Match the bundled target digest against the
setup request and the Cloud verification. Keep the verifier’s `activation: "not_attempted"`
receipt. Stop the disposable source and use its own master key, this snapshot’s source-bound
preparation, and setup’s isolation confirmations. Restore through setup. After restart, find the
known sale and fresh fiscal allocation. Record the local `reported` phase, Cloud’s `restored`
acknowledgment for the same request and point, and elapsed time against Cloud’s expiry.
[Release procedure](../../operations/backup-verifier-release.md)

Expect about 40 production and 155 test lines added. The chooser, Cloud UI, fiscal authority and
placement are outside this PR. Update `docs/backlog.md`, `docs/backlog/box.md` and
`docs/developers/conventions-data.md` from the trial evidence. Run finish-branch with two Claude
reviews. The owner lands this restore change. The chooser waits for this PR and watcher clearance.
