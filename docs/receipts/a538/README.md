# A538's first Amazon S3 rehearsal — 2026-10-14

The four JSON files here are the receipts the rehearsal runner wrote, committed unchanged. This page
says what they show and what they do not. How the rehearsal works, and every limit it runs under, is
in [aws-backup-rehearsal.md](../../developers/aws-backup-rehearsal.md).

## The run

- **Command**, from a clean checkout of `main` at `aa702de4cae53b2aec633155759c33cbda552e95`, with
  `AI_AGENT`, `CLAUDECODE` and `CI` unset:

  ```sh
  AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" \
  AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" \
  AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 \
  WAITRON_RUN_AWS_REHEARSAL=1 \
  WAITRON_AWS_REHEARSAL_RECEIPT_DIR=<a folder outside the repository> \
  pnpm --filter @waitron/server test:aws-rehearsal
  ```

- **Where and with what:** Amazon S3 in `eu-north-1`, from a Mac (macOS 26.6.2, arm64), Node
  v26.7.0, AWS SDK for JavaScript 3.1140.0, Litestream 0.5.17, Vitest 4.1.11. The profile's region
  was read from its config file just before the run.
- **When:** 2026-10-14, 05:46:12 to 05:49:25 UTC, the four scenario runs one after another.
- **Result:** Vitest printed `Test Files 5 passed (5)` and `Tests 5 passed (5)`: the loop, pause,
  archive and delete files, and the file that only checks the profile.
- **Where each fact comes from:** the receipts carry the commit, the Node, SDK and Litestream
  versions, the region, the times, the bucket requests and the teardown. Vitest's version and counts,
  and the server's log lines quoted below (`stream.paused`, `stream.pause_check_failed`,
  `stream.resumed`), come from the run's console output, which is not committed. The checkout's
  state, the unset variables, the macOS version and architecture, the profile's region check, the
  outside bucket listing and the key-pair search were done by the person running the rehearsal and
  are recorded in neither.

| Receipt                                            | Scenario                          | Run (UTC)         |
| -------------------------------------------------- | --------------------------------- | ----------------- |
| [`aws-rehearsal-53355dcd-41f9-489d-a73e-ba0d7ba2df3a.json`](aws-rehearsal-53355dcd-41f9-489d-a73e-ba0d7ba2df3a.json)       | pause, with the bucket rule's 403 | 05:46:12–05:48:29 |
| [`aws-rehearsal-efe76461-7c7f-467e-9f55-1354a2b143fc.json`](aws-rehearsal-efe76461-7c7f-467e-9f55-1354a2b143fc.json)       | stream loop                       | 05:48:30–05:48:56 |
| [`aws-rehearsal-549fe151-41f7-45c5-9d58-a5153fe7c694.json`](aws-rehearsal-549fe151-41f7-45c5-9d58-a5153fe7c694.json)       | archive round trip, then abort    | 05:48:56–05:49:12 |
| [`aws-rehearsal-c031a178-78fc-4643-9756-56ce1f2b72c7.json`](aws-rehearsal-c031a178-78fc-4643-9756-56ce1f2b72c7.json)       | delete-many                       | 05:49:12–05:49:25 |

Each run made its own bucket, `waitron-rehearsal-waitron-<12 random characters>`, and every
receipt's teardown table reads `ok` for cancelling uploads, removing the bucket policy, deleting the
objects and deleting the bucket; `remaining` is empty and `cleanupCommand` is `null` in all four.
`stop-child` reads `skipped` in all four: no child process the runner had been told about was still
running when teardown began.

