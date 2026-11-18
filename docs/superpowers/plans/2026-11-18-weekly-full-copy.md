# WEEKLY-FULL-COPY — one full copy a week in the bucket copy, two weeks kept

Status: plan, 2026-11-18, lane B. Read once by a fresh-context Claude reviewer (2026-11-18); its
seven findings are folded in below.

**What a person gets when it lands.** A box streaming to a bucket uploads its whole database once a
week instead of once a day. For a year-old busy venue that is about 1.6 GB a day instead of 3.2 GB
(lane M's report, `~/waitron-campaign-m/reports/lean-backups-and-live-db.md`, "The
recommendation"), and the nightly window in which a slow line can fall behind (that report, "What
the daily full copy does besides using the line") comes seven times less often. A restore still
reaches the latest point; it downloads up to a week of change files on top of the full copy. The
full copy is timed by Litestream from Go's zero time (`compaction_level.go:33-35` at v0.5.18), a
Monday, so it lands at Monday 00:00 UTC: late Sunday night in Spain (computed, not run).

**Authority.** Owner, 2026-11-17 23:18 (picker, "Full copy"): "Weekly, two weeks kept
(Recommended)", replacing the 23 September decision "One full copy a day, and a 7-day history
window" (slice-2 design §0 item 9; that file was deleted in #711, the decision survives in git at
4e1033a120). Recorded in lane B's queue heading for this item. The owner also said to drop the hash
idea (same heading: "drop the hash part"); lane M's report answers it.

**Should this exist, and the simplest way.** Yes: two numbers in one config function. The only
thing that could make it wrong is a restore across a week of change files being much slower than
the bytes suggest, so that is measured first (step 1), and the change lands only if the figure is
acceptable (step 1 says what acceptable means). Nothing else is built. True size: about 4 changed
production lines across three files, their test pins, 2 probe lines, and about 6 documents. No
generated files.

## Step 1 — measure a restore after a week of change files (bench server, scratch only)

About 12 hours of the bench server, unattended.

Not a pull request. Results go into this plan as its receipt, and one line into
`docs/backlog/box.md`'s Decisions with the change.

- **Where.** The bench server `root@2.29.240.15`, a copy of lane J's year
  (`/srv/waitron-bench/a1544-j-20261116-2240`, 366 days, built at 30c1c1c564) in a folder of lane
  B's own; lane J's original is only read. A clone at 30c1c1c564 (main's schema no longer opens that
  year). Litestream 0.5.18, checksum checked against `scripts/setup-litestream.mjs`.
- **The database a real box would hold.** Empty print payloads older than seven days and
  `VACUUM INTO`, as lane M's M6 did (`tools/step6.sh`): about 3.3 GB. Put it, with its `node.db`,
  in the copy's `last-day/` so the bench resumes from it.
- **Pacing.** A scratch change in the clone only: `build-year.ts`'s existing `beforeBill` hook
  sleeps between bills so a day of 250 bills takes 60 real minutes (one bill every ~14 s); and the
  bench's end-of-day checkpoint is skipped entirely (`bench-venue.ts:215-217` at 30c1c1c564), not
  only its throw: a box truncates the write-ahead file only after stopping Litestream
  (`apps/server/src/stream-host.ts:406`), and a truncate under a running Litestream can make it
  write a whole-database change file (`db.go:1832-1839` at v0.5.18) that a box would not. Nothing of
  this lands: it only applies to the year's commit, and main cannot open that year.
- **Time compressed by 12.** A venue trades its day over about 12 hours, so one paced hour stands
  for one trading day, and Litestream's levels are divided by 12: level 1 every 2.5 s, level 2 every
  25 s, level 3 every 5 min (production: 30 s, 5 min, 1 h, Litestream's defaults, which Waitron does
  not set). That keeps about 12 level-3 files per trading day, as on a box. Snapshot interval and
  retention are set long enough that no second full copy is taken during the run.
- **The bucket.** A local S3 store (`versitygw`, as `scripts/setup-s3-test-server.mjs` installs it)
  in lane B's folder; Litestream writes to it unthrottled during the run. Restores read it through
  a small rate-limiting TCP proxy in the scratch folder, because restore opens up to 32 files at
  once and merges them in one pass (`replica.go:778-788`, `:851+`), which a local folder would not
  exercise.
- **Order.** Start Litestream on the idle trimmed database; wait for
  `snapshot complete` and the first level-3 file, so the full copy is not made while trading (the
  failure lane M's M8 met is a separate question, not in this item). Then trade 7 paced days (about 7.5
  hours with the nightly work). Stop Litestream cleanly.
- **Control.** After day 1, copy the bucket's folder aside (Litestream stopped for the copy, then
  restarted): a full copy plus one paced day.
