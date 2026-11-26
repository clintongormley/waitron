# A1418 slice 2 — order a restored box above its bucket

On its first start, a restored box takes a membership term (the number that orders changes of
primary) above the largest term it reads in its own chart and its backup bucket. A writer may
have opened a higher generation before publishing a new pointer. Once the restored box publishes
its pointer, the existing stream supervisor refuses to replace it from a lower term.

[Owner-approved design, §3](../specs/2026-11-07-a1418-box-stop-intent-design.md) ·
[November 7 draft, Task 6](2026-11-07-a1418-part-1-stop-marks.md) ·
[Lane H slices](2026-11-26-h-a1418-box-stop-intent.md)

## One change to first startup after restore

- [x] Start with failing tests in `apps/server/src/rebuild-first-start.test.ts`, using its venue DB
  and memory object store. With restored term 0, pointer 5 and a generation at 7 holding only
  its opened marker, run `completeRebuild` with the real bucket reader and assert saved term 8.
  Check that the highest valid generation with no pointer still supplies the floor. Keep the
  pointer-only, no-bucket and restored-term cases. A stalled list must time out and receive
  cancellation. A refused list through the
  real reader and `runFirstStart` leaves the term and restore record in place, with `mayStream: false`.
- [x] Change `readBucketPointerTerm` in `apps/server/src/rebuild-first-start.ts` to `readBucketTerm`
  with the same arguments. Rename the injected dependency and its `boot.ts` caller to
  `bucketTerm`. Read the pointer then list generation folders under `gen-` within the existing
  15-second deadline, using one abort signal. The S3 store uses a slash delimiter and returns
  child folder names relative to the configured root, across all pages. Run `parseGenerationName`
  over those names and use the highest term through `minTerm: bucketTerm + 1`. Return null when
  neither source names a term.
  The watcher cleared the folder-only read on 26 November at 15:01 after the full file listing
  hit the deadline in an 80,000-file simulation. Test prefix, pagination, stray objects and
  incomplete answers in `packages/stream/src/s3-store.test.ts`. Re-run the simulation with
  the real S3 client and the folder listing.
- [x] Reject floors at or above `Number.MAX_SAFE_INTEGER - 1` with `restore.bucket_term_invalid`
  in `apps/server/src/errors.ts`. Check that a generation at MAX−1 is refused. Apply the existing
  first-start failure path to this error in place of the November 7 draft's hard refusal to start.
  The failure log names the reason, the term and
  restore record stay in place, and streaming stays off. The unusable bucket contents need
  correction before a subsequent restart can finish the restore.
- [x] Run `pnpm --filter @waitron/server exec vitest run src/rebuild-first-start.test.ts` before and
  after the change. Re-run the unreachable-bucket case in `boot.restore.test.ts` and the
  continuation-token case in `packages/stream/src/s3-store.test.ts` for prefix and page handling.
  The watcher waived the fiscal and menu suites locally at 14:46 on 26 November. The PR reports
  the saved term and the failed-list startup behavior. The A1418 backlog paragraph records the
  floor. Estimate 35–60 product lines and
  75–115 test lines.

The read covers the owner's configured bucket. Paired streaming still uses the spare's store.
A timeout or refusal leaves streaming off until a later restart and leaves the restored term
as it was. The existing sales and filing admission rules still apply, per the watcher’s 13:03
note. Replacement detection, signed claims, and a sales hold or administrator override are
outside this slice. The reads cover observed terms. A later generation or one created by an
offline box may be unseen.
