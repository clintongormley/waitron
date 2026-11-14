# A1531: moving old finished records out of the live database

**Status: design for the owner's decision. No product code. Dated 2026-11-14.**

## What this lets the venue do, and what I recommend

You asked for a way to move old, finished records out of the box's live database so that it
takes less space and new sales stay fast, while the old records stay readable. Five minutes
later you added the idea that a closed year, written once as one compressed file, would be the
same in every backup, so the backups, the copy streamed to the storage bucket and the spare box
would carry it once and afterwards only refer to it.

I measured both aims before designing for them. My recommendation is **not to build the archive
of fiscal records now**, and to do two smaller things that deliver most of what you asked for:

1. **Land A1533, the compressed backups, as already planned.** On the same 30-day sample it turns
   a 676.8 MB backup into 144.2 MB. That is most of "it takes less space" for backups.
2. **Open one new item to trim finished attendance and service bookkeeping**, the way A1532 trimmed
   print payloads. After A1532, three working tables that are not fiscal records and not
   append-only (append-only means the database refuses any change or removal of a row once it is
   written) hold 38% of the database and grow about 3.5 GB a year. The fiscal records you were
   thinking of hold 1.3%.

The archive itself, which moves append-only fiscal, sale and working-time rows into a sealed file
per closed year, is designed below so it is ready when it is worth building. It cannot be built
without changing what the append-only protection allows, and that needs your explicit permission
and the advisers' answer to Q48. Its gain today would be about 15% of the database.

The figures, each explained further down with its receipt:

| What | Figure |
| --- | --- |
| 30 days at 250 bills a day, after A1532, compact copy of the database | 676,794,368 bytes |
| The same copy compressed with gzip, as A1533 will do | 144,176,204 bytes |
| A year at that rate, estimated without the constant week of print payloads | about 6.1 GB live, about 1.3 GB per compressed backup |
| All 51 append-only tables (sales, invoices, fiscal records, events), share of the 30-day database | 10.2% (77.7 MB) |
| Fiscal records (`registros_facturacion`) with their indexes | 1.31% (9.97 MB) |
| Attendance bookkeeping plus service command results | 38.3% (291.1 MB) |
| A 10-row write into an indexed table holding a year of rows, against a month | 0.47 ms against 0.43 ms, about 10% slower, about 0.04 ms |

## Should this exist?

**The need.** In your words, as relayed by the watcher on 2026-11-14 at 16:43: "we probably want a
way to archive off older immutable data so that (1) it takes less space and (2) the live writes
remain faster. the old data still needs to be accessible". At 16:48: "archiving or compressing
could help in another way though. if last year's data is immutable and compressed into (eg) one
big file, then that file would be the same across backups, which mean we don't need to sync it
over every time". The watcher's own note of the first ask is a paraphrase
(`~/waitron-campaign-shared/watcher-handoff.md:2680`); I did not find the 16:48 words recorded
anywhere I could read, so both quotations come from the brief.

**What you could use once the recommendation lands.** Smaller backups (A1533), and a database that
grows more slowly (the bookkeeping trim). **What would still be missing:** the old fiscal records
would still live in the live database and be carried in full by every backup and every daily copy
to the bucket. They are about 120 MB a year.

**The simplest thing that meets the need** is the two smaller steps above. Building the fiscal
archive on top would add a new kind of file to backups, restores, the bucket stream, the spare and
the handover copy, change the append-only protection, and add a second place every report and
inspector export must read. That is a large, permanent cost for 15% of the database.

**Size of this change:** one new document, no code, no generated files.

**Approval.** No design here is approved. The owner's words above are as relayed in the brief.

## What fills the database now

Lane J built 30 days of trading at 250 bills a day on the pinned bench (revision `95e668a747`,
Node 26.13.0, SQLite 3.54.0) and measured every table with SQLite's `dbstat` page counter.

**Before A1532** the database was 1,296,785,408 bytes and print jobs were 60.9% of it with their
indexes (`~/waitron-campaign-j/receipts/large-backup-restore-20261114/storage-breakdown.md`).
Those shares are no longer today's.

