# A538: Off-box archives and an Amazon S3 rehearsal

**Status: needs-owner-review.** Draft dated 2026-10-12. Every new choice below is **proposed**, not owner-approved. Please review before **17 October 2026**. This document authorizes neither a build nor a live run. The [implementation plan](../plans/2026-10-12-a538-archive-s3.md) uses native inline execution after approval.

_2026-10-13: the owner approved the four proposed defaults as written on 2026-10-12, and plan Task 1 is built as A538-1._

Your database already streams to a bucket, but your scheduled recovery archives still have only a local destination. A lost box needs both an off-box archive and recovery instructions you saved elsewhere. Add an S3 archive destination, keep local archives available, and run a small rehearsal against Amazon S3 to replace specific untested claims with recorded answers.

## 1. Scope and evidence boundary

Build an S3-compatible `StorageBackend`, cancellation through every destination operation, a Backups-screen choice, and an opt-in Amazon S3 rehearsal. Google Drive remains out of scope. Preserve archive framing, restore validation, fiscal installation allocation and working-time continuation. This is no change to fiscal logic or permission to edit fiscal assertions.

This draft is based on source reads and AWS documentation, **not execution**. No product tests, bucket requests or credential reads were run while writing it. Region `eu-north-1` comes from the driver's region-only profile inspection. Recheck the region at rehearsal time.

| Current source receipt | What the read establishes |
| --- | --- |
| `apps/server/src/storage-backend.ts:8`, `backup-config.ts:100` | Archive destinations have file transfers but no cancellation argument; the parser accepts only `local-fs`. |
| `apps/server/src/local-fs-backend.ts:73`, `backup-supervisor.ts:138` | The backend factory constructs only `LocalFsBackend`; the supervisor uses it for sweep and status. |
| `apps/server/src/backup-sweep.ts:108` | The sweep packs and encrypts to a protected file, then uploads that file to each destination. It does not buffer the entire database in memory. |
| `apps/server/src/backup-sweep.ts:124`, `backup-status.ts:23` | Upload/prune and status listing wait for destination calls. They lack whole-call cancellation. |
| `apps/server/src/backup-supervisor.ts:89`, `backup-sweep.ts:149` | `archiveUnderCurrentKey` records **any** destination success in this process. It does not establish an off-box copy. |
| `apps/server/src/backup-api.ts:142`, `backup-api.ts:183`, `backup-env-writer.ts:12` | Apply and rotation currently serialize one `destinationDir`; rotation cannot preserve an S3 descriptor as written. |
| `apps/server/src/boot.ts:304`, `boot.ts:1727`, `boot.ts:1904` | Raw environment ownership and shared backup/stream turns are explicit consumers to update. |
| `apps/server/src/stream-host.ts:25`, `packages/credentials/src/purposes.ts:38` | Stream settings use sealed purpose `backup.stream`. Credential readers validate the fields they consume. |
| `apps/server/src/stream-api.ts:210`, `apps/dashboard/src/screens/stream-settings-panel.ts:100` | The stream recovery kit includes bucket credentials and the recovery passphrase; ordinary settings omit the secret access key, so a secret-only change does not invalidate a displayed kit today. |
| `apps/server/src/backup-optional-state.ts:10`, `artifact-cipher-file.ts:10`, `restore.ts:679` | `backup.env` and `modules.json` are captured; file encryption derives its key asynchronously; file restore validates before placement. |
| `packages/stream/src/s3-store.ts:135`, `object-store.ts:19`, `apps/server/src/bounded-store.ts:16` | The SDK seam has pagination and 1,000-key delete batches, but no signal. Restore's timeout abandons the call instead of cancelling it. |
| `packages/stream/src/supervisor.ts:884`, `supervisor.ts:626` | Pause/freshness deadlines must pass cancellation into the actual listing, rather than only race a timer. |
| `apps/server/src/stream-loop.e2e.test.ts:76`, `stream-pause.e2e.test.ts:88`, `stream-pause.e2e.test.ts:485` | Local harnesses use versitygw and pinned Litestream; pause diagnostics sample sellers, file state and stream status. These are not Amazon S3 receipts. |

Future implementers re-map these paths on their starting commit. The quoted backlog inventory in §8 records scope; it is not a claim that each historical description still matches code.

## 2. Your destination and recovery material

