> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: open bills, ordering, sales, receipts and refunds

Researcher's proposal for the "orders and sales" area. Repository read at `main` 64eeabb036, read
only; nothing was run except greps and two small scripts that read the latest drizzle snapshots
(`packages/db/drizzle/meta/0204_snapshot.json`, `packages/venue-service/drizzle/meta/0072_snapshot.json`)
and the migration SQL of every set for live triggers. Every protection listed below comes from those
two reads. Where I say "read, not run", the claim rests on reading code only.

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

**Shape of the proposal.** 41 current tables become 21. Seven one-to-one side tables fold into their
parent, the four-table dish structure becomes columns on the line plus one link table, five write-mostly
logs move to `activity_log`, two counters/histories are replaced, one unbuilt feature's table goes,
and the two refund tables become one.

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
| department_id | text | null, FK departments **or plain id — decision D1** | `order_service_contexts.department_id` |
| service_mode | text | null | `order_service_contexts.service_mode` |
| editor_id | text | null, plain person id (persons is in the identity set) | `bill_edit_states.editor_id` |
| editor_version | integer | not null, default 0 | `bill_edit_states.editor_version` |
| delivery_table_id / delivery_table_label | text | null, FK dining_tables | — |
| revision | integer | not null, default 0 | — |
| invoice_type, recipient_tax_id, recipient_legal_name, recipient_address, recipient_country_code, recipient_identifier_type, recipient_identifier_country_code, invoice_delivery, receipt_locale | text | invoice_type not null default `F2`, rest null | — |

Dropped: `location_id` (R10). Protections: every current one (§5), plus the folded tables' checks
(service-mode enum; editor_version ≥ 0; bill name 1–40 trimmed; bill_number a whole number ≥ 1 and
only with a party; partial unique `(party_id, bill_number) where bill_number is not null`), plus the
new unique `order_number`. Zone, department and service mode are all-or-none (a bill with no recorded
context today raises `order.service_context_missing`, 11 non-test sites, so the columns stay nullable).

### 1.2 `working_order_lines` — one priced row on a bill: a dish, or an extra under a dish

Core set, `state`. ≈1,000–1,500/day, ≈360,000–540,000/year. Absorbs `working_line_contexts`,
`line_service_cancellations`, `working_line_portions` and `order_portions`.

Keeps all 31 current columns (id, working_order_id, line_no, name, product_id, variant_name,
variant_descriptions, variant_kitchen_name, kitchen_name, descriptions, option_snapshots, unit_name,
unit_precision, quantity, price_quantity, unit_price_gross, vat_class, line_total, category, served_at,
served_quantity, course_id, make_at_station_id, parent_line_id, note, sent_at, extra_list_id,
classification, group_id, credited_to, list_unit_price_gross) and adds:

