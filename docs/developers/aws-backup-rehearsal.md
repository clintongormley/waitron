# The Amazon S3 backup rehearsal

The server's stream tests talk to versitygw, a small S3-compatible server started on your machine.
That is fast and free, but it cannot tell you how Amazon S3 itself answers.
The rehearsal is the one place that asks the real service: it runs the same scenarios against Amazon
S3, in a bucket it creates for the run and then tries to delete. Teardown can fail to delete it: an
error from AWS, the teardown's two-minute limit running out, or a Litestream upload still running
when teardown starts. Any failed teardown step fails the run, and when the bucket is left the
receipt names it and gives a cleanup command. A run whose process dies before it can tear down
(Ctrl-C, a SIGTERM, an uncaught error) is cleaned up by a second process it started for that, the
keeper; see "When a run is killed: the keeper". If the deadline passes before AWS answers the
create, the run cannot know whether the bucket exists: the receipt records it as
`unowned-candidate` with no cleanup command, and a person checks it.

Every request the rehearsal's own Node code would send to S3 is checked against the run's plan
before it leaves the process, and one off the plan is refused there; see "Requests are checked
before they are sent". Litestream's requests are not checked that way.

The loop, pause, delete-many, archive round trip and archive abort scenarios first ran against
Amazon S3 on 2026-10-14 (A538 plan Task 10, `eu-north-1`), and all passed. Their receipts, and what
they do and do not show, are in [docs/receipts/a538/](../receipts/a538/README.md).

## What it is, and what it is not

- **Opt-in, by hand only.** It runs only through its own Vitest config,
  `apps/server/vitest.aws-rehearsal.config.ts`, which selects files named `*.aws-rehearsal.test.ts`.
  The package's normal and preproduction configs exclude those files, and CI never runs the
  rehearsal. Without `WAITRON_RUN_AWS_REHEARSAL=1`, the run stops in its global setup before it
  reads a credentials file or opens a connection, and reports no test count.
- **Its own bucket only.** Each run (one per scenario file) creates one fresh bucket named
  `waitron-rehearsal-waitron-<12 random characters>` in your region, writes an ownership marker
  object into it (`.waitron-rehearsal-owner`, naming the run), and never touches any other bucket. If
  `WAITRON_AWS_REHEARSAL_BUCKET` is set to anything but an empty value, the run refuses: it never reuses a bucket you name.
  A request from the rehearsal's Node code to any other bucket is refused before it is sent.
  Before any scenario starts it checks that the new bucket uses Amazon's own encryption (SSE-S3) and
  has versioning off.
