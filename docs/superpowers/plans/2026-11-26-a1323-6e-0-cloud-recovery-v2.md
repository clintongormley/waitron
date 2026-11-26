# A1323-6E-0 — Recover a checked Cloud backup through setup

Recover a checked snapshot on the owner’s test Cloud with the continuous copy absent. The box
uses version 2 from setup through Cloud’s acknowledgment after restart. Lane K’s watcher assigned
this first PR in `questions.md` on 2026-11-26 at 13:22. Build after Claude’s review and the
watcher’s clearance.

## Build test-first

- In `apps/server/src/boot.test.ts`, boot preproduction setup through its real HTTPS listener. POST
  `/setup-api/cloud-recovery/start` and stub only Cloud. Check the signed v2 request with the full
  target, the saved v2 request and the browser’s awaiting-approval view. Keep the production gate
  case. Supply a test target with a module spy because source tests lack the bundle defines.
  Watch the case fail on the v1 request, then wire `boot.ts` to the existing client with
  `snapshotProtocol: 2` and lazy `currentBackupVerificationTarget`. Keep the existing refusal
  for a missing build target or incompatible saved session. Rerun the tests.
- In `apps/server/src/node-entry.test.ts`, extend “marks a completed managed restore and reports that
  snapshot after boot” and keep the v1 assertions. Give `runEntry` a valid saved v2 operation and
  matching Cloud verification. Assert the signed `restored` request for the same point’s archive
  digest and target, Cloud’s acknowledgment and the saved `reported` phase. Watch v2 completion
  fail first. In `node-entry.ts`, keep the placement callback’s `markRestored` and use
  `readCloudRecoveryState` to choose the reporting client after boot. Use the running target for
  saved v2 and the existing v1 client for recognised v1. Skip reporting on unsupported or invalid
  state and preserve the file. Keep reporting best-effort. Rerun the tests. Keep direct-client and
  replacement behavior.

```sh
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/node-entry.test.ts \
  src/cloud-recovery-v2.test.ts src/backup-verification-protocol.test.ts \
  src/backup-verification-target.test.ts src/restore-request.verification.test.ts
```

## Qualify and land

Confirm the deployed test Cloud accepts a named `pointId` approval and serves it through `info`.
Cloud #1382 merged at `46e77bf820c2a10121dcb9c0a2d0a32d234bd6b8` and retains named approval
for the current portal. Coordinate the brief trial with lane G. Record the deployed Cloud image
and source revision. The trial needs an isolated disposable venue and the release gates still apply.

Pin the published Waitron candidate image by digest and record the source revision, release, runtime
fingerprint and full `currentBackupVerificationTarget()` from `/app/backup-verification.js` with
`/app/drizzle`. In one run, capture and verify a real Cloud snapshot for that target, record the
current verification attempt and archive identity, and show the continuous source is absent.
Isolate the disposable preproduction source and use its own master key and recovery preparation.
Approve that point, review and restore in setup, then record restart, local `reported` and Cloud
`restored` for the same request and point. Record the verifier’s `activation: "not_attempted"`
and the authorised restore’s fresh fiscal allocation. Retain the prior `FISCAL_RESTORE` refusal.
Keep admission and enforcement gated on Cloud’s child isolation, resource limits, independent
deadline, strict result checks, current claim and cleanup. [Release procedure](../../operations/backup-verifier-release.md) · [Authority fixture](../../developers/authorised-cloud-restore-fixture.md)

Expect about 20 production lines and 120 test lines added. Exclude fiscal authority changes,
restore placement, Cloud UI and the chooser. At landing, update the v1 and open-proof claims in
`docs/backlog/box.md`, A1323’s progress in `docs/backlog.md`, and the v1 setup claim in
`docs/developers/conventions-data.md`. The chooser waits for this PR to land and watcher clearance.