| column | type | null | from |
|---|---|---|---|
| menu_item_id | text | null, FK menu_items or plain id (D1) | working_line_contexts |
| menu_id, menu_name | text | null | working_line_contexts |
| menu_version_id | text | null, FK menu_versions or plain id (D1) | working_line_contexts |
| offer_department_id, department_name | text | null | working_line_contexts (the department when the line was added; it can differ from the bill's after a move, `packages/venue-service/src/operations.ts:1174` "retaining existing line snapshots") |
| unit_id | text | null, plain id (as today) | working_line_contexts |
| sold_in_each | integer flag | null | working_line_contexts |
| hardware_unit | text | null | working_line_contexts |
| allergens, diet, diet_derivation, diet_override | text | null | working_line_contexts |
| late_period_name, late_confirmed_by | text | null | working_line_contexts |
| offer_unit_name, offer_unit_precision, offer_vat_class, offer_category_name | text/int | null | working_line_contexts — **kept only if measure M3 shows they differ from the line's own `unit_name`/`unit_precision`/`vat_class`/`category`; otherwise dropped** |
| service_cancelled_quantity | integer | null | line_service_cancellations.quantity |
| service_cancelled_at | text | null | line_service_cancellations.cancelled_at |
| service_cancel_was_started | integer flag | null | line_service_cancellations.was_started |
| service_cancelled_by | text | null, plain person id | line_service_cancellations.actor_id |
| cohort_id | text | null | order_portions.cohort_id |
| cohort_ordinal | integer | null | order_portions.ordinal |
| whole_portion | integer flag | null | `not order_portions.measured` |

The line id *is* the dish's identity: a portion is born with its line (every `registerPortions`
caller makes a fresh line id and a fresh portion id together: `working-order.ts:1760, 6525`,
`order-groups.ts:389`, `draft-recall.ts:279`; `registerPortions` refuses to rebind a line,
`order-portions.ts:173-179`), moves with it (lines move in place, `working-order.ts:4092-4103`), and
is cancelled exactly when the line is deleted (`cancelPortions`, `order-portions.ts:372-383`, called
at every bound-line delete: `working-order.ts:3230, 3334, 6623`).
Protections: all current ones plus the folded checks (§5); `unique(cohort_id, cohort_ordinal)`;
cohort columns all-or-none and only on dish rows (`parent_line_id is null`); service-cancel columns
all-or-none with quantity > 0; a new trigger refusing any change to `cohort_id`, `cohort_ordinal`,
`whole_portion` once set (this replaces `order_portions` being append-only).

### 1.3 `order_amendments` — hash-chained log of a bill being placed or cancelled after placing

Keep as is. Core, `state`, append-only. ≈50/day, ≈18,000/year. A typed history because it is a
tamper-evident chain (each entry hashes the previous, `packages/db/src/append-order-amendment.ts`),
which `activity_log` is not. Read back by the appender (previous hash), `packages/db/src/backup-evidence.ts:191-196`
(chain check) and attendance (`apps/server/src/attendance-facts.ts:21-23`).

### 1.4 `order_groups` — a batch of a party's order released to the kitchen together

Keep, plus one column `last_joined_at text null` (when lines last joined this group), so
`apps/server/src/service-step-signals.ts:118-136` can read first/last order times from
`order_groups.created_at` and `last_joined_at` instead of `order_group_events`. Core, `state`.
≈400–600/day, ≈150,000–220,000/year.

### 1.5 `order_group_hold_stations` — stations that printed a held group's HOLD ticket

Keep (link table, both sides are rows: R7). Core, `state`. ≈100–400/day.

### 1.6 `order_drafts` — one waiter's unsent order round

Keep, plus `taken_over_from text null` (plain person id: the owner before the latest takeover), which
replaces the till's read of `order_draft_events` in `takenOverFrom` (`apps/server/src/order-drafts.ts:1931-1955`).
Core, `state`. ≈500–750/day, ≈180,000–270,000/year (finished headers are kept; the
`draft.already_submitted` refusal reads their state, `order-drafts.ts:1527-1528`).

### 1.7 `order_draft_lines` — a line in an unsent round: a new dish, or a sent dish recalled for change

Absorbs `order_draft_recalled_lines`. Core, `state`. 0–110 rows at any moment (deleted on send/discard).
Columns: id PK, draft_id FK, position, **source_line_id** (null, FK working_order_lines on delete
cascade, partial unique), menu_item_id (now null), variant_id, menu_version_id, options (now null),
extras (now null), note, quantity (now null), course_id FK, make_at_station_id FK, slot, join_group_id FK,
after_group_id FK, no_merge. New CHECK: exactly one of `menu_item_id` / `source_line_id`; a recalled
row carries no options, extras, quantity or note; quantity > 0 on a new-dish row. Both kinds already
share `position`, `slot`, `join_group_id`, `after_group_id` and the same three slot checks.

### 1.8 `service_commands` — the recorded answer to each till command, so a retry is answered, not redone

