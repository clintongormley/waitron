# A1543: audit approach for the working-records proposal

**Authority and gate.** Lane J `queue.md`, A1543, records the proposal ask;
the watcher at 2026-11-15 12:53 records “The owner said ‘start now’ on A1543 (12:38)”.
This authorises the proposal, not retention periods.
Before the audit starts, the driver supplies Claude a brief quoting that ask,
obtains a completed plan read, addresses findings and obtains watcher clearance.
This is an audit plan, not a trimming design or an approved policy.
Claude read and its single corrections read completed; the watcher cleared the approach
and synthetic-copy measurements on 2026-11-15 at 13:19, not retention or trimming.

**Finish line.** Write `docs/superpowers/specs/2026-11-15-a1543-working-records-proposal.md`:
a plain-English table-by-table choice with reader/link receipts, explicit no-trim
rows, proposed machinery periods, measured potential savings and limits. For each
table/period, state when age starts, dependencies, saved bytes or why it stays. Keep
search inventories, commands and raw results outside the repository under
`~/waitron-campaign-j/receipts/a1543-proposal-20261115/`. Initial notes and consumer
paths there are incomplete orientation, not a completed audit.

1. **Bound the inventory.** Start with A1531's table and “recommended next item”:
   `attendance_source_state`, `attendance_operation_facts`, `service_commands`,
   `working_order_lines`, `ticket_items`, `attendance_questions`,
   `kitchen_print_jobs`, `working_line_contexts`, `kitchen_print_job_lines`.
   Catch “smaller ones” by reconciling the full sample table/index inventory with
   core/module classifications; enumerate remaining growing working tables and
   linked parents, including `working_orders`, `attendance_day_work`,
   `attendance_response_commands` and `kitchen_notices`. Record exclusions and reasons.
   Classifications describe storage roles, not permission to trim.
2. **Trace before choosing.** The driver follows every reader through its callers
   to screens, exports, reports, jobs and replays. Search SQL names, camelCase
   symbols, schema barrels, raw SQL, triggers, JSON and plain-id references;
   reconcile incoming links with actual SQLite foreign keys. Record exact
   `file:line` paths, cascade effects and append-only anchors. An append-only
   foreign key keeps its target. Kept rows also keep their restrict/no-action targets;
   cascade/set-null links into kept rows block trimming their parents.
   Evidence of who did what/when, working time,
   served dishes or allergies stays. Split mixed row classes; names alone justify
   no cutoff. Verify `attendance-facts.ts:44–48`, workforce `personal-data.ts:156–167`,
   discovery's missing-cursor restart (`attendance-discovery.ts:423–426`), and
   replay-before-open checks (`parties.ts:970–1005`) plus made-here state
   (`made-here.ts:175–228`). Do not presume these are disposable machinery.
3. **Remeasure potential savings.** The old A1532 remote sample was removed
   (`progress.log`, 2026-11-14 22:22; A1533 `sample-cleanup.log`);
   `dbstat-after.json` is historical only. Locate an explicitly dedicated current
   30-day fixture or regenerate through existing `apps/server/scripts/bench/cli.ts`:
   from `apps/server`, `pnpm bench build --out <absolute-owned-scratch> --days 30 --bills-per-day 250 --seed 1`.
   Follow testing-guide's bench instructions and current README boundaries.
   Record the sample's Node/SQLite/STAT4, revision, profile and final clock;
   make no box-planner or cross-runtime claims. Reuse A1532's byte-measurement method.
   The bench does not run print housekeeping: report absolute table bytes and state
   that shares with untrimmed print payloads are not comparable with A1531's.
   At the clearance gate above, ask the watcher to confirm that “no deletion” permits
   synthetic-copy probes, never real-data deletion or a trim implementation. If refused,
   report eligibility counts and explicitly leave savings unmeasured and the ask incomplete.
   Make one fresh build, close its venue, then use independent disposable file copies
   under owned scratch for each probe; never rebuild 30 days per table or period. Probe
   justified periods; record eligible/kept counts at the final clock, table/index
   `dbstat`, freelist, file and compact-copy bytes, plus an unchanged control.
   A period at least as long as the sample may save nothing: report that result;
   label average daily growth and projected kept-window bytes derived, not measured savings.
   Distinguish reusable pages from smaller files; explain synthetic-sample limits.
   No new byte claims without runs.

**Delivery and bounds.** Driver submits `## WATCHER-NEEDED: A1543 proposal for the owner`.
Only owner acceptance authorises trimming in A1532's existing housekeeping seat.
No production source/schema/protection/guard changes, retained/live-data writes,
planner statistics, legal claims, new framework/table/record or redundant tests.
Source audit owns reader/link claims; disposable probes own savings claims.
Destroy only exact owned scratch; leave other lanes' runtime state alone.
Expected: 100–140 documentation lines, zero code/tests. Budget: three hours to a
reviewable proposal, external waits excluded; stop for watcher outside opinion at
the limit or beyond 1.5× estimated size.
