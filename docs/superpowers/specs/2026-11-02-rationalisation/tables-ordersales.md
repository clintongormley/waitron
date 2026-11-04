> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: open bills, ordering, sales, receipts and refunds

Researcher's proposal for the "orders and sales" area, brought into line with the owner's review of
4 November 2026 (ledger: `docs/handoffs/2026-11-02-schema-rationalisation.md`). First read at `main`
64eeabb036; every passage the review changed was re-read at `main` e0da0ad18a. Nothing was run except
greps and small scripts that read the drizzle snapshots and the migration SQL of every set for live
triggers. Every protection listed below comes from those reads. Where I say "read, not run", the claim
rests on reading code only.

**The area in one paragraph.** A bill while it is being served is a `working_orders` row with its
`working_order_lines` (one row per dish since A803: a dish ordered ×3 becomes three rows of 1,
`apps/server/src/order-portions.ts:46-104`). Unsent dishes sit in a waiter's draft
(`order_drafts` / `order_draft_lines`) until sent; sent dishes are released to the kitchen in order
groups (`order_groups`). Money taken before the invoice is a `bill_payments` row. When the bill is
invoiced, `packages/core/src/record-sale.ts` writes one immutable `sales` row (at most one per bill:
unique `sales.working_order_id`) and `sale_lines` copied by value from the working lines, with
identical dishes grouped into one sale line; `sale_line_portions` records which dishes each sale line
stands for. Payment of the sale is `tenders` plus one `sale_settlements` row ("fully paid"), which may
come later than the sale (`packages/core/src/settle-sale.ts:36-40`, "the deferred half of the sale
write path"). Refunds before the invoice are `bill_payment_refunds`; after it, `tender_refunds`.

**Shape of the proposal.** 41 current tables become 24. Ten one-to-one side tables fold into a parent
(three into `working_orders`, three into `working_order_lines`, two into `sales`, one into
`order_draft_lines`, one into `departments`), `bill_number_allocations` becomes a counter on `parties`
and `working_order_counters` is deleted. The three event tables become one typed `order_events`, the
two refund tables become one `refunds`, and two tables people read move to `activity_log`.

---

## 1. Target tables

Reference venue: 250 bills/day, 4 dish lines each (plus extras rows), 360 days/year.
"Plain id" means a column holding another row's id with no foreign key, with the reason given.

### 1.1 `working_orders` — a bill (or counter order) from opening until it is finished

Core set, `state`, not append-only. ≈250/day, ≈90,000/year (never deleted:
`rg -i 'delete\((schema\.)?workingOrders\b|delete from working_orders'`, tests excluded, finds nothing).
Absorbs `order_service_contexts`, `bill_identities`, `bill_edit_states`.

| column | type | key / null | from |
|---|---|---|---|
| id | text | PK | — |
| source | text | not null | — |
| device_id | text | null, FK devices (restrict) | — |
| node_id | text | null, FK nodes | — (see §7) |
| order_number | integer | not null, **UNIQUE (new)** | replaces `working_order_counters` |
| label | text | null | — |
| status | text | not null, default `open` | — |
| opened_at / settled_at / collected_at / payment_attempt_at | text | settled_at etc. null | — |
| party_id | text | null, FK parties | — |
| bill_number | integer | null | `bill_identities.number` |
| bill_name | text | null | `bill_identities.name` |
| zone_id | text | null, FK floor_zones | `order_service_contexts.zone_id` |
| department_id | text | null, FK departments | `order_service_contexts.department_id` |
| service_mode | text | null | `order_service_contexts.service_mode` |
| editor_id | text | null, FK persons (README U11) | `bill_edit_states.editor_id` |
| editor_version | integer | not null, default 0 | `bill_edit_states.editor_version` |
| delivery_table_id / delivery_table_label | text | null, FK dining_tables | — |
| revision | integer | not null, default 0 | — |
| invoice_type, recipient_tax_id, recipient_legal_name, recipient_address, recipient_country_code, recipient_identifier_type, recipient_identifier_country_code, invoice_delivery, receipt_locale | text | invoice_type not null default `F2`, rest null | — |

Dropped: `location_id` (R10). No order, bill, kitchen or refund code filters on it since A1301 S11
(#2411), but every new order still fills it (`apps/server/src/working-order.ts:1719`). Protections:
every current one (§5), plus the folded tables' checks (service-mode enum; editor_version ≥ 0; bill
name 1–40 trimmed; bill_number a whole number ≥ 1 and only with a party; partial unique
`(party_id, bill_number) where bill_number is not null`), plus the new unique `order_number`. Zone,
department and service mode are all-or-none (a bill with no recorded context today raises
`order.service_context_missing`, 11 non-test sites, so the columns stay nullable). A merge of two
parties moves settled bills too, so `party_id` is the one numbering scope; on a settled bill the
freeze rule gains an exception for five columns: `party_id`, `bill_number`, `bill_name`, `editor_id`
and `editor_version` (owner, 2026-11-04; §5).

### 1.2 `working_order_lines` — one priced row on a bill: a dish, or an extra under a dish

Core set, `state`. ≈1,000–1,500/day, ≈360,000–540,000/year. Absorbs `working_line_contexts`,
`working_line_portions` and `order_portions`. `line_service_cancellations` stays its own table (§1.22).

Keeps all 31 current columns (id, working_order_id, line_no, name, product_id, variant_name,
variant_descriptions, variant_kitchen_name, kitchen_name, descriptions, option_snapshots, unit_name,
unit_precision, quantity, price_quantity, unit_price_gross, vat_class, line_total, category, served_at,
served_quantity, course_id, make_at_station_id, parent_line_id, note, sent_at, extra_list_id,
classification, group_id, credited_to, list_unit_price_gross) and adds:

| column | type | null | from |
|---|---|---|---|
| menu_item_id | text | null, FK menu_items | working_line_contexts |
| menu_id, menu_name | text | null | working_line_contexts |
| menu_version_id | text | null, FK menu_versions | working_line_contexts |
| offer_department_id, department_name | text | null | working_line_contexts (the department when the line was added; it can differ from the bill's after a move, `packages/venue-service/src/operations.ts:1080` "retaining existing line snapshots") |
| unit_id | text | null, plain id (as today) | working_line_contexts |
| sold_in_each | integer flag | null | working_line_contexts |
| hardware_unit | text | null | working_line_contexts |
| allergens, diet, diet_override | text | null | working_line_contexts; `diet_derivation` goes with recipes (`tables-menu.md` §4) |
| late_period_name, late_confirmed_by | text | null; late_confirmed_by FK persons (README U11) | working_line_contexts |
| offer_unit_name, offer_unit_precision, offer_vat_class, offer_category_name | text/int | null | working_line_contexts — **kept only if measure M3 shows they differ from the line's own `unit_name`/`unit_precision`/`vat_class`/`category`; otherwise dropped** |
| cohort_id | text | null | order_portions.cohort_id |
| cohort_ordinal | integer | null | order_portions.ordinal |
| whole_portion | integer flag | null | `not order_portions.measured` |

**The line is the dish's identity** (owner, 2026-11-04). A dish record is born with its line: every
`registerPortions` caller makes a fresh line id and a fresh dish record together
(`apps/server/src/working-order.ts:1749, 6600`, `order-groups.ts:391`, `draft-recall.ts:234-275`), and
`registerPortions` refuses to rebind a line (`order-portions.ts:173-179`). It moves with its line:
lines move in place (`working-order.ts:4189, 4199`). It is cancelled at each delete of a whole dish
(`cancelPortions`, `order-portions.ts:372-380`, called at `working-order.ts:3258, 3384, 6700`); the two
other deletes of working lines remove extras under a dish that stays (`working-order.ts:6375`,
`draft-recall.ts:189`). Read, not run.

The A803 plan kept a portion row "even if a mutable working line is deleted"
(`docs/superpowers/plans/2026-10-19-a803-bills-and-tables.md:74-77`), for pre-bills that link to every
invoice their dishes reached. The pre-bill is now built to the strict reading (A446, owner, 2026-11-04)
and takes the line id as the dish's identity; the pre-bill of a line deleted later keeps its printed
copy. A803 §3.1 and §3.9 change to match (§7).

Protections: all current ones plus the folded checks (§5); `unique(cohort_id, cohort_ordinal)`;
cohort columns all-or-none and only on dish rows (`parent_line_id is null`); a new trigger refusing any
change to `cohort_id`, `cohort_ordinal`, `whole_portion` once set (this replaces `order_portions` being
append-only).

### 1.3 `order_amendments` — hash-chained log of a bill being placed or cancelled after placing

Keep, plus an index on `event_at` for attendance (`tables-people.md`; §8 M6). Core, `state`, append-only.
≈50/day, ≈18,000/year. A typed history because it is a
tamper-evident chain (each entry hashes the previous, `packages/db/src/append-order-amendment.ts`),
which `activity_log` is not. Read back by the appender (previous hash), `packages/db/src/backup-evidence.ts:191-196`
(chain check) and attendance (`apps/server/src/attendance-facts.ts:19-20`).

### 1.4 `order_groups` — a batch of a party's order released to the kitchen together

Keep, unchanged. First and last order times stay a read of the group events
(`apps/server/src/service-step-signals.ts:118-136`), now from `order_events`. _(2026-11-04, A803 slice 4b: this read is now at
`service-step-signals.ts:125-163`, groups by party, and also takes `lines_moved` events whose `detail` has
`arrived` as a party's order times when it has none of its own; M7's `last_joined_at` would have to carry
those too.)_ If §8 M7 fails, the group
gains a column `last_joined_at text null` instead. Core, `state`. ≈400–600/day, ≈150,000–220,000/year.

### 1.5 `order_group_hold_stations` — stations that printed a held group's HOLD ticket

Keep (link table, both sides are rows: R7). Core, `state`. ≈100–400/day.

### 1.6 `order_drafts` — one waiter's unsent order round

Keep, unchanged. The till's previous owner stays a read of the takeover events in `takenOverFrom`
(`apps/server/src/order-drafts.ts:1879-1902`), now from `order_events`. If §8 M7 fails, the draft gains
a column `taken_over_from text null` (FK persons) instead. Core, `state`. ≈500–750/day, ≈180,000–270,000/year (finished headers are kept; the
`draft.already_submitted` refusal reads their state, `order-drafts.ts:1481-1482`).

### 1.7 `order_draft_lines` — a line in an unsent round: a new dish, or a sent dish recalled for change

Absorbs `order_draft_recalled_lines`. Core, `state`. 0–110 rows at any moment (deleted on send/discard).
Columns: id PK, draft_id FK, position, **source_line_id** (null, FK working_order_lines on delete
cascade, partial unique), menu_item_id (now null), variant_id, menu_version_id, options (now null),
extras (now null), note, quantity (now null), course_id FK, make_at_station_id FK, slot, join_group_id FK,
after_group_id FK, no_merge. New CHECK: exactly one of `menu_item_id` / `source_line_id`; a recalled
row carries no options, extras, quantity or note; quantity > 0 on a new-dish row. Both kinds already
share `position`, `slot`, `join_group_id`, `after_group_id` and the same three slot checks.

### 1.8 `service_commands` — the recorded answer to each till command, so a retry is answered, not redone

Keep. Core, `state`. ≈1,000–3,000/day, ≈360,000–1,000,000/year if never pruned. A record is useful
only while a retry can arrive, so the daily tidy-up job (`jobs.md`) deletes records a day after their
party or bill closes (owner, 2026-11-04). That is a separate small job, and it waits until the longest
possible till retry is confirmed (§8 M10).

### 1.9 `bill_payments` and 1.10 `bill_payment_lines`

Keep both as they are, plus an index on `bill_payments.created_at` for attendance (`tables-people.md`;
§8 M6). Ledger; payments guarded by triggers; lines append-only, `line_id` a plain id on purpose
(`packages/db/src/schema/bill-payments.ts:101-108`). ≈100–150/day and ≈0–100/day.

### 1.11 `refunds` — money given back, before or after the invoice

Merges `bill_payment_refunds` (before invoice) and `tender_refunds` (after), in its own slice after the
rest of this area, because it touches money paths and the fiscal area's `adjustment_refunds` key (owner,
2026-11-04). Core, `ledger`, not append-only (outcome moves under a guard trigger; never deleted).
≈0–3/day.
Columns: the union — id PK; **either** `bill_payment_id` (FK bill_payments) **or** `sale_id` + `tender_id`
(FK sales, tenders), CHECK exactly one kind; submission_id, fingerprint, applied_amount, tip_amount,
reason, authorized_by, requested_by, attested_by, attestation_note, source, device_id (FK), node_id
(null; tender kind only today), method, manual, provider, provider_payment_ref, state, created_at,
completed_at, failed_at, sent_at, send_count, refs_before_send, provider_refund_ref, provider_status,
last_lookup_at, next_retry_at, and the new `drawer_opened_at` (below). `location_id` dropped (R10).
Person columns get keys to `persons` (README U11). Unique keys become partial per kind:
`(bill_payment_id, submission_id)`, `(sale_id, submission_id)`, plus tender_refunds' three partial
uniques.

`drawer_opened_at` (text, null, new) is when this refund opened the cash drawer. `drawer_opens` moves
to `activity_log` (`tables-devices.md`), and product logic never decides from that log, so the "a
refund opens the drawer at most once" check (`apps/server/src/receipt-print.ts:636-640`) reads this
column instead. Today's check runs only for after-invoice refunds; the bill path (`enqueueBillDrawer`,
`receipt-print.ts:541`) has none and gains none, but stamps the column too, so it means the same on
both kinds. The guard triggers name the columns that may not change, so a new column would be free to
change at will (`packages/db/drizzle/0163_tender_refund_transitions.sql:1-46`); the merged trigger
makes it set-once. `tables-devices.md` §3 holds the clause and the stand-in test that proves it.