Keep. Core, `state`. ≈1,000–3,000/day, ≈360,000–1,000,000/year; never pruned (D7).

### 1.9 `bill_payments` and 1.10 `bill_payment_lines`

Keep both as they are (ledger; payments guarded by triggers; lines append-only, `line_id` a plain id
on purpose, `packages/db/src/schema/bill-payments.ts:101-108`). ≈100–150/day and ≈0–100/day.

### 1.11 `refunds` — money given back, before or after the invoice (D4)

Merges `bill_payment_refunds` (before invoice) and `tender_refunds` (after). Core, `ledger`, not
append-only (outcome moves under a guard trigger; never deleted). ≈0–3/day.
Columns: the union — id PK; **either** `bill_payment_id` (FK bill_payments) **or** `sale_id` + `tender_id`
(FK sales, tenders), CHECK exactly one kind; submission_id, fingerprint, applied_amount, tip_amount,
reason, authorized_by, requested_by, attested_by, attestation_note, source, device_id (FK), node_id
(null; tender kind only today), method, manual, provider, provider_payment_ref, state, created_at,
completed_at, failed_at, sent_at, send_count, refs_before_send, provider_refund_ref, provider_status,
last_lookup_at, next_retry_at. `location_id` dropped (R10). Unique keys become partial per kind:
`(bill_payment_id, submission_id)`, `(sale_id, submission_id)`, plus tender_refunds' three partial
uniques. If D4 is declined, keep both tables unchanged except `tender_refunds.location_id`.

### 1.12 `tenders` — each payment applied to an issued sale

Keep. Core, `ledger`, append-only. ≈250–350/day.

### 1.13 `sales` — the immutable issued invoice or simplified ticket

Keep, plus four columns fixed when the sale is written (R2), moved from two append-only side tables
that are written in the same transaction right after `recordSale` (`apps/server/src/receipt-guests.ts:29-48`):

| column | type | null | from |
|---|---|---|---|
| receipt_guest_count | integer | null (CHECK 1–999) | sale_receipt_guests.guest_count |
| receipt_department_id | text | null, FK departments or plain id (D1) | sale_receipt_headers.department_id |
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

### 1.16 `sale_settlements`, 1.17 `sale_substitutions`, 1.18 `unpaid_departures`, 1.19 `invoice_deliveries`

