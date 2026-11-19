# A1543: keep the evidence, bound two kinds of working record

> **2026-11-17, A1308 os2 Tasks 1–4:** Bill editor ownership now lives on working_orders; the bill_edit_states measurement below records the earlier layout. See [the os2 plan](https://github.com/clintongormley/waitron/blob/0a049fa0ff84a09bb0eb863af66338c63ebeb087/docs/superpowers/plans/2026-11-08-a1308-os2-bill-identity.md).

## Owner decision, 2026-11-15

The owner chose “Keep everything” at 19:32, as recorded by the watcher in Lane J’s
`questions.md` at 19:55: “Trim nothing now; revisit with A664 after the advisers. Close A1543
with the proposal as its record.” No trimming is authorised. The proposed seven-day cutoffs
and replay tradeoff below were not accepted; the audit and measurements remain as the
proposal’s historical record. See the [retention decision](../../backlog/data-protection.md#decisions-and-deliberate-limits).

## Proposal as submitted, before the owner’s decision

You can recover a modest amount of reusable database space by keeping seven elapsed days of
closed-party command replies and narrowly defined terminal whole-payment watches. I recommend
that boundary, retaining every evidence table. You must accept both the replay tradeoff and doing
this under existing housekeeping before the wider A664 work; neither choice is approved yet.

The owner asked to “start now” on the proposal, not trimming. Claude reviewed the audit approach;
the watcher cleared that approach and disposable synthetic-copy measurements on November 15 at
13:19/13:24. Neither clearance approves a period. The recorded approach is
[2026-11-15-a1543-working-records-proposal.md:3](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1543-working-records-proposal.md).

**What seven days means.** Set the cutoff to the housekeeping run's time minus 604,800,000
milliseconds. Only timestamps strictly before it qualify; equality stays. No clock field is
proposed. These are proposed boundaries, not current cleanup behavior:

- **Command replies:** `service_commands.scope_kind = 'party'`, with a matching retained `parties`
  row whose state is `closed` and whose `closed_at` precedes the cutoff. Age starts at party
  closure, not command creation. Keep open parties, missing parents, missing closure times and
  every bill-scoped command, including the `madeHere` payment replay.
- **Payment watches:** `attendance_source_state.record_kind = 'watch'`, source `whole-payment`,
  empty `previous_days`, and a matching retained `attendance_operation_facts` row with the same
  source/key, outcome `qualifying` or `refused`, and original `fact.at` before the cutoff.
  This is seven days from the operation, not completion; there is no completion timestamp.
  Keep missing or pending facts. A terminal watch may still have `next_due_at` set.

At `runServiceCommand`, today's replay checks the saved kind/fingerprint and returns its JSON
before checking whether the party is open (`apps/server/src/parties.ts:970`). After expiry, a
closed-party retry reaching this boundary would instead refuse `party.not_open` before running
work (`apps/server/src/parties.ts:993`, `:513`). It would lose the original JSON reply, including
generated ids or refund links, and changed-fingerprint detection (`submission.id_reused`).
Route checks may refuse earlier. Keeping underlying evidence does not preserve that JSON answer.

**Table choices.** MB means decimal megabytes, including each table's indexes, from inventory `R`.
“Keep” means no new expiry and **0 policy removal**, not a measured zero saving. An empty sample
still occupies pages and establishes no long-term saving. Receipt letters below name the readers
and links. The three source-state rows share one table total; their class bytes were not measured.

| Table or family | Proposed period | Table + indexes MB | Reason / source receipt | Reusable bytes |
| --- | --- | ---: | --- | ---: |
| `service_commands` | Seven days after party closure; all other scopes stay | 37.236736 | Bounded replies; C | 26,828,800 |
| `attendance_source_state`: terminal whole-payment watches above | Seven days from original fact | 119.009280 total | Finished payment checks; A | 1,220,608 |
| `attendance_source_state`: all scans | Keep | Shared total above | Missing scan set restarts discovery; A | 0 policy removal |
| `attendance_source_state`: all other watches, including noneligible whole-payment | Keep | Shared total above | Previous-day fingerprints still matter; A | 0 policy removal |
| `attendance_operation_facts` | Keep | 87.031808 | Working-time evidence and personal export; F | 0 policy removal |
| `attendance_day_work`, `attendance_questions`, `attendance_response_commands` | Keep | 13.856768 | Processing, questions and authorised answers; F; responses empty | 0 policy removal |
| `working_orders` | Keep | 3.510272 | Append-only amendments and money rows retain parent; O | 0 policy removal |
| `working_order_lines` | Keep | 21.331968 | Served snapshots, history and receipt adjustments; O | 0 policy removal |
| `ticket_items` | Keep | 16.388096 | Kitchen/pass timings, reports and notice links; K | 0 policy removal |
| `kitchen_print_jobs`, `kitchen_print_job_lines` | Keep | 23.650304 | Station/line paper history and reprint links; K | 0 policy removal |
| `working_line_contexts` | Keep | 13.869056 | Recorded offer, VAT, allergens and nutrition; X | 0 policy removal |
| `order_service_contexts` | Keep | 1.351680 | Recorded zone, department and service mode; X | 0 policy removal |
| `order_groups`, `order_drafts` | Keep | 14.401536 | Append-only events retain their parents; G | 0 policy removal |
| `order_draft_lines` | Existing lifecycle; no age cutoff | 0.016384 | Unsent work and draft actions; D; empty | 0 policy removal |
| `order_group_hold_stations` | Keep | 0.745472 | Which stations received HOLD paper; H | 0 policy removal |
| `order_portions`, `sale_line_portions`, `order_portion_events`, `working_line_portions` | Keep | 21.086208 | Protected portions and working bindings; P; events empty | 0 policy removal |
| `bill_edit_states` | Keep | 0.741376 | Missing row resets editor/version; E | 0 policy removal |
| `line_service_cancellations`, `ticket_item_moves` | Keep | 0.020480 | Charged cancellations and who moved food; M; empty | 0 policy removal |
| `kitchen_notices`, `order_kitchen_notes`, `party_allergy_guests`, `allergy_line_ticks` | Keep | 0.061440 | Instructions, acknowledgements and allergies; N; empty | 0 policy removal |

**Reader and link receipts, at `58d9a51fe695173efd691edb215e71ddafcef21d`.**
`R` means the local directory `~/waitron-campaign-j/receipts/a1543-proposal-20261115/`.
`R/audit-disposition.md` holds the completed dispositions; `R/fresh-inventory.json` holds actual
SQLite incoming keys and table/index bytes. Neither candidate has an incoming foreign key.
The inventory covers 224 tables and 1,031,185 rows; the dispositions reconcile the smaller families.
`R/reader-call-inventory.txt` is an identifier/immediate-caller catalogue, with false positives
and module-dispatch limits. Separate SQL, trigger, schema and plain-id/JSON searches supplement it;
this is source tracing, not an automatic exhaustive call graph or runtime proof.

- **C:** `apps/server/src/parties.ts:961` serves draft/group, service, bill-request, cancellation,
  adjustment, move, pass and allergy commands through till/device routes. The other table reader
  is bill-scoped prepay storage/replay, `apps/server/src/made-here.ts:155` and `:211`.
  `packages/db/src/schema/parties.ts:124` keeps plain scope ids and JSON replies; their targets stay.
- **A:** `apps/server/src/attendance-integrated.ts:109` stops before reading the watch fingerprint
  for a nonpending fact. `apps/server/src/attendance-capture.ts:80` prevents terminal-to-pending
  reversal. `apps/server/src/attendance-discovery.ts:57` reconciles pending facts; `:113` lists
  ordinary scan sources without whole-payment. Scans stay (`:423`); other watches dirty previous
  and current days (`:317`). Most fingerprints stay. A name, mutable classification or
  `next_due_at` alone justifies no expiry.
- **F:** `apps/server/src/attendance-facts.ts:44` reads retained facts and suppresses duplicates;
  `apps/server/src/attendance-loop.ts:27` processes days. Questions, answers and operation facts
  enter the personal export at `packages/workforce/src/personal-data.ts:114`, `:143`, `:156`.
  Operation facts are evidence, not erasable bookkeeping.
- **O:** `packages/db/src/schema/order-amendments.ts:49` restricts parent deletion;
  `packages/db/src/classification.ts:189` protects amendments. History reads lines at
  `apps/server/src/orders-list.ts:778`; invoice and receipt adjustments resolve their ids at
  `apps/server/src/invoice-document.ts:83` and `apps/server/src/transaction-receipt.ts:91`.
  `packages/db/triggers/core.sql:142` also refuses closed-order line deletion. Keep that protection.
- **K:** `apps/server/src/pass-board.ts:95`, `packages/reporting/src/overdue-orders.ts:37` and
  `apps/server/src/kitchen-print.ts:197` feed kitchen/pass, reports and printed work.
  `apps/server/src/print-job-reprint.ts:75` reads kitchen links. Deleting tickets would null a kept
  notice's link (`packages/db/src/schema/venue-service/kitchen-notices.ts:79`).
- **X:** `packages/venue-service/src/operations.ts:1068` reads service identity; `:1207` reads
  offer/allergen snapshots and `:1304` nutrition, used by history at `apps/server/src/orders-list.ts:805`.
- **G/D/H:** Event-parent keys are `packages/db/src/schema/order-groups.ts:112` and
  `packages/db/src/schema/order-drafts.ts:137`; actual incoming actions are NO ACTION in `R`.
  `apps/server/src/bill-unsent.ts:8` reads draft lines; `apps/server/src/order-groups.ts:2437`
  reads HOLD stations for release/copy work. Existing draft submit/discard/move lifecycles stay.
- **P/E/M:** `packages/db/src/classification.ts:118` protects portions; history joins their
  working bindings at `apps/server/src/orders-list.ts:801`. `apps/server/src/bill-editing.ts:286`
  defaults a missing version to zero. Cancellations feed `apps/server/src/order-groups.ts:1913`;
  `apps/server/src/station-queue-moves.ts:12` reads mover, destination and time.
- **N:** `packages/venue-service/src/kitchen-notices.ts:252`,
  `packages/venue-service/src/order-kitchen-notes.ts:32` and
  `packages/venue-service/src/party-allergy.ts:49` read notice/instruction/allergy records.

Retained children keep their targets: an append-only foreign key keeps its parent, and deleting
a parent through CASCADE or SET NULL would change kept evidence. No such parent cleanup is proposed.
Other growing money/delivery/identity families stay outside these cutoffs: payments, tenders,
settlements, bill identities/number allocations, receipt headers/guests, invoice deliveries,
outgoing mail and sessions. Protected fiscal/activity/drawer and group/draft journals stay, as do
catalogue/configuration tables. A1532's print-payload policy stays separate; whole print rows stay.

**Measured scope and limits.** `R/savings-probe.mjs`, `R/savings-probe-transaction.log` and
`R/savings-results.json` record independent synthetic copies: 30 days, 250 bills/day, seed 1,
final clock `2025-12-03T04:30:07.530Z`; Mac Node v26.13.0, SQLite 3.54.1, STAT4 enabled.
Commands: 43,155 eligible rows; watches: 2,599. Combined: 45,754 rows and **28,049,408 reusable
bytes**, with **zero shrink** of the **1,244,479,488-byte file**. Identically compacted control
and candidate copies measured 1,220,063,232 and 1,191,141,376 bytes: **28,921,856 differential
bytes**, a measurement only. Thirty-day cutoff: zero eligible rows and zero savings.
Foreign keys were enabled, trigger SQL stayed unchanged, and hashes/counts of 15 named retained
tables matched; this did not check every table. Copies are gone. Print payloads were untrimmed,
so proportions are not comparable with A1531. No automatic VACUUM, speed, backup or box-planner
claim follows. No new table, protection change or legal requirement is proposed.

Existing focused receipts recorded 12 replay, 38 attendance-source, 3 export, 2 final replay/editor
and 1 settled-line deletion test passing (`R/focused-*-behaviour.log`,
`R/focused-final-replay-editor.log`, `R/focused-closed-order-line.log`).
They support current dependencies, not future cleanup. Any implementation needs TDD (failing tests first) for
eligibility, boundaries, retained evidence, expired replay refusal and A1532 housekeeping integration.
Build only after your acceptance, in A1532's existing housekeeping seat. A664 places operational
cleanup after adviser agreement and G4; changing that order remains your decision
(`docs/superpowers/specs/2026-10-16-a664-data-retention-design.md:191`). This is no legal opinion.

**Owner decision:** accept this seven-day boundary now under existing housekeeping, including its
replay tradeoff and sequencing, or retain today's unbounded replies/watches pending wider A664 work?
