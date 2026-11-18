# WEEKLY-FULL-COPY — one full copy a week in the bucket copy, two weeks kept

Status: step 1 was measured on 2026-11-18 and passed its three tests (results under step 1); step 2
is the pull request that carries this line. Plan by lane B, read once by a fresh-context Claude
reviewer (2026-11-18); its seven findings are folded in below.

**What a person gets when it lands.** A box streaming to a bucket uploads its whole database once a
week instead of once a day. For a year-old busy venue that is about 1.6 GB a day instead of 3.2 GB
(lane M's report, `~/waitron-campaign-m/reports/lean-backups-and-live-db.md`, "The
recommendation"), and the nightly window in which a slow line can fall behind (that report, "What
the daily full copy does besides using the line") comes seven times less often. A restore still
reaches the latest point; it downloads up to a week of change files on top of the full copy. The
full copy is timed by Litestream from Go's zero time (`compaction_level.go:33-35` at v0.5.18), a
Monday, so it lands at Monday 00:00 UTC, which is 01:00 or 02:00 on Monday in mainland Spain
(computed, not run).

**Authority.** Owner, 2026-11-17 23:18 (picker, "Full copy"): "Weekly, two weeks kept
(Recommended)", replacing the 23 September decision "One full copy a day, and a 7-day history
window" (slice-2 design §0 item 9; that file was deleted in #711, the decision survives in git at
4e1033a120). Recorded in lane B's queue heading for this item. The hash idea is not part of
this item: lane M's report answers it and recommends dropping it ("Drop from the item: its part
(2), the hash idea"), and the owner set content-named pieces aside to revisit later (17 November
2026, 23:16 and 23:19, `docs/backlog/setup.md`).

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

### Step 1 results (run 2026-11-18, 01:51 to 11:20 CET)

One run of each restore, on the bench server. The run's scripts, logs and `results.md` are kept
outside the repository, in lane B's campaign folder (`receipts/weekly-full-copy-20261118/`); each
figure in `results.md` sits beside the command that produced it.

**What was run.** Lane J's 366-day year at 30c1c1c564 with print payloads older than seven days
emptied, compacted: 3,297,202,176 bytes. Litestream 0.5.18 against versitygw 1.8.0, levels at
2.5 s, 25 s and 5 min. Seven paced days of 250 bills, one bill about every 14.4 s (the first day
16.5 s). The full copy was 1,916,395,730 bytes as Litestream stores it. Litestream logged no warning
or error in any of its runs. Lane J's year was unchanged afterwards (every file's size and time
compared).

**The restore plans** (`litestream restore -dry-run`). Each holds one full copy and nothing written
before it.

| Restore from             | Files | Bytes         | Of which change files                |
| ------------------------ | ----- | ------------- | ------------------------------------ |
| the full copy + one day  | 15    | 2,351,899,510 | 14 files, 435,503,780 bytes          |
| the full copy + the week | 88    | 3,660,881,982 | 87 files, 1,744,486,252 bytes        |

**The restores** (`litestream restore`, wall time). Every result passed `pragma quick_check` and
held the same number of sales as the live database at that point (91,750 after one day, 93,250
after the week).

| Line        | Full copy + one day | Full copy + the week |
| ----------- | ------------------- | -------------------- |
| unthrottled | 17.1 s              | 21.1 s               |
| 20 Mbit/s   | 947.7 s (15.8 min)  | 1,471.8 s (24.5 min) |
| 5 Mbit/s    | not run             | 5,878.9 s (98.0 min) |

**The three tests.**

- Unthrottled: the one-day restore took 7.272 s per GB of its plan; twice the week's plan at that
  rate is 53.2 s; the week took 21.1 s. Pass.
- At 20 Mbit/s the week took 8.7 minutes longer than the one-day restore, against a limit of about
  15 and the "about nine more minutes" the owner was told. Pass.
- At 5 Mbit/s the week finished in 98 minutes, inside the 6 hours, and was never stopped by the
  2-minute no-growth rule. Pass.

On the throttled lines each restore took within 22 seconds of its plan's bytes divided by the line's
rate (for the week at 20 Mbit/s, 1,464.4 s computed against 1,471.8 s measured), so on this machine
the download decided the time.

**Where the run differed from the plan above.**

- Two full copies were taken on the idle database before trading, not one. Litestream's own first
  change after its first full copy left a whole-database file at level 3, so a second full copy was
  taken past it. Both restore plans start from the second and hold nothing older.
- The local bucket was not given the customer-held encryption key production sets
  (`sse-customer-key`, `packages/stream/src/litestream.ts`), so the bucket encrypting and decrypting
  each file was not part of the measurement.
- Litestream's working files were kept outside the bench's folder.

**What the run does not show.**

- A box's processor and disk. The restores ran on the bench server (32 cores, shared with other
  virtual machines). The unthrottled figures are the whole cost of merging there, 21 s for the week;
  a box would take longer by an amount not measured.
- A restore while the venue trades.
- A real line: the proxy shares one download rate between all connections and adds no delay or
  loss.
- A week at real speed: time was compressed by 12, as planned.

## Step 2 — the change (one pull request, full review path: recovery data)

Lands only if step 1 passes. Otherwise the figures go to the watcher before anything changes.

- `packages/stream/src/litestream.ts`: `interval: 168h`, `retention: 335h`; the doc comment's
  "One full copy a day and a week of history" becomes the weekly words. Retention must exceed the
  interval: with both at 168 h Litestream deletes the previous full copy as soon as the next lands
  (`db.go:3096-3108`, `store.go:617-620` at v0.5.18: retention is applied just after a new full copy
  and keeps at least one). 335 h, not 336 h, leaves an hour's margin for the copy from two weeks
  before to be past retention when a new one lands. (Exactly 336 h leaves it to the upload times
  whether a third copy stays.) How many copies the bucket then holds is under "What the review's run
  of Litestream showed" below.