Keep as they are. Settlement is a later fact than the sale (deferred settlement, `settle-sale.ts:36-40`),
and `sales` is append-only, so it stays a separate append-only row (R1's lifetime exception).
Substitution is a link of two sale rows (R7). An unpaid departure is a later, append-only fact on a
bill and a sale. Invoice deliveries are a queue with retries (one row per generation).

### 1.20 `department_transfer_destinations`, 1.21 `department_transfer_requests` (venue-service set)

Keep. Destinations are a link of two departments (R7); requests have their own identity and
lifecycle. Their natural owner is whoever owns `departments` (venuebox area) — §7.

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
| department_transfer_destinations | venue-service | state | no | 0–6 |
| department_transfer_requests | venue-service | state | no | ≈0–7,000 |

Columns this area asks other areas to add: `departments.transfer_desk_profile_id` (venuebox),
`parties.last_bill_number` (floorkitchen). See §7.

---

## 2. Settings documents

None. No current table in this area is a switch, number, time or text. The one configuration table,
`department_transfer_desks`, chooses a row (a device profile), so R4 makes it a column on
`departments`, not a document field; `department_transfer_destinations` is a list of department pairs
(R7). No `box_settings` fields.

---

## 3. History

**To `activity_log`** (audit; product hot paths no longer read them):

| kind | subject_kind / subject_id | person_id / device_id | data | from | ≈/day |
|---|---|---|---|---|---|
| `order_line.moved` | order_line / line id | actor | from_order_id, to_order_id | order_portion_events (moved) | 10–50 together |
| `order_line.cancelled` | order_line / line id | actor | order_id | order_portion_events (cancelled) | |
| `order_group.submitted`, `.joined`, `.fired`, `.reordered`, `.lines_moved`, `.removed` | order_group / group id (party when no group) | person, or device for a kitchen display | party_id, detail | order_group_events | ≈1,000 |
| `order_draft.created`, `.taken_over`, `.submitted`, `.discarded` | order_draft / draft id | actor | party_id, from_person, to_person, detail | order_draft_events | ≈800–1,200 |
| `sale.copy_printed` | sale / sale id | requester | print_job_id | receipt_reprints | 5–20 |
| `sale.invoice_pdf_downloaded` | sale / sale id | requester | — | invoice_pdf_downloads | 0–10 |

That is ≈1,800–2,300 rows/day, ≈650,000–830,000/year from this area. Remaining readers after the move:
attendance (`apps/server/src/attendance-facts.ts:16-42`, `attendance-discovery.ts:139-151`, people
area) reads the order_group/order_draft kinds by person and time; the dashboard order detail
(`apps/server/src/orders-list.ts:740-753, 1105-1120`) reads the two `sale.*` kinds by subject. Both are
occasional reads, not till hot paths; they need an index on `(subject_kind, subject_id)` and on `at`
(central definition, §7). The hot reads were replaced by columns: `order_drafts.taken_over_from` and
`order_groups.last_joined_at`.

**Typed histories that remain:** `order_amendments` (hash chain; read by `append-order-amendment.ts`,
`backup-evidence.ts:191-196`, attendance). Ledger rows that are history by nature and read back by
product code: `sale_settlements` (`settle-sale.ts`, `tender-refund-balance.ts`, the two coverage
triggers), `sale_substitutions` (`invoice-lookup-api.ts`, `orders-list.ts`), `unpaid_departures`
(`orders-list.ts`), `sale_line_dishes` (`cancellation-refund-value.ts`). Nothing in this area goes to
the fiscal history log.

---

## 4. Mapping (every current table)

| current | fate | why |
|---|---|---|
| working_orders | keep | the bill; absorbs three side tables, loses location_id |
| working_order_lines | keep | the line; absorbs four side tables |
| order_amendments | keep | hash-chained typed history, legal tamper-evidence |
| order_portion_events | → activity_log | write-only: no reader outside tests (`rg -l -w orderPortionEvents`) |
| order_portions | merge into working_order_lines | a portion is born, moves and dies with its line (§1.2); "outlives a deleted line" serves only the write-only events and the unbuilt pre-bill (A446) |
| sale_line_portions | rename to sale_line_dishes | link now points at the dish line |
| working_line_portions | merge into working_order_lines | one row per line, keyed by line id |
| service_commands | keep | idempotency record with its own identity |
| order_group_events | → activity_log | audit + attendance; the one hot read moves to order_groups.last_joined_at |
| order_groups | keep | real thing; gains last_joined_at |
| order_group_hold_stations | keep | link table of two rows (R7) |
| order_draft_events | → activity_log | audit + attendance; the till read moves to order_drafts.taken_over_from |
| order_draft_lines | keep | absorbs recalled lines |
| order_drafts | keep | real thing; gains taken_over_from |
| order_draft_recalled_lines | merge into order_draft_lines | same thing (a line in a draft), same lifetime, same slot columns |
| line_service_cancellations | merge into working_order_lines | one optional row per line, same lifetime |
| receipt_reprints | → activity_log | audit of who asked for a copy; sale and time already on print_jobs |
| sale_receipt_guests | merge into sales | fixed in the same transaction as the sale |
| invoice_pdf_downloads | → activity_log | audit only |
| working_order_counters | delete | `max(order_number)+1` under the write lock plus a unique index (D-free; M1) |
| bill_payment_lines | keep | child rows of an item payment |
| bill_payment_refunds | merge into refunds | same real thing as tender_refunds (D4) |
| bill_payments | keep | money before the invoice, outcome moves |
| sale_lines | keep | fiscal copy by value |
| sale_settlements | keep | later fact on an immutable sale |
| sale_substitutions | keep | link of two sales (R7) |
| sales | keep | absorbs two append-only side tables |
| tenders | keep | payments on the sale |
| sale_voids | delete | no product writer: `recordVoid`'s only caller is the test helper `apps/server/src/testing/order-venue.ts:227`; backlog says "No till screen or server route calls `recordVoid` yet" (`docs/backlog.md:290`) (D3) |
| unpaid_departures | keep | later append-only fact |
| invoice_deliveries | keep | delivery queue |
| tender_refunds | merge into refunds | D4 |
| bill_edit_states | merge into working_orders | one row per bill, same lifetime |
| order_service_contexts | merge into working_orders | one row per bill, same lifetime (it is updated on moves, `operations.ts:1174-1205`) |
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
(read in `0198_recipient_identifier_guards.sql`); every folded column has to be placed. Moves of placed
and settled bills change party and number today (`move-bill.ts:300-314`), so `bill_number`,
`bill_name`, `zone_id`, `department_id`, `service_mode`, `editor_id`, `editor_version` must be free in
the same branches where `party_id` is free, and nothing else may loosen.

**working_order_lines** — kept: PK; indexes group, parent, order, course; unique (order, line_no); FKs
order (cascade), group, product (restrict), course, station, parent; CHECKs unit_precision,
quantity≠0, price_quantity>0, vat_class, line_no≥1; triggers `require_open_parent_insert/_update/_delete`
(0097, 0177), `check_locales_insert/_update`, `check_variant_locales_insert/_update` (0110); CF.
**Changed:** the four locale triggers join `locations` (`l.id = wo.location_id`); with R10 they must read
the venue's languages from wherever the venuebox area puts them. The open-parent update trigger lists
unchanged columns: the service-cancel columns join `served_quantity`/`served_at` in the "service state
may change on any bill" branch; every other folded column joins the frozen lists.

**working_line_contexts** → working_order_lines: FK menu_item, FK menu_version (D1); CHECKs
unit_precision 0–3, hardware_unit in kg/g/mg, vat_class enum (on the `offer_` columns if kept); cascade
from the line becomes inherent; CF dropped with the table.

**line_service_cancellations** → working_order_lines: quantity > 0 becomes a CHECK on
`service_cancelled_quantity`; cascade inherent.

**order_portions** → working_order_lines: unique (cohort, ordinal) → unique (cohort_id, cohort_ordinal);
ordinal ≥ 1 → CHECK; AO → a freeze trigger on the three cohort columns. Dropped: the row surviving
its line's deletion (reason in §4).

**working_line_portions** → working_order_lines: PK on line and unique portion become inherent (one
row); FK to portions dropped with the table; the "no delete rule, unbind first" note
(`packages/db/src/schema/order-portions.ts:33-36`) goes with it.

**sale_line_portions** → sale_line_dishes: unique pair, index, FKs restrict, AO all kept; the portion FK
becomes a line FK (restrict).

**order_portion_events** → activity_log: AO kept (activity_log is append-only). Dropped: FK to portion,
CHECKs kind and destination (the writer `recordPortionEvents`, `order-portions.ts:345-370`, builds the
only two shapes) — no reader exists to rely on them.

**order_group_events** → activity_log: AO kept. Dropped: FKs party/group/device, kind CHECK, actor
xor CHECK (the activity row names person or device; kinds are fixed in the writer
`order-groups.ts:2437-2443`).

**order_draft_events** → activity_log: AO kept; dropped FK draft and kind CHECK, same reason.

**receipt_reprints** → activity_log: AO kept; dropped FKs sale/print_job and unique print_job_id (an audit
row; a duplicate harms nothing). **invoice_pdf_downloads** → activity_log: AO kept; FK dropped.

**order_amendments, order_groups, order_group_hold_stations, order_drafts, service_commands,
bill_payments, bill_payment_lines, sale_lines, sale_settlements, sale_substitutions, tenders,
unpaid_departures, invoice_deliveries, department_transfer_destinations, department_transfer_requests**
— every PK, index, unique, FK, CHECK, trigger, AO and CF kept unchanged (lists in the snapshot read):
notably `sale_settlements_check_coverage` (0097), `tenders_reject_post_settlement` (0001),
`bill_payments_guard_update` / `_no_delete` (0097), `order_drafts_open_owner_uq` (partial),
`invoice_deliveries_active_uq` (partial), `department_transfer_requests_one_pending_key` (partial).

**order_draft_recalled_lines** → order_draft_lines: unique source_line_id → partial unique; FKs draft,
source line (cascade), join/after group kept; slot/place/after CHECKs already exist on draft lines;
new CHECK one-kind-only.

**sales** — all kept (`sales_series_invoice_number_key`, `sales_working_order_id_key`, all CHECKs,
`sales_recipient_identity_insert` (0198), AO, CF). Gains from **sale_receipt_guests** the guest-count
CHECK (whole number 1–999 or null); its AO is inherited. Gains from **sale_receipt_headers** the
department FK (D1); its AO is inherited.

**bill_payment_refunds / tender_refunds** → refunds: every CHECK kept, applied per kind where it differs
(`tender_refunds_reason_ck`, `_provider_ck`, `_provider_status_ck`, `_refs_ck` today exist only on the
tender kind); the two guard-update triggers become one trigger with a branch per kind; both no-delete
triggers become one; all unique keys kept as partial uniques per kind; FK location dropped (R10).

**bill_edit_states** → working_orders: version CHECK kept; cascade inherent.
**order_service_contexts** → working_orders: mode CHECK, zone FK, department FK (D1) kept; location dropped.
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

**sale_voids**: unique sale, index voided_at, FK, AO — dropped with the table (D3). Its readers'
checks go too: `settle-sale.ts:59-65`, `record-correction.ts:126-129`, `record-substitution.ts:101-104`,
`tender-refund-balance.ts:43-45`, `personal-data-actions.ts:123-126`.

**Guards that change:** `scripts/append-only-triggers.test.ts` EXPECTED loses order_portions,
order_portion_events, order_group_events, order_draft_events, receipt_reprints, sale_receipt_guests,
invoice_pdf_downloads, sale_voids, sale_receipt_headers, bill_number_allocations and gains
sale_line_dishes; `scripts/behavioural-triggers.test.ts`; `scripts/live-subscriptions.test.ts`
(dashboard subscriptions are named after tables, so removed table names leave the subscription lists).

---

## 6. Duplicates removed

1. **The dish's identity stored three times** — line id, portion id, and the binding row. One home: the
   line id (§1.2).
2. **Order number counter** — `working_order_counters.next_number` vs `max(working_orders.order_number)`.
   One home: working_orders (only one product insert site, `working-order.ts:1724-1726`).
3. **Bill number history** — `bill_number_allocations` (every number) vs `bill_identities.number`
   (current). One home: `working_orders.bill_number` plus `parties.last_bill_number` as the counter.
4. **The bill's party, twice** — `working_orders.party_id` and `bill_identities.party_id`. They move
   together on moves (`move-bill.ts:228-235, 312-314`) but not on a merge: `rescopeBillNumbers`
   renumbers every non-abandoned bill of the old party into the new one
   (`bill-identities.ts:32-45`), while the merge moves only open and placed bills
   (`table-actions.ts:237`), so a settled bill ends up numbered in one party and belonging to another
   (read, not run). One home: `working_orders.party_id`; the merge moves settled bills too (D6).
5. **Unit, VAT class and category, twice per line** — line's `unit_name`/`unit_precision`/`vat_class`/
   `category` vs context's `unit_name`/`unit_precision`/`vat_class`/`category_name`. They are not
   obviously equal (the line leaves the unit name out for an "Each" unit, `working-order.ts:957-958`;
   the context always has one, `operations.ts:1464`). One home if M3 shows equality; else both,
   named apart.
6. **Who asked for a receipt copy** — `receipt_reprints.sale_id` / `requested_at` duplicate
   `print_jobs.sale_id` / `created_at`. One home: print_jobs for the job, activity_log for the person.
7. **Two location columns** — `working_orders.location_id`, `order_service_contexts.location_id`,
   `tender_refunds.location_id`: removed (R10).
8. **Two refund tables with ~20 shared columns** — one home `refunds` (D4).
9. **Draft owner history vs current owner** — the till only needs the previous owner; one column
   `order_drafts.taken_over_from`, history to activity_log.

Kept on purpose, not duplicates: `sale_lines` copying working lines by value (the filed record must not
change with the menu); `sales.counterparty_*` copying `working_orders.recipient_*` (the bill's choice
is editable until issue, the sale's is not); `tenders` copying a bill payment's amounts
(`tenders.bill_payment_id`; the tender is part of the immutable sale record, the bill payment's outcome
moves); `working_orders.status = 'settled'` ("the bill is finished", set when the sale is recorded,
e.g. `till-sale.ts:1050-1055`) vs `sale_settlements` ("the sale is fully paid", may be later);
`order_groups.hold_printed_at` (group-level time, read in kitchen paths) beside the per-station links;
`order_drafts.party_id` beside `bill_id` (a party-level draft has no bill).

---

## 7. Depends on other areas

- **venuebox**: `departments` gains `transfer_desk_profile_id` (FK device_profiles, on delete set null).
  `departments` lives in the venue-service set, which runs after core (`requires: { core, catalogue }`,
  `packages/composition/src/modules.ts:193`); core tables cannot hold a foreign key into it — D1.
  The line locale triggers need the venue's languages from wherever `locations`' replacement puts them.
  `nodes`: `working_orders.node_id`, `sales.node_id`, `refunds.node_id` assume `nodes` stays a table.
- **floorkitchen**: `parties.last_bill_number integer not null default 0` (plus a no-decrease trigger);
  FKs to `parties`, `floor_zones`, `dining_tables`, `kitchen_stations`, `kitchen_courses`.
  `ticket_items.working_order_id` copies the line's bill and is rewritten on every line move
  (`working-order.ts:4106-4109`) — a duplicate in their area that this area's lines are the source for.
  `kitchen_print_job_lines` FK working_order_lines.
- **menu**: FKs from lines to `menu_items`, `menu_versions` (catalogue set, after core) — D1;
  `products` (core).
- **devices**: `print_jobs` (invoice_deliveries FK; activity_log names print_job_id), `devices`,
  `device_profiles`, `page_printers`, `print_agents`.
- **fiscal**: `registros_facturacion.sale_id`, `payments.working_order_id / sale_id / bill_payment_id`,
  `adjustments.working_order_id`, `adjustment_lines.line_id`, `adjustment_refunds.tender_refund_id`
  (becomes `refund_id` if D4), `drawer_opens` → tender_refunds (same). `sales.fiscal_backend/fiscal_state`
  and `invoice_series` stay theirs. The void (D3) is also a fiscal-backend operation (`recordVoid` in
  `packages/fiscal-verifactu/src/backend.ts:405`).
- **people**: attendance reads `order_amendments`, `bill_payments`, and (after this change) the
  `order_group.*` / `order_draft.*` kinds in `activity_log` instead of two tables.
- **central**: `activity_log` needs indexes on `(subject_kind, subject_id)` and `at` (or `(kind, at)`).

---

## 8. Measure before building

- **M1 order numbers.** Time `select max(order_number)+1` with a unique index at 90,000 and 900,000 bills
  (expected: an index seek). Run the suites with the new unique index: test seeds insert fixed numbers
  (`packages/payments/test/seed.ts:66-67` always 1). Failing result that changes the design: none expected
  for speed; a product path needing a repeated number would keep the counter.
- **M2 wider line rows.** Time the till bill read and the kitchen print query for a 40-line bill with the
  ~20 extra columns. Failing result: a measurable slowdown on the bill screen would be the "real need"
  (R6) to keep the context columns in a side table.
- **M3 duplicated line fields.** On a seeded demo venue and across the apps/server suite's databases,
  count lines whose `unit_name`, `unit_precision`, `vat_class`, `category` differ from their context's.
  Non-zero (beyond "Each" units) means keep both, named apart.
- **M4 dish ordinals.** With the registry gone, a cancelled dish's ordinal is no longer remembered, so
  `max(cohort_ordinal)+1` may reuse it. Run the portion, recall and sale-projection suites; a failure
  means storing the cohort's next ordinal on the first dish row.
- **M5 sale links to lines.** Run the full apps/server suite with `sale_line_dishes.dish_line_id`
  restricting deletes. Any refusal means a path deletes a sold dish line, which today silently succeeds.
- **M6 attendance from activity_log.** Time `readAttendanceFacts` for one day with a year of
  activity_log (≈650,000–830,000 rows from this area plus other areas'). A slow result means a typed
  `order_events` table instead (D5).
- **M7 service-step signals.** Compare first/last order times from `order_groups.created_at` /
  `last_joined_at` against the event-based result in `service-step-signals` tests, including merged
  parties (events keep the old party id; groups move with `moveGroupsToParty`).
- **M8 triggers.** Run the transition and open-parent trigger suites after the column lists are rewritten;
  add a case per folded column on placed and settled bills.
- **M9 service_commands.** Time the replay lookup at 1,000,000 rows (a unique-index seek; expected fine).

---

## 9. Decisions for the owner

- **D1. Venue-service and catalogue columns on core tables.** Folding the bill's zone/department/mode,
  the line's menu snapshot and the sale's receipt header into core tables makes core rows point at
  `departments` (venue-service set) and `menu_items`/`menu_versions` (catalogue set), which migrate after
  core. Options: move `departments` into core (venuebox researcher's call), or hold those three ids as
  plain ids with the reason at the column. **Recommend:** fold into core either way; foreign keys where
  the target ends up in core, plain ids otherwise. This moves four tables out of the venue-service set.
- **D2. Dish identity = line id.** The A803 plan kept a portion row "even if a mutable working line is
  deleted" (`docs/superpowers/plans/2026-10-19-a803-bills-and-tables.md:74-77`), for pre-bills that link
  to every invoice their dishes reached (spec §3.9, backlog A446, not built). Today nothing reads a
  deleted dish's portion. **Recommend:** fold; the pre-bill design brings its own record when built.
- **D3. Delete `sale_voids`.** No till screen or route can void (`docs/backlog.md:290`). The owner's
  2026-09-24 decision on which day a void counts stands for when it is built. **Recommend:** delete now.
- **D4. One `refunds` table.** Before- and after-invoice refunds share most columns and the same
  lifecycle; two recovery loops and the dashboard Payments screen read both. **Recommend:** merge, in its
  own slice after the rest, because it touches money paths and the fiscal area's `adjustment_refunds`
  and `drawer_opens` keys.
- **D5. Order-round history to `activity_log`.** ≈1,800 rows/day; attendance reads it.
  **Recommend:** yes, subject to M6; fallback is one typed `order_events` table.
- **D6. Bill numbers on a merge.** Move settled bills into the surviving party too, so one party column
  is the numbering scope; the counter lives on `parties`. **Recommend:** yes.
- **D7. Prune `service_commands`.** A record is useful only while a retry can arrive; it is the fastest-
  growing table here. **Recommend:** delete records a day after their party or bill closes (a small
  housekeeping job); not required for the redesign.