- **What is recorded.** Files and bytes per level, listing every file over 50 MB; the restore plan
  from `litestream restore -dry-run` (`cmd/litestream/restore.go:35`) for the week and the control,
  with its file count and bytes. Each plan must hold exactly one whole-database-sized file, the
  level-9 full copy, and nothing written before it; otherwise the run is not a fair stand-in for a
  later weekly copy and is redone, not reported. Then `litestream restore` wall time for each, through
  the proxy unthrottled, at 20 Mbit/s, and (the week only) at 5 Mbit/s, each stopped as Waitron
  stops one: no growth in the output for 2 minutes, or 6 hours in all
  (`packages/stream/src/restore.ts:16,19`). `pragma quick_check` and the sales count of each result
  against the live database's.
- **Pass, and what failing looks like.** Take the control's rate (its unthrottled seconds over the
  bytes in its plan). The week passes if, unthrottled, it takes no more than twice its plan's bytes
  at that rate, and at 20 Mbit/s no more than about 15 minutes beyond the control (the owner was told
  "about nine more minutes on a 20 Mbit/s line", lane M's report, question 2), and at 5 Mbit/s it
  finishes inside the 6 hours. If merging many small files costs more than their bytes, the first
  test fails; if the files download slowly in parallel, the second does. Both outcomes are possible
  before the run.

## Step 2 — the change (one pull request, full review path: recovery data)

Lands only if step 1 passes. Otherwise the figures go to the watcher before anything changes.

- `packages/stream/src/litestream.ts`: `interval: 168h`, `retention: 335h`; the doc comment's
  "One full copy a day and a week of history" becomes the weekly words. Retention must exceed the
  interval: with both at 168 h Litestream deletes the previous full copy as soon as the next lands
  (`db.go:3096-3108`, `store.go:617-620` at v0.5.18: retention is applied just after a new full copy
  and keeps at least one). 335 h, not 336 h, so the copy from two weeks before is always gone when the
  third lands, whatever the uploads took; the bucket then holds two full copies and reaches back
  between one and two weeks. (Exactly 336 h leaves it to the upload times whether a third copy stays.)
- The week of history is written in two more places, which move with it so the bucket copy has one
  window: `packages/stream/src/supervisor.ts:151-152` (`PRUNE_WINDOW_MS`, an old generation deleted
  after a week untouched) and `apps/server/src/backup-recovery-pack-status.ts:6` (`BUCKET_COPY_KEEP`,
  how long a pack under an older key still opens the bucket copy; a key change opens a new
  generation, `stream-host.ts:509`). Both become two weeks (336 h; generations are not timed by
  Litestream's boundaries). Trace every consumer of each before changing it (`.test.ts:381` pins
  the second), and if either has its own reason for a week, keep it and say why in the PR.
- Test first: `packages/stream/src/litestream.test.ts:53-54` pins the two lines; change them to the
  new values and watch them fail before the source changes (a check the owner's decision changes,
  listed under "Changed test checks" in the PR).
- `bench/sqlite-failover/src/probes/restore-time.ts:44-45` and the description at
  `bench/sqlite-failover/src/probes/restore-points.ts:3`: the production values and their words.
- Documents: a dated pointer under the topology design's 2026-09-25 pointer
  (`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md:542`); the changed
  decision, with the owner's words and step 1's figures, in `docs/backlog/box.md` → Decisions and
  deliberate limits. The privacy guide says "the bucket copy keeps a week of history"
  (`apps/server/src/guide/en/data-protection.md:397`, `es/data-protection.md:432`): it becomes two
  weeks, in both. Dated pointers, not rewrites, in
  `docs/superpowers/specs/2026-10-22-a980-data-protection-design.md:246` and
  `docs/compliance/research/2026-11-06-adviser-privacy.md:190`. Then grep `apps/server/src/guide/`,
  the dashboard's Backups strings (EN and ES), `packages/stream`, `apps/server/src` and `docs/` for
  "a day", "daily", "week", "7 days", "168" near the bucket copy and correct what is now false.
- The spare follows with the same configuration (`packages/stream/src/follow.ts:52-56`), so its
  catch-up from scratch also reads up to a week of change files; say so in the box.md decision.
- Checks: `pnpm --filter @waitron/stream exec vitest run src/litestream.test.ts`; the stream
  loop/pause suites run in CI (they need the Litestream and versitygw binaries).

## Not in this item

The slow-line probe (a full copy over a slow line while trading): the owner did not ask for it and
it decides nothing here; as written it could not run either (`-force-snapshot` needs `-once`,
`cmd/litestream/replicate.go:261-262`). It goes in the pull request thread as a follow-up. The hash idea (answered by lane M: the pieces change daily). Fewer merge levels (lane M's
follow-up measurement). Ordered ids and bench housekeeping (lane M's plan items 2 and 3, other
lanes). Cloud's backup (lanes J and G).
