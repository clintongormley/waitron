# A1323-6E-0 — Recover a checked Cloud backup through setup

Recover a checked snapshot on an isolated local Cloud with the continuous copy absent. The box
uses version 2 from setup through Cloud’s acknowledgment after restart. Lane K’s watcher assigned
this first PR on 26 November at 13:22, cleared the plan at 13:41 and cleared the local trial at 13:47.

## Build test-first

- In `apps/server/src/boot.test.ts`, use the existing setup HTTPS fixture. POST
  `/setup-api/cloud-recovery/start` with a fresh state folder. Stub Cloud and the bundled target
  using the module-spy pattern in `restore-request.verification.test.ts`. Assert that setup
  sends version 2 with the bundled target and receives the awaiting-approval response. Keep
  the production gate. In `boot.ts`, pass `snapshotProtocol: 2` and a lazy target that keeps its
  first successful result. Use a fresh setup state folder for the trial.
- Test saved-version reporting in `cloud-recovery-v2.test.ts`. Version 2 uses the running build’s
  target, recognised version 1 uses its existing proof, and unreadable state is preserved. Add
  one helper in `cloud-recovery.ts` using the existing reader and client. Keep `markRestored`.
  In `node-entry.test.ts`, check that reporting follows startup and a failed report leaves the
  server running. In `cloud-replacement.test.ts`, check the retry order `info`, `restored`,
  `prepare` and the `cloud.unavailable` answer when reporting fails.

```sh
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/node-entry.test.ts \
  src/cloud-replacement.test.ts src/cloud-recovery.test.ts src/cloud-recovery-v2.test.ts \
  src/setup-api.cloud-recovery.test.ts src/restore-request.verification.test.ts \
  src/backup-verification-protocol.test.ts src/backup-verification-target.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## Qualify the candidate before landing

Use a clean local Cloud checkout containing #1382
(`46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8`), with one disposable preproduction venue and a
checker pinned to the candidate. Confirm named approval returns `info`. Record the venue,
Cloud image and revision, scoped checker and admission settings, and cleanup. D451’s release
gates apply. Ask the watcher if the trial requires a Cloud code change.

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

Expect about 40 production and 100 test lines added. The chooser, Cloud UI, fiscal authority and
placement are outside this PR. Update `docs/backlog.md`, `docs/backlog/box.md` and
`docs/developers/conventions-data.md` with the exact tested source and digest. Update
`docs/operations/backup-verifier-release.md` with setup's authority and what to do with a saved
version 1 setup session. Verify that later branch edits touch only docs and qualify every
different image separately. Run finish-branch with two Claude reviews. The owner lands this
restore change. The chooser waits for this PR and watcher clearance.
