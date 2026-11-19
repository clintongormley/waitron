# A1531: moving old finished records out of the live database

**Status: design for the owner's decision. No product code. Dated 2026-11-14; revised the same day
after a fresh-context review.**

## What this lets the venue do, and what I recommend

You asked for a way to move old, finished records out of the box's live database so that it
takes less space and new sales stay fast, while the old records stay readable. Five minutes
later you added the idea that a closed year, written once as one compressed file, would be the
same in every backup, so the backups, the copy streamed to the storage bucket and the spare box
would carry it once and afterwards only refer to it.

I measured both aims before designing for them. My recommendation is **not to build the archive
of fiscal records now**, and to do three smaller things instead:

1. **A1533, the compressed backups**, landed as #3245 (a4a4a425b3) while this design was reviewed. On the 30-day sample it turns a
   676.8 MB backup into 144.2 MB.
2. **Open one new item to trim finished working rows**, the way A1532 trimmed print payloads. After
   A1532, the tables that are neither append-only (append-only means the database refuses any change
   or removal of a row once it is written) nor print jobs hold 56% of the database: attendance
   and service bookkeeping 38%, and order, kitchen-ticket and attendance-question working rows
   another 18%. The fiscal records you were thinking of hold 1.3%; all append-only tables together
   hold 10%.
3. **Decide separately how to stop carrying unchanged history every time.** Even after 1 and 2,
   every backup, every daily full copy to the bucket and every handover copy still carries the
   whole history. Two cheaper routes than an archive exist (open question 1); both are unmeasured.

On speed: while the busy parts of the database fit in the box's memory, a year of history makes
a write only about 10% slower, about 0.04 ms. When I squeezed the memory available to the test,
the same write became about twice as slow and a read by key about twenty times slower. The
installer plan's hardware floor is 8 GB of memory; a year of this database is about 6.1 GB, so it
would outgrow that memory during its second year. Whether the sale then slows down is **not
measured**, and measuring it properly on the bench takes about a day of build time. The top
recommendation does not change, because most of what grows is the working rows of point 2, not
the immutable records an archive would move, but this open measurement is the one that could change
it.

The archive itself, which moves append-only fiscal, sale and working-time rows into a sealed file
per closed year, is designed below so its costs are visible. It cannot be built without dropping
and recreating the append-only protection on every box, which needs your explicit permission and the
advisers' answer to Q48, and several of A664's requirements for it are still open.

| What | Figure |
| --- | --- |
| 30 days at 250 bills a day, after A1532, compact copy of the database | 676,794,368 bytes |
| The same 30 days as an encrypted backup with A1533's gzip (PR #3245) | 144,176,735 bytes |
| A year at that rate, estimated without the constant week of print payloads | about 6.1 GB live, about 1.3 GB per compressed backup |
| All 49 append-only tables, share of the 30-day database's used space | 10.2% (77.7 MB) |
| Fiscal records (`registros_facturacion`) with their indexes | 1.31% (9.97 MB) |
| Attendance bookkeeping plus service command results | 38.3% (291.1 MB) |
| Other working tables, not append-only and not print jobs | 18.1% (138.0 MB) |
| A 10-row write, year of rows against month, memory not limited | 0.47 ms against 0.43 ms |
| The same, container limited to 112 MB of memory | 0.72 to 0.77 ms against 0.34 to 0.36 ms |

## Should this exist?

**The need.** In your words: "we probably want a way to archive off older immutable data so that
(1) it takes less space and (2) the live writes remain faster. the old data still needs to be
accessible" (2026-11-14 16:43), and "archiving or compressing could help in another way though. if
last year's data is immutable and compressed into (eg) one big file, then that file would be the
same across backups, which mean we don't need to sync it over every time" (16:48). Both are
recorded in lane L's queue (`~/waitron-campaign-l/queue.md:125` and `:128`).

**What you could use once the recommendation lands.** Smaller backups (A1533), and a database that
grows more slowly (the trim). **What would still be missing:** each copy would still carry all of
the history every time, until open question 1 is decided; and the old fiscal records, about 120 MB
a year, would stay in the live database.

**The simplest thing that meets the need** is the three steps above. Building the fiscal archive
on top would add a new kind of file to backups, restores, the bucket stream, the spare and the
handover copy, change the append-only protection, and add a second place every report and
inspector export must read. That is a large, permanent cost for about 15% of the database.

**Size of this change:** one new document, no code, no generated files.

**Approval.** No design here is approved.

## What fills the database now