**After A1532**, which empties a print job's payload once it is a week old, lane J measured the
same sample again (`~/waitron-campaign-j/receipts/a1532-print-payload-20261114/dbstat-after.json`).
The file stays the same size until it is compacted, so the shares below are of the 760,717,312
bytes still in use, not of the whole file (the other 130,875 pages are free). I grouped each table
with its indexes:

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
| `working_order_lines` | 21,331,968 | 2.80% | open-order working state |
| `ticket_items` | 20,070,400 | 2.63% | kitchen tickets |
| `sale_lines` | 16,883,712 | 2.21% | append-only |
| `registros_facturacion` | 9,965,568 | 1.31% | append-only fiscal records |

Three things follow.

**Print jobs are now a constant, not a growth.** Of the 253.9 MB, 60.1 MB is empty space inside
pages, and the stored content is 185.9 MB, which is about the last week's payloads (7/30 of the
original 782.8 MB is 182.7 MB). In a year it stays about the same size, so a linear "times 12"
overstates the year. Lane J's linear estimate is 8,122,690,860 bytes
(`size-after.json`); taking the week of payloads out of the multiplication gives
(676,794,368 − 185,854,113) × 12 + 185,854,113 = **6,077,137,173 bytes, about 6.1 GB**. This is my
derivation, not a measurement: it treats the whole of `print_jobs`' stored content as the week of
payloads, which slightly undercounts the emptied rows that remain.

**The immutable records are small.** I listed every table declared append-only
(`grep` for `appendOnly(` across `packages/`, 51 tables) and summed them from the same file: 77.7 MB,
**10.2%** of the 30-day database, about 0.93 GB a year, about 15% of the year estimate. The
largest are `sale_lines` (16.9 MB), `order_draft_events` (12.8 MB), `registros_facturacion`
(10.0 MB), `sale_line_portions` (9.4 MB) and `order_group_events` (9.4 MB).

**What actually grows is attendance and service bookkeeping.** `attendance_source_state`,
`attendance_operation_facts` and `service_commands` together are 291.1 MB a month, **38.3%** of
the database and about 57% of what is left once print jobs are set aside. None is append-only: the
workforce module classifies the first two as "attendance processing, questions and delivery state;
copied with the venue" (`packages/workforce/src/classification.ts:28-38`), and core classifies
`service_commands` as "the recorded result of each service command and a bill's server-written
made_here replay row" (`packages/db/src/classification.ts:217-221`). The 30-day sample holds
252,595 rows of `attendance_source_state`, about 8,400 a day, for 8 seeded staff
(`~/waitron-campaign-j/receipts/large-backup-restore-20261114/attendance-summary.json`). I have not
established which of those rows are finished machinery and which are evidence of working time; that
is the first job of the item I recommend.

One caveat applies to all of this: the bench's venue is synthetic. Its staff count, its number of
attendance rows per bill and its print volume are the bench profile's, not a real restaurant's.

## What A1532 and A1533 already solve

