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
scoped to one disposable preproduction venue. Confirm that Cloud’s deployed revision contains
#1382 (`46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8`) and named approval returns `info`.
Have lane G pin the checker to the same candidate for that venue. If its verifier is shared, use
an isolated test deployment. Record the venue, Cloud image and revision, and scoped checker and
admission settings. Remove the trial settings afterward. D451’s release gates apply.

Before the trial, build and pin a candidate image with release provenance. Record its digest,
source, runtime fingerprint and complete target from `/app/backup-verification.js` using `/app/drizzle`.
Capture and verify a snapshot of the disposable source with a known sale. Record the current
verification attempt and archive digest, and confirm that Cloud has no recoverable continuous
source for the venue and setup has no bucket kit. Match the bundled target digest against the
setup request and the Cloud verification. Keep the verifier’s `activation: "not_attempted"`
receipt. Stop the source and use its master key, setup’s Cloud-source recovery preparation
for the selected snapshot, and setup’s isolation confirmations. After restoring and restarting,
find the known sale and fresh fiscal allocation. Require local `reported` and Cloud `restored`
for the same request and point before approval expires. An expired trial needs a fresh run.
[Release procedure](../../operations/backup-verifier-release.md)

Expect about 40 production and 155 test lines added. The chooser, Cloud UI, fiscal authority and
placement are outside this PR. Update `docs/backlog.md`, `docs/backlog/box.md` and
`docs/developers/conventions-data.md` with the exact tested source and digest, and the refusal
of saved v1 setup sessions. Verify that later branch edits touch only docs and qualify every
different image separately. Run finish-branch with two Claude reviews. The owner lands this
restore change. The chooser waits for this PR and watcher clearance.
