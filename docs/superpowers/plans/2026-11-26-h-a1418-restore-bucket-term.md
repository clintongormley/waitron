# A1418 slice 2 — order a restored box above its bucket

After restoring onto a replacement box, its first startup can publish backups with a membership
term (the number that orders changes of primary) above both the bucket's current pointer and any
newer generation already visible there. A previous writer may have opened that generation before
it published a new pointer. This gives the later replacement check a newer term to compare.

[Owner-approved design, §3](../specs/2026-11-07-a1418-box-stop-intent-design.md) ·
[November 7 plan, Task 6 and Decision 12](2026-11-07-a1418-part-1-stop-marks.md) ·
[Lane H slices](2026-11-26-h-a1418-box-stop-intent.md)

## One change to first startup after restore

- [ ] Start with failing cases in `apps/server/src/rebuild-first-start.test.ts`. Use its existing
  venue DB and memory store. With restored term 0, pointer 5 and a generation at 7 holding only
  its opened marker, run `completeRebuild` with the real bucket reader and assert saved term 8.
  Check a generation with no pointer still gives the floor, and a folder that fails the existing
  generation-name parser is ignored. Keep the existing pointer-only, no-bucket and restored-term
  assertions. Add a silent list case that checks both the deadline and cancellation, and a
  maximum safe integer generation that cannot supply a usable floor. Check that a refused list
  leaves first start pending and streaming disabled through `runFirstStart`.
- [ ] In `apps/server/src/rebuild-first-start.ts`, use `readBucketTerm(db, ring, options)` with the
  current reader's signature and change the injected dependency and the `boot.ts` caller to
  `bucketTerm`. Within the existing single 15-second deadline, read the pointer for this stream,
  then list `gen-` through the configured store. Its list already follows every page and returns
  keys relative to the configured prefix. Use `parseGenerationName` on each key's first folder
  and take the highest term across both reads. A valid folder name supplies an ordering floor
  without authorising a replacement verdict. Return null when both reads have no term. Treat a
  floor at or above `Number.MAX_SAFE_INTEGER - 1` as an unreadable floor via the existing
  first-start failure path. Reuse the same abort signal for both reads and the existing
  `minTerm: bucketTerm + 1` minting and save path.
- [ ] Preserve the existing response to an unreadable bucket. The restore stays pending and
  streaming stays off until a later start can finish it. This slice leaves sales and filing
  admission where they are today, per the watcher's 13:03 note. A hold on sales or filing, an
  administrator override, replacement detection, and signed claims are separate decisions.
  Update the A1418 backlog paragraph when the floor ships.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/rebuild-first-start.test.ts` before and
  after the implementation. Run the unedited fiscal write-path and immutability suites, the
  Server published-menu suite and the Till menu-refresh suite. Use the verified first-start
  outcome in the review brief. Estimate 35–55 added product lines and 65–105 added test lines.

Verification covers the highest term observed during these two reads. A concurrent writer can
open another generation after the listing, and an offline writer can have a term absent from the
bucket. Nothing here proves that either writer has stopped.