**A1532** (landed as #3222) cut the 30-day compact copy from 1,268,367,360 to 676,794,368 bytes
(`size-before.json`, `size-after.json` in the A1532 receipts), and it stops print payloads growing
with time.

**A1533** (planned, held for a memory decision) compresses each backup before encrypting it. On the
post-A1532 copy, inside the box image's base `node:26-slim`, gzip at level 6 gave 144,176,204 bytes
and zstd at level 3 gave 125,429,021 (`docs/backlog/setup.md:428-433`, receipts in
`~/waitron-campaign-j/receipts/a1533-compressed-backups-20261114/`). The plan chooses gzip
(`docs/superpowers/plans/2026-11-14-a1533-compressed-backups.md`, step 1). At the same ratio
(0.213), the year's 6.1 GB would back up to about 1.3 GB. That ratio on a year is an assumption.

**What neither touches.** A1533 leaves the bucket stream out (its "Limits and size" paragraph:
"Litestream, Cloud capture, A664, schema and streamed uploads stay out"). The bucket stream is
Litestream, a program that copies every change of `venue.db` to object storage. It is configured
to take one full copy a day and keep a week (`packages/stream/src/litestream.ts:88-90`:
`interval: 24h`, `retention: 168h`). With a 6.1 GB database that is a 6.1 GB upload every day and
about seven full copies held in the bucket. I have not established whether Litestream 0.5.18
compresses those copies. The spare box follows that same stream (`apps/server/src/spare-follow.ts:11`,
`followGeneration`), and a planned handover fetches a whole `venue.db` copy from the old box
(`apps/server/src/handover-source-api.ts:263-268`). So the "carry once" idea matters most there, and
it matters in proportion to how much of the database is closed. Trimming bookkeeping shrinks all of
these at once without any new file type.

## Does a year of history slow the sale down? (aim 2)

**What existing measurements say.** Across lane H's 30-day build, the payment request's median did
not grow: 14.22 ms on day 1 and 15.10 ms on day 30; submitting a round went from 18.33 ms to
12.58 ms (`~/waitron-campaign-h/receipts/a1308-5b/bench-before-ea78181422/request-timings.jsonl`,
read with `jq` per day). Over the bench's full year the whole day's work went from 0.18 s a bill on
day 1 to 0.49 s on day 360 (`docs/developers/testing-guide.md:3637`). That figure includes the
bench's own reads and the nightly filing, attendance and close, so it does not say which part
slowed. Where the year was investigated (A1469), the cost was reads that chose a poor index, fixed
one read at a time by naming the index (`docs/backlog/architecture.md:1243-1250`). Those are reads
whose cost grows with history; archiving would hide them for a few months and they would come back
as the live year filled up again. The bench and the protection list remain the right tool for them.

None of that isolates the cost of **writing** into a large table, so I ran one bounded measurement.

**The probe.** One table shaped like `attendance_operation_facts`, the largest table that grows with
every bill: an auto-numbered key, a unique index on a random text key (so each new row lands at a
random place in that index, the worst case for depth), and three more indexes. I filled it with one
month's rows (184,911, lane J's 30-day count) or twelve months' (2,218,932), then timed 2,000
transactions of 10 inserts each, the box's defaults (write-ahead log, `synchronous` 2, the default
2 MB page cache), and 2,000 reads by the random key. Script: `/tmp/a1531-probe/depth-probe.mjs`
(not committed). Container check first:

```sh
docker run --rm node@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 node -e '...'
# printed: v26.13.0 3.54.0 0 1 2 -2000
# (Node, SQLite, STAT4 off, dbstat on, synchronous FULL, cache 2,000 KiB): the box image's base
```

Then, in one container, run one after another:

```sh
docker run --rm --name a1531-depth-probe -v /tmp/a1531-probe:/probe:ro \
  node@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 sh -c 'mkdir -p /work &&
  for spec in "month-a 184911 -2000 FULL" "month-b 184911 -2000 FULL" "year 2218932 -2000 FULL"
    "month-nosync 184911 -2000 OFF" "year-nosync 2218932 -2000 OFF" "year-tinycache 2218932 -64 FULL";
  do node /probe/depth-probe.mjs $spec; done'
```

**What each answer would have looked like, written before running.** If a year's depth mattered,
the year's median would be well above both month runs, by more than the gap between the two month
runs and by a quarter or more. If it did not, the year would sit within about 10 to 20% of the
months. Two controls: the month run twice, to show the noise; and a year run with a tiny 64 KB page
cache, which **should** be slower, to prove the probe can see a cache or depth effect at all.

**What it printed** (each line one run; times are the median and 95th percentile of a 10-row
transaction, then of one read):