Outside the runner, the same profile listed the account's buckets with `aws s3api list-buckets`:
none just before the run, one (the pause run's bucket) during it, and none after. Neither half of
the key pair appears in any receipt: each file was searched for both, by a script that read them
from the credentials file without printing them.

## What was measured

Each figure is one request, or one run, on this day, from this machine. None is a bound.

**Stream loop.** Every stage passed: `probe`, `pointer-a`, `sale-a`, `rebuild`, `pointer-b`,
`sale-b` and `restore-compare`; box B was rebuilt from the kit, and a sale made on it was in a
restore of its generation. `frozen-transport` reads `skipped`, as it always does against Amazon S3:
the stage's sales ran, but their timing was not checked. Litestream's own requests are not recorded
(the runner does not see them), so this receipt holds only the runner's bucket requests.

**Pause, and a real 403.** The box streamed, every bucket call was then held at local proxies,
Litestream was killed and its replacement held too, and the side file passed its 16 MiB limit. The
server logged `stream.paused` with 90,833,672 bytes in the side file. With the bucket rule in
place:

- the negative control, which starts once PutBucketPolicy has been answered (204), had its first
  listing of the paused prefix answered 403 `AccessDenied`, 176 ms after it started;
- the paused supervisor's held listing, released, was refused, and the server logged
  `stream.pause_check_failed` with `errorCode` `backup.stream_request_failed`, `status` 403 and
  `errorName` `AccessDenied` (step `pause-check-denied`);
- the positive control, which starts once DeleteBucketPolicy has been answered (204), had its first
  listing succeed, 70 ms after it started;
- the stream then resumed into the same generation (`stream.resumed`), and a sale made during the
  pause was in a restore of it (`restore-sale`).

Both controls needed only one listing, so on this run the rule and its removal applied by the next
request. That is one observation, not a statement about how fast a bucket policy applies.

**Archive round trip.** A 32 MiB synthetic encrypted archive went up as CreateMultipartUpload (200),
four UploadPart of 8 MiB (each 200; the slowest 1,656 ms) and CompleteMultipartUpload (200). It was
listed, downloaded with one GetObject (200) using only a recovery pack that had been encoded and
decoded, and its decrypted bytes matched. A wrong key and a flipped byte were each refused.

**Archive abort.** A 24 MiB upload was cancelled after its first 8 MiB part was answered 200: the
store sent AbortMultipartUpload (204) and no CompleteMultipartUpload, and afterwards the bucket listed
no unfinished upload and no object under the archive folder. At teardown the runner sent
AbortMultipartUpload again for both uploads the scenarios had reported, the completed one and the
cancelled one, and Amazon S3 answered 204 to each, not `NoSuchUpload`.

**Delete-many.** 1,005 PutObject (28,140 bytes, each 200), then DeleteObjects of 1,000 keys (200,
1,040 ms) and of 5 keys (200, 153 ms), with no per-key errors, and a listing afterwards found
nothing.

## The receipts' action table

The runner marks an API `observed` when a recorded step names it with an HTTP status in that run.
Across the four runs:

| API                                                                     | Status                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| PutObject, ListObjectsV2, DeleteObject, DeleteObjects                   | observed                                              |
| CreateBucket, DeleteBucket, DeleteBucketPolicy, ListMultipartUploads    | observed                                              |
| GetBucketEncryption, GetBucketVersioning                                | observed                                              |
| PutBucketPolicy                                                         | observed (pause run)                                  |
| GetObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload   | observed (archive run)                                |
| AbortMultipartUpload                                                    | observed (archive run)                                |
| HeadObject, GetBucketLocation                                           | source-only: known from the code, in no recorded step |
| GetBucketPolicy                                                         | not exercised                                         |

## What this does not show

- **Other providers.** Everything here is Amazon S3 in one region. No other S3-compatible
  provider's answers, and not the fallback for a provider that answers a batch delete with 501.
- **Size and time.** One 32 MiB archive, 1,005 tiny objects and small synthetic venues. Nothing
  about large databases, large archives, large deletes or how long any of them takes.
- **A full restore from an archive in the bucket.** The round trip downloads and decrypts from the
  pack; it does not run `waitron-restore restore --from-archive`'s placement against Amazon S3.
- **Other open questions this run did not touch:** the error names versitygw gives, a deleted
  stream pointer (Amazon documents a 404; not exercised here), Litestream's own requests, the
  frozen-transport timing, and the Litestream trace-logging stall.
- **The rehearsal's own open edges**, listed in [docs/backlog.md](../../backlog.md) under the A538
  rehearsal entries: among them, no teardown when the run is interrupted, and an unplanned request is
  caught only after Amazon S3 has answered it.
