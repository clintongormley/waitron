# DB-GROWTH measurement receipts — 15 November 2026

Supporting evidence for the [one-page plan](2026-11-15-db-growth.md), not an implementation or a second specification. Source: `0dc325b3be85eddce6ad63b6f91fe294570deabf`, including A1532. Small raw receipts are retained locally in Lane H `receipts/db-growth-20261115/`.

## Authority

Lane H's queue records the owner's ~21:17 words: “This is complete overkill. all we need to know is the time of the first user action and the latest user action. with that we can calculate the clock in and clock out times. We definitely do NOT need to record every action immutably. The activity log may be useful briefly (eg one month max) but we can prune it after that”. At ~21:10 the owner answered “sounds good” to the watcher's proposal to retain first/latest **per planned rota shift**. These override A1543 for the two attendance-copy tables and `activity_log`; legal clock entries/corrections stay. The owner requested this work; Claude reviews the plan and the watcher clears its build. Neither review nor clearance is owner approval of this design.

## Measured storage

Command: from `apps/server`, `pnpm bench build --out <owned-scratch> --days 30 --bills-per-day 250 --seed 1`. Two fixed-source builds completed 7,500 bills each. The stock builder does not run housekeeping: run the real `clearOldPrintPayloads` at the saved simulated clock, then measure storage replays with `dbstat` and compact each disposable copy. Mac Node 26.13.0/SQLite 3.54.1 supplies storage figures, not box planner/timing evidence.

| Second build, after one-week payload cleanup | Compacted bytes | Saving from baseline |
| --- | ---: | ---: |
| Baseline | 628,916,224 | — |
| First/latest activity and endpoint question references | 421,474,304 | 207,441,920 |
| One-month activity-log retention alone | 628,908,032 | 8,192 |
| Print codec alone | 472,514,560 | 156,401,664 |
| Combined | 265,064,448 | 363,851,776 |

Receipts: `shift-build.log`, `shift-after-sweep.json`, `shift-replay-{baseline,aggregate,retention,prints,all}.json`. The log itself occupies **3,555,328 bytes before / 3,547,136 bytes after** the month cutoff (7,515 → 7,500 rows). This is one month's retained footprint, not a measured later-month saving rate; the 8,192-byte saving removes only 15 older seed events. The live file remained **1,244,594,176 bytes** after cleanup; freed pages are reused, not returned to the filesystem. These figures are retained storage for one observed month, not a perpetual growth rate or a claim that runtime behavior is equivalent.

Attendance: **184,911 facts** (24.6548/bill), **252,595 discovery rows** (33.6793/bill), **120 person/business-days** (1,540.925 facts/staff-day, range 1,059–1,900). There are **zero planned shifts and zero legal clock rows**. Therefore per-planned-shift counts cannot be measured from this fixture. The replay uses 120 actual first/latest outside-shift pairs, occupying 61,440 bytes; question storage falls from 13,815,808 to 114,688 bytes by replacing per-action evidence lists with endpoint identities. Fiscal rows remain 7,500 with unchanged digest; the empty clock-table digest proves nothing about nonempty legal clock chains. Split/overnight shifts, overtime, corrections and question behavior need the plan's seeded tests.

Why a bill creates attendance rows: `apps/server/src/attendance-capture.ts:60–148` records each distinct person/source/key at existing action boundaries, not once per bill. Order revisions, draft/group and kitchen actions, payments and refunds contribute separate facts. `attendance-discovery.ts:113–165,269–335` also tracks each fact and underlying source row with a fingerprint. The [consumer manifest](2026-11-15-db-growth-consumers.json) names every tracked direct consumer; the plan names indirect clock/rota and action-boundary callers. The old source notes predate the owner's override and are not the selected design.

Printing: `printing/src/escpos.ts:45–48,119–138` rasterizes text into full-width one-bit bands. The first build contained **37,122 jobs / 752,905,686 raw payload bytes**; 749,329,072 bytes were raster data, 80.7% of it zero. No venue logo was seeded. Document jobs average 21,702 bytes; sale receipts average 57,200 bytes. This is why textual content occupies kilobytes.

**Monthly generated payload volume**, measured by encoding every first-build packet: **752,905,686 → 83,811,753 bytes**, with 37,122 exact roundtrips. This is encoded-input volume, not measured WAL traffic. A1532 empties 28,419 payloads and retains every job row. **Rolling-week payload holding** in the second build: **176,465,211 → 19,691,712 bytes**. Compression saves fixed holding at this workload; it does not remove another 156 MB of retained growth every month. No second-month growth slope was measured. Metadata and non-payload growth remain.