**Proposed:** the archive form offers **Local folder**, **Same bucket as database stream**, and **Another S3-compatible bucket**. Keep local fan-out destinations configured by the environment. The dashboard manages one archive bucket plus optional local copies; arbitrary multiple bucket credentials are outside this slice.

Choosing the stream bucket copies its resolved endpoint, region, bucket and credentials **server-side at Save**. It creates an independent archive configuration. Later stream edits or removal do not move or disable archives. The form says this and shows the resolved archive location. Switching back to this choice and saving again copies the current stream settings. With no stream settings, the choice stays quiet and unavailable with a localized explanation.

The actual archive namespace is `<selected-prefix>/archives/<venueId>/`. Strip redundant outer slashes, reject control characters, `.` and `..` segments, and require a non-empty fixed `archives/<venueId>/` suffix. Even a stream configured at bucket root stores its venue under `venues/<venueId>/` (`packages/stream/src/names.ts:26`), so archives remain in a separate namespace. Compare normalized endpoint/region/bucket and **actual stream venue namespace**, not just the selected root prefix. Refuse an archive prefix inside a stream venue namespace, or containing one, for the same bucket. A custom selection cannot disable this check.

Retention sees only strictly valid archive names immediately inside this archive namespace. Unknown files, stream pointers, generations, other venues and malformed names are never deletion candidates. Save probes with a unique object under the selected archive namespace, reads and lists it, then deletes only that object through `deleteMany([probeKey])`. Probe success does not prove future access or retention performance.

**Proposed persistence:** add sealed purpose `backup.archive` with one `settings` field holding a validated JSON configuration, including complete destination descriptors, schedule, retention and a fresh opaque revision on each edit. The single-purpose vault (`packages/credentials/src/store.ts:10`) is why this slice manages one bucket. Local dashboard settings also use this record, so destination/schedule updates commit in one database transaction. Keep the existing recovery passphrase in `backup.env`; do not put S3 keys there. No shipped data-format migration or compatibility reader is added while Waitron is not live; reset existing development installations if this format changes.

Raw environment configuration remains authoritative. `WAITRON_BACKUP_DESTINATIONS` can describe local or S3 destinations with externally injected credentials; never copy those keys to a persisted file. Extend the raw environment ownership list for the proposed timeout setting. Environment-managed settings are read-only in the dashboard. Explicit dashboard disable is a stored disabled configuration, not deletion that could reactivate another source. The configuration loader resolves exactly one authoritative source and reports its provenance.

Save uses the shared `backup-turns` queue, rechecks primary/ownership/held key, then commits configuration and reloads outside the transaction. Minting an absent passphrase and writing its existing file before the configuration transaction is a **deliberate split**, because filesystem and database writes cannot share this transaction; a refused configuration leaves only a usable held passphrase, with archives off. Re-lock node state immediately after a key-file write and again after a successful configuration write. A successful commit followed by failed reload is a load failure and does not invite the form to submit again. Rotation preserves every destination and schedule; it changes only the held passphrase, rotation time and configuration revision.

The key file is authoritative for the effective passphrase. If its write succeeds but the later configuration-revision transaction fails, the key **has changed**. Re-lock node state immediately, reload using that effective key even on the failure path, and report `backup.rotation_metadata_failed` with `effectiveKeyChanged: true`, never a refusal implying the old key remains active. Keep the new key/recovery-record action available. Ordinary status and pack validity include the effective key fingerprint and key-file rotation time independently of the sealed configuration revision, so this partial outcome invalidates an old pack. Preserve the old destination configuration, and never compensate by putting back an older key. If re-lock or reload also fails, report its separate load/sealed-state outcome. A key-file write that fails changes none of these values.

Ordinary settings/status return endpoint, region, bucket, namespace, credential-present flag and revision, never secret access keys, passphrases or raw SDK errors. Use the revision to invalidate displayed recovery material, including a secret-only change. Sealing protects bucket credentials stored on the box; the recovery passphrase encrypts archive contents. These have different jobs.

**Proposed recovery:** offer an explicit, authenticated, `Cache-Control: no-store` **Download archive recovery pack** action. A versioned pack contains the archive location, bucket credentials, recovery passphrase, format identifier and instructions. It is secret material like today's stream kit: save it outside the box. Ordinary reads never return it. The pack works with archives off and with no stream kit, pointer or generation. You can also download ciphertext and restore a local file using only the passphrase. Bucket access alone cannot decrypt an archive.