Attendance reads `requested_by`, `created_at` and `state`, so `refunds` gets an index on `created_at`
(`tables-people.md`; §8 M6).

### 1.12 `tenders` — each payment applied to an issued sale

Keep. Core, `ledger`, append-only. ≈250–350/day.

### 1.13 `sales` — the immutable issued invoice or simplified ticket

Keep, plus four columns fixed when the sale is written (R2), moved from two append-only side tables
that are written in the same transaction right after `recordSale` (`apps/server/src/receipt-guests.ts:29-48`):

| column | type | null | from |
|---|---|---|---|
| receipt_guest_count | integer | null (CHECK 1–999) | sale_receipt_guests.guest_count |
| receipt_department_id | text | null, FK departments | sale_receipt_headers.department_id |
| receipt_trading_name | text | null | sale_receipt_headers.trading_name |
| receipt_prints_trading_name | integer flag | null | sale_receipt_headers.print_trading_name |

`recordSale`'s input gains these values so they go in the one insert. Core, `ledger`, append-only.
≈250/day, ≈90,000/year.

### 1.14 `sale_lines`

Keep (the fiscal copy by value; deliberately not deduplicated against working lines, §6). ≈1,000–1,300/day.

### 1.15 `sale_line_dishes` — which dishes each filed sale line stands for

