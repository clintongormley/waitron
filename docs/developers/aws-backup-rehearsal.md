# The Amazon S3 backup rehearsal

The server's stream tests talk to versitygw, a small S3-compatible server started on your machine. That is fast and free, but it cannot tell you how Amazon S3 itself answers.
The rehearsal is the one place that asks the real service: it runs the same scenarios against Amazon
S3, in a bucket it creates for the run and then tries to delete. Teardown can fail to delete it: an
error from AWS, the teardown's two-minute limit running out, or a Litestream upload still running
when teardown starts. Any failed teardown step fails the run, and when the bucket is left the
receipt names it and gives a cleanup command. Pressing Ctrl-C also leaves the bucket, with no receipt; that is described
under the limits below.

As of 2026-10-14 only the loop scenario exists and it has never run against Amazon S3; later tasks of the A538
plan (`docs/superpowers/plans/2026-10-12-a538-archive-s3.md`, tasks 8 to 10) add the pause,
refused-listing, batch-delete and archive scenarios and the first live run.

## What it is, and what it is not

- **Opt-in, by hand only.** It runs only through its own Vitest config,
  `apps/server/vitest.aws-rehearsal.config.ts`, which selects files named `*.aws-rehearsal.test.ts`.
  The package's normal and preproduction configs exclude those files, and CI never runs the
  rehearsal. Without `WAITRON_RUN_AWS_REHEARSAL=1`, the run stops in its global setup before it
  reads a credentials file or opens a connection, and reports no test count.
- **Its own bucket only.** Each run creates one fresh bucket named
  `waitron-rehearsal-waitron-<12 random characters>` in your region, writes an ownership marker
  object into it (`.waitron-rehearsal-owner`, naming the run), and never touches any other bucket. If
  `WAITRON_AWS_REHEARSAL_BUCKET` is set to anything but an empty value, the run refuses: it never reuses a bucket you name.
  Before any scenario starts it checks that the new bucket uses Amazon's own encryption (SSE-S3) and
  has versioning off.
- **Synthetic data only.** The loop scenario provisions a made-up venue ("Stream Loop SL") and records
  test sales in it. No real venue, customer or fiscal data goes near the bucket.
- **Bounded.** The runner refuses a fixture past its limits before sending it: a 32 MiB archive,
  1,005 objects for the delete scenario, and 128 MiB uploaded in total. Creating and checking the
  bucket and then the scenario get 15 minutes together, and teardown gets 2 minutes on top; the
  2 minutes include stopping the child processes the runner was told about. The loop scenario does not count its bytes against the 128 MiB
  limit, because Litestream does its uploads and the runner does not see them.

Two limits matter if something goes wrong:

- **A run that passes its deadline, or whose test hits Vitest's time limit, gets one minute to stop.** The runner signals the scenario
  to stop. The loop scenario then closes whichever of its two servers is running, which stops that
  server's Litestream, and ends at its next wait. The runner waits up to 60 seconds for that before
  it starts teardown, and records the wait as the `settle` step. When Vitest's time limit ends the test
  first, the test file's `afterAll` stops the run the same way and waits for its teardown and
  receipt; the receipt records that stop as the `interrupt` step. A scenario still running after
  that minute, for example one inside a restore that cannot be cut short, races the teardown, and a
  late Litestream upload can leave the bucket behind. The server does not tell the scenario its
  Litestream child's process id, so the runner has no child of its own to stop. When the bucket is
  left, the run fails and the receipt gives the cleanup command.
- **Ctrl-C is not handled.** Interrupting the run from the terminal skips teardown and writes no
  receipt. The bucket is left behind, and nothing printed names it. Find it in the S3 console by its
  `waitron-rehearsal-waitron-` prefix and delete it by hand, after checking that its
  `.waitron-rehearsal-owner` object is from your run. The loop scenario's working folder,
  `waitron-aws-stream-loop-<random>` under your temporary folder (`$TMPDIR` on a Mac), is left
  behind too. It holds a box's `secrets.env` (box A's until the loop removes it, then the rebuilt
  box's) and, once written, `recovery-kit.txt`, which carries the rehearsal's key pair encoded as
  base64url, not encrypted.
  Delete that folder as well.

## Running it

Run it from a checkout of the branch you want to test, with Litestream installed
(`node scripts/setup-litestream.mjs`). The loop scenario fails, rather than skips, when Litestream is
missing.

```sh
AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" \
AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" \
AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 \
WAITRON_RUN_AWS_REHEARSAL=1 \
pnpm --filter @waitron/server test:aws-rehearsal
```

The variables the rehearsal's own code reads:

| Variable                             | What it does                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITRON_RUN_AWS_REHEARSAL`          | Must be `1`. Anything else refuses the run (`opt-in-missing`) before any file is read.                                                                                                                                             |
| `AWS_SHARED_CREDENTIALS_FILE`        | Absolute path to the credentials file, outside the repository. The runner reads the `waitron-rehearsal` profile's static key pair from it. A session token is refused.                                                            |
| `AWS_CONFIG_FILE`                    | Absolute path to the config file, outside the repository. The profile's region is read from it.                                                                                                                                   |
| `AWS_PROFILE`                        | Must be `waitron-rehearsal`.                                                                                                                                                                                                       |
| `AWS_REGION`                         | Must match the profile's region. The bucket is created there. `us-east-1` is refused (`region-unsupported`) before any request, because there AWS answers a create for a bucket the account already owns with success, so the run could not tell a fresh bucket from someone else's. |
| `WAITRON_AWS_REHEARSAL_RECEIPT_DIR`  | Where receipts are written. Unset or empty, they go to `waitron-aws-rehearsal` under your temporary folder. The full path may hold only letters, digits and `. _ @ -` between its slashes and must be at most 40 folders deep. The cleanup command naming a receipt in it must fit in 512 characters, which the run checks before any AWS call; with the default run id that allows a folder path of about 150 characters, depending on the region (155 for `eu-north-1`). |
| `WAITRON_AWS_REHEARSAL_BUCKET`       | Must be unset or empty. Any other value refuses the run (`supplied-bucket`).                                                                                                                                                       |
| `WAITRON_LITESTREAM_BIN`             | The Litestream binary the loop scenario runs. Unset or empty, it is `.bin/litestream` at the repository root, where `node scripts/setup-litestream.mjs` puts it. It must report the pinned version, or the loop fails.             |

A scenario sees the key pair only inside the bucket settings the runner builds for it. The key pair
never reaches a receipt: every string in a receipt is checked against both halves of it before the
receipt is written.

## What a run leaves behind

Whatever the scenario does, pass or fail, the runner tears down what it owns, in this order: it stops
the child processes it was told about, cancels the multipart uploads it was told about and then
every unfinished upload the bucket lists, removes the bucket's policy, deletes every object in the
bucket, and deletes the bucket.

It then writes a receipt, `aws-rehearsal-<run id>.json`, and prints its path. A receipt holds the
commit, versions, region, times and limits, one row per recorded step (a stage name, an outcome, a
duration, and where relevant an API name, HTTP status and AWS error name), the teardown steps and
their outcomes, and what is left. It never holds a key, a URL, an object's contents or a raw error
message. For the loop scenario, the recorded steps are `probe`, `pointer-a`, `sale-a`, `rebuild`,
`pointer-b`, `sale-b`, `frozen-transport` and `restore-compare`. Amazon S3 cannot be frozen the way
the local test freezes versitygw, so `frozen-transport` always reads `skipped` here: the stage's sales
still run, but their timing is not checked.

## When teardown fails: the cleanup command

If teardown could not delete the bucket, the run fails and the receipt's `cleanupCommand` holds the
command to finish the job. The command always names the credentials and config files under
`$HOME/.config/waitron-cloud/aws/`; if yours are elsewhere, change those two paths before running it.
It looks like this:

```sh
WAITRON_RUN_AWS_REHEARSAL=1 AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt /path/to/aws-rehearsal-<run id>.json
```

The cleanup works only from that receipt. It reads the bucket's ownership marker first and deletes
nothing unless the marker names the receipt's run. It then runs the same teardown as the run, writes
`aws-rehearsal-<run id>-cleanup.json` beside the receipt, and prints that path. It never signals a
process.

The cleanup refuses, deleting nothing, when:

- the opt-in or the profile checks above fail, or `AWS_REGION` differs from the receipt's region
  (`region-mismatch`);
- the receipt cannot be read or does not have the receipt's shape (`receipt-refused`);
- the receipt's ownership state is `not-created` or `collision`, meaning the run never owned a
  bucket, or `unowned-candidate`, meaning a create's outcome was unknown. All three refuse with
  `ownership-unproven`. For a candidate, a person has to check who owns the bucket before anyone
  deletes it;
- the bucket's ownership marker is missing, unreadable or names another run (`ownership-unproven`);
- the receipt's folder could not be named in a cleanup command (`receipt-dir-unsupported`).

If the bucket no longer exists, the cleanup says so and deletes nothing.

The receipt keeps the ids of uploads that could not be cancelled, but the cleanup does not use them:
cancelling an upload needs its object key, which the receipt does not store. Instead it cancels every
unfinished upload the owned bucket lists, which covers the same uploads because the bucket is the
run's alone.