Lane J built 30 days of trading at 250 bills a day on the pinned bench (revision `95e668a747`,
Node 26.13.0, SQLite 3.54.0) and measured every table with SQLite's built-in page counter
(`dbstat`, which says how many bytes each table and index uses).

**Before A1532** the database was 1,296,785,408 bytes and print jobs were 60.9% of it with their
indexes (`~/waitron-campaign-j/receipts/large-backup-restore-20261114/storage-breakdown.md`).
Those shares are no longer today's.

**After A1532**, which empties a print job's payload once it is a week old, lane J measured the
same sample again (`~/waitron-campaign-j/receipts/a1532-print-payload-20261114/dbstat-after.json`).
The file stays the same size until it is compacted, so **the shares below are of the 760,717,312
bytes still in use**, not of the whole file (the other 130,875 pages are free). The year estimate
further down starts instead from the 676,794,368-byte compact copy, which is the same data with
the free space squeezed out. I grouped each table with its indexes:

```sh
jq -r '.allocatedBytes as $a | [.objects[] | {t:.tableName, b:.bytes}] | group_by(.t)
  | map({t:.[0].t, b:(map(.b)|add)}) | sort_by(-.b) | .[:30][]
  | "\(.t)\t\(.b)\t\((.b*10000/$a|floor)/100)%"' dbstat-after.json
```

| Table, with its indexes | Bytes | Share | Kind |
| --- | ---: | ---: | --- |
| `print_jobs` | 253,878,272 | 33.37% | working table; payloads older than a week now emptied |
| `attendance_source_state` | 151,552,000 | 19.92% | attendance processing bookkeeping |
| `attendance_operation_facts` | 102,330,368 | 13.45% | attendance processing bookkeeping |
| `service_commands` | 37,236,736 | 4.89% | the recorded result of each service command |
| `working_order_lines` | 21,331,968 | 2.80% | order lines in flight |
| `ticket_items` | 20,070,400 | 2.63% | kitchen tickets |
| `sale_lines` | 16,883,712 | 2.21% | append-only |
| `attendance_questions` | 13,836,288 | 1.81% | attendance questions to staff |
| `order_draft_events` | 12,820,480 | 1.68% | append-only |
| `kitchen_print_jobs` | 12,709,888 | 1.67% | kitchen print jobs |
| `working_line_contexts` | 12,697,600 | 1.66% | order line working state |
| `kitchen_print_job_lines` | 10,989,568 | 1.44% | kitchen print job lines |
| `registros_facturacion` | 9,965,568 | 1.31% | append-only fiscal records |
| Every other table that is neither append-only nor print jobs | 46,354,432 | 6.09% | |

Four things follow.

**Print jobs are now a constant, not a growth.** Of the 253.9 MB, 60.1 MB is empty space inside
pages, and the stored content is 185.9 MB, about the last week's payloads (7/30 of the original
782.8 MB is 182.7 MB). In a year it stays about the same size, so a linear "times 12" overstates
the year. Lane J's linear estimate is 8,122,690,860 bytes (`size-after.json`); taking the week of
payloads out of the multiplication gives (676,794,368 − 185,854,113) × 12 + 185,854,113 =
**6,077,137,173 bytes, about 6.1 GB**. This is my derivation, not a measurement: it treats the whole
of `print_jobs`' stored content as the week of payloads, which slightly undercounts the emptied
rows that remain, and it assumes the other tables grow in a straight line.

**The immutable records are small.** I listed every table declared append-only in the five
modules' `classification.ts` files (49 tables; the same count as `packages/migrations/migrations.manifest.json`'s
append-only lists) and summed them from the same file: 77.7 MB, **10.2%**, about 0.93 GB a year,
about 15% of the year estimate. The largest are `sale_lines` (16.9 MB), `order_draft_events`
(12.8 MB), `registros_facturacion` (10.0 MB), `sale_line_portions` (9.4 MB) and
`order_group_events` (9.4 MB).

**What actually grows is attendance and service bookkeeping.** `attendance_source_state`,
`attendance_operation_facts` and `service_commands` together are 291.1 MB a month, **38.3%** of
the used space. None is append-only: the workforce module classifies the attendance tables as
"attendance processing, questions and delivery state; copied with the venue"
(`packages/workforce/src/classification.ts:28-38`), and core classifies `service_commands` as
"the recorded result of each service command and a bill's server-written made_here replay row"
(`packages/db/src/classification.ts:217-221`). The 30-day sample holds 252,595 rows of
`attendance_source_state`, about 8,400 a day, for 8 seeded staff
(`~/waitron-campaign-j/receipts/large-backup-restore-20261114/attendance-summary.json`).

