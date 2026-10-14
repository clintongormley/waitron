# The Amazon S3 backup rehearsal

The server's stream tests talk to versitygw, a small S3-compatible server started on your machine.
That is fast and free, but it cannot tell you how Amazon S3 itself answers.
The rehearsal is the one place that asks the real service: it runs the same scenarios against Amazon
S3, in a bucket it creates for the run and then tries to delete. Teardown can fail to delete it: an
error from AWS, the teardown's two-minute limit running out, or a Litestream upload still running
when teardown starts. Any failed teardown step fails the run, and when the bucket is left the
receipt names it and gives a cleanup command. Pressing Ctrl-C also leaves the bucket, with no receipt; that is described
under the limits below. If the deadline passes before AWS answers the create, the run cannot know
whether the bucket exists: the receipt records it as `unowned-candidate` with no cleanup command,
and a person checks it.

As of 2026-10-14 the loop and pause scenarios exist and neither has run against Amazon S3; later
tasks of the A538 plan (`docs/superpowers/plans/2026-10-12-a538-archive-s3.md`) add the delete and
archive scenarios (task 9) and the first live run (task 10).

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
- **Synthetic data only.** The loop and pause scenarios each provision a made-up venue ("Stream Loop
  SL", "Stream Pause SL") and record test sales in it. No real venue, customer or fiscal data goes near the bucket.
- **Bounded.** The runner refuses a fixture past its limits before sending it: a 32 MiB archive,
  1,005 objects for the delete scenario, and 128 MiB uploaded in total. Creating and checking the
  bucket and then the scenario get 15 minutes together, and teardown gets 2 minutes on top; the
  2 minutes include stopping the child processes the runner was told about. The loop scenario does not count its bytes against the 128 MiB
  limit, because Litestream does its uploads and the runner does not see them; nor does the pause
  scenario.

Two limits matter if something goes wrong:

- **A run that passes its deadline gets one minute to stop.** The runner signals the scenario
  to stop. The loop scenario then closes whichever of its two servers is running, and the pause scenario its
  one server; either way that server's Litestream stops, and the scenario ends at its next wait. The runner waits up to 60 seconds for that before
  it starts teardown, and records the wait as the `settle` step. The test's own time limit is longer than the
  deadline, that minute and teardown together. If it still ends the test while the run is going,
  the test file's `afterAll` stops the run and waits up to three and a half minutes for its teardown
  and receipt; a scenario still running then is stopped as at its deadline, and the receipt records
  that stop as the `interrupt` step. A scenario still running after
  that minute, for example one inside a restore that cannot be cut short, races the teardown, and a
  late Litestream upload can leave the bucket behind. In the loop scenario the runner never learns
  the Litestream child's process id, so it has no child of its own to stop; the AWS pause test hands
  the server the function that starts Litestream, so the runner learns each child's id and stops it
  at teardown (see "The pause scenario"). When the bucket is
  left, the run fails and the receipt gives the cleanup command.
- **Ctrl-C is not handled.** Interrupting the run from the terminal skips teardown and writes no
  receipt. The bucket is left behind, and nothing printed names it. Find it in the S3 console by its
  `waitron-rehearsal-waitron-` prefix and delete it by hand, after checking that its
  `.waitron-rehearsal-owner` object is from your run. The loop scenario's working folder,
  `waitron-aws-stream-loop-<random>` under your temporary folder (`$TMPDIR` on a Mac), is left
  behind too. It holds a box's `secrets.env` (box A's until the loop removes it, then the rebuilt
  box's) and, once written, `recovery-kit.txt`, which carries the rehearsal's key pair encoded as
  base64url, not encrypted.
  Delete that folder as well, and the pause scenario's `waitron-aws-stream-pause-<random>`, which
  holds its box's `secrets.env`.

## Running it

Run it from a checkout of the branch you want to test, with Litestream installed
(`node scripts/setup-litestream.mjs`). The loop and pause scenarios fail, rather than skip, when
Litestream is missing.

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
| `AWS_REGION`                         | Must match the profile's region. The bucket is created there. `us-east-1` is refused (`region-unsupported`) before any request, because there, AWS's CreateBucket reference says, "if you re-create an existing bucket that you already own in the North Virginia Region, Amazon S3 returns 200 OK", so the run could not tell a fresh bucket from one the account already owns, such as another run's (read 2026-10-14). |
| `WAITRON_AWS_REHEARSAL_RECEIPT_DIR`  | Where receipts are written. Unset or empty, they go to `waitron-aws-rehearsal` under your temporary folder. The full path may hold only letters, digits and `. _ @ -` between its slashes and must be at most 40 folders deep. The cleanup command naming a receipt in it must fit in 512 characters, which the run checks before any AWS call; with the default run id that allows a folder path of about 150 characters, depending on the region (155 for `eu-north-1`). |
| `WAITRON_AWS_REHEARSAL_BUCKET`       | Must be unset or empty. Any other value refuses the run (`supplied-bucket`).                                                                                                                                                       |
| `WAITRON_LITESTREAM_BIN`             | The Litestream binary the scenarios run. Unset or empty, it is `.bin/litestream` at the repository root, where `node scripts/setup-litestream.mjs` puts it. It must report the pinned version, or the loop and pause scenarios fail.                   |

A scenario sees the key pair only inside the bucket settings the runner builds for it. The key pair
never reaches a receipt: every string in a receipt is checked against both halves of it before the
receipt is written. If a row the runner records would carry part of the key pair, the receipt holds
a fixed `record-refused` row in its place (a teardown step keeps only its name and outcome), and the
run, or the cleanup, fails. A scenario's own such row fails the scenario where it is recorded.

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
`pointer-b`, `sale-b`, `frozen-transport` and `restore-compare`. The rehearsal passes the loop no way
to freeze the transport, so `frozen-transport` always reads `skipped` here: the stage's sales
still run, but their timing is not checked.

An upload the runner could not cancel, whose id the receipt cannot carry, is left out of what is left
and recorded as a `record-refused` row, and the run fails; the cleanup command still finds that
upload, because it lists the bucket's uploads itself.

## The pause scenario

`apps/server/src/aws-stream-pause.aws-rehearsal.test.ts` runs the stream pause test's steps
(`apps/server/src/testing/stream-pause-scenario.ts`, described in
[testing-guide.md](testing-guide.md), "The stream pause test") against the run's bucket, under the
label prefix `pause`. A box streams to the bucket; then every bucket call is held, Litestream is
killed and its replacement is held too, sales grow the side file past a 16 MiB limit, and the server
stops Litestream and folds the file back. While the stream is paused, a bucket rule refuses the
supervisor's question to the bucket; once the rule is removed the stream resumes into the same
generation, and a sale made during the pause must be in a restore of it.

**How the bucket is held.** Amazon S3 cannot be frozen, so the scenario holds the rehearsal's own
connections to it instead, through three small proxies on 127.0.0.1 that the test starts and
closes (`apps/server/src/testing/transport-gate.ts`), one per client, so a connection a proxy sees
can only be its own client's. Litestream reaches the bucket through its own:
`HTTPS_PROXY` is added to the environment of the Litestream processes the server starts, and to no
other process. The server's own bucket calls go through another, and the scenario's own calls
through the third, each by a request handler the test gives that store. The server's store does not
reuse connections (keep-alive is off), so every server call opens its own connection to the proxy,
and a server call held there is always a held connection the proxy counts. While held, a new connection waits unanswered and is
never passed on to AWS, and an open one moves no bytes; releasing passes the waiting ones on in
order. Each proxy lets through only port 443 of the owned bucket's own name in the run's region,
`<bucket>.s3.<region>.amazonaws.com`, and refuses every other host, including the shared
`s3.<region>.amazonaws.com`; the run fails if anything asked for a refused host (the `gate-refused`
steps, one per proxy, each naming its client in `objectRole`: `server`, `scenario` or `litestream`, recorded whether the scenario passed or failed). Not everything goes through a proxy: the runner's own calls, the rule's control listings
and the final restore check reach AWS directly, with the same key pair. Unlike the loop scenario's,
this test hands the server the function that starts Litestream, so it learns each process id and
the runner stops those processes at teardown.

On 2026-10-14, a local experiment while building the proxy (A538 plan Task 8) held a real Litestream 0.5.17 this way on a Mac, against a made-up bucket
name with dummy keys and no AWS packet sent: for 240 seconds Litestream stayed alive and kept
opening new connections to replace held ones it gave up (the one timed closely was given up between
58.7 and 64.7 seconds after it arrived), none was passed on, and its side file grew from 7 MB to 50 MB
without being restarted.

**The bucket rule.** While the stream is paused, the scenario puts this bucket policy, with
`<prefix>` the exact listing the paused supervisor asks for (the generation's level-0 folder, under
the run's `pause` prefix):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WaitronRehearsalListingDenial",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": "<prefix>*" } }
    }
  ]
}
```

The runner refuses any other document before sending it (`policy-refused`). After putting the rule, a negative control
lists that prefix every two seconds until AWS answers 403, starting no new listing after 60 seconds. Only then does the
scenario release the server's held connections, so the supervisor's held question reaches AWS under
the rule, and it waits up to 60 seconds more for the server to log `stream.pause_check_failed` with
status 403 and `AccessDenied` (the `pause-check-denied` step, its status and name taken from that
log line). The supervisor logs a refused check once per pause, and a check that hit its five-minute
read deadline each time; either way the first one decides: any other status or name fails the run at
once. Then the rule is removed and a positive control lists the
prefix until it is answered, again starting none after 60 seconds. If the negative control never sees a 403,
the refusal is **unmeasured**: the receipt records `deny-unmeasured` as failed and the run fails. The
rule is then removed before the scenario's own cleanup releases the proxies, so the held question
goes out without it; but if removing the rule fails, that cleanup still releases the proxies, and
the held question goes out with the rule in place. Teardown removes the bucket's policy again
whatever happened.

A successful control listing records no HTTP status, because the store's success carries none, so
the receipt sees `ListObjectsV2` answered only through a refusal or the runner's own listings. The
60-second budgets bound when a control starts a listing, not how long one listing takes: a single
listing that hangs is bounded by the store's own transport limits.

The server's store is set to give up a held call after 120 seconds without traffic (measured with
shorter settings to give up later than its setting, never earlier), longer than the hold is expected
to last, so its question is still waiting when the rule is in place. The
`held-pause-check` step records how long the question was held, from the logged `stream.paused` to
its release. After the refusal, the stream is given the supervisor's one-minute interval, plus 60
seconds for the rule's removal to reach AWS, plus 30 seconds, to resume.

Compared with the local test, the AWS run plans to add, while paused, the wait for the held question
(5 seconds at most), the two controls (each starts no new listing after 60 seconds) and the wait for
the logged refusal (up to 60 seconds), and, after it, 120 seconds more of resume wait: 305 seconds in
all (`STREAM_PAUSE_AWS_EXTRA_MS`, `apps/server/src/testing/aws-pause-gate.ts`, the module the test
reads these waits from). That is a planned budget, not an upper bound. It leaves out how long a
control's last listing runs once started (the store makes up to three attempts, each with a
30-second silence limit, `packages/stream/src/s3-client.ts`), the calls that put and remove the
rule, and, in a failing run, the wait of up to 60 seconds from the kill for the restarted Litestream
to reach its proxy. A unit test holds the local test's waits plus the planned 305 within the
rehearsal's 15-minute scenario deadline: 526 + 305 = 831 seconds, leaving a planned 69 seconds,
which also has to cover creating and checking the bucket.

Its other recorded steps are the scenario's stages (`probe`, `boot`, `baseline`, `freeze-control`,
`restart-held`, `fill`, `fold-back`, `paused-sales`, `while-paused`, `resume`, `restore-sale`),
`restart-through-gate` (a held connection reached the Litestream proxy after the replacement
Litestream started, so the replacement really went through it; one the killed Litestream opens
before then does not count, and a failure names any host that proxy refused), `pause-check-held`, and the rule's
`listing-denial` steps. `pause-check-held` waits, after the server has logged `stream.paused`, up to
5 seconds for the server's proxy to hold at least one connection, and records how many it holds
and how long the wait took; no held connection fails the run. It shows that a server bucket call was
waiting at the proxy, not which call: the connection is encrypted end to end, so the proxy cannot
see that it is the pause check. What ties the refusal to the pause check is the later logged
`stream.pause_check_failed` with a 403 (`pause-check-denied`).
Its working folder is `waitron-aws-stream-pause-<random>` under your temporary folder.

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