| Run | Rows | Index depth (random key) | Write median | Write p95 | Read median |
| --- | ---: | ---: | ---: | ---: | ---: |
| month-a | 184,911 | 3 | 0.4247 ms | 2.85 ms | 0.0012 ms |
| month-b (noise control) | 184,911 | 3 | 0.4373 ms | 3.15 ms | 0.0012 ms |
| year | 2,218,932 | 4 | 0.4706 ms | 5.62 ms | 0.0030 ms |
| month, no disk flush | 184,911 | 3 | 0.1052 ms | 0.24 ms | 0.0013 ms |
| year, no disk flush | 2,218,932 | 4 | 0.1163 ms | 0.35 ms | 0.0028 ms |
| year, 64 KB cache (other-direction control) | 2,218,932 | 4 | 0.6635 ms | 3.13 ms | 0.0030 ms |

The script printed `max(slashes)+1` from `dbstat`'s page paths, which counts one level too many; the
depths above are corrected (the root-only `sqlite_schema` printed 2). Full output:
`/tmp/a1531-probe/results.jsonl` (not committed).

**What it shows.** Twelve times the rows added one level to the random-key index and made a 10-row
write about 10% slower at the median, both with and without the disk flush: about 0.04 ms. The
control proved the probe can see a real effect (the small cache cost 41%). The slowest 5% of
writes were slower on the year with the disk flush but not without it, so that gap is the disk,
not the tree; it was one run each. A read by key went from about 1 to 3 microseconds. On a payment
that takes 10 to 34 ms (lane E's 30-day bench, `~/waitron-campaign-e/receipts/a1308-4a-ii/bench-base.json`,
first-round medians `payment.partial` 10.6 ms and `payment.final` 33.9 ms, on a Mac), even a dozen such writes add
well under 1%.

**Limits.** One synthetic table, not the server's routes. Docker Desktop on an Apple M-series Mac,
whose virtual disk flushes differently from a box's. One run per case. It answers "does a bigger
B-tree slow a write" and nothing about reads that scan history.

**Conclusion for aim 2:** a year of rows does not make the sale's writes meaningfully slower.
Archiving to make writes faster is not supported by the measurement, and I do not claim it.

## The recommended next item: trim finished bookkeeping

A short item, shaped like A1532:

1. For `attendance_source_state`, `attendance_operation_facts` and `service_commands`, trace every
   reader (`apps/server/src/attendance-capture.ts`, `attendance-discovery.ts`,
   `attendance-integrated.ts`, `attendance-source-changes.ts` read the first two) and say which rows
   are only needed while a day's attendance or a bill's replay is open.
2. Separate machinery from evidence. A row that only remembers where a scan got to is machinery. A
   row that says a person did something at a time may be evidence of working time, which A664 puts
   in front of the labour adviser (Q48, G2) and which is then not trimmed.
3. Bring you a retention choice for the machinery, with figures, the way A1532 brought "a week".
4. Measure the 30-day sample again after it.

This needs no change to any append-only protection, no new file type and no change to backups.

## The archive design, for when it is worth building

This is the design the owner's ask describes, written so it is ready and so its costs are visible.
It meets A664's storage-boundary requirements
(`docs/superpowers/specs/2026-10-16-a664-data-retention-design.md:129`) point by point.

### What would move, and where

One read-only SQLite file per closed calendar year, for example `<state>/archive/2027.db`, holding
the year's rows of the append-only sale, invoice, fiscal-record, event and working-time tables, and
nothing mutable. The live database keeps everything still open: the chain heads, the invoice
counters and every row something live still points at.

A year is closed only when all of these hold: the advisers' answer to Q48 says how long a
correction to it can still arrive, and that time has passed; no live row refers to a row in it
(a refund, a correction, a reprint record); and its fiscal records are all filed and settled. For
example, a December 2027 sale refunded in February 2028 keeps 2027 open until the refund is itself
closed and the correction window has passed.

The file is written once, checked, sealed with its SHA-256 (a fingerprint of its exact bytes), and
never written again. The live database records the seal in a new append-only table: file name,
fingerprint, the year, each fiscal chain's first and last position in the file, and the last
record's hash.

### The crux: the append-only protection