**Other working rows are another 18.1%** (137,990,144 bytes): order lines, kitchen tickets,
attendance questions, kitchen print jobs and their lines, and smaller tables. They carry no
append-only triggers either (for example `ticket_items` at `packages/db/src/classification.ts:68`,
`working_order_lines` at `:175`, `kitchen_print_jobs` at `:207`; `attendance_questions` in the
workforce list above). That is more than all the append-only tables together.

I have not established which of these working rows are finished machinery and which are evidence
of what happened; that is the first job of the item I recommend. One caveat applies to all of
this: the bench's venue is synthetic. Its staff count, its attendance rows per bill and its print
volume are the bench profile's, not a real restaurant's.

## What A1532 and A1533 already solve, and what they leave

**A1532** (landed as #3222) cut the 30-day compact copy from 1,268,367,360 to 676,794,368 bytes
(`size-before.json`, `size-after.json` in the A1532 receipts), and it stops print payloads growing
with time.

**A1533** landed as #3245 (a4a4a425b3). On the retained 30-day sample it measured encrypted backups falling
"from **676,798,984 to 144,176,735 bytes** (about 79% smaller). Capture took 13.77 → 18.27 seconds;
data-only restore took 4.98 → 6.83 seconds" (the PR's description, read with `gh pr view 3245`). It
chose gzip over zstd ([2026-11-14-a1533-compressed-backups.md](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1533-compressed-backups.md), step 1). At
the same ratio the year's 6.1 GB would back up to about 1.3 GB; that ratio on a year is an
assumption.

**What neither touches: every copy still carries all the history, every time.** A1533 leaves the
bucket stream out (its "Limits and size" paragraph: "Litestream, Cloud capture, A664, schema and
streamed uploads stay out"). The bucket stream is Litestream, a program that copies every change of
`venue.db` to object storage. It is configured to take one full copy a day and keep a week
(`packages/stream/src/litestream.ts:88-90`: `interval: 24h`, `retention: 168h`). With a 6.1 GB
database that is a full copy of up to 6.1 GB every day, and about seven of them held in the bucket;
I have not established whether Litestream 0.5.18 compresses those copies, so the upload may be
smaller. The spare box follows that same stream (`apps/server/src/spare-follow.ts:11`,
`followGeneration`), and a planned handover fetches a whole `venue.db` copy from the old box
(`apps/server/src/handover-source-api.ts:263-268`); no measurement of a handover copy's size or
time exists.

**2026-11-18 update:** the bucket stream now takes one full copy a week (`interval: 168h`,
`retention: 335h`); see
[the decision](../../backlog/box.md#the-bucket-copy-takes-one-full-copy-a-week-2026-11-18).

So after A1533 and the trim, each backup, each daily full copy and each handover copy would still
carry somewhere between about 2.6 GB (if all 3.5 GB a year of bookkeeping turned out to be
trimmable) and 6.1 GB a year of history, every time. The archive as designed below would carry only
the append-only part, about 0.93 GB a year, once; the rest would still travel every time. That is
why open question 1 offers two routes that carry unchanged data once without touching the
protection.

## Does a year of history slow the sale down? (aim 2)

**What existing bench results say.** Lane H's 30-day build recorded each request's median time each
day (`~/waitron-campaign-h/receipts/a1308-5b/bench-before-ea78181422/request-timings.jsonl`; it does
not record which machine, Node or SQLite). Comparing day 1 with day 30, the three payment requests
**got slower**: `POST /api/working-orders/:id/payments` 14.2 → 15.1 ms (+6%), `POST /api/pay`
13.9 → 16.7 ms (+20%) and `POST /api/working-orders/:id/collect` 10.8 → 12.8 ms (+18%). Every
other request in the file got 11 to 33% faster over the same days (submitting a round, for
example, 18.3 → 12.6 ms). Why the payment requests alone grew is not established.

Over the bench's full year the whole day's work went from 0.18 s a bill on day 1 to 0.49 s on day
360, 2.7 times (`docs/developers/testing-guide.md:3637`). **Its cause has not been identified.** It
includes the bench's own reads and the nightly filing, attendance and close. Where the year was
investigated (A1469), reads that chose a poor index were found and fixed one at a time by naming the
index (`docs/backlog/architecture.md:1243-1250`). That investigation did not account for the whole
2.7 times.

**What a proper measurement would take.** The brief asked for the bench or the protection list. I
used neither: I ran one synthetic table, below. A real answer is a bench build of more than one
year (the one-year build took 8 h 28 min on the bench server, and each `measure` about an hour,
`docs/developers/testing-guide.md:3635-3639`), measured once with the box's memory and once with
memory limited to what a box would have left for the database. That is about a day of machine time
and has not been run.

**The probe I ran.** One table shaped like `attendance_operation_facts`, the second-largest table
that grows with every bill: an auto-numbered key, a unique index on a random text key (so each new
row lands at a random place in that index, the hardest case), and three more indexes. I filled it
with one month's rows (184,911, lane J's 30-day count) or twelve months' (2,218,932), then timed
2,000 transactions of 10 inserts each and 2,000 reads by the random key. It used the box's defaults:
write-ahead log, a full flush to disk at each commit, and SQLite's default 2 MB cache of database
pages. Script: `/tmp/a1531-probe/depth-probe.mjs` (not committed). Container check first:

```sh
docker run --rm node@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 node -e '...'
# printed: v26.13.0 3.54.0 0 1 2 -2000
# Node, SQLite, no extra planner statistics, page counter present, full flush, 2,000 KiB cache:
# the same as the box image's base
```

Then, in one container, one run after another:

```sh
docker run --rm --name a1531-depth-probe -v /tmp/a1531-probe:/probe:ro \
  node@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 sh -c 'mkdir -p /work &&
  for spec in "month-a 184911 -2000 FULL" "month-b 184911 -2000 FULL" "year 2218932 -2000 FULL"
    "month-nosync 184911 -2000 OFF" "year-nosync 2218932 -2000 OFF" "year-tinycache 2218932 -64 FULL";
  do node /probe/depth-probe.mjs $spec; done'
```

**What each answer would have looked like, written before running.** If a year's size mattered,
the year's median would be well above both month runs, by more than the gap between them and by a
quarter or more. If it did not, the year would sit within about 10 to 20% of the months. Two
controls: the month run twice, to show the noise; and a year run with a tiny 64 KB page cache, which
should be slower, to prove the probe can see an effect at all.

**What it printed.** "Index levels" is how many steps a lookup takes from the top of the random-key
index to a row. "Slowest 5%" is the time that 95% of the transactions beat.

| Run | Rows | Index levels | Write median | Slowest 5% | Read median |
| --- | ---: | ---: | ---: | ---: | ---: |
| month-a | 184,911 | 3 | 0.4247 ms | 2.85 ms | 0.0012 ms |
| month-b (noise control) | 184,911 | 3 | 0.4373 ms | 3.15 ms | 0.0012 ms |
| year | 2,218,932 | 4 | 0.4706 ms | 5.62 ms | 0.0030 ms |
| month, no flush to disk | 184,911 | 3 | 0.1052 ms | 0.24 ms | 0.0013 ms |
| year, no flush to disk | 2,218,932 | 4 | 0.1163 ms | 0.35 ms | 0.0028 ms |
| year, 64 KB cache (control expected to be slower) | 2,218,932 | 4 | 0.6635 ms | 3.13 ms | 0.0030 ms |

The script printed one level too many for every index (the top-only `sqlite_schema` printed 2);
the levels above are corrected. Full output: `/tmp/a1531-probe/results.jsonl` (not committed).

**With memory limited.** The reviewer re-ran the same script unchanged with the container's memory
capped (`/tmp/a1531-review/lowmem.jsonl`, `lowmem2.jsonl`). At 256 MB: month 0.365 ms, year
0.412 ms. At 112 MB with no swap: month 0.337 ms, year 0.717 ms, and a read by key 0.0012 →
0.025 ms. I repeated the 112 MB case, expecting, if the reviewer's figure were a fluke, a year
within about 20% of the month:

```sh
docker run --rm --name a1531-mem-recheck --memory=112m --memory-swap=112m -v /tmp/a1531-probe:/probe:ro \
  node@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 sh -c 'mkdir -p /work &&
  for spec in "month-112m 184911 -2000 FULL" "year-112m 2218932 -2000 FULL" "month-1g 184911 -2000 FULL";
  do node /probe/depth-probe.mjs $spec; done'
```

It printed month 0.3614 ms, year 0.7662 ms (2.1 times), a repeat month 0.3148 ms, and reads of
0.0012 ms for the months against 0.0256 ms for the year (`/tmp/a1531-probe/recheck-112m.jsonl`;
the third run's label `month-1g` is a mistake of mine: it ran under the same 112 MB cap). The
year's file was about 0.9 GB, so 112 MB is roughly an eighth of it.

**What it shows.** While the table fits in memory, twelve times the rows added one level to the
random-key index and made a 10-row write about 10% slower at the median, with and without the
flush to disk (with the flush, 0.03 to 0.05 ms). The small-cache control was 41% slower, so the probe can see an
effect. When the container could hold only about an eighth of the year's table, the year's write
took about twice as long and a read by key about twenty times as long. On payments that took a
median of 10.6 ms and 33.9 ms in lane E's first 30-day round
(`~/waitron-campaign-e/receipts/a1308-4a-ii/bench-base.json`, a Mac), and 4.3 ms and 13.7 ms in
its second round, a dozen writes each 0.05 ms slower add about 0.55 ms: 5% of 10.6 ms, 1.6% of
33.9 ms, 13% of 4.3 ms. A dozen writes each 0.4 ms slower, as under the memory cap, would add about
5 ms.

**What memory a box has.** The installer plan sets the hardware floor at "8 GB RAM minimum / 16 GB
recommended, 128 GB disk minimum" (`docs/superpowers/plans/2026-10-26-b3-usb-installer.md:60`).
I found no measurement of how much of that the database's cache gets once the operating system,
Waitron and the print agent have taken theirs. At about 6.1 GB a year, the database passes 8 GB
during its second year. The busy parts of it (the indexes new rows land in) are smaller than the
whole file, but how much smaller, and whether they stay in memory, is not measured.

**Limits.** One synthetic table, not the server's routes. Docker Desktop on an Apple M-series Mac,
whose virtual disk flushes differently from a box's. One or two runs per case.

**Conclusion for aim 2:** while the busy parts of the database fit in memory, a year of rows does
not make the sale's writes meaningfully slower. Once they do not fit, the probe shows writes about
twice as slow and reads by key about twenty times as slow, and a real box past its second year
may reach that point; that is unmeasured. Archiving would relieve it only for the tables it moves.
Most of the growth is in working tables an archive of immutable records would not move, so the
trim is also the main lever for speed.

**2026-11-17 measured update:** A1544 completed a 366-day / 91,500-sale history (11.61 GiB)
and uncapped, 7 GiB and 8 GiB comparisons. Counter-sale medians were 12.323, 13.752 and
15.419 ms respectively. Both capped conditions exercised partially resident databases, but host
load was not controlled; these timings do not isolate memory's effect. The 7 GiB condition
assumes 1 GiB for other services, whose actual appliance use remains unmeasured. This leaves
the archiving recommendation unchanged. [Full results and limits](../../developers/a1544-memory-measurement.md).

## The recommended next item: trim finished working rows

**2026-11-15:** [A1543's proposal](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1543-working-records-proposal.md) now separates the
retained evidence from two limited cleanup candidates, with a fresh sample and current link receipts.
Its proposed periods and the decision to build still await the owner.

**2026-11-15, 19:32 update:** the owner chose “Keep everything”, recorded by the watcher in
Lane J’s `questions.md` at 19:55. Trim nothing now; revisit retention with A664 after the
advisers. The preceding pending status and recommendation below record the earlier proposal;
see [A1543’s decision](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1543-working-records-proposal.md#owner-decision-2026-11-15).

A short item, shaped like A1532:

1. For the bookkeeping tables (`attendance_source_state`, `attendance_operation_facts`,
   `service_commands`) and the other working tables in the table above (`working_order_lines`,
   `ticket_items`, `attendance_questions`, `kitchen_print_jobs`, `working_line_contexts`,
   `kitchen_print_job_lines` and the smaller ones), trace every reader and say which rows are only
   needed while a day's attendance, an order or a bill's replay is open. The attendance readers are
   `apps/server/src/attendance-capture.ts`, `attendance-discovery.ts`, `attendance-integrated.ts`
   and `attendance-source-changes.ts`.
2. Trace every link into each table. Some links are plain ids, not foreign keys (for example
   `sales.working_order_id`, `packages/db/src/schema/sales.ts:120`), so they do not stop a removal,
   but a reader may still follow them. Others are foreign keys from append-only rows, which would
   stop a removal: `order_amendments` points at `working_orders`
   (`packages/db/src/schema/order-amendments.ts:50-52`), and `receipt_reprints` points at
   `print_jobs` (`packages/db/src/schema/receipt-reprints.ts:24-26`). A row pinned that way stays.
3. Separate machinery from evidence. A row that only remembers where a scan got to is machinery. A
   row that says a person did something at a time, or what an order or a kitchen ticket held, may be
   evidence (of working time, or of what a guest was served, including allergy facts). A664 puts
   working time in front of the labour adviser (Q48, G2) and order evidence on the shared schedule;
   such rows are not trimmed.
4. Bring you a retention choice for the machinery, with figures, the way A1532 brought "a week".
5. Measure the 30-day sample again after it.

This needs no change to the append-only protection, so it does not need A664's G5 permission
(`docs/superpowers/specs/2026-10-16-a664-data-retention-design.md:179`). But A664's adopted approach
places "explicitly approved mutable personal/operational cleanup" after the advisers' design
agreement and after G4's verification (A664 line 191). A1532 trimmed print payloads on your own
choice ("a week is fine", [2026-11-14-a1532-print-payload-retention.md:3-4](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1532-print-payload-retention.md));
the same choice is yours here, for machinery rows only.

## The archive design, for when it is worth building

This is the design your ask describes, written so it is ready and so its costs are visible. It
does **not** yet meet all of A664's requirements for an archive; the table after it says which are
met, which are open and which are deliberately deferred.

### What would move, and where

One read-only SQLite file per closed calendar year, for example `<state>/archive/2027.db`, holding
the year's rows of the append-only sale-detail, fiscal-record, event and working-time tables, and
nothing mutable. The live database keeps everything still open: the chain heads, the invoice
counters, every row something live still points at, and (as proposed below) every sale's header row.

A year is closed only when all of these hold: the advisers' answer to Q48 says how long a
correction to it can normally still arrive, and that time has passed; no live row refers to a row
in it; and its fiscal records are all filed and settled.

The file is written once, checked, sealed with its SHA-256 (a fingerprint of its exact bytes), and
never written again. The live database records the seal in a new append-only table: file name,
fingerprint, the year, each chain's first and last position in the file, and the last record's hash.

### The crux: the append-only protection

Each append-only table carries a pair of triggers that refuse every update and delete
(`packages/store/src/append-only.ts:63-82`), installed from each module's `appendOnly()`
declarations (`packages/sync-enrolment/src/classification.ts:34-41`). They are "the whole of what
protects the table at runtime" (`packages/sync-enrolment/src/classification.ts:36`). Boot and the
trading watch refuse a database whose triggers are missing or carry any other text
(`appendOnlyTriggerFaults`, `packages/store/src/append-only.ts:96-120`, used by
`apps/server/src/append-only-watch.ts`).

**Moving a row out is a delete, and the triggers refuse it.** There are three ways round that, and
two are forbidden:

- **Drop or bypass the triggers while moving.** Forbidden: CLAUDE.md §5 ("never work around its
  append-only update/delete triggers") and A664 line 129 ("not permission to bypass triggers").
- **Build a new `venue.db` that leaves the old rows out.** Forbidden: A664 line 129 names
  "rebuild a database while omitting protected records".
- **Replace the trigger with one that permits a delete only for a row inside a sealed range.** This
  is the only route, and it is itself a change to the protection.

I tested whether the trigger could check the archive file directly. It cannot. In `node:26-slim`
(script `/tmp/a1531-probe/attach-probe.mjs`, not committed), with the archive opened alongside the
live database read-only, a permanent trigger that names the archive was refused:

```text
main trigger naming archive.r: refused: trigger r_guard cannot reference objects in database archive
```

A temporary trigger, which lives only on one connection, could name the archive. The reviewer then
tested whether it could loosen a permanent append-only trigger
(`/tmp/a1531-review/perm-plus-temp.mjs`), and I re-ran it unchanged. If a temporary trigger could
loosen the permanent one, the second delete below would print "ok". It printed:

```text
control, no temp trigger, delete row 1: refused: r append-only (permanent)
temp trigger naming archive.r: ok
delete archived row 1 with permanent+temp: refused: r append-only (permanent)
drop permanent trigger (DDL from app connection): ok
delete archived row 1 after drop: ok
```

So the permanent trigger would have to be **dropped and recreated** in a new form that consults the
seal table inside the live database: "refuse, unless this row's position falls inside a sealed
range". The installer cannot do that by itself: it creates triggers with `if not exists`, which
leaves an existing trigger of the same name in place whatever it says
(`packages/store/src/append-only.ts:52-58`, `:84-88`). Every box would therefore drop and recreate
its protection once, in a migration, and the boot check would have to expect the new text. And the
guarantee changes from **the engine refuses every removal** to **the application checked the archive
and wrote a seal, and the engine permits removals inside sealed ranges**: anyone who can write a
seal row could then remove rows. That is a real weakening, and exactly A664's gate G5: "Approve
archival format/storage separation, reference/chain-boundary resolution and final evidence
disposal. Separate item and explicit permission for any conflict with existing invariants" (A664
line 179).

### Hash chains across the boundary

Each fiscal record stores its predecessor's hash (`anterior_huella`,
`packages/fiscal-verifactu/src/schema/registros.ts:100`).

- **At sale time nothing changes.** Before each new record, the sale checks only the latest two
  records (`packages/fiscal-verifactu/src/verify.ts:41-58`, `order by secuencia desc limit 2`). The
  chain head stays live, so the sale never reads the archive.
- **The full walk must read archive then live.** The backup verifier walks each chain from
  position 1 and refuses a gap (`packages/fiscal-verifactu/src/backup-verification-chain.ts:100-108`).
  With an archive it would walk the sealed files in order, then the live rows, and check that the
  first live record's `anterior_huella` equals the seal's last hash, and that the file's fingerprint
  matches its seal.
- **Nothing is rehashed, renumbered or restarted.** The chain continues unbroken; the archive is only
  where its earlier links are stored. No new chain, no new installation name. Nothing in
  `registerSif`, `restoreFiscal`, the hash writers or number allocation changes (A664 line 129).
- **The other chains A664 names are not designed here.** A664 asks for the same boundary record for
  "each fiscal, working-time, order-amendment, pay-period and daily-close chain present" (A664 line
  123). This design covers only the fiscal chain.

### Numbering, and a late correction for a closed year

The invoice counter is `invoice_series.next_number`, "the live counter and the single source of
truth" (`packages/db/src/schema/series.ts:13-21`), so moving old rows out does not reset a number.
But the database's backstop against reuse is `UNIQUE (series_id, invoice_number)` on `sales`
(`packages/db/src/schema/sales.ts:123`), and the same shape guards fiscal records
(`registros_identidad_uq`, `registros.ts:127-129`). A unique index cannot see rows in another file.

**Proposal: every sale's header row (`sales`, 4.5 MB a month in the sample) and every number
allocation stay live for good, and only their detail moves.** That keeps the reuse backstop whole,
and it gives a late correction something to point at: a refund or corrective invoice for a 2027
sale arriving in 2029 would link to the live 2027 header, and its lines would be read from the 2027
file. Whether every table a corrective writes can link to a header alone, rather than to archived
lines, is not traced; until it is, the design must refuse to close a year that a corrective could
still need, which is the open "reference resolution" row below.

### What reads the archive

Every reader that answers about the past opens the year files read-only alongside the live
database (SQLite's `ATTACH`, which opens a second database file on the same connection, as in the
probe above):

- **Reports, invoice lookup and reprint:** look in live first, then in the year the invoice date
  names.
- **A person's own data download:** both live and every archive year.
- **A tax or labour inspector's request:** the export reads both. The archive is what Q48's fiscal
  question proposes to the adviser: "un archivo con los originales íntegros, sus relaciones y
  límites de cadena, información de versión y un lector independiente del servidor de venta"
  (`docs/compliance/2026-11-05-consultas-para-asesores.md:23`).

Foreign keys cannot cross files, so a live row can never point at an archived row by a foreign key.

### Carry once: backups, the bucket stream, the spare and handover

- **Backups** would list the archive files by fingerprint and upload each file once, under its
  fingerprint as its name; a later backup that finds the name already present skips it.
- **The bucket stream** carries only `venue.db` (`packages/stream/src/litestream.ts:95-97`). The
  archive files would be uploaded beside it as objects named by fingerprint, once.
- **The spare** follows the stream and fetches each archive object it does not already hold.
- **A handover** sends `venue.db` and only the archive files the receiving box lacks, each checked
  against its seal.
- **A restore** is incomplete until every sealed file it lists is present and matches.

This makes each archive file both part of a recovery backup and a legal archive. A664 keeps those
apart (line 50, below), so this part of the design is open.

### A664's requirements, one by one

| A664 requirement | Where | State in this design |
| --- | --- | --- |
| A read-only evidence store | line 129 | Met in design: sealed, read-only year files. |
| Stable reference resolution from live rows to archived identities | line 129 | Open. Avoided by closing a year only when nothing live refers into it; the live sale headers proposed above are a partial answer; late correctives not fully traced. |
| Authority access | line 129 | Open: needs the fiscal adviser (Q48, G1). |
| Chain-boundary verification, with the boundary record A664 lists | lines 123, 129 | Met in design for the fiscal chain only; working-time, order-amendment, pay-period and daily-close chains open. |
| Exact original bytes and a manifest of tables, columns, encodings, versions | line 121 | Partly: the file holds rows as stored and its schema version; the manifest is not designed. |
| An offline reader, isolated from the trading application | line 125 | Partly: readable without the sale server; isolation of the reader not designed. |
| Dedicated archive keys, separate from recovery-backup keys, with a custodian, a sealed recovery copy and a recovery test without the production server | line 127 | Open: this design says nothing about encrypting archive files or their keys. |
| Backup and restore behaviour | line 129 | Designed above, but in conflict with the next row. |
| A recovery backup is not a legal archive; a storage destination only after a separate namespace, access policy, location and expiry are validated | line 50 | Open: as designed, a restore depends on the archive files and they sit in the backup destination and beside the bucket copy. |
| Final lawful destruction of expired groups | line 129 | Deliberately deferred: A664's deletion stays blocked on the advisers, and nothing here deletes an archive file. |
| G4: measured storage and restore results, actual storage lifecycles, offline inspection | line 178; `docs/compliance/asesor-questions.md:693` | Open: the figures here are a start, not G4. |
| G5: permission for the protection change | line 179 | Open: your decision (open question 4). |

## What needs the advisers' Q48

Q48 is written but has not been sent (`docs/compliance/asesor-questions.md:638-693`).

- **G1, fiscal:** how long a year can still receive corrections, which decides when it can close;
  and whether a sealed archive with its own reader satisfies conservation and the tax agency's
  access.
- **G2, labour:** whether attendance rows are evidence of working time, before any is trimmed or
  archived; and how long time records are kept.
- **G3, privacy:** personal data inside sealed files and every copy of them, and who holds the
  archive keys.

## What is deliberately not done

- No deletion of any record, live or archived.
- No trigger bypass, no rebuild that omits rows, no new chain, no rehash, no number reset, no
  whole-folder or chain rotation.
- No claim that archiving makes sales faster.
- No change to Litestream, Cloud capture or A1533's scope.
- No trim of working rows in this item; that is the separate item recommended above.

## Open questions for you

**1. How should copies stop carrying unchanged history every time?** After A1533 and the trim,
each backup, each daily full copy to the bucket and each handover copy would still carry between
about 2.6 and 6.1 GB a year of history, every time. The archive would carry only the append-only
part, about 0.93 GB a year, once. Two routes need no change to the protection, and neither is
measured:

- **Backups that skip parts already sent**: for example, a backup splits the database into pieces,
  names each piece by its fingerprint and uploads only pieces the destination lacks. A year-old
  page that never changes is uploaded once.
- **A longer gap between the bucket stream's full copies**: for example, one a week instead of one
  a day (`packages/stream/src/litestream.ts:88-90`). The cost is that a restore from the bucket
  replays more of the changes recorded since the last full copy, which takes longer; how much longer
  is not measured.

**2026-11-18 update:** the second route was taken and its restore measured — the bucket copy now
takes one full copy a week; see
[the decision](../../backlog/box.md#the-bucket-copy-takes-one-full-copy-a-week-2026-11-18).

**Recommended:** land A1533 and the trim first, then measure the year's copies and choose between
these two before considering the archive.

**2. When the archive is built, what period does each archive file cover?** For example, the file
for calendar year 2027 closes once the adviser's correction window after 31 December 2027 has passed
and no 2028 row points back into it. **Recommended: one file per calendar year, closed only on the
adviser's window and with no live reference into it.**

**3. Should the box keep its archive files compressed?** Compressed saves disk on the box, but
reprinting a 2027 invoice would first unpack the year file. Lane J measured gzip compressing the
1.30 GB pre-A1532 database in 14.48 seconds (`docs/backlog/setup.md:418-421`); unpacking was not
measured. Uncompressed on the box saves no box disk, but the live database still shrinks, and copies
in the bucket and backups would be compressed anyway. **Recommended: uncompressed on the box,
compressed everywhere it travels.**

**4. Do you give the G5 permission in principle for the protection change?** The change would drop
the append-only triggers on every box once and recreate them in a form that permits removing a row
inside a sealed range. For example, the trigger on `sale_lines` would permit removing a 2027 line
only when a seal row records 2027's file, its fingerprint and the range that line is in. The
reviewer's probe above is the evidence that a drop is required: a temporary trigger cannot loosen
the permanent one. **Recommended: decide only when the archive is worth building**; nothing here
needs it now.

## What I could not establish

- Whether Litestream 0.5.18 compresses its daily full copies.
- Which working rows are finished machinery and which are evidence.
- Why the payment requests grew over lane H's 30 days while every other request got faster, and
  what made the bench's year 2.7 times slower per bill.
- A year-long or multi-year bench measurement of the sale-path requests on one machine: the year's
  `measure` results and per-day timings were removed from the bench server
  (`~/waitron-campaign-i/receipts/a1479-two-ci-hosts-20261110/bench-year-removed.jsonl`,
  `"requestTimingsPresent": false`).
- How much of a box's memory the database's cache gets, and so when the busy parts stop fitting.
- The size and time of a handover copy.
