# Qualify a backup verifier release

A backup-data check and a recovery of a selling server answer different questions. Use the
private verifier to check a copy. Obtain recovery and fiscal activation authority separately.
The [callable interface](../developers/conventions-data.md#backup-data-verification-has-a-separate-authority-boundary)
describes its inputs, private scratch folder, deadline and cleanup requirements.

## Pin the build you will run

Build from the selected source revision. Read `currentBackupVerificationTarget()` and
`BACKUP_VERIFICATION_MODULES` from that build's `backup-verification.js`; use the image's
`/app/drizzle` migrations. Do not reconstruct the target from a saved table of digests.
Record the source revision, runtime fingerprint, complete module target and published image
digest together. A local build alone is not evidence that an image was published.

A850's first implementing source was
[`5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa`](https://github.com/clintongormley/waitron/commit/5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa).
That is historical provenance, not an instruction to use that old image for a newer target.
Later changes, including thread-free verification, require their own exact-build qualification.

## Check the protocol and the recovery boundary

Run the retained protocol and recovery suites from the selected checkout:

```sh
pnpm --filter @waitron/server exec vitest run src/backup-verification-protocol.test.ts src/backup-verification-target.test.ts src/cloud-recovery-v2.test.ts
```

Read the test count. These local checks do not establish Cloud child isolation or an ordinary
recovery of a particular backup.

The literal `VECTOR` in
[backup-verification-protocol.test.ts](../../apps/server/src/backup-verification-protocol.test.ts)
is the cross-implementation request example. Its request digest is
`ecac239bf44b948246432671c1f896219d079c9a3a11b1e3a96d7bd6240e786a`.
Use the complete literal with its target, not that digest on a different request.
The [target implementation](../../apps/server/src/backup-verification-target.ts) and its
[tests](../../apps/server/src/backup-verification-target.test.ts) retain the canonical
composition, migrations, policy and target encodings. File digests hash original bytes;
array digests hash UTF-8 JSON using lowercase SHA-256. Module and dependency ordering use
code-unit ordering. Dependency-range spaces are significant.

The [v2 recovery suite](../../apps/server/src/cloud-recovery-v2.test.ts) retains the target-bound
request, signed proof and descriptor comparisons alongside unchanged v1 exchanges. Preserve
unrecognised or invalid saved state for diagnosis. Do not erase it to force a version fallback.

## Recover through setup

Start a fresh recovery in setup on the qualified build. Setup asks Cloud for a checked copy
matched to this build's verification target. Review that copy, use your venue's master key to
prepare recovery and confirm that the old box is offline and this is your only recovery. After
the box restarts, check that Cloud acknowledges the same request and copy while approval is live.

If setup holds an unfinished version 1 request, close the old request in Cloud if you can. Keep
the old setup state and start a new request from an unprovisioned box with an empty state folder.
If a restore is already staged, keep its state and resolve the staged operation before starting
another recovery. A completed restore can still report to Cloud using its saved version 1 proof.

### Local setup trial, 26 November 2026

The trial used Waitron source `247a1659d54d5411e298813e30f7caa946707a0d` and box image
`sha256:8607c91caeb4683851bcdc6ca9d0e1f3a57198f2ecd2e64ef137321076b03bdb`.
The local Cloud ran `0502b1c6b1ba40f58de2d2df987f4600104a3000`, including Cloud #1382,
in image `sha256:816d845e593be827b0ff3cc08f9845c41cabfa5c6255b13152a226f76d3aa1a9`.
Its checker used the candidate's compiled verifier and migrations in
`sha256:34353c9e6ca6e34184f787ad30283df5e7be840bc2c2bcc87fece17126cfc547`.
Setup and Cloud both recorded target
`79581efc8b7753ced1b022e03c7ad15619ac4678303c789e7f212f571eeafd01`
with runtime fingerprint `d5dcc3239bc2e4174040a00cc7d487d79a40b07d34b0a2fc6315b4bd2cc58fdd`.

The isolated venue had no continuous copy or stream objects. Cloud admitted the 105,744-byte
archive with SHA-256 `9928998e89adb1b8291e64320f06aacd9e748b19638a86a8fc68d37c081151e3`.
The checker passed all eight module checks, recorded `activation: "not_attempted"` and
removed its child container. The disposable venue's owner approved that copy after signing
in and confirming their identity in Cloud. Setup reviewed it, used the venue's master key and confirmed the
time and isolation before staging. After a restart, SQLite reported integrity `ok`, the six
sales included `A-0CNNY/123` and `A-0CNNY/124`, and four new series used installation `0EFE3`.
The box recorded `reported` and Cloud recorded `restored` for the same request and copy at
13:23:07 UTC, before approval expired at 14:21:00 UTC.

## Complete the joint qualification

Before enabling verified-snapshot admission or deployment enforcement, retain exact-build
evidence for the Cloud controller's child isolation, resource limits, independent deadline,
cleanup, strict result admission and current claim. Complete the coordinated target-bound v2
exchange and a genuine capture-to-ordinary-recovery exercise with the continuous source absent.
Use the [authorised disposable restore fixture](../developers/authorised-cloud-restore-fixture.md)
for that exercise; data verification alone supplies no activation authority.

Keep snapshots unavailable and enforcement off until the applicable joint gates pass. Record
which build and image passed, rather than treating A850's historical local results as current
Cloud acceptance. A result with `activation: "not_attempted"` must remain a data-check result.

The original handoff and canonical-vector receipt are retained in the pinned
[A850 source](https://github.com/clintongormley/waitron/blob/6afd12f2644e401d617b492826a1f1c44bd962e8/docs/superpowers/plans/2026-10-20-a850-backup-verification.md#task-27-completion-and-implementing-release--21-october-2026).