Add `waitron-restore restore --from-archive <pack-file> --archive-key <name>` as an explicit archive source, mutually exclusive with existing file/bucket sources. Download into owned protected staging; authenticate/decrypt and validate completely before the existing restore placement. Preserve existing fresh fiscal installation and working-time behavior. Cloud snapshot replacement, Cloud connection rebinding and new offline fiscal authorization are separate tracks. Never capture the private Cloud recovery files excluded in `docs/backlog/box.md` merely to make this pack work. Audit configuration-export contributions and verify that `backup.archive` and bucket secrets do not enter an ordinary configuration export.

## 3. Bounded transfers and independent outcomes

**Proposed defaults:** destination budget **15 minutes** for one upload plus its retention; status listing **30 seconds** per destination; cleanup **10 seconds** on a separate controller; transport idle limit **30 seconds**; SDK maximum **3 attempts**, including the first. `WAITRON_BACKUP_DESTINATION_TIMEOUT_MS` accepts 30 seconds to 24 hours. Restore download uses a separately specified transfer budget with the same 15-minute default. These are proposed budgets, not measured AWS latency guarantees.

Extend `StorageBackend` with a required `StorageCall { signal: AbortSignal }` argument on `put`, `putFile`, `get`, `getFile`, `list`, `delete` and `deleteMany`. Extend `ObjectStore` with optional `StoreCall { signal?: AbortSignal }` arguments, then trace and update production callers and test stores. Archive transfers use a separate file-capable S3 seam sharing the client, prefix validation and sanitized errors. Keep the small-object `ObjectStore.get` for stream metadata; never use it to read a whole archive. Its full body read still honors cancellation.

The outer controller covers SDK attempts, backoff, every page/batch, upload parts, download body and file writes. Forward `abortSignal` to `client.send`; destroy returned response streams on abort and use abort-aware pipeline/file iteration. Clearing a timer after headers is insufficient. Preserve 409 conditional-write retry semantics and 501-only batch-delete fallback, but make both stop on cancellation. A body that trickles forever and an endless sequence of individually fast pages both stop at the outer budget. Timer, SDK client, response body and file descriptors settle before the operation returns.

Extract `createBucketClient` and shared safe error conversion inside `@waitron/stream`. The archive adapter in `apps/server/src/s3-backend.ts` owns archive policy, not the generic stream store. Use AWS SDK commands already present in the workspace, with no new transfer dependency.

For uploads at most **8 MiB**, send a replayable file stream with a known content length. Larger archives use sequential multipart upload with part size `max(8 MiB, ceil(fileBytes / 10,000))`, capped at **64 MiB**. Reject a transfer needing more than 10,000 capped parts before opening an upload. This proposed ceiling is 625 GiB; it does not change the existing archive metadata budget (16 MiB, 4,096 entries). Buffer at most one part, never the whole database. Reopen the relevant file range for a retry. Complete only after every part succeeds.

On failed/cancelled multipart upload, abort the owned upload ID with the cleanup budget, independently of the cancelled transfer signal. For an uncertain complete/PUT answer, delete only that operation's newly minted object name; record an unresolved cleanup if this cannot finish. Never delete a previous archive to compensate. Downloads write a private temporary file and rename only after the complete body; remove partial output on failure. No destination sees the plaintext archive.

Mint archive keys with timestamp plus random UUID, e.g. `waitron-20261012T180000Z-<uuid>.backup.enc`. Parse the entire name, including a real date, before retention; sort by embedded timestamp and key for ties. This prevents retries or same-second runs overwriting another archive. No reader accepts new names by substring matching.

Create one destination controller per fan-out operation. A failed remote upload leaves the local result intact. Prune failure after successful upload is a maintenance failure, not lost upload success. Keep `archiveUnderCurrentKey`'s any-success meaning and add per-destination `storedUnderCurrentKey` and latest upload/prune failure. Label a local-only success as local; never show an off-box success until that bucket's upload finishes. Status returns a bounded failure per unavailable destination without hiding healthy siblings.