- The week of history is written in two more places, which move with it so the bucket copy has one
  window: `packages/stream/src/supervisor.ts:151-152` (`PRUNE_WINDOW_MS`, an old generation deleted
  after a week untouched) and `apps/server/src/backup-recovery-pack-status.ts:6` (`BUCKET_COPY_KEEP`,
  how long a pack under an older key still opens the bucket copy; a key change opens a new
  generation, `stream-host.ts:509`). Both become two weeks (336 h; generations are not timed by
  Litestream's boundaries). Trace every consumer of each before changing it (`.test.ts:381` pins
  the second), and if either has its own reason for a week, keep it and say why in the PR.
  **2026-11-18, at review:** both stay at a week; the reasons are under "What the review's run of
  Litestream showed" below.
- Test first: `packages/stream/src/litestream.test.ts:53-54` pins the two lines; change them to the
  new values and watch them fail before the source changes (a check the owner's decision changes,
  listed under "Changed test checks" in the PR).
- `bench/sqlite-failover/src/probes/restore-time.ts:44-45` and the description at
  `bench/sqlite-failover/src/probes/restore-points.ts:3`: the production values and their words.
- Documents: a dated pointer under the topology design's 2026-09-25 pointer
  (`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md:542`); the changed
  decision, with the owner's words and step 1's figures, in `docs/backlog/box.md` → Decisions and
  deliberate limits. The privacy guide says "the bucket copy keeps a week of history"
  (`apps/server/src/guide/en/data-protection.md:397`, `es/data-protection.md:432`): it becomes the
  period worked out under "What the review's run of Litestream showed" below, in both. Dated pointers, not rewrites, in
  `docs/superpowers/specs/2026-10-22-a980-data-protection-design.md:246` and
  `docs/compliance/research/2026-11-06-adviser-privacy.md:190`. Then grep `apps/server/src/guide/`,
  the dashboard's Backups strings (EN and ES), `packages/stream`, `apps/server/src` and `docs/` for
  "a day", "daily", "week", "7 days", "168" near the bucket copy and correct what is now false.
- The spare follows with the same configuration (`packages/stream/src/follow.ts:52-56`), so its
  catch-up from scratch also reads up to a week of change files; say so in the box.md decision.
- Checks: `pnpm --filter @waitron/stream exec vitest run src/litestream.test.ts`; the stream
  loop/pause suites run in CI (they need the Litestream and versitygw binaries).

### What the review's run of Litestream showed (2026-11-18)

The run-it review of this change ran the pinned Litestream 0.5.18 against versitygw 1.8.0 on a
compressed schedule: 16.8 s for the week, 33.5 s kept, six full copies, with a control keeping
16.8 s. The real values were not run. Its two reports are kept beside the measurement's record, in
lane B's campaign folder (`receipts/weekly-full-copy-20261118/`).

- The bucket held 1, 2, 3, 2, 2 and 2 full copies after each of the six; the control held 1, 2, 1,
  1, 1 and 1. A generation's first copy is made when it opens, not on the boundary, so in the run it
  was not yet past retention at the third copy and went at the fourth. From a generation's fourth
  full copy (its third Monday one) it holds two full copies, the older one to two weeks old; before
  that, up to three copies, the oldest up to three weeks old.
- Litestream also applies retention when it starts: restarted after its retention had passed, it
  deleted the older of two full copies without taking a new one.
- At the end of each run, and after the restart, a restore to the latest point returned every row
  (290 of 290, `quick_check` ok).
- Run while finishing the branch: `litestream databases -config` refuses `retention: 14d`
  (`cannot unmarshal !!str 14d into time.Duration`) and accepts `335h` and `1206000s`.
- Computed, not run: each start of the box opens a new generation
  (`packages/stream/src/supervisor.ts`, `#open`), and the one it leaves is deleted by the first
  daily sweep more than 168 h after its last upload (`PRUNE_WINDOW_MS`). Litestream keeps change
  files back to the last full copy it deleted (`db.go:3110-3120`), so a generation holds up to three
  weeks of data. Data can therefore stay in the bucket about four weeks: up to three in a
  generation, then 7 to 8 days, when every Monday's copy and clean-up succeed; a missed one is not
  tried again until the next Monday and adds a week (`store.go:598-646`, read).

**The two other windows stay at a week.** Step 2 moved `PRUNE_WINDOW_MS` and `BUCKET_COPY_KEEP` to
two weeks unless either had its own reason for a week. Two were found while finishing the branch,
by the reviewers who asked whether the two changes should exist; the first run-it report had found
none. At two weeks, data
would stay in the bucket about five weeks, past the 30 days adviser question P4 proposes
(`docs/compliance/2026-11-06-adviser-questions.md`). And in the Backups screen's starting setup
(the newest 7, daily) the bucket's two weeks, not the archives' eight days, would set the date
beside "Keep pack", which that sentence explains by the archives. Neither window changes how far
back a restore can reach in the generation the box is writing. Both are as they were.

## Not in this item

The slow-line probe (a full copy over a slow line while trading): the owner did not ask for it and
it decides nothing here; as written it could not run either (`-force-snapshot` needs `-once`,
`cmd/litestream/replicate.go:261-262`). It goes in the pull request thread as a follow-up. The hash idea (answered by lane M: the pieces change daily). Fewer merge levels (lane M's
follow-up measurement). Ordered ids and bench housekeeping (lane M's plan items 2 and 3, other
lanes). Cloud's backup (lanes J and G).
