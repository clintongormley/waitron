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

Keep the same build from the first setup request until Cloud acknowledges the restore. Use a
bundle with its build identity and migrations so setup can compute the verification target.

If setup holds an unfinished version 1 request or a version 2 request from a different build,
close the old request in Cloud if you can. Keep the old setup state and start a new request
from an unprovisioned box with an empty state folder. If a restore is already staged, keep its
state and finish it on the build that staged it. A completed version 2 restore reports from the
build that performed it. A completed version 1 restore reports using its saved proof.

### Local setup trial, 26 November 2026

The trial used Waitron source `b2ecd05f84920f826500b2bb3a455aeba456c9d4` and the arm64 box image
`sha256:50ebf121e69a2d000d7e4bc6c3603b75b18d464acf55b6abb51f3662078f6e17`.
The local Cloud ran `0502b1c6b1ba40f58de2d2df987f4600104a3000`, including Cloud #1382,
in image `sha256:a43cb4cb4502cfc3b1e93c34033087d91c607fa5a3622b71b9a4e9b3a17a2468`.
Its checker used the candidate's compiled verifier and migrations in
`sha256:c6dae13785db0e029870653bc21688490cc3a23d8739958743411387226d3ca4`.
Setup and Cloud both recorded target
`d413e05ff2c1d06d1d1d16d37d85948ecd24136490a13888160756d45003bd9d`
with runtime fingerprint `c6b02bc604568a1c9e925ee72901288e49021f9a0c2d1c2af11a75fbf2b7e7a2`.

The isolated venue had no continuous copy. Cloud counted zero stream objects and pointer rows
before and after recovery. It admitted the 105,770-byte archive with SHA-256
`dd20f4c9c1216a01cd4ea12dea06d1b65e3b41ce4591c83844bb3e6ad65d9959`. The checker passed
all eight module checks, recorded `activation: "not_attempted"` and removed its child container.

The disposable venue's owner signed in, confirmed their identity and approved the named copy.
Setup reviewed it, used the venue's master key and confirmed the time and isolation before
staging. After the restart, SQLite reported integrity `ok`. The six sales included
`A-0CNNY/123` and `A-0CNNY/124`, and four new series used installation `0EFF3`.
The box recorded `reported` and Cloud recorded `restored` for the same request and copy at
13:55:06 UTC, before approval expired at 14:53:10 UTC.

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