Stop/reload abort destination work and wait for settlement before closing its database handle or removing shared ciphertext staging. File creation and encryption check the sweep signal at chunk boundaries. Archive copying may still take local filesystem time; do not promise that cancellation interrupts an engine or filesystem call it cannot interrupt. Keep archive work outside sale transactions and `/health` dependency decisions. A focused boot test must run with an unavailable archive backend and make an actual sale and health request.

Off-box storage does not remove local staging costs: the existing snapshot and ciphertext coexist; restore needs ciphertext plus validated plaintext/database scratch. Use `statfs` for an advisory capacity check where supported, count the actual files at each phase, and handle `ENOSPC` without replacing a valid local archive or touching a live venue. Cleanup owns only this run's paths. Crash-left scratch sweeping and wider symlink races remain separate backlog items.

## 4. Backups-screen behavior

Extend the existing `backup-screen.ts` draft rather than adding a second saving form. Use shared field primitives, `draftScopeFor`, `saveActionState`, semantic input names and tokens. Save opens quiet/disabled until the draft changes; identical save handlers return early. Required fields show localized field errors and one bottom message above buttons. A bucket refusal does not permanently disable Save. Test waits quietly for a complete choice; explicit recovery-pack download is its own action.

For custom buckets, an empty secret field means **keep the held secret only when the existing bucket identity is unchanged**. Initial configuration or changed endpoint/region/bucket requires an entered secret. Null, an array and a coerced enum are refused. Saved passive reads update status without overwriting a draft; revision changes invalidate an old pack without resetting staged edits. Short-key recovery points to the existing key action when it can help, otherwise explains why an environment-managed key must change externally.

Verify EN/ES, both themes, 390 and 1280 widths, keyboard access and unsaved navigation. Retain existing local-only behavioral assertions. Do not imply that a green string/API test proves the screen rendered.

## 5. Actual and planned S3 calls

These are **source-reachable**, not a claim that every branch has executed. AWS's [API-to-policy map](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html) is the authority for permissions; API names and policy names differ. All selected calls below use S3 permissions. No IAM, STS, CloudWatch or KMS operation is planned.

| API | Current source / proposed use | Required S3 policy action |
| --- | --- | --- |
| `GetObject` | JS store `s3-store.ts:165`; Litestream replica client lines 651/1370/1400; proposed archive download | `s3:GetObject` |
| `PutObject` | JS store `s3-store.ts:187`; Litestream line 774 and uploader small-file path; proposed small archive/probe | `s3:PutObject` |
| `ListObjectsV2` | JS store `s3-store.ts:223`; Litestream paginator; proposed archive listing | `s3:ListBucket` |
| `DeleteObject`, `DeleteObjects` | JS store `s3-store.ts:155/260`; Litestream batch deletion lines 1144/1219; archive retention/cleanup | `s3:DeleteObject` for either API without version IDs |
| `HeadObject` | Litestream metadata path line 1491; optional owned-object cleanup check | `s3:GetObject` |
| `GetBucketLocation` | Litestream line 599, region lookup branch; explicit region should avoid needing that lookup in the rehearsal, to be observed | `s3:GetBucketLocation` |
| `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload` | Litestream's pinned uploader dependency; proposed large archive upload | `s3:PutObject` |
| `AbortMultipartUpload` | Pinned Go uploader failure path; proposed owned-upload cleanup | `s3:AbortMultipartUpload` |
| `CreateBucket`, `DeleteBucket` | Proposed rehearsal administration only | `s3:CreateBucket`, `s3:DeleteBucket` |
| `GetBucketPolicy`, `PutBucketPolicy`, `DeleteBucketPolicy` | Proposed denial experiment and reversal on the runner's bucket only | Corresponding `s3:*BucketPolicy` actions |
| `ListMultipartUploads` | Proposed teardown inventory of uploads on the owned bucket only | `s3:ListBucketMultipartUploads` |
| `GetBucketEncryption`, `GetBucketVersioning` | Proposed preflight on the owned bucket; refuse KMS/versioned setup | `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning` |