Each append-only table carries a pair of triggers that refuse every update and delete
(`packages/store/src/append-only.ts:63-82`), installed from each module's `appendOnly()`
declarations (`packages/sync-enrolment/src/classification.ts:34-41`). They are "the whole of what
protects the table at runtime" (`packages/sync-enrolment/src/classification.ts:36`). Boot and the trading watch refuse a database
whose triggers are missing or carry any other text (`appendOnlyTriggerFaults`,
`packages/store/src/append-only.ts:96-120`, used by `apps/server/src/append-only-watch.ts`).

**Moving a row out is a delete, and the triggers refuse it.** There are three ways round that, and
two are forbidden:

- **Drop or bypass the triggers while moving.** Forbidden: CLAUDE.md §5 ("never work around its
  append-only update/delete triggers") and A664 line 129 ("not permission to bypass triggers").
- **Build a new `venue.db` that leaves the old rows out.** Forbidden: A664 line 129 names
  "rebuild a database while omitting protected records".
- **Change the trigger so it permits a delete only for a row inside a sealed range.** This is the
  only route, and it is itself a change to the protection.

I tested whether the trigger could check the archive file directly, which would have been the
strongest form. It cannot. In `node:26-slim` (script `/tmp/a1531-probe/attach-probe.mjs`, not
committed), with the archive attached read-only, a permanent trigger was refused:

```text
main trigger naming archive.r: refused: trigger r_guard cannot reference objects in database archive
temp trigger naming archive.r: ok
delete archived row 1: ok
delete unarchived row 2: refused: r is append-only
write into read-only archive: refused: attempt to write a readonly database
```

A temporary trigger can look into the archive, but it lives only on one connection and cannot
loosen the permanent pair, which still refuses. So the permanent trigger would have to consult the
seal table inside the live database: "refuse, unless this row's chain position falls inside a sealed
range". The guarantee then changes from **the engine refuses every removal** to **the application
checked the archive and wrote a seal, and the engine permits removals inside sealed ranges**. Anyone
who can write a seal row could then remove rows. That is a real weakening, and it is exactly A664's
gate G5: "Approve archival format/storage separation, reference/chain-boundary resolution and final
evidence disposal. Separate item and explicit permission for any conflict with existing invariants"
(A664 line 179). It also changes the trigger text that the boot check compares, so every box would
see an altered trigger unless the new form ships with it.

### Hash chains across the boundary

Each fiscal record stores its predecessor's hash (`anterior_huella`, `packages/fiscal-verifactu/src/schema/registros.ts:100`).

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

### Numbering

The invoice counter is `invoice_series.next_number`, "the live counter and the single source of
truth" (`packages/db/src/schema/series.ts:13-21`), so moving old sales out does not reset a number.
But the database's backstop against reuse is `UNIQUE (series_id, invoice_number)` on `sales`
(`packages/db/src/schema/sales.ts:123`), and the same shape guards fiscal records
(`registros_identidad_uq`, `registros.ts:127-129`). A unique index cannot see rows in another file,
so once a year moved out the engine would no longer catch a reused old number. The design would
keep a small live table of every issued (series, number), kept append-only and never archived, one
small row a bill (its size not measured). That is another reason the fiscal tables themselves are the last thing worth
moving.

### What reads the archive

Every reader that answers about the past opens the year files read-only alongside the live
database (SQLite's `ATTACH`, as in the probe above):

- **Reports, invoice lookup and reprint:** look in live first, then in the year the invoice date
  names.
- **A person's own data download:** both live and every archive year; A664's privacy gate (G3) also
  covers personal data held inside sealed files and their copies.
- **A tax or labour inspector's request:** the export reads both, and the archive is exactly what
  Q48's fiscal question proposes to the adviser: "un archivo con los originales íntegros, sus
  relaciones y límites de cadena, información de versión y un lector independiente del servidor de
  venta" (`docs/compliance/2026-11-05-consultas-para-asesores.md:23`). Each archive file would carry
  its schema version and be readable without the sale server.

Foreign keys cannot cross files, so a live row can never point at an archived row. That is why a
year closes only when nothing live refers into it.

### Carry once: backups, the bucket stream, the spare and handover

- **Backups** would include a list of the archive files, by fingerprint, and upload each file to
  the backup destination once, under its fingerprint as its name. A later backup that finds the
  name already present skips it.
- **The bucket stream** carries only `venue.db` (`packages/stream/src/litestream.ts:95-97`). The
  archive files would be uploaded beside it as objects named by fingerprint, once.
- **The spare** follows the stream and fetches each archive object it does not already hold.
- **A handover** sends `venue.db` and only the archive files the receiving box lacks, each checked
  against its seal.
- **A restore** is incomplete until every sealed file it lists is present and matches. A backup
  that refers to a file is only as good as that file, so archive files need their own retention,
  longer than the backups' (A664 line 50 already separates a recovery backup from a legal archive).

Whether the box keeps its own copy compressed is open question 3 below.

## What needs the advisers' Q48

Q48 is written but has not been sent (`docs/compliance/asesor-questions.md:638-693`).

- **G1, fiscal:** how long a year can still receive corrections, which decides when it can close;
  and whether a sealed archive with its own reader satisfies conservation and the tax agency's
  access (the question quoted above).
- **G2, labour:** whether attendance rows are evidence of working time, before any is trimmed or
  archived; and how long time records are kept.
- **G3, privacy:** personal data inside sealed files and every copy of them.
- **G5, your decision, not an adviser's:** the trigger change described above.

Moving data is not deleting it. A664's deletion stays blocked on the advisers, and nothing here
deletes an archive file.

## What is deliberately not done

- No deletion of any record, live or archived.
- No trigger bypass, no rebuild that omits rows, no new chain, no rehash, no number reset, no
  whole-folder or chain rotation.
- No claim that archiving makes sales faster.
- No change to Litestream, Cloud capture or A1533's scope.
- No trim of attendance or service rows in this item; that is the separate item recommended above.

## Open questions for you

**1. Do you accept not building the fiscal archive now, and doing A1533 plus a bookkeeping trim
instead?** For example: after a year, the live database would be roughly 6.1 GB less whatever the
trim removes (up to about 3.5 GB if all of the attendance and service rows turned out to be
machinery, which I have not established), and each compressed backup roughly a fifth of that. The
fiscal archive would remove at most another 0.9 GB. **Recommended: yes.**

**2. When the archive is built, which unit closes?** For example, the calendar year 2027 closes once
the adviser's correction window after 31 December 2027 has passed and no 2028 refund or reprint
points back into it. **Recommended: the calendar year, closed only on the adviser's window and
with no live reference into it.**

**3. Should the box keep its archive files compressed?** Compressed saves disk on the box, but
reprinting a 2027 invoice would first unpack the year file. Lane J measured gzip compressing the
1.30 GB pre-A1532 database in 14.48 seconds (`docs/backlog/setup.md:418-421`); unpacking was not
measured.
Uncompressed on the box saves no box disk, but the live database still shrinks, and copies in the
bucket and backups would be compressed anyway. **Recommended: uncompressed on the box, compressed
everywhere it travels.**

**4. Do you give the G5 permission in principle for the trigger change?** For example: the trigger
on `sale_lines` would permit removing a 2027 line only when a seal row records 2027's file, its
fingerprint and the range that line is in. **Recommended: decide only when the archive is worth
building**; nothing here needs it now.

## What I could not establish

- Whether Litestream 0.5.18 compresses its daily full copies.
- Which attendance and service rows are finished machinery and which are evidence.
- A year-long bench measurement of the sale-path requests on one machine: the year's `measure`
  results and its per-day timings were removed from the bench server
  (`~/waitron-campaign-i/receipts/a1479-two-ci-hosts-20261110/bench-year-removed.jsonl`,
  `"requestTimingsPresent": false`).
- How large a box's disk is, so how soon 6.1 GB a year would matter.