Cheapness probe (`codec-box.json`): designated test box, owned disposable Node 26.13.0 container, one CPU/256 MiB, existing image, no network. Three synthetic no-logo packets (12,616/55,948/77,548 bytes), 40 warmups and 300 timed samples each. Encode medians 0.117–0.423 ms, worst sample p95 0.456 ms; decode medians 0.033–0.135 ms, worst p95 0.151 ms. First codec call after imports ≤1.225 ms. Every roundtrip exact. Imports, startup, SQL, lock waits, printer I/O and whole-sale latency were excluded. Remote container/folder removal is recorded in `codec-remote-cleanup.json`.

## Activity-log readers and pruning effects

Tracked-source searches: `activity-log-tracked-all-types.txt`, `activity-log-consumers.txt`; follow callers and generic table readers, not only the table identifier. This is a source inventory at the fixed commit, with a real-reader probe below.

| Reader | Effect after pruning |
| --- | --- |
| `db/src/activity-log.ts:74–138`, `readActivityForSubject`/`readActivityForPerson` | Return retained entries only. No production screen/report calls either exported helper in the tracked-source search. The owned baseline/retention probe ran both real helpers: subject 2→0, person 769→768, exactly the expired entries removed. Existing activity-log suite: 11 passed. |
| `recordActivity`, same file:35–52, idempotent insert fallback | Reads original id/time on a duplicate id. Old ids expire with their rows; do not promise deduplication beyond retention. Identity staff/role mail callers consume new id/time; outgoing mail stores its complete parameters and does not later join the log. Other callers discard the returned row. |
| `db/src/configuration-transfer.ts:72` explicit core transfer list | Does not export this table. Personal-data exports use module-registered parts (`module/src/personal-data.ts:46,73`); no part reads `activity_log`. Workforce's exported attendance activity is a separate table being replaced. |
| Full backups: `server/src/backup-supervisor.ts:316` → store `archiveTo`/`archive.ts`; streaming: `stream-host.ts:383` → `stream/src/supervisor.ts`/`litestream.ts` | New full copies contain retained rows; subsequent streamed database changes include pruning. Earlier backup/restore points remain governed by backup retention, not rewritten by this task. |
| Backup checks: `db/src/backup-evidence.ts:43,96,245`, composition `core-backup-verification.ts`, server `backup-verification.ts`/`backup-verification-target.ts:42` | Compare rows in the supplied snapshots, including retained log rows. Removing append-only classification changes the target's immutable-table descriptor/hash; cover this in existing backup-evidence/target tests. Row comparison still covers the table. No business decision reads event content. |
| Recovery holdings: `server/src/first-setup-database-holdings.ts:240–252` | Generic row count decreases. Remove `startAgainDeletable` and rename the UPDATE guard without `_append_only_`: the module validator (`module/src/module.ts:1615–1621`) requires that exception to name an append-only classification, while **either** conventionally named guard activates the holdings detector. The distinct guard preserves the existing ability to Start again after import history. |
| Demo diagnostic: `scripts/demo-seed/testing/madrid-semantics.ts:38,206` | Enumerates current tables/rows; only retained log rows appear in a new snapshot. Frozen historical captures and their hashes stay unchanged. |

No current production semantic business branch reading log history was found. Maintenance verification/counts and the writer's duplicate-id fallback above do read it; the claim is not that the table has no readers. Historical acceptance history described in `backlog/replication-cloud.md:902–903` must be qualified to one month. Calendar-month clamping is retained over a fixed-day interval because it expresses the requested month at February/month-end boundaries with a small cutoff helper; this reviewer alternative is submitted to the watcher with the plan.

## Predicted protection changes

Attendance branch: remove both old attendance-copy tables with their columns, keys, indexes, checks and change-feed triggers from the six venue headers. Add `staff_activity` with `id`, `person_id`, `business_day`, `shift_key`, `shift_start_at`, `shift_end_at`, `first_at`, `last_at`; id primary key, `staff_activity_person_fk`, unique person/shift key, `staff_activity_day_idx` on day/person, and first≤last check. Add its three change-feed triggers. Update workforce classification/exports and generated baseline; questions keep their schema. Legal clock/fiscal protections stay unchanged. The no-rota replay measures outside pairs; per-gap attribution behavior awaits implementation tests.

Core branch: retire `activity_log_append_only_delete` and the log's generated append-only manifest entry; replace `activity_log_append_only_update` with `activity_log_refuse_update` declared in core SQL and explicitly pinned in `scripts/behavioural-triggers.test.ts`. Remove `startAgainDeletable` and its composition assertion, retaining ledger classification; update schema refusal tests, Start again behavior tests and `conventions-data.md`'s explanation. This avoids both composition refusal and falsely protected import history. Codec changes no SQL type/protection. Rebuild starting migrations rather than editing generated SQL. Run before/after `protection-list`, inspect the actual differences and stop on unpredicted changes. No broader guard exclusion is planned.
