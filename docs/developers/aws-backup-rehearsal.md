# The Amazon S3 backup rehearsal

Every test that touches a bucket in this repository talks to versitygw, a small S3-compatible server
started on your machine. That is fast and free, but it cannot tell you how Amazon S3 itself answers.
The rehearsal is the one place that asks the real service: it runs the same scenarios against Amazon
S3, in a bucket it creates for the run and always deletes afterwards.

As of 2026-10-14 only the loop scenario exists and it has never run against Amazon S3; tasks 8–10 add
pause/403, delete and archive scenarios and the first live run.

## What it is, and what it is not

- **Opt-in, by hand only.** It runs only through its own Vitest config,
  `apps/server/vitest.aws-rehearsal.config.ts`, which selects files named `*.aws-rehearsal.test.ts`.
  The package's normal and preproduction configs exclude those files, and CI never runs the
  rehearsal. Without `WAITRON_RUN_AWS_REHEARSAL=1`, the run stops in its global setup before it
  reads a credentials file or opens a connection, and reports no test count.
- **Its own bucket only.** Each run creates one fresh bucket named
  `waitron-rehearsal-waitron-<12 random characters>` in your region, writes an ownership marker
  object into it (`.waitron-rehearsal-owner`, naming the run), and never touches any other bucket. If
  `WAITRON_AWS_REHEARSAL_BUCKET` is set at all, the run refuses: it never reuses a bucket you name.
  Before any scenario starts it checks that the new bucket uses Amazon's own encryption (SSE-S3) and
  has versioning off.
- **Synthetic data only.** The loop scenario provisions a made-up venue ("Stream Loop SL") and records
  test sales in it. No real venue, customer or fiscal data goes near the bucket.
- **Bounded.** The runner refuses a fixture past its limits before sending it: a 32 MiB archive,
  1,005 objects for the delete scenario, and 128 MiB uploaded in total. A scenario gets 15 minutes,
  and teardown gets 2 minutes on top. The loop scenario does not count its bytes against the 128 MiB
  limit, because Litestream does its uploads and the runner does not see them.

Two limits matter if something goes wrong:

- **A scenario that passes its deadline is not stopped.** The runner stops waiting for it and starts
  teardown, but the loop scenario does not watch the runner's stop signal, and the server does not
  tell the scenario its Litestream child's process id, so the runner has no child to stop. A
  Litestream still uploading can then race the teardown, which may leave the bucket behind; the
  receipt says so and gives the cleanup command.
- **Ctrl-C is not handled.** Interrupting the run from the terminal skips teardown and writes no
  receipt. The bucket is left behind, and nothing printed names it. Find it in the S3 console by its
  `waitron-rehearsal-waitron-` prefix and delete it by hand, after checking that its
  `.waitron-rehearsal-owner` object is from your run.

## Running it

Run it from a checkout of the branch you want to test, with Litestream installed
(`node scripts/setup-litestream.mjs`). The loop scenario fails, rather than skips, when Litestream is
missing. Do not set `CI=true`.

```sh
AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" \
AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" \
AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 \
WAITRON_RUN_AWS_REHEARSAL=1 \
pnpm --filter @waitron/server test:aws-rehearsal
```

Every variable the run reads:

| Variable                             | What it does                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITRON_RUN_AWS_REHEARSAL`          | Must be `1`. Anything else refuses the run (`opt-in-missing`) before any file is read.                                                                                                                                             |
| `AWS_SHARED_CREDENTIALS_FILE`        | Absolute path to the credentials file, outside the repository. The runner reads the `waitron-rehearsal` profile's static key pair from it. A session token is refused.                                                            |
| `AWS_CONFIG_FILE`                    | Absolute path to the config file, outside the repository. The profile's region is read from it.                                                                                                                                   |
| `AWS_PROFILE`                        | Must be `waitron-rehearsal`.                                                                                                                                                                                                       |
| `AWS_REGION`                         | Must match the profile's region. The bucket is created there.                                                                                                                                                                      |
| `WAITRON_AWS_REHEARSAL_RECEIPT_DIR`  | Where receipts are written. Unset or empty, they go to `waitron-aws-rehearsal` under your temporary folder. The path may hold only letters, digits and `. _ @ -` between its slashes, and must be at most 40 folders deep.        |
| `WAITRON_AWS_REHEARSAL_BUCKET`       | Must be unset. Setting it refuses the run (`supplied-bucket`).                                                                                                                                                                     |

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
exact command to finish the job. It looks like this:

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
- the receipt records that the run never owned a bucket (`not-created` or `collision`), or that a
  create's outcome was unknown, so the bucket is only a candidate (`ownership-unproven`). For a
  candidate, a person has to check who owns the bucket before anyone deletes it;
- the bucket's ownership marker is missing, unreadable or names another run (`ownership-unproven`);
- the receipt's folder could not be named in a cleanup command (`receipt-dir-unsupported`).

If the bucket no longer exists, the cleanup says so and deletes nothing.

The receipt keeps the ids of uploads that could not be cancelled, but the cleanup does not use them:
cancelling an upload needs its object key, which the receipt does not store. Instead it cancels every
unfinished upload the owned bucket lists, which covers the same uploads because the bucket is the
run's alone.