- **Synthetic data only.** The loop and pause scenarios each provision a made-up venue ("Stream Loop
  SL", "Stream Pause SL") and record test sales in it; the delete and archive scenarios upload
  made-up bytes. No real venue, customer or fiscal data goes near the bucket.
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
  late Litestream upload can leave the bucket behind. The AWS loop and pause tests hand the server
  the function that starts Litestream, so the runner learns each child's process id and stops it at
  teardown. The Litestream processes a restore starts (`packages/stream/src/restore.ts`) are not
  started through that function, so neither the runner nor the keeper knows them or stops them. The delete and archive scenarios pass the run's stop
  signal to every bucket request. Decrypting an archive on your machine takes no signal. When the bucket is
  left, the run fails and the receipt gives the cleanup command.
- **A killed run is cleaned up by the keeper, within limits.** Interrupting the run skips its own
  teardown, and the keeper does it instead; what the keeper cannot do is listed in "When a run is
  killed: the keeper". A bucket it reports as left, or of unknown ownership, is found in the S3
  console by its `waitron-rehearsal-waitron-` prefix, or by listing the account's buckets with
  `aws s3api list-buckets` under the same profile variables (which worked with the rehearsal profile
  on 2026-10-14). A folder it reports as left holds secrets: the loop scenario's holds a box's
  `secrets.env` and, once written, `recovery-kit.txt`, which carries the rehearsal's key pair
  encoded as base64url, not encrypted. Delete it by hand.

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

This runs every `*.aws-rehearsal.test.ts` file in `apps/server/src`, one at a time. Each scenario
file is its own run, with its own bucket, deadline and receipt, so the loop, pause, delete and
archive files make four buckets and four receipts; the profile file only reads the profile and
creates no bucket.

The variables the rehearsal's own code reads:

| Variable                             | What it does                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WAITRON_RUN_AWS_REHEARSAL`          | Must be `1`. Anything else refuses the run (`opt-in-missing`) before any file is read.                                                                                                                                             |
| `AWS_SHARED_CREDENTIALS_FILE`        | Absolute path to the credentials file, outside the repository. The runner reads the `waitron-rehearsal` profile's static key pair from it. A session token is refused.                                                            |
| `AWS_CONFIG_FILE`                    | Absolute path to the config file, outside the repository. The profile's region is read from it.                                                                                                                                   |
| `AWS_PROFILE`                        | Must be `waitron-rehearsal`.                                                                                                                                                                                                       |
| `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3` | Must be unset or empty. Either one set refuses the run (`endpoint-unsupported`), and so does an `endpoint_url` or `services` setting in the profile's section of either file: a rehearsal sends only to Amazon S3. |
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
bucket, and deletes the bucket. Last, it removes the run's scratch folder (the `remove-scratch`
step), whether or not it owned a bucket, whenever a scenario asked for one.

**Scratch.** A scenario's working files go in a folder the runner makes for it,
`waitron-aws-rehearsal-<run id>/<label>/` under your temporary folder (`$TMPDIR` on a Mac); the
loop's holds a box's `secrets.env` and, once written, its `recovery-kit.txt`, and the pause scenario's its box's
`secrets.env`. The runner names the folder in the journal before making it, so the keeper can remove
it too. The step, and the run, fail when the folder cannot be removed, when it is back after
removal, or when the scenario was still running after its one-minute settle wait and could write there again; the run's
failure message then names the folder, so you can delete it by hand.

It then writes a receipt, `aws-rehearsal-<run id>.json`, and prints its path. A receipt holds the
commit, versions, region, times and limits, one row per recorded step (a stage name, an outcome, a
duration, and where relevant an API name, HTTP status and AWS error name), the teardown steps and
their outcomes, and what is left. For a bucket the run owned, a receipt missing any of the five
bucket teardown steps or `remove-scratch` is refused, and the run fails saying the receipt was not written. It never holds a key, a URL, an object's contents or a raw error
message. For the loop scenario, the recorded steps are `probe`, `pointer-a`, `sale-a`, `rebuild`,
`pointer-b`, `sale-b`, `frozen-transport` and `restore-compare`. The rehearsal passes the loop no way
to freeze the transport, so `frozen-transport` always reads `skipped` here: the stage's sales
still run, but their timing is not checked.

An upload the runner could not cancel, whose id the receipt cannot carry, is left out of what is left
and recorded as a `record-refused` row, and the run fails; the cleanup command still finds that
upload, because it lists the bucket's uploads itself.

## Requests are checked before they are sent

Every request the rehearsal's Node code sends through the AWS SDK, whoever sends it (the runner, a
scenario's own store, or the server the loop and pause scenarios start inside the test process), is
checked against the run's plan before it leaves the process
(`apps/server/src/testing/aws-send-gate.ts`, which wraps the SDK's shared `send`). A request that
fails the check is refused locally and never reaches Amazon S3. The plan:

- **The runner's own requests** may be only the ones it needs to create, check and tear down the
  bucket (CreateBucket, the encryption and versioning reads, the policy calls, listing and cancelling
  uploads, listing and deleting objects, DeleteBucket), only on the run's bucket; it may put and read
  only the ownership marker.
- **Every other request** may use only the APIs its scenario declares
  (`apps/server/src/testing/aws-rehearsal-plans.ts`), only on the run's bucket, and every object key
  and listing prefix must sit under a prefix the run handed out, with no `.` or `..` path segment. A
  scenario cannot declare a bucket-level API such as CreateBucket or a policy call.
- **Any API outside the receipt's list** is refused.
- **The host.** Just before a request is sent, the host the SDK worked out for it must be one of
  Amazon S3's own names for the run's bucket in the run's region (`<bucket>.s3.<region>.amazonaws.com`,
  the path-style `s3.<region>.amazonaws.com`, and their FIPS and dual-stack forms). That catches an
  endpoint set some way the profile checks above do not read.

A refusal fails the run even when the code that sent it catches the error, as the server's stream
code does with bucket errors: the receipt gets a `request-refused` row (naming the API when it is on
the receipt's list), and the run fails with `N unplanned request(s) refused before sending; the
first: <detail>`. The detail names the API and the rule it broke; it names a bucket only when the
name is a rehearsal bucket's, and never a key or a prefix.

In the rehearsal's own test processes, a request sent outside any run is refused too
(`<API> was sent outside a rehearsal run`). A request sent after the run's receipt is built is not
in the receipt; it is printed as `refused after the receipt was written: <detail>` and still fails
the run. One sent after the run has returned is printed as `refused after the run ended: <detail>`
and fails nothing, because the run's result is already settled. The keeper and the cleanup command
check their own requests the same way, with a plan that holds the run's bucket and nothing else.

What is not checked:

- **Litestream's requests.** Litestream is a separate program, and no Node code sends its requests.
  In the pause scenario its connections pass through a proxy that admits only the run's bucket host
  (see "The pause scenario"); in the loop scenario nothing limits them. Whether to close that gap is
  an open owner question, asked 2026-10-14.
- **The listing-denial step, locally.** The local loop, pause and
  rehearsal-scenario tests run under the same plans as the AWS runs, so a request a plan lacks fails
  there first; but the local pause test does not run the listing-denial step, which needs Amazon's
  bucket policies, so that step's listings are first checked against the plan on Amazon S3.

**Proving it without Amazon.** The rehearsal's own tests run the runner against versitygw by giving
it a local endpoint, which only a test can set; nothing reads one from the environment. With one
set, the encryption and versioning check is skipped and recorded as two `skipped` rows (versitygw
answers the encryption read with 501 `NotImplemented`), and the host check lets any host through.
The four AWS test files never set one. `apps/server/src/aws-send-gate.e2e.test.ts` shows a request
off the plan never reaches versitygw, whose access log records nothing for it.

## The pause scenario

`apps/server/src/aws-stream-pause.aws-rehearsal.test.ts` runs the stream pause test's steps
(`apps/server/src/testing/stream-pause-scenario.ts`, described in
[testing-guide.md](testing-guide.md), "The stream pause test") against the run's bucket, under the
label prefix `pause`. A box streams to the bucket; then every bucket call is held, Litestream is
killed and its replacement is held too, probe sales prove a reader holds the side file, sales grow
the side file past a 16 MiB limit, and the server stops Litestream and folds the file back. While
the stream is paused, a bucket rule refuses the supervisor's question to the bucket; once the rule
is removed the stream resumes into the same generation, and a sale made during the pause must be in
a restore of it.

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
and the final restore check reach AWS directly, with the same key pair. As in the loop scenario, the test hands the server the
function that starts Litestream, so the runner learns each process id and stops those processes at
teardown.

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
rehearsal's 15-minute scenario deadline: 536 + 305 = 841 seconds, leaving a planned 59 seconds,
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

## The delete and archive scenarios

Each scenario has its own label prefix in the run's bucket and goes through the product's own S3
backend (`buildBackupBackend`), so each request is built by the product's own store code.

- **`delete-many`** (`apps/server/src/aws-delete.aws-rehearsal.test.ts`, steps in
  `apps/server/src/testing/s3-delete-scenario.ts`): puts 1,005 tiny objects, about 28 KB in all,
  lists them, deletes them through the backend's `deleteMany`, and checks from the recorded requests
  that two DeleteObjects calls of 1,000 and 5 keys were answered and that a listing then finds
  nothing. Its phases are `listed-before`, `deleted` and `listed-after`, and `put` when putting
  fails.
- **`archive-roundtrip`** and **`archive-abort`** (`apps/server/src/aws-archive.aws-rehearsal.test.ts`,
  steps in `apps/server/src/testing/s3-archive-scenario.ts`) run one after the other in one run, so
  in one bucket under one 128 MiB budget. The round trip uploads a synthetic encrypted archive of
  32 MiB in four 8 MiB parts, lists it, downloads it using only a recovery pack that has been encoded
  and decoded, checks the decrypted bytes match, and checks that a wrong key and a flipped byte are
  each refused (phases `uploaded`, `listed`, `downloaded`, `decrypted-match`, `wrong-key-refused`,
  `tamper-refused`). The abort starts a 24 MiB archive upload, cancels it once one part has been
  answered, and checks that an AbortMultipartUpload was sent, no completion was, and neither an
  unfinished upload nor an object, at any key, is left under its archive folder (phases `aborted`,
  `uploads-after`, `listed-after`, and `abort-cleanup` when the store fails to cancel its own
  upload).
  Together they reserve 56 MiB of the budget.

A phase is recorded `failed` when its request fails or when one of its checks does not hold; the
row carries the error's name, which is `AssertionError` when an `expect` failed. Only a phase that
passed is recorded `ok`.

**What the receipt records.** Besides the phases, every S3 request these scenarios send is one
`request` row: the API name, HTTP status, attempts, elapsed time and outcome, and for DeleteObjects
the number of keys sent, for PutObject and UploadPart the bytes sent. A DeleteObjects answer that
lists per-key errors adds a `delete-key-errors` row with their count. A row never holds a key, a
body or a URL. A request to an API outside the receipt's list (`RECEIPT_APIS`,
`apps/server/src/testing/aws-rehearsal-receipt.ts`) is refused before it is sent (see "Requests are
checked before they are sent"). The recorder keeps its own check behind that one: it throws on such
an API once Amazon S3 has answered, and the scenario fails.

**Observed or source-only.** The receipt's action table lists each API on that list once. An API is
`observed` when some recorded step names it with an HTTP status; otherwise it is `source-only`
when the runner lists it as known only from reading the code (GetBucketLocation, HeadObject,
CreateMultipartUpload, UploadPart, CompleteMultipartUpload), and `not-exercised` otherwise. So a
live run of the archive scenarios is what can move the multipart APIs to `observed`, as the
2026-10-14 run did.

**Unfinished uploads.** Each archive scenario tells the runner the id of every multipart upload it
starts, which teardown cancels. The abort scenario's "no unfinished upload" check asks the runner
(`ownedUploads`), which lists the bucket's unfinished uploads under a prefix this run issued, or a
path below one, and refuses any other prefix.

**Against versitygw.** The same scenarios run against versitygw in
`apps/server/src/s3-rehearsal-scenarios.e2e.test.ts` (CI's `test-server-stream` job). Run on
2026-10-14 on a Mac with versitygw 1.8.0
(`WAITRON_REQUIRE_STREAM_BINARIES=1 pnpm --filter @waitron/server exec vitest run src/s3-rehearsal-scenarios.e2e.test.ts`),
all 6 cases passed. The requests each scenario recorded were: delete-many,
1,005 PutObject, 3 ListObjectsV2 and 2 DeleteObjects, all 200; the round trip, 1
CreateMultipartUpload, 4 UploadPart, 1 CompleteMultipartUpload, 2 ListObjectsV2 and 1 GetObject, all
200; the abort, 1 CreateMultipartUpload, 1 UploadPart and 1 ListObjectsV2 answered 200 and 1
AbortMultipartUpload answered 204. That is how versitygw answers, not how Amazon S3 does. The
delete-many scenario's refusal of a 1,006th object and its failing first listing are checked without
a server, in `apps/server/src/testing/s3-delete-scenario.test.ts`.

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

When teardown fails to delete the bucket after it has already deleted the marker with the objects,
or the run never wrote a marker, teardown writes the marker again so this command can prove
ownership. If that write fails too, the receipt has a failed `restore-nonce` row and the
command refuses with `ownership-unproven`. The bucket is still the one the receipt names, created by
that run: check in the S3 console that it holds nothing but this run's objects, then empty and
delete it by hand.

## When a run is killed: the keeper

A killed run cannot be relied on to tear down itself. So before it creates its bucket, each run writes a
**journal**, `aws-rehearsal-<run id>-journal.json` in the receipt folder, and starts a **keeper**, a
separate Node process (`apps/server/scripts/aws-rehearsal-keeper.ts`) that outlives the run. A
person never starts the keeper.

**How it stays alive.** The keeper is started through a short-lived launcher in a session of its
own, so its parent is process 1: a Ctrl-C to the terminal's process group, or a watchdog stopping
the run's process tree, does not reach it. It ignores the hang-up signal a closing terminal sends,
and stops on a SIGTERM sent to it directly. It learns that the run has ended from a pipe whose other
end only the run holds, so the run ending in any way, a kill included, ends the pipe. The run
creates nothing until the journal shows the keeper ready; a keeper not ready within 10 seconds
refuses the run (`keeper-unavailable`) before any bucket exists.

**The journal** records, as the run goes: the bucket name and its state (`creating` before the
create is sent, `owned` once Amazon answers it as created, `deleted` once teardown deletes it,
`finished` once the receipt is written), the multipart uploads and child processes the run was told
about (each process with its start time), the scratch folder, and the run's limits. Each write is
whole or not at all, so a kill finds the last complete journal.

**What it does.** When the run has ended, the keeper reads the journal. If it says `finished`, the
keeper does nothing and exits 0. Otherwise it stops each tracked process whose start time still
matches the journal's (a process id since reused by another program is left alone), then acts on
the bucket's state:

- `owned`: it reads the ownership marker. If the bucket is gone, nothing is left to delete. If the
  marker names the run, or there is no marker (a run killed between its create and its marker), it
  runs the same teardown as the run, within the same two-minute limit: cancel uploads, remove the
  bucket's policy (so a listing-denial rule left by a run killed mid-pause goes too), delete the
  objects, delete the bucket. If the marker names another run or cannot be read, or the read fails
  in any other way (Amazon S3 cannot be reached, for example), it deletes nothing and reports the
  bucket as of unknown ownership.
- `creating`: the create may have been sent and never answered, so it waits 30 seconds for it to
  land, then reads the marker. If the bucket does not exist, nothing was created; otherwise it
  deletes nothing and reports the bucket as of unknown ownership.
- `deleted`, `not-created`, `collision`: there is no bucket to delete.

In every state it then removes the scratch folder, writes its own receipt,
`aws-rehearsal-<run id>-interrupted.json` (never overwriting one already there) with an
`interrupted` row, and prints its lines.

**What it prints.** Every line goes to `aws-rehearsal-<run id>-keeper.log` beside the receipt, and to
the terminal the run was started from, when there was one. The lines are the receipt's path, then
either `nothing left behind` or `left behind:` followed by one line per thing left: `bucket <name>`,
`bucket <name> (ownership unknown)`, `upload <id>`, `process <pid>`, `folder <path>`. It exits 0
when nothing is left and nothing else went wrong, and 1 otherwise. A bucket left behind gets a
cleanup command in the interrupted receipt, run as above. A bucket of unknown ownership gets none: a
person checks who owns it before deleting it, as for `unowned-candidate`.

**Its limits.**

- **It trusts the journal only within bounds.** The scratch folder must be exactly
  `waitron-aws-rehearsal-<run id>` directly in the keeper's temporary folder, the bucket must have a
  rehearsal bucket's name, and an endpoint (set only by the rehearsal's own tests) must be on this
  machine. A journal outside those bounds, or one it cannot read, is refused: the keeper deletes
  nothing, not even the scratch folder, prints why and exits 1. Clean up by hand, as described under
  the limits near the top.
- **If its own checks fail** (the opt-in, the profile, `AWS_REGION` differing from the journal's),
  it sends nothing, but still stops the tracked processes and removes the scratch folder, and lists
  an `owned` bucket as left and a `creating` one as of unknown ownership.
- **It waits at most twice the run's whole budget**: the 15-minute deadline, the one-minute settle
  wait and the two-minute teardown, doubled, so 36 minutes. A run still going then is left to finish
  alone: the keeper prints `gave up waiting`, lists what may be left, does nothing and exits 1.
- **It cannot stop the Litestream processes a restore starts**, because the journal never names them.
- **A bucket in state `creating` is reported, never deleted**, and so is an owned bucket whose marker
  it could not read; neither gets a cleanup command.

`apps/server/src/aws-rehearsal-interrupt.e2e.test.ts` (CI's `test-server-stream` job) kills a run
against versitygw at several points, by SIGINT and SIGTERM, by an uncaught error, during a teardown
held by a paused server, and under Vitest itself, and checks that no bucket and no scratch folder is
left and that the keeper prints `nothing left behind`; one more case runs out the keeper's teardown limit and checks that the interrupted
receipt's cleanup command removes what was left.