[Litestream v0.5.17 source](https://raw.githubusercontent.com/benbjohnson/litestream/v0.5.17/s3/replica_client.go) calls `uploader.Upload` at lines 749/783. Its [go.mod](https://raw.githubusercontent.com/benbjohnson/litestream/v0.5.17/go.mod) pins S3 manager **v1.20.18**. That [pinned uploader](https://raw.githubusercontent.com/aws/aws-sdk-go-v2/feature/s3/manager/v1.20.18/feature/s3/manager/upload.go) creates multipart uploads at line 600, uploads parts, completes at line 830 and attempts abort at line 809. Abort uses the upload context and can itself fail after cancellation. A live receipt must distinguish calls actually observed from these possible paths; AWS checks on tiny LTX files do not establish multipart behavior.

### AWS provenance, checked 2026-10-12

Quotes are short and literal; the interpretation is limited to the proposed general-purpose, unversioned S3 bucket.

| Official source and quotation | Meaning here |
| --- | --- |
| [Permissions map](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html): “Not every S3 API operation is represented by a single permission” | Use the policy actions above, including `DeleteObjects` to `s3:DeleteObject` and `HeadObject` to `s3:GetObject`. |
| [DeleteObjects API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html): “The request can contain a list of up to 1,000 keys” | Send batches at most 1,000, inspect per-key errors even on a successful HTTP answer. |
| [Default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html): “Buckets and new objects are encrypted by default with SSE-S3” | Propose default SSE-S3 for the new bucket, retaining Waitron's own archive encryption. A changed KMS configuration requires owner approval first. |
| [Pinned manager source](https://raw.githubusercontent.com/aws/aws-sdk-go-v2/feature/s3/manager/v1.20.18/feature/s3/manager/upload.go): “fail will abort the multipart unless LeavePartsOnError is set to true.” | This is a source path, not evidence of successful cleanup on AWS. Observe owned uploads at teardown. |

## 6. Opt-in Amazon S3 rehearsal

**Proposed command:** `pnpm --filter @waitron/server test:aws-rehearsal`. A separate config includes only `src/**/*.aws-rehearsal.test.ts`; normal local/CI configs explicitly exclude them. Without `WAITRON_RUN_AWS_REHEARSAL=1`, fail before reading credentials or making a network request. This is never enabled in default CI.

Use profile `waitron-rehearsal` at runtime with `AWS_SHARED_CREDENTIALS_FILE=~/.config/waitron-cloud/aws/credentials`, `AWS_CONFIG_FILE=~/.config/waitron-cloud/aws/config`, `AWS_PROFILE=waitron-rehearsal`, and the region-only value, currently `eu-north-1`. Resolve the static profile inside the runner, then inject it into JS and Litestream in memory. Do not assume product `BucketConfig` can load a profile or pass session tokens today. Reject unsupported temporary/session credentials without printing their values. No account-identity STS probe. The owner says the sandbox key permits S3 on `waitron-rehearsal-*` and expires **2026-11-03**; this has not been tested here.

Create exactly one fresh bucket named `waitron-rehearsal-waitron-<random>`, in the verified region, with no public ACL, versioning, Object Lock or KMS setting. Never reuse a supplied bucket or enumerate account-wide buckets. Record creation success and an ownership nonce before fixtures start. Refuse a collision. Lane D shares the account: its buckets, objects, policies and uploads are outside this runner's authority.

Use small synthetic venues and a **32 MiB** synthetic archive, at most **1,005** tiny batch-delete objects and a **128 MiB** total uploaded fixture budget. No real fiscal/customer data. Keep Litestream at its normal log level. Trace only a vetted request/outcome schema, never wire logging, credential-bearing URLs, raw SDK exceptions, headers or object bodies.

| Experiment | Required assertion and receipt |
| --- | --- |
| Real stream loop | Pinned Litestream streams A, B rebuilds with the existing kit, a new synthetic sale is in B's restored generation. Keep existing installation/chain assertions unedited; record pointer/upload/restore outcomes and durations. |
| Real pause listing | Use a runner-owned transport gate to hold only this fixture's calls, grow the file to its existing 16 MiB limit, observe pause/fold/resume; after release the real S3 listing and restored sale succeed. Preserve the local frozen-request latency control separately. |
| Real 403 | Put a reversible **bucket policy** denying only `s3:ListBucket` for `s3:prefix = <this-run's-venue-generation-level-prefix>*`. Do not deny root cleanup listing, policy removal, object deletion or other buckets. Run the real client and the paused supervisor's listing; require actual HTTP 403 and a sanitized AWS error name on the expected log path. Remove the policy and require the same listing to succeed before continuing. |
| Multi-object delete | Store 1,005 tiny objects in a dedicated owned prefix, observe batches of 1,000 and 5 with HTTP/per-key outcomes, then list zero remaining. AWS evidence settles AWS's support only; it does not exercise 501 fallback or establish other providers' answers. |
| Archive round trip | Upload the encrypted 32 MiB fixture through multipart, list it, download in bounded chunks, validate/decrypt to the expected synthetic content; wrong passphrase/tamper refuses before placement. A saved archive pack alone works without stream settings. |
| Owned failure cleanup | Abort an archive transfer through a runner gate after at least one actual part succeeds; require no completed object and no owned multipart upload after cleanup. Record any abort error without raw detail. |

A policy propagation wait polls the positive/negative controls under a fixed **60-second** experiment budget. If the full-access identity cannot be made to receive 403, the denial receipt is **unmeasured**, not passed using an injected error. Do not change IAM or try another lane's resources. Any proposed outside-S3 change goes to the owner before 17 October.

Use separate deterministic network tests for headers-then-stall, trickling bodies, slow pagination and production 30-second handler configuration. An AWS success duration is a measurement for one fixture, not a general bound or a diagnosis of A529's file growth.

Always run teardown, even after assertions fail or a controlled interruption: stop only recorded child PIDs; abort tracked uploads; remove the runner's temporary policy; list/delete every object in its **owned bucket**, then delete the bucket. The administrative cleanup controller has a proposed **2-minute** total budget and retries only its own operations. A failed cleanup makes the run fail and leaves a secret-free receipt of the exact remaining owned bucket/upload IDs, plus a constrained cleanup command. An unknown creation outcome is recorded and requires an ownership check before deletion; do not claim ownership merely from a prefix. Keep owned local fixture paths until the sanitized failure receipt is written, then clean them.

Receipts contain commit, Node/SDK/Litestream versions, UTC time, region, run ID, synthetic limits, API/operation, object role or synthetic count, HTTP status, vetted error name, attempt count and elapsed time. Include a teardown ledger and an **observed / source-only / not-exercised** action table. Keep sanitized durable receipts in `docs/receipts/a538/`; no pack, payload, credential file or raw log is committed. Retire only the exact measured backlog clauses after review; keep all broader provider, large-database, timing and recovery gaps.

## 7. Owner choices with proposed defaults

1. Approve an independent archive snapshot for “same bucket”, with `archives/<venueId>/` isolation, one bucket plus optional local copies?
2. Approve existing recovery-passphrase reuse and a separate downloadable secret archive pack? Changing it leaves older archives needing the old pack/key.
3. Approve 15-minute transfer/retention, 30-second status and 10-second cleanup defaults, configurable transfer budget, bounded multipart memory and the proposed transfer ceiling?
4. Approve the small S3-only rehearsal, including the temporary listing-only deny policy on its own disposable bucket? SSE-S3 is the default; no outside-S3 work is proposed.

All four remain unanswered. Build and rehearsal remain pending owner approval. _(2026-10-13: answered; see the status line.)_

## 8. Backlog source inventory and dispositions

The go-live source is quoted verbatim:

> an off-box home for the backup archive — the bucket stream of `venue.db` is built, but
> archives can only be saved on the box itself (`LocalFsBackend`);

The other included source paragraphs below are copied verbatim from the backup section at draft time. Inclusion means a planned change or experiment, not closure.

> **S3-compatible bucket, then Google Drive.** The bucket stream of `venue.db` is built (slice 2);
> the archive's S3 backend is not — only `LocalFsBackend` exists for archives. The abort-aware
> per-destination timeout lands with the first network backend.

> **Which real providers lack S3's multi-object delete, and what each answers, is not established;**
> a provider that refuses it with a status other than 501 fails the day's prune
> (`stream.prune_failed`). `probeBucket` deletes one object at a time, so it cannot reveal such a
> provider; having it delete its test object through `deleteMany` would. Left open by SQLite slice 2
> Task 5 (#569, `@waitron/stream`).

> **Nothing in the package has been run against a real provider's bucket:** the unit tests drive the
> real S3 client over a scripted network, and the loop test drives it against versitygw. Left open
> by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

> **A bucket read given up after five minutes is not cancelled,** because the bucket client's list
> takes no way to stop it; what the deadline can still leave running is a listing whose answer keeps
> arriving, or one whose answer stalls after headers that arrived within the first three seconds.
> Left open by SQLite slice 2 Task 7 (#619, how current the bucket copy is).

> **Task 8b** (#628, the Backups screen's bucket-copy panel). Open: the Backups screen's own card
> width is still a `34rem` literal, which the no-hardcoded-chrome rule forbids in a view and no
> guard reads; and a change of the secret access key alone, made in another tab, still leaves the
> old kit showing, because a settings read does not carry the secret. Left open by SQLite slice 2.

> **The bucket client's limits (A44, #676) — what is still open.** `createS3ObjectStore` gives a
> request up when it has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
> `packages/stream/src/s3-store.ts`).

> **That a real bucket's 403 to the pause's listing reads that code, and the status and `errorName`
> on each line, were shown by reading**, by the store's scripted HTTP answers and by the
> supervisor's injected errors, not against a real bucket. Left open by #668, #686, A57, A60 and
> #723 (the pause test and the bucket's error reports).

The included A44 detail in `docs/backlog/box.md` is also quoted in full:

> **The bucket client's limits (A44, #676) — what is still open.** `createS3ObjectStore` gives a
> request up when it has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
> `packages/stream/src/s3-store.ts`). An answer whose headers arrive within three seconds and whose
> body then stalls is not bounded; the deadline on the pause and the freshness read cannot cancel a
> listing whose answer keeps arriving; the idle limit is per request, not per call, so a listing of
> many pages, or a bucket answering each request just inside the limit, can take longer; a bucket that
> takes more than 30 seconds to answer a request whose body is already sent, such as a delete of 1,000
> keys, is cut off, and how long real providers take for one was not measured; and the tests run the
> handler's below-6,000 ms path, while its production path was measured by hand, not by a test.

The audit below covers every entry in the backup section mentioning real/bucket/Litestream/stream, plus related archive boundaries. Exact identifying text is quoted; **excluded** clauses stay open, even if the same entry contains an included clause.

| Quoted identifying text | Disposition and reason |
| --- | --- |
| “S3-compatible bucket, then Google Drive.” | Include S3/timeout; exclude Drive, a separate provider. |
| “Whole-state-volume capture” | Exclude capture redesign; preserve its explicit exclusions. |
| “Backup & restore — carry-forwards (B2)” | Exclude stale scratch, source routing and manifest redesign; test touched backend key boundaries without claiming BR-3 closed. |
| “a working-backup boot success-path integration test” | Include unavailable-network boot/sale/health integration only; successful full-backup boot carry-forward stays open. |
| “The remaining cold-restore operator surface” | Exclude connection/origin/authorization; archive retrieval feeds existing validation/placement. |
| “Reconsider the backup container against off-the-shelf tools” | Exclude archive-format reconsideration; retain WBA1/WBK1. |
| “Upgrade testing — blocking before go-live” | Exclude real older database/product-row migrations; AWS fixtures do not establish upgrade behavior. |
| “Automatic upgrades that can be undone until the first order” | Exclude updater/snapshots, including stream rollback coordination. |
| “Every migrating path but boot and the bucket rebuild” | Exclude ahead-of-image expansion; no new migrator path. |
| “What showing the failed start's reason” | Exclude staged real-migrator failure/logging work. |
| “The recovery page's secret bound” | Exclude general redaction redesign; touched errors/receipts must carry no secret. |
| “Shutdown closes the database even when stopping background work fails” | Exclude existing Litestream-stop failure case; archive cancellation gets its own checks. |
| “Two concurrent first provisions can still race past the venue guard” | Exclude real-database provisioning races; unrelated to archive storage or AWS evidence. |
| “resolveSafeEntryPath” | Exclude existing symlink-race changes; owned archive-download staging has a bounded cleanup contract. |
| “apps/server/src/errors.ts still cites CLAUDE.md §5” | Exclude unrelated historical comments/options; preserve key fingerprint decision. |
| “nothing proves startServer itself survives a backup duty that cannot start” | Include a new unavailable-backend boot/sale/health test; other clauses in that prose entry stay open. |
| “On a box that holds a key while backups are off because its venue failed to open” | Exclude recovery of an unopenable venue; test committed-settings/failed-reload distinction. |
| “The bucket copy panel's refusal for a too-short key” | Include touched field/action guidance; no general key recovery redesign. |
| “The status watcher does not retry its own failed mint” | Exclude retry policy; do not add passive POSTs. |
| “The edit-settings form can meet backup.recovery_key_exists” | Include preserving this refusal and draft; no automatic key replacement. |
| “rotate with a destination loaded rebuilds backup.env” | Include preserving all newly modeled loaded destinations; unloaded hand-edited settings behavior remains an owner decision. |
| “Which real providers lack S3's multi-object delete” | Include AWS batches and archive probe using deleteMany; exclude claims about other providers/fallback status. |
| “Nothing in the package has been run against a real provider's bucket” | Include measured AWS loop/pause/store/archive paths; keep not-exercised package paths explicit. |
| “Every synchronous deriveKey caller” | Exclude global KDF changes; retain existing asynchronous file path for archives. |
| “A pointer write from a process that has since died” | Exclude stale-writer/deleted-pointer conflict semantics. |
| “The server's 8-second shutdown stops the stream last” | Exclude large-database Litestream final-upload completeness. |
| “pnpm setup:litestream skips the download” | Exclude installed-binary checksum redesign. |
| “A bucket read given up after five minutes is not cancelled” | Include forwarding its controller through listing/body/SDK. |
| “A commit that changes no row but writes to the side file” | Exclude freshness accounting change. |
| “An update that writes the same value” | Exclude accounting semantics; retain existing assertion. |
| “The check that the side file changed was measured on the Mac's filesystem only” | Exclude Linux timestamp-tick measurement; AWS is not a box-filesystem test. |
| “A sale whose write transaction began before the supervisor first subscribed” | Exclude startup freshness accounting. |
| “Whether Litestream uploads anything while the side file is unchanged” | Exclude idle-upload measurement; rehearsal does not target it. |
| “Task 8a” | Exclude its dead-process pointer issue; settings integration follows existing turns. |
| “Task 8b” | Include touched card tokens and secret-change revision invalidation; quote above. |
| “When the key rename and the put-back both fail” | Exclude TLS atomic publication and missing endorsement assertion. |
| “pragma integrity_check is one blocking statement” | Exclude physical box-storage latency/watchdog measurement. |
| “An invalid staged marker, unreadable recovery key or unreadable stream entries” | Exclude restart recovery policy; archive download owns only its partial files. |
| “A copy with no tenants row” | Exclude tax-id confirmation/error redesign. |
| “An interrupted bucket rebuild or archive check leaves its scratch folder” | Exclude crash-left global sweep; include cleanup of this new transfer's partial files. |
| “A .venue.db-replaced- folder” | Exclude alternate startup cleanup. |
| “the first start's pointer read and the bucket rebuild's calls” | Include actual cancellation beneath existing 15/60-second limits; exclude changing those limits/codes. |
| “Whether a sale's write waited behind the server's fold-back” | Exclude proof of queue ordering and 256 MiB supervisor benchmark; retain existing synthetic sale assertions. |
| “Litestream at trace logging deadlocked sales for five seconds” | Exclude log-thread redesign; normal-level rehearsal cannot settle trace behavior. |
| “The bucket client's limits (A44, #676)” | Include deterministic whole-call/body/production-handler checks and measured AWS batch durations; exclude universal provider timing. |
| “The wizard route answers backup.stream_name_invalid 400” | Exclude shared status-code remapping; preserve current setup refusals. |
| “A batch delete's backup.stream_request_failed still carries the file's name” | Include safe logging regression check for touched error conversion; do not claim AWS success exercises a per-key error. |
| “That a real bucket's 403 to the pause's listing” | Include actual AWS denial and status/name receipts; versitygw's names stay unmeasured. |
| “A venue preparing to go live sends real email through SMTP” | Exclude real-email configuration/delivery; unrelated to archive storage or AWS evidence. |

A529's “Why the stream pause test's file growth differs between runs remains unexplained” is in the testing backlog, outside this source section. Reuse its diagnostics; AWS success does not identify that cause. No backlog gap closes in this docs-only change.

> 2026-10-13: A549 found the cause (Litestream's own checkpoints restarting the side file) and deleted that entry; the pause test now kills Litestream after the freeze and checks the side file is held ([testing-guide.md](../../developers/testing-guide.md), "Why the fill used to time out").