Rename of `sale_line_portions`; `portion_id` becomes `dish_line_id` (FK working_order_lines, restrict).
Columns: id PK, sale_line_id (FK sale_lines restrict), dish_line_id. Unique `(sale_line_id, dish_line_id)`,
index on dish_line_id. Core, `ledger`, append-only. ≈1,000–1,500/day. Still a many-to-many link: one
sale line stands for several identical dishes, and one dish links to its dish row and its extras' rows
and can appear in a later substitution sale (`order-portions.ts:386-404`; readers
`apps/server/src/cancellation-refund-value.ts:44-89`).

### 1.16 `sale_settlements`, 1.17 `sale_substitutions`, 1.18 `unpaid_departures`

Keep as they are. Settlement is a later fact than the sale (deferred settlement, `settle-sale.ts:36-40`),
and `sales` is append-only, so it stays a separate append-only row (R1's lifetime exception).
Substitution is a link of two sale rows (R7). An unpaid departure is a later, append-only fact on a
bill and a sale.

### 1.19 `invoice_deliveries` — the record of each time an invoice was sent, printed or handed over

Core, `state`. ≈700–7,000/year. A record only, no longer a queue (owner, 2026-11-04, devices review):
an A4 page goes through `print_jobs` and an email through `outgoing_mail`, so one sender drains one mail
queue and one print path carries every printer. One row per generation, as today.

| column | type | key / null |
|---|---|---|
| id | text | PK |
| sale_id | text | not null, FK sales (restrict) |
| print_job_id | text | null, FK print_jobs (restrict), unique |
| printer_id | text | null, FK printers (restrict); was `page_printer_id` |
| request_key | text | not null, unique with sale_id |
| medium | text | not null: email, a4, receipt |
| designation | text | not null: original, duplicate |
| status | text | not null: queued, sending, sent, failed, unknown |
| generation | integer | not null, unique with sale_id |
| recipient | text | set exactly on email rows |
| made_by_retry, printer_chosen | integer flag | not null |
| person_id | text | FK persons (README U11); null only on a receipt row |
| created_at, completed_at, expired_at | text | created_at not null |
| failure_code | text | null |
| reported_outcome, reported_at, reported_failure_code | text | null |

Leaving: `attempts`, `next_attempt_at`, `claim_token_hash`, `claimed_by`, `claimed_agent_id`, `claimed_at`
and `printer_hold`. The attempt belongs to the job or the mail row. `tables-devices.md` §1.7 draws the
job's side, with the print agent's changed messages, and `jobs.md` §2 drafts `outgoing_mail`, whose row
names its delivery in `subject_id`, so this table needs no key to it. `printer_id` stays because a
delivery to a printer disabled after staging is recorded failed with no job
(`apps/server/src/invoice-delivery.ts:70-83`). `expired_at` and the three `reported_` columns stay because
they say how a delivery ended, late successes included (`invoice-delivery-status.ts:332, 347`), and no
queue row outlives that. The printer-hold alert follows `printer_hold` to `print_jobs`
(`apps/server/src/alert-sources.ts:504-509`).

### 1.20 `department_transfer_destinations`, 1.21 `department_transfer_requests`

Keep. Destinations are a link of two departments (R7); requests have their own identity and
lifecycle. Both move to the core set with `departments` (README U1).

### 1.22 `line_service_cancellations` — a dish's service cancelled while its charge stays

Keep as it is: `line_id` PK (FK working_order_lines, cascade), `quantity` (> 0), `cancelled_at`,
`was_started`, `actor_id`, which gains a key to `persons` (README U11). Core, `state`, one optional row
per line. It stays separate for the same reason as `allergy_line_ticks`: its facts change on a frozen
line. `apps/server/src/line-cancel.ts` works on settled bills (`:183`, `:206`, `:393`), writes this row
at `:558-561`, and a later split rewrites it (`line-service-state.ts:163-176`). The line's freeze trigger
(0177) lets a settled line change only `group_id`, `sent_at` or the two served columns. Folding would
need a new exception there for every settled line. Read, not run.

### 1.23 `order_events` — what happened to a bill's dishes, rounds and drafts, and who did it

One typed, append-only history (owner, 2026-11-04; README U3). Replaces `order_portion_events`,
`order_group_events` and `order_draft_events`. Core, `state`, append-only. ≈1,800–2,300/day,
≈650,000–830,000/year.

| column | type | key / null | from |
|---|---|---|---|
| id | text | PK | all three |
| kind | text | not null, CHECK | see below |
| at | text | not null | `at`, `created_at` |
| actor_id | text | null, FK persons | all three |
| actor_device_id | text | null, FK devices | group events |
| party_id | text | null, FK parties | group events |
| group_id | text | null, FK order_groups | group events |
| draft_id | text | null, FK order_drafts | draft events |
| line_id | text | null, plain id: a cancelled dish's line is deleted and this row outlives it | `portion_id` (the line is the dish, §1.2) |
| from_order_id, to_order_id | text | null, plain ids, as today | dish events |
| from_person, to_person | text | null, FK persons | draft events |
| detail | JSON | not null, default `{}` | group and draft events |

`kind` is one of `dish.moved`, `dish.cancelled`; `group.submitted`, `.joined`, `.fired`, `.reordered`,
`.lines_moved`, `.removed`; `draft.created`, `.taken_over`, `.submitted`, `.discarded`. The prefix keeps
the two `submitted` kinds apart. One CHECK per family carries today's rules: a dish row has `line_id` and
`from_order_id`, `moved` has a different `to_order_id` and `cancelled` none; a group row has `party_id`
and exactly one of `actor_id` and `actor_device_id`; a draft row has `draft_id`, `actor_id` and
`to_person`. `group_id` stays null on a reorder, which names every held group in `detail`.

Indexes: `(actor_id, at)` (README U3), `party_id`, `group_id`, `draft_id`. Attendance reads all of them
by day, not by person, so §8 M6 decides whether `at` needs its own index.

### 1.24 `sale_voids` — a sale voided by appending a row

Keep as it is (amended R5: built, sound, and the fiscal void needs it). Core, `ledger`, append-only.
No product route writes it yet: `recordVoid`'s only caller is the test helper
`apps/server/src/testing/order-venue.ts:227`, and the backlog says "No till screen or server route calls
`recordVoid` yet" (`docs/backlog.md:285`). Its readers stay: `settle-sale.ts:59-65`,
`record-correction.ts:126-129`, `record-substitution.ts:101-104`, `tender-refund-balance.ts:41-43`,
`personal-data-actions.ts:123-126`. `voided_by` gains a key to `persons` (README U11). 0 rows today.

### Summary of target tables (this area)

| table | set | class | append-only | rows/year |
|---|---|---|---|---|
| working_orders | core | state | no | ≈90,000 |
| working_order_lines | core | state | no | ≈360,000–540,000 |
| order_amendments | core | state | yes | ≈18,000 |
| order_groups | core | state | no | ≈150,000–220,000 |
| order_group_hold_stations | core | state | no | ≈36,000–140,000 |
| order_drafts | core | state | no | ≈180,000–270,000 |
| order_draft_lines | core | state | no | ≈0 kept |
| service_commands | core | state | no | ≈360,000–1,000,000 |
| bill_payments | core | ledger | guarded | ≈36,000–54,000 |
| bill_payment_lines | core | ledger | yes | ≈0–36,000 |
| refunds | core | ledger | guarded | ≈0–1,000 |
| tenders | core | ledger | yes | ≈90,000–125,000 |
| sales | core | ledger | yes | ≈90,000 |
| sale_lines | core | ledger | yes | ≈360,000–470,000 |
| sale_line_dishes | core | ledger | yes | ≈360,000–540,000 |
| sale_settlements | core | ledger | yes | ≈90,000 |
| sale_substitutions | core | ledger | yes | ≈0–1,800 |
| unpaid_departures | core | ledger | yes | ≈0–50 |
| invoice_deliveries | core | state | no | ≈700–7,000 |
| department_transfer_destinations | core | state | no | 0–6 |
| department_transfer_requests | core | state | no | ≈0–7,000 |
| line_service_cancellations | core | state | no | a few a day at most; not measured |
| order_events | core | state | yes | ≈650,000–830,000 |
| sale_voids | core | ledger | yes | 0 today |

Columns this area asks other areas to add: `departments.transfer_desk_profile_id` (venuebox),
`parties.last_bill_number` (floorkitchen). See §7.

---

## 2. Settings documents

None. No current table in this area is a switch, number, time or text. The one configuration table,
`department_transfer_desks`, chooses a row (a device profile), so R4 makes it a column on
`departments`, not a document field; `department_transfer_destinations` is a list of department pairs
(R7).

---

## 3. History

**To `activity_log`** (for people to read; product logic never decides from it):

| kind | subject_kind / subject_id | person_id / device_id | data | from | ≈/day |
|---|---|---|---|---|---|
| `sale.copy_printed` | sale / sale id | requester | print_job_id | receipt_reprints | 5–20 |
| `sale.invoice_pdf_downloaded` | sale / sale id | requester | — | invoice_pdf_downloads | 0–10 |

That is ≈5–30 rows/day, ≈1,800–11,000/year. The dashboard's order dialog shows both to a person
(`readOrderDetail`, `apps/server/src/orders-list.ts:658-685`; `readReprints`, `:1103-1118`;
`readPdfDownloads`, `:736-749`), so `activity_log` needs its `(subject_kind, subject_id)`
index for them. `readReprints` joins `print_jobs` for the printer's name and keeps only copies of a
receipt (`:1112-1115`), so after the move it joins on `data.print_job_id`. The rows have four writers:
`orders-api.ts:332`, `orders-reprint.ts:40`, `tender-refund-api.ts:220`, `transaction-receipt-api.ts:79`.

**Typed histories that remain:** `order_events` (§1.23; README U3). Attendance reads the group and
draft kinds by day (`apps/server/src/attendance-facts.ts:22-30`, `attendance-discovery.ts:129-140`;
people area). `service-step-signals` and the till's `takenOverFrom` read them too (§8 M7). Nothing reads the dish kinds yet: outside tests and test helpers, a grep for
`orderPortionEvents` finds only its schema, its writer and the package export.
`order_amendments` (hash chain; read by `append-order-amendment.ts`, `backup-evidence.ts:191-196`,
attendance). Ledger rows that are history by nature and read back by product code: `sale_settlements`
(`settle-sale.ts`, `tender-refund-balance.ts`, the two coverage triggers), `sale_substitutions`
(`invoice-lookup-api.ts`, `orders-list.ts`), `unpaid_departures` (`orders-list.ts`), `sale_line_dishes`
(`cancellation-refund-value.ts`). Nothing in this area goes to the fiscal history log.

---

## 4. Mapping (every current table)

| current | fate | why |
|---|---|---|
| working_orders | keep | the bill; absorbs three side tables, loses location_id |
| working_order_lines | keep | the line; absorbs four side tables |
| order_amendments | keep | hash-chained typed history, legal tamper-evidence |
| order_portion_events | → order_events | one typed history (README U3); no reader outside tests yet |
| order_portions | merge into working_order_lines | a portion is born, moves and dies with its line (§1.2) |
| sale_line_portions | rename to sale_line_dishes | link now points at the dish line |
| working_line_portions | merge into working_order_lines | one row per line, keyed by line id |
| service_commands | keep | idempotency record with its own identity |
| order_group_events | → order_events | typed history (README U3); attendance and service-step signals read it |
| order_groups | keep | real thing |
| order_group_hold_stations | keep | link table of two rows (R7) |
| order_draft_events | → order_events | typed history (README U3); attendance and the till's takeover read it |
| order_draft_lines | keep | absorbs recalled lines |
| order_drafts | keep | real thing |
| order_draft_recalled_lines | merge into order_draft_lines | same thing (a line in a draft), same lifetime, same slot columns |
| line_service_cancellations | keep | its facts change on a frozen line (§1.22) |
| receipt_reprints | → activity_log | who asked for a copy; the order dialog shows it to a person, nothing decides from it; sale and time already on print_jobs |
| sale_receipt_guests | merge into sales | fixed in the same transaction as the sale |
| invoice_pdf_downloads | → activity_log | who downloaded the PDF; the order dialog shows it to a person, nothing decides from it |
| working_order_counters | delete | `max(order_number)+1` under the write lock plus a unique index (§8 M1) |
| bill_payment_lines | keep | child rows of an item payment |
| bill_payment_refunds | merge into refunds | same real thing as tender_refunds |
| bill_payments | keep | money before the invoice, outcome moves |
| sale_lines | keep | fiscal copy by value |
| sale_settlements | keep | later fact on an immutable sale |
| sale_substitutions | keep | link of two sales (R7) |
| sales | keep | absorbs two append-only side tables |
| tenders | keep | payments on the sale |
| sale_voids | keep | amended R5: built and sound; the fiscal void needs it (§1.24) |
| unpaid_departures | keep | later append-only fact |
| invoice_deliveries | keep, record only | A4 through print_jobs, email through outgoing_mail (§1.19) |
| tender_refunds | merge into refunds | §1.11 |
| bill_edit_states | merge into working_orders | one row per bill, same lifetime |
| order_service_contexts | merge into working_orders | one row per bill, same lifetime (it is updated on moves, `operations.ts:1080-1101`) |
| sale_receipt_headers | merge into sales | fixed in the same transaction as the sale |
| working_line_contexts | merge into working_order_lines | one row per line, same lifetime |
| department_transfer_desks | merge into departments | one row per department, chooses a row (R4) |
| department_transfer_destinations | keep | link table (R7) |
| department_transfer_requests | keep | own identity and lifecycle |
| bill_identities | merge into working_orders | one row per bill |
| bill_number_allocations | merge into parties (counter `last_bill_number`) | history kept only to compute the next number (`bill-identities.ts:10-26`); a counter on the party does that |

---

## 5. Protections

Abbreviations: CF = the generated change-feed triggers every classified table gets
(`CORE_CHANGE_SOURCES`, `packages/db/src/classification.ts`); AO = the generated append-only
update/delete triggers (`installAppendOnlyTriggers`, `packages/store/src/append-only.ts`).

**working_orders** — kept: PK; indexes status, opened_at, party_id; FKs device (restrict), node,
delivery table, party; CHECKs status, source, source↔device, status↔settled_at; triggers
`working_orders_invoice_type_insert/_update` (0104), `working_orders_recipient_identity_insert/_update`
and `working_orders_enforce_transition` (0198); CF. Dropped: FK location (R10). **The transition
trigger must be rewritten**: it lists, per allowed transition, which columns must stay unchanged
(read in `0198_recipient_identifier_guards.sql`); every folded column has to be placed.

- On an open or placed bill, the folded columns are free in the same branches where `party_id` is free.
- **On a settled bill the freeze gains one exception: `party_id`, `bill_number`, `bill_name`,
  `editor_id` and `editor_version` may change, and nothing else may loosen** (owner, 2026-11-04). Today's settled branches pin `party_id`,
  except that a paid bill not yet handed over may leave its party once
  (`moveSettledBillToCounter`, `apps/server/src/move-bill.ts:292-317`). Three things need the exception:
  a merge moving settled bills (§6 item 4), including collected ones, since `rescopeBillNumbers` renumbers
  every bill that is not abandoned (`packages/venue-service/src/bill-identities.ts:32-44`); that counter
  move, which also clears the number (`move-bill.ts:313`) and rewrites the editor state
  (`relocateBillEditor`, `move-bill.ts:314`, which bumps the version, `apps/server/src/bill-editing.ts:76-108`);
  and naming a settled bill (`setBillName`,
  `apps/server/src/bill-identities.ts:28-52`). As today, only the server limits when these happen.
- `zone_id`, `department_id` and `service_mode` stay pinned on a settled bill: the move above keeps its
  zone, and the merge's zone change reaches open and placed bills only (`table-actions.ts:237-241`).

**working_order_lines** — kept: PK; indexes group, parent, order, course; unique (order, line_no); FKs
order (cascade), group, product (restrict), course, station, parent; CHECKs unit_precision,
quantity≠0, price_quantity>0, vat_class, line_no≥1; triggers `require_open_parent_insert/_update/_delete`
(0097, 0177), `check_locales_insert/_update`, `check_variant_locales_insert/_update` (0110); CF.
**Changed:** the four locale triggers join `locations` (`l.id = wo.location_id`); they read the
venue's languages from the `settings` row `venue` instead (`tables-venuebox.md` §5, §8.2). The
open-parent update trigger lists unchanged columns, and every folded column joins the frozen lists.
Nothing updates a context or portion row today (grep for `update(` on `workingLineContexts`,
`workingLinePortions` and `orderPortions` outside tests finds none).

**working_line_contexts** → working_order_lines: FK menu_item, FK menu_version; CHECKs
unit_precision 0–3, hardware_unit in kg/g/mg, vat_class enum (on the `offer_` columns if kept); cascade
from the line becomes inherent; CF dropped with the table.

**order_portions** → working_order_lines: unique (cohort, ordinal) → unique (cohort_id, cohort_ordinal);
ordinal ≥ 1 → CHECK; AO → a freeze trigger on the three cohort columns. Dropped: the row surviving
its line's deletion (§1.2).

**working_line_portions** → working_order_lines: PK on line and unique portion become inherent (one
row); FK to portions dropped with the table; the "no delete rule, unbind first" note
(`packages/db/src/schema/order-portions.ts:33-36`) goes with it.

**sale_line_portions** → sale_line_dishes: unique pair, index, FKs restrict, AO all kept; the portion FK
becomes a line FK (restrict).

**order_portion_events, order_group_events, order_draft_events** → order_events: AO kept. Kept too:
the group events' FKs to party, group and device, the draft events' FK to draft, and their party, group
and draft indexes. The kind, actor and destination CHECKs become the per-family CHECK of §1.23. Changed:
the portion FK becomes the plain `line_id` (§1.23). Gained: person keys (README U11) and the
`(actor_id, at)` index. CF: none of the three is a live-update source.

**receipt_reprints** → activity_log: AO kept; dropped FKs sale/print_job and unique print_job_id. A
duplicate row shows one copy twice, and nothing decides from it. **invoice_pdf_downloads** →
activity_log: AO kept; FK dropped.

**order_amendments, order_groups, order_group_hold_stations, order_drafts, service_commands,
bill_payments, bill_payment_lines, sale_lines, sale_settlements, sale_substitutions, tenders,
unpaid_departures, sale_voids, line_service_cancellations, department_transfer_destinations,
department_transfer_requests** — every PK, index, unique, FK, CHECK, trigger, AO and CF kept unchanged
(lists in the snapshot read): notably `sale_settlements_check_coverage` (0097),
`tenders_reject_post_settlement` (0001), `bill_payments_guard_update` / `_no_delete` (0097),
`order_drafts_open_owner_uq` (partial), `department_transfer_requests_one_pending_key` (partial),
`sale_voids_sale_id_key`. Gained: the time indexes on `order_amendments` and `bill_payments` (§1.3, §1.9).

**invoice_deliveries** — kept: PK, `_print_job_uq`, `_request_uq`, `_generation_uq`,
`invoice_deliveries_active_uq` (partial), the medium, designation, status, generation, person and email
CHECKs, the sale FK, CF. The FK to `page_printers` becomes the FK to `printers`. Dropped with their
columns: `_attempts_ck` and the FK to `print_agents`.

**order_draft_recalled_lines** → order_draft_lines: unique source_line_id → partial unique; FKs draft,
source line (cascade), join/after group kept; slot/place/after CHECKs already exist on draft lines;
new CHECK one-kind-only.

**sales** — all kept (`sales_series_invoice_number_key`, `sales_working_order_id_key`, all CHECKs,
`sales_recipient_identity_insert` (0198), AO, CF). Gains from **sale_receipt_guests** the guest-count
CHECK (whole number 1–999 or null); its AO is inherited. Gains from **sale_receipt_headers** the
department FK; its AO is inherited.

**bill_payment_refunds / tender_refunds** → refunds: every CHECK kept, applied per kind where it differs
(`tender_refunds_reason_ck`, `_provider_ck`, `_provider_status_ck`, `_refs_ck` today exist only on the
tender kind); the two guard-update triggers become one trigger with a branch per kind, plus the set-once
rule for `drawer_opened_at` (§1.11); both no-delete triggers become one; all unique keys kept as partial
uniques per kind; FK location dropped (R10).

**bill_edit_states** → working_orders: version CHECK kept; cascade inherent.
**order_service_contexts** → working_orders: mode CHECK, zone FK, department FK kept; location dropped.
**bill_identities** → working_orders: scope, number and name CHECKs and the party/number unique kept
(partial). **bill_number_allocations** → `parties.last_bill_number`: its unique (party, number) is covered
by the working_orders partial unique; its AO plus "never give a number twice" becomes a trigger refusing
any decrease of `last_bill_number`. Dropped: venue-service's backup check that treats it as immutable.

**working_order_counters**: no constraint beyond its FK; its "immutable" entry in
`CORE_BACKUP_TABLE_POLICIES` (`packages/db/src/backup-evidence.ts:95-104`) goes. Order numbers are not a
fiscal series (`packages/db/src/allocate-order-number.ts:13-16`), so losing that backup check is acceptable.

**department_transfer_desks** → departments: FK department inherent; FK device_profiles
(on delete cascade today) becomes `on delete set null` on the column, which is what deleting the desk
row did.

**Guards that change:** `scripts/append-only-triggers.test.ts` EXPECTED loses order_portions,
order_portion_events, order_group_events, order_draft_events, receipt_reprints, sale_receipt_guests,
invoice_pdf_downloads, sale_receipt_headers, bill_number_allocations and sale_line_portions, and gains
sale_line_dishes and order_events; `scripts/behavioural-triggers.test.ts`;
`scripts/live-subscriptions.test.ts` (dashboard subscriptions are named after tables, so removed table
names leave the subscription lists).

---

## 6. Duplicates removed

1. **The dish's identity stored three times** — line id, portion id, and the binding row. One home: the
   line id (§1.2).
2. **Order number counter** — `working_order_counters.next_number` vs `max(working_orders.order_number)`.
   One home: working_orders (only one product insert site, `working-order.ts:1716-1718`).
3. **Bill number history** — `bill_number_allocations` (every number) vs `bill_identities.number`
   (current). One home: `working_orders.bill_number` plus `parties.last_bill_number` as the counter.
4. **The bill's party, twice** — `working_orders.party_id` and `bill_identities.party_id`. They move
   together on moves but not on a merge: `rescopeBillNumbers` renumbers every non-abandoned bill of the
   old party into the new one (`packages/venue-service/src/bill-identities.ts:32-44`), while the merge
   moves only open and placed bills (`apps/server/src/table-actions.ts:237`), so a settled bill ends up
   numbered in one party and belonging to another (read, not run). One home: `working_orders.party_id`.
   A merge moves settled bills too (owner, 2026-11-04), so `setBillName` no longer needs a separate
   "numbering party" (`apps/server/src/bill-identities.ts:23-26`).
5. **Unit, VAT class and category, twice per line** — line's `unit_name`/`unit_precision`/`vat_class`/
   `category` vs context's `unit_name`/`unit_precision`/`vat_class`/`category_name`. They are not
   obviously equal (the line leaves the unit name out for an "Each" unit, `working-order.ts:951-952`;
   the context always has one, `operations.ts:1376`). One home if M3 shows equality; else both,
   named apart.
6. **Who asked for a receipt copy** — `receipt_reprints.sale_id` / `requested_at` duplicate
   `print_jobs.sale_id` / `created_at`. One home: print_jobs for the job, activity_log for the person.
7. **Two location columns** — `working_orders.location_id`, `order_service_contexts.location_id`,
   `tender_refunds.location_id`: removed (R10).
8. **Two refund tables with ~20 shared columns** — one home `refunds`.
9. **Draft owner history vs current owner** — the till only needs the previous owner, and reads it from
   `order_events`, so no second copy is stored unless §8 M7 fails.

Kept on purpose, not duplicates: `sale_lines` copying working lines by value (the filed record must not
change with the menu); `sales.counterparty_*` copying `working_orders.recipient_*` (the bill's choice
is editable until issue, the sale's is not); `tenders` copying a bill payment's amounts
(`tenders.bill_payment_id`; the tender is part of the immutable sale record, the bill payment's outcome
moves); `working_orders.status = 'settled'` ("the bill is finished", set when the sale is recorded,
e.g. `till-sale.ts:1050-1056`) vs `sale_settlements` ("the sale is fully paid", may be later);
`order_groups.hold_printed_at` (group-level time, read in kitchen paths) beside the per-station links;
`order_drafts.party_id` beside `bill_id` (a party-level draft has no bill).

---

## 7. Depends on other areas

- **venuebox**: `departments` gains `transfer_desk_profile_id` (FK device_profiles, on delete set null);
  `tables-venuebox.md` §1.10 lists it. Under U1 `departments` is in the core set, so bills and sales hold
  real keys into it. The line locale triggers read the venue's languages from the `settings` row
  `venue`. `nodes`: `working_orders.node_id`, `sales.node_id`, `refunds.node_id` assume `nodes` stays a
  table; it does.
- **floorkitchen**: `parties.last_bill_number integer not null default 0` (plus a no-decrease trigger), which
  `tables-floorkitchen.md` must list; FKs to `parties`, `floor_zones`, `dining_tables`, `kitchen_stations`,
  `kitchen_courses`. `ticket_items.working_order_id` copies the line's bill and is rewritten on every line
  move (`working-order.ts:4197-4200`) — a duplicate in their area that this area's lines are the source
  for. `kitchen_print_job_lines` FK working_order_lines.
- **menu**: FKs from lines to `menu_items`, `menu_versions` and `products`, all in core under U1.
- **devices**: `print_jobs` (invoice_deliveries FK; the `sale.copy_printed` row names print_job_id; A4
  pages now go through it), `devices`, `device_profiles`, `printers` (page printers merge in),
  `print_agents`. `drawer_opens` moves to `activity_log`; §1.11's `refunds.drawer_opened_at` replaces its
  refund-once read, and its key to `tender_refunds` goes with it.
- **jobs**: `outgoing_mail` carries invoice emails, so `jobs.md`'s mail sender drains one queue, and a mail
  row names its delivery. The daily tidy-up job prunes `service_commands` (§1.8).
- **fiscal**: `verifactu_records.sale_id`, `payments.working_order_id / sale_id / bill_payment_id`,
  `adjustments.working_order_id`, `adjustment_lines.line_id`, `adjustment_refunds.tender_refund_id`
  (becomes `refund_id`). `sales.fiscal_backend/fiscal_state` and `invoice_series` stay theirs. The void
  stays a fiscal-backend operation (`recordVoid` in `packages/fiscal-verifactu/src/backend.ts:415`), and
  `sale_voids` stays with it (§1.24).
- **people**: attendance reads `order_amendments`, `bill_payments`, `order_events` and `refunds` directly,
  and asks for a time index on each (`tables-people.md`).
- **central**: `activity_log` needs its `(subject_kind, subject_id)` index for §3's two kinds. The order
  dialog subscribes to `receipt_reprints` and `invoice_pdf_downloads` by name
  (`apps/dashboard/src/api/live-queries.ts:269, 273`), so either `activity_log` becomes a live-update
  source, or the dialog refreshes after those two actions.
- **A803**: §3.1 and §3.9 change: the line is the dish's identity, and a pre-bill records lines (§1.2).
  A803 is mid-build in lane C (slice 4b), so time the change around it.

---

## 8. Measure before building

- **M1 order numbers.** Time `select max(order_number)+1` with a unique index at 90,000 and 900,000 bills
  (expected: an index seek). Run the suites with the new unique index: test seeds insert fixed numbers
  (`packages/payments/test/seed.ts:68` takes the shared `seedWorkingOrder`, whose default is order
  number 1, `packages/db/src/testing/seed.ts:122-138`). Failing result that changes the design: none expected
  for speed; a product path needing a repeated number would keep the counter.
- **M2 wider line rows.** Time the till bill read and the kitchen print query for a 40-line bill with the
  ~21 extra columns. Failing result: a measurable slowdown on the bill screen would be the "real need"
  (R6) to keep the context columns in a side table.
- **M3 duplicated line fields.** On a seeded demo venue and across the apps/server suite's databases,
  count lines whose `unit_name`, `unit_precision`, `vat_class`, `category` differ from their context's.
  Non-zero (beyond "Each" units) means keep both, named apart.
- **M4 dish ordinals.** With the registry gone, a cancelled dish's ordinal is no longer remembered, so
  `max(cohort_ordinal)+1` may reuse it. Run the portion, recall and sale-projection suites; a failure
  means storing the cohort's next ordinal on the first dish row.
- **M5 sale links to lines.** Run the full apps/server suite with `sale_line_dishes.dish_line_id`
  restricting deletes. Any refusal means a path deletes a sold dish line, which today silently succeeds.
- **M6 attendance from `order_events`.** Time `readAttendanceFacts` for one day with a year of
  `order_events` (≈650,000–830,000 rows), plus `order_amendments`, `bill_payments` and `refunds`. It filters
  by day through `julianday(r.at)` (`apps/server/src/attendance-facts.ts:43`), which no index on a time
  column can serve as written, and README U3's `(actor_id, at)` index starts with the person. Failing
  result: a slow read means comparing the stored text and giving `order_events` an index on `at` too.
- **M7 the two reads that stay on the events.** With a year of `order_events` (≈650,000–830,000 rows) and
  the `party_id` and `draft_id` indexes, time the first/last order read in `service-step-signals` for a
  party with four merged members, and `takenOverFrom` for a till's whole list of drafts. Failing result: a
  read measurably slower than on today's three event tables. Then that read gets its column
  (`order_groups.last_joined_at` or `order_drafts.taken_over_from`), and the group column is checked
  against the event result, including merged parties: events keep the old party id, and groups move with
  `moveGroupsToParty`.
- **M8 triggers.** Run the transition and open-parent trigger suites after the column lists are rewritten;
  add a case per folded column on placed and settled bills, plus: a merge moving a settled, collected
  bill; a settled bill leaving for the counter, with its editor columns rewritten; naming a settled bill.
  Each must pass, and a change to any
  other column of a settled bill must still be refused.
- **M9 service_commands.** Time the replay lookup at 1,000,000 rows (a unique-index seek; expected fine).
- **M10 latest till retry.** Before the tidy-up job prunes `service_commands`, establish how late a till can
  retry a command, offline tills included. Failing result: a retry that can arrive more than a day after
  its bill closes means a longer wait before pruning, since a pruned record would let the command run twice.

---

## 9. Decisions for the owner

The owner settled D1 to D7 and the five-column exception on 4 November 2026; each is stated in the body.
No question is open in this area.
