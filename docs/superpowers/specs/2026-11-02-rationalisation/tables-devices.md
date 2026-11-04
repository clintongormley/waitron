> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: devices, device profiles and printers

Area: devices, join requests, device profiles and everything hanging off them, print agents,
printers, page printers, print jobs, drawer opens, themes and `tenant_receipts`. 27 current tables.

Brought into line with the owner's review of 4 November 2026. Every passage this update wrote was
checked at `main` e0da0ad18a, and so was every cite kept into a file that changed since
`68732329c1`. Everything else was last read at `68732329c1`, with a `git diff` between the two as
the receipt. Reading only, except the stand-in tests named where they are used (`node:sqlite`, Node
26.13, in the session scratchpad, not through the real store). Any other "the code does X" below is
a citation, not a test result.

**In one line:** 27 tables become 8: `devices`, `device_profiles`, `device_approved_profiles`,
`join_requests`, `print_agents`, `printers`, `print_jobs` and `custom_themes`. Lists that belong to
one device or one profile become JSON on that row (owner, 2026-11-04). A4 printers join `printers`.
Who may sign in on a profile is decided by role alone, so the per-person exceptions go. Drawer opens
move to `activity_log`, and "open the drawer once per refund" moves to a column on `refunds`. Stored
"taken away" notes for kitchen displays go. `tenant_receipts` is deleted. `invoice_deliveries`
becomes a record only, so A4 printing runs through `print_jobs`.

---

## 1. Target tables

Notation: `pk` primary key, `fk→t` foreign key to table t, `null` = nullable (otherwise NOT NULL).
All tables are in `venue.db` and in the core set (README §5 U1: venue-service and identity fold into
core). No table has `location_id` (R10, A1301). Reference venue: one restaurant, 250 bills a day with
4 lines each, 360 days a year, 4 tills, 2 kitchen screens and 3 thermal printers.

### Lists kept as JSON on their owner's row

The owner's exception to R4 (2026-11-04): a list that belongs to one device or one profile may be
JSON on that row. It covers the lists below. Nothing here puts a list into a settings document.

| Column | Shape | Was | Writer that validates it |
|---|---|---|---|
| `devices.made_here_station_ids` | array of station ids, default `[]` | `device_made_here_stations` | `apps/server/src/made-here.ts:255` |
| `devices.kitchen_views` | object keyed by view (below), default `{}` | `device_kitchen_screens` and its two child tables | `setDeviceKitchenScreens` (`packages/venue-service/src/kitchen-screens.ts:548`) |
| `device_profiles.kitchen_views` | the same object | `device_profile_kitchen_screens` and its two child tables | `replaceProfileKitchenScreens` (`kitchen-screens.ts:157`) |
| `device_profiles.order_zone_ids` | null = every zone of the department; else an array, where `[]` allows no zone | `device_profile_zones`, `device_profile_service_access.every_zone` | `writeScope` (`packages/venue-service/src/profile-access.ts:301`) |
| `device_profiles.printer_lists` | object keyed by role: `{ids: [...], defaultId}`, default `{}` | `device_profile_printers` | `setProfilePrinterLists` (`packages/layouts/src/device-printers.ts`) |
| `device_profiles.card_readers` | `{ids: [...], defaultId}`, default `{}` | `device_profile_card_readers` (`tables-fiscal.md` §1.3) | `setProfileReaderList` (`packages/payments/src/device-readers.ts`) |
| `device_profiles.admitted_roles` | array of roles, default `[]`, which means every role as no rows does today | `device_profile_admission_roles` | `setProfileAdmission` (`packages/identity/src/profile-admission.ts`) |
| `device_approved_profiles.zone_ids` | null = never saved; else an array | `device_zone_selection_zones`, and the marker `device_zone_selections` row | `setDeviceZoneSelection` (`packages/venue-service/src/device-zone-selection.ts`) |

A `kitchen_views` value is `{"pass": {"stationIds": [...] or null, "zoneIds": [...] or null,
"showNonPassStations": true}}`, with `station`, `pass` and `pass_monitor` as the only keys. Null in
`stationIds` or `zoneIds` means every one, which is the shape the code's reads already build
(`readStored`, `kitchen-screens.ts:60`). On a device, a null `showNonPassStations` means the
profile's value applies (`packages/venue-service/src/schema/kitchen-screens.ts`, the column comment).
The word is "view" because this is a setting for one way of looking at the kitchen, up to three per
device or profile. It is not a device, which is what `kitchen_screens` wrongly suggested.

Separate columns rather than one document, because four packages write them. One document would
make each writer read and rewrite the others' fields.

**Why this is safe.** Read back by owner almost everywhere: `git grep` for an `eq(`, `inArray(` or
`notInArray(` on each list table's value column, over non-test files, finds searches by value only
in delete and equipment flows: `printer-delete.ts:90,105`, `station-delete.ts:108`,
`station-delete-settings.ts:47,60`, `service-delete-settings.ts:134,142,230`,
`card-reader-delete.ts:113,123,137`, `demo-printer.ts:100`. No product code hard-deletes a printer,
a station or a zone (the same grep for `delete(printers)`, `delete(kitchenStations)` and
`delete(floorZones)` prints nothing outside test helpers), so today's foreign keys never fire on a
delete; explicit lines clear each list. A stand-in `json_each` search over 500 profiles took 0.15 ms
on average, against 0.06 ms for an indexed link table.

**What moves from the database to code.**

- Every writer checks that each id names a live row. The database holds only the shape: a CHECK of
  `json_valid(x) and json_type(x) = 'array'` (or `'object'`). Stand-in test: it refuses an object
  and bad text, and accepts a list. A CHECK cannot look inside a list, because that needs `json_each`
  and a CHECK takes no subquery. The writers above already check ids, except that card reader ids are
  checked by the one route that calls the writer (`requireKnownReader`,
  `apps/server/src/payments-api.ts:1013`). That check moves into the writer.
- A delete removes the id from every list in the same transaction, replacing today's `tx.delete`
  lines (`printer-delete.ts:178`, `station-delete.ts:193`, `station-delete-settings.ts:141-145`,
  `service-delete-settings.ts:378-398`, `card-reader-delete.ts:277-278`).
- **A stale id is not harmless on a printer list.** `setProfilePrinterLists` refuses "a deleted
  printer on any list or default, even one already stored there" (`device-printers.ts:96`), so a
  deleted printer left on a list would make that profile unsaveable. `deletePrinter` clearing the
  list is what prevents it, and nothing in the database backs that up. The kitchen and zone lists do
  tolerate one: their reads drop anything no longer active (`kitchen-screens.ts:86,104`), and the
  device zone read drops zones the profile no longer offers
  (`device-zone-selection.ts:69-72`).
- Unique pairs, "one default per role" and "a default is on its list" were keys or checks in the
  writer; they are all held by the writer now. The shape makes "one view per kind" and "one owner"
  automatic.
- Configuration export and import need new code, because neither looks inside JSON (§7).

### 1.1 `devices` — `state`, not append-only

What it is: each enrolled screen (till, phone, tablet, kitchen display) that signs in with a device
cookie. It keeps its row after Delete, because fiscal records, sales, orders and sessions point at it
(`registros_facturacion.device_id`, `sales.device_id`, `working_orders.device_id`,
`sessions.device_id`; each set's latest drizzle snapshot lists them).

| column | type | key / null |
|---|---|---|
| id | text | pk |
| device_profile_id | text | fk→device_profiles (restrict) |
| label | text | |
| token_hash | text | `""` once deleted (`apps/server/src/device-delete.ts:213`) |
| active | integer flag | default 1 |
| deleted_at | text | null |
| receipt_printer_id | text | null, fk→printers (restrict); kind `receipt` |
| payment_slip_printer_id | text | null, fk→printers (restrict); kind `receipt` |
| cash_drawer_printer_id | text | null, fk→printers (restrict); kind `receipt` |
| invoice_printer_id | text | null, fk→printers (restrict); either kind. Was this column plus `invoice_page_printer_id` |
| card_reader_id | text | null = use the profile's default. **No foreign key** (below). Was `device_card_readers` |
| made_here_station_ids | JSON | list, see above |
| kitchen_views | JSON | list, see above |
| last_seen_at | text | null |
| battery_level | integer | null |
| battery_charging | integer flag | null |
| battery_reported_at | text | null |
| enrolled_at | text | |

Removed: `location_id` (R10), and `created_at`. `created_at` is a second copy of `enrolled_at`: both
are filled at insert by `$defaultFn(nowIso)` (`packages/db/src/schema/devices.ts:71-72`). `git grep
-n -E "enrolled_at|enrolledAt *[:=]"` finds no code that rewrites either, and no reader of
`devices.createdAt`.

**`card_reader_id` has no foreign key, and cannot have one** (owner chose the column, 2026-11-04;
`tables-fiscal.md` §1.3). `card_readers` is in the switchable `payments` set. `packages/db` cannot
name its column, because `packages/payments` depends on `packages/db`, the same loop that
`packages/media/drizzle/0001_image_references.sql:13-18` describes. And in trading mode a box migrates
only its enabled modules' sets (`apps/server/src/boot.ts:1165-1167`), so the table need not exist.
Stand-in test: with `devices.card_reader_id` declared as a key to a table that does not exist, every
insert into `devices` is refused with `no such table`, even with a null reader. So the column is a
plain id: the reader's writer checks it, and Delete clears it (`card-reader-delete.ts:277`). Readers
are never hard-deleted, so today's `restrict` never fires. This reverses README U11's first bullet.

Protections: unique `label` among active devices (today `devices_location_label_active_key`, minus
the location). New CHECKs, which the code already holds but the schema left out only because a CHECK
would have made drizzle-kit rebuild `devices` (`devices.ts:46-48`, `:60-62`). A first migration
written fresh before go-live has no rebuild to avoid:
- `battery_level between 0 and 100` (held today only by `PUT /api/device/battery`, `devices.ts:60-61`);
- `deleted_at is null or active = 0` (Delete sets both, `device-delete.ts:211-212`);
- the shape CHECKs on the two JSON columns.

New trigger: `receipt_printer_id`, `payment_slip_printer_id` and `cash_drawer_printer_id` must name a
printer of kind `receipt`. Until now a plain foreign key said so, because A4 printers lived in another
table. A CHECK cannot read another row, so this takes a trigger. Stand-in test: the trigger refuses
an A4 printer in the receipt column, and an A4 printer in `invoice_printer_id` passes. It gets pinned
in `scripts/behavioural-triggers.test.ts`.

`invoice_printer_id is null or invoice_page_printer_id is null` goes: one column cannot hold two.

Rows: 6 live, plus deleted devices, which are kept.

The enrolled-device proof for till actions (A941, #2409) adds no column here. It checks that the
device the cookie proves is the device the staff session names (`assertRequestDevice`,
`apps/server/src/till-session.ts:148-156`), so it reads `devices.id`, `token_hash` and
`sessions.device_id`, all of which this design keeps. Its one change to how the row is written: a
passive read no longer stamps `last_seen_at` (`apps/server/src/device-session.ts:244`).

### 1.2 `device_profiles` — `state`, not append-only

What it is: a reusable set-up that devices run. It also holds what used to be side tables: its
ordering scope, its printer, reader and kitchen lists, and which roles may sign in.

| column | type | key / null |
|---|---|---|
| id | text | pk |
| name | text | |
| form_factor | text enum (`till`, `phone-portrait`, `tablet-landscape`, `kds`) | |
| capabilities | JSON array of capability flags (no ids) | default `[]` |
| inactivity_timeout_seconds | integer | null = never |
| starting_screen | text | null |
| order_department_id | text | null, fk→departments — was `device_profile_service_access.department_id` |
| order_starting_zone_id | text | null, fk→floor_zones — was `.starting_zone_id` |
| order_zone_ids | JSON | null = every zone; list, see above |
| kitchen_views | JSON | list, see above |
| printer_lists | JSON | list, see above |
| card_readers | JSON | list, see above. Owned by `payments`; stays `{}` when that module is off |
| admitted_roles | JSON | list, see above |
| created_at, updated_at | text | |
| retired_at | text | null |

Protections:
- kept: unique live `name` (`device_profiles_live_name_key`), and the form-factor CHECK;
- kept: the trigger `device_profile_form_factor_locked`
  (`packages/db/drizzle/0161_restore_profile_form_factor_lock.sql`);
- new: CHECK `(order_department_id is null) = (order_starting_zone_id is null) and
  (order_department_id is not null or order_zone_ids is null)`. This is the side table's NOT NULLs
  restated: either the whole scope is there or none of it is (a profile with no row was unrestricted,
  `packages/venue-service/src/schema/service.ts:160-161`);
- new: CHECK `form_factor <> 'kds' or inactivity_timeout_seconds is null`. The code already forces
  this on write and the schema says the database does not (`device-profiles.ts:44-45`);
- new: the shape CHECKs on the JSON columns.

`admitted_roles` holds role values today, and role ids once A1002 lands. A1002 also replaces the
empty-means-every rule and has deleting or retiring a role clear the list (A1002 §3, §6).

There is no `device_profile_admission_persons`, so there are no per-person exceptions: a person's
access changes with their role (owner, 2026-11-04). The owner was told the limit: today a person
holds one of four roles, so a change of access means a change of role. A1002 proposes several roles
per person, which makes "remove them from their roles" work finely once it lands. `admits`
(`packages/identity/src/profile-admission.ts:50`) loses its exception branch, the Device profiles
screen loses its people list (`device-profiles-screen.ts:2307`), and `personExceptions` leaves the
management API (`management-api.ts:635`). A1002's design keeps exceptions in several places and has
to change (§7).

Rows: 3–6 live, plus retired ones.

### 1.3 `device_approved_profiles` — `state` (merged with `device_zone_selections`)

What it is: one row per device per profile the device may run, holding what the device remembers
for that profile.

| column | type | key / null |
|---|---|---|
| device_id | text | pk part, fk→devices (no action; `device-delete.ts` deletes explicitly) |
| device_profile_id | text | pk part, fk→device_profiles (cascade) |
| starting_zone_id | text | null, fk→floor_zones — was `device_zone_selections.starting_zone_id` |
| zone_ids | JSON | null = the device never saved a zone choice under this profile (today: "no `device_zone_selections` row", `device-zone-selection.ts:47`) |

`zones_saved_at`, proposed earlier, is gone: nothing read the time, and null in `zone_ids` already
says never saved. A saved list can be empty, when a Delete took its last zone; that differs from
null, and the read handles it (`device-zone-selection.ts:73`).

Protections: the PK, and both FKs. New CHECK `starting_zone_id is null or zone_ids is not null`, plus
the shape CHECK allowing null. A delete can leave a saved list with a null start
(`service-delete-settings.ts:386-388`), so the reverse does not hold.

Meaning: the device's active profile (`devices.device_profile_id`) counts as approved whether or not
it has a row, as it does today (`apps/server/src/device.ts:186-187`). The difference is that saving a
zone choice under the active profile now writes a row here. `readApprovedAlternatives` already
leaves the active profile out (`device.ts:156`), so nothing new appears in the list. Two writers
change, because a row now holds zone memory:

- `keepApprovedAfterSwitch` stops deleting the new active profile's row (`device.ts:220`).
- `approveDeviceProfiles` stops deleting every row and re-inserting (`device.ts:190`). As written,
  that would forget the zones of every profile on each approval save. It deletes only rows no longer
  named and not the active profile's, and inserts the new ones.

Withdrawing approval of a profile forgets the device's zones for it (owner, 2026-11-04): the
remembered zones are useful only while the device may run that profile.

Rows: 4–12.

### 1.4 `join_requests` — `local`, not append-only

Columns as today minus `location_id`: `id pk, node_id, kind (device|print_agent, CHECK), label,
token_hash, verification_number, decoy_numbers (JSON list of two-digit numbers, not ids), created_at`.
`node_id` stays. It is how a `local` table says which node a row belongs to (CLAUDE.md §3), and every
verb filters on it (`apps/server/src/join-requests.ts:27`). With one box, it always holds that box's
id. Rows: 0–2.

Since A1301 S12 (#2421), `join_requests.location_id` is written but never read: the request is
stamped with `venueLocationId(tx)` (`join-requests.ts:208`), and an accept stamps the new `devices`
or `print_agents` row the same way instead of copying the request's value (`:561`, `:608`).
`git grep -n "joinRequests.locationId"` over `apps` and `packages` on main prints one line, a test
(`apps/server/src/join-requests.test.ts`). So no product code loses anything when the column goes.

### 1.5 `print_agents` — `state`

As today minus `location_id`: `id pk, name, host null, setup_url null, setup_port null, node_id null
(unique), token_hash, active, last_seen_at null, enrolled_at`. Unique `node_id`
(`print_agents_tenant_node_key`) keeps "at most one self-enrolled agent per node" (used at
`join-requests.ts:707-720`). Second box: the reason `node_id` has no FK is the mirror
(`packages/db/src/schema/print-agents.ts:21-23`, `apps/server/src/mirror-bundle.ts`). The column
itself is also needed with one box. Rows: 1–2.

### 1.6 `printers` — `state` (absorbs `printer_holders` and `page_printers`)

One row per printer, of either kind (owner, 2026-11-04). The names `receipt` and `a4` are the ones
the code already uses (`invoice-delivery-status.ts:43`, `invoice_deliveries.medium`).

| column | type | key / null |
|---|---|---|
| id | text | pk |
| kind | text enum (`receipt`, `a4`) | **new** |
| name | text | |
| transport | text enum (usb, network_tcp, bluetooth, cloud_poll, ipp) | `ipp` is new, and is the only value of an `a4` printer: A4 printing exists over network IPP only |
| local_key | text | null |
| host | text | null |
| port | integer | null, default 9100 |
| poll_id | text | null |
| poll_token_hash | text | null |
| paper_width | text enum (58mm, 80mm) | null on `a4` |
| resolution | text enum (180dpi, 203dpi) | null on `a4` |
| has_cash_drawer | integer flag | 0 on `a4` |
| portable | integer flag | 0 on `a4` |
| picks_up_receipts | integer flag | default 1, 0 on `a4` — was `pickup_roles` containing `receipt` |
| picks_up_payment_slips | integer flag | default 1, 0 on `a4` — was `pickup_roles` containing `payment_slip` |
| held_by_device_id | text | null, fk→devices (set null) — was `printer_holders.device_id` |
| held_at | text | null — was `printer_holders.held_at` |
| resource_path | text | null on `receipt` — was `page_printers.resource_path` |
| document_format | text enum | null on `receipt` |
| supported_formats | JSON | null on `receipt`; the formats the printer reported, not ids |
| media | text enum | null on `receipt` |
| resolution_dpi | integer | null on `receipt` |
| agent_id | text | null, fk→print_agents; only on `a4`. A receipt printer has no agent binding (`printers.ts:32-33`) |
| active | integer flag | |
| deleted_at | text | null |

Removed: `location_id` (R10). Also `ticket_scope`: its own schema comment says it is unused
(`packages/db/src/schema/printers.ts:23`), and `git grep -n -E "\.ticketScope|printTicketScope" --
apps packages ':!*.test.ts'` finds only its declaration and export.

Protections:
- kept: CHECKs on transport, paper width and resolution, and `printers_transport_fields_ck`, with a
  new branch for `ipp`;
- new: `printers_kind_fields_ck`. An `a4` row has transport `ipp`, a host, a port, and every field in
  the `a4` group, with none of the receipt fields set and `deleted_at` null. A `receipt` row has
  paper width and resolution, and none of the `a4` fields. `deleted_at` stays null on `a4` because a
  page printer has no Delete today, only disable (`apps/server/src/page-printers-api.ts`);
- moved from `page_printers`: the format, media, port-range and resolution CHECKs;
- moved, partial on `kind = 'a4'`: the endpoint key, now `(host, port, resource_path)`;
- kept: partial unique `local_key` where `local_key is not null and deleted_at is null`, minus the
  location. Since A1301 S10 (#2396) the demo printer's lookup keeps a `location_id` condition only
  so that it can use today's key, which leads with the location (`apps/server/src/demo-printer.ts:34-45`).
  It is the one qualified read of a `location_id` column on this area's tables left outside tests
  (`git grep -n -E "(devices|printers|pagePrinters|printJobs|printAgents|joinRequests)\.locationId"`
  over `apps` and `packages`, tests, migrations and `src/testing/` left out). The key without the
  location serves that lookup with the condition gone;
- new: CHECK `(held_by_device_id is null) = (held_at is null)`;
- new: CHECK `held_by_device_id is null or portable = 1` (making a printer fixed drops its holder:
  `packages/layouts/src/device-equipment.ts:615-617`);
- new: CHECK `deleted_at is null or active = 0` (`apps/server/src/printer-delete.ts:183`);
- "one holder per printer" (the old `printer_holders` PK) now holds by construction: a printer has
  one `held_by_device_id`.

**Reads have to say which kind they mean.** Two tables kept the kinds apart without anyone having to
ask. `git grep` for selects and joins on `printers` finds about 45 lines in 25 non-test files, and
each one now needs checking. Some are already safe: the agent's job pull takes only `network_tcp` and
listed `usb`/`bluetooth` printers (`packages/printing/src/runtime.ts:106`), so it never sees `ipp`.
`insertPrintJob` is the one place a job row is written (`packages/printing/src/outbox.ts:60`), and it
looks the printer up first (`:54`), so it refuses a job whose kind does not suit the printer. A
drawer job or a receipt on an `a4` id therefore keeps today's answer, `printer.not_found`. M5 checks
the rest.

Rows: 3, plus 0–1 A4 printers.

The earlier reason for keeping A4 printers apart, that they had a different outbox, ends with this
change (§1.7). The other reason, that a plain key proved a role named a thermal printer, moves to the
trigger on `devices` (§1.1) and the writers of the JSON lists.

### 1.7 `print_jobs` — `state`, not append-only (an outbox)

Every print goes through this table, A4 included (owner, 2026-11-04).

| column | type | key / null |
|---|---|---|
| id | text | pk |
| printer_id | text | fk→printers |
| claimed_by | text | null, fk→print_agents |
| kind | text (`document`, `drawer`, `a4`) | `a4` is new |
| payload | blob | null only on `a4`, whose pages are drawn when the agent asks for them |
| receipt_copy | integer flag | null |
| handed_over_by | text | null, fk→persons — was `receipt_handover.personId` |
| handed_over_at | text | null — was `receipt_handover.confirmedAt` |
| claim_token_hash | text | null — moved from `invoice_deliveries`; set when a job for an invoice is claimed |
| printer_hold | text enum (the eight hold codes, `a4HoldCodes`) | null; only on `a4` — moved from `invoice_deliveries` |
| status | text enum (queued, printing, done, failed) | |
| attempts | integer | |
| last_error | text | null |
| created_at, claimed_at null, delivered_at null | text | |
| resend_of | text | null, fk→print_jobs |
| sale_id | text | null, fk→sales; not null on `a4` |

Removed: `location_id`. Since A1301 S10 (#2396) a new job's `location_id` is filled from
`venueLocationId(tx)`, or from a `venueId` option a caller that queues several jobs reads once
(`packages/printing/src/outbox.ts:21-25`, `:62`; callers such as `receipt-print.ts:561`).
Dropping the column also drops that option and what callers pass to it. `receipt_handover` breaks R4
(a person id inside JSON). It is written at `apps/server/src/receipt-print.ts:509` and read at
`:450`. `git grep -n "receiptHandover\|receipt_handover" -- apps packages ':!*.test.ts'
':!*/drizzle/*'` prints only those two, its declaration (`packages/db/src/schema/print-jobs.ts:56`)
and the frozen `country-es` demo captures.

**A4 printing, on this table.** An A4 delivery today lives entirely in `invoice_deliveries`
(`apps/server/src/invoice-page-print.ts`). An invoice printed on a receipt printer already has both a
job and a delivery row, and the delivery holds the claim (`apps/server/src/invoice-print.ts`). This
design makes both work one way. The job holds the queue: who has it, the claim, the lease, what the
printer is waiting for. The delivery record holds what was asked for and how it ended
(`tables-ordersales.md`).

- Queuing an A4 invoice writes a job of kind `a4` on the chosen printer, with `sale_id` and no
  payload, and the delivery record names it through `print_job_id`, as a receipt does today.
- The pages stay drawn at the moment the agent asks, in that printer's format
  (`apps/server/src/page-print-api.ts`, the `/document` route).
- `claimInvoicePagePrint` keeps its rules and reads `print_jobs`: oldest first, only this agent's
  printers (`printers.agent_id`), one A4 out per printer, and a job on a disabled printer fails
  instead of being handed out. `print_jobs_pull_idx (printer_id, status)` serves it.
- A renewal moves `claimed_at` and writes `printer_hold` (`renewInvoicePagePrint`). The 60-second
  lease stays.
- A claim that lapses ends the job `failed` with no attempts left, and the delivery record says
  `unknown`. That is what an invoice receipt already does (`invoice-delivery.ts:278-283`). `a4` jobs
  are not resent: `canResendPrintJob` takes only `document` (`outbox.ts`), and a person's retry is a
  new delivery, as today.
- `next_attempt_at` is not needed here. Only an email retry sets it to a later time
  (`invoice-delivery.ts:413`), so a queued job is simply due.
- **The print agent's messages change** (owner told, 2026-11-04). The `/print-api/agent/page-jobs`
  routes can stay, but the id they carry becomes the job's id, and the claim it proves is the job's,
  so `deliveryId` and `generation` leave `InvoicePrintClaim` and `PageJob`
  (`packages/print-agent/src/client.ts:122`). The agent runs in its own container. Before go-live a
  box is reset, so no compatibility code is needed. A test page stays in memory
  (`page-print-api.ts`, `deps.testPages`), because it has no sale.
- Lists of jobs must leave `a4` out where they mean thermal printing. `printJobInTrouble` already
  does (`print-job-trouble.ts`, `kind = 'document'`). The Printers screen's list does not
  (`print-api.ts:1411`).

Protections: the CHECKs on kind and status, and the three indexes (`print_jobs_pull_idx`,
`print_jobs_resend_of_idx`, `print_jobs_sale_id_idx`) stay. New CHECKs: `(handed_over_by is null) =
(handed_over_at is null)`; `(kind = 'a4') = (payload is null)`; `kind <> 'a4' or sale_id is not
null`; `printer_hold is null or kind = 'a4'`.

Rows: about 3–5 per bill, so 750–1,250 a day and 270,000–450,000 a year, plus the few A4 invoices.
No product code deletes any (`git grep -E "delete\(printJobs\)|delete from print_jobs"`, test code left out, prints nothing). Three other tables point at it
(`kitchen_print_jobs`, `kitchen_print_job_lines`, `invoice_deliveries`), and `activity_log` names it,
so rows cannot simply be removed. Emptying old payloads is handed to A980 (README U10; M1 gives it a
figure).

### 1.8 `custom_themes` — `state`

| column | type | key / null |
|---|---|---|
| id | text | pk |
| name | text | |
| name_key | text | unique |
| in_use | integer | null or 1, unique (at most one in use) — already a flag on the row, so R4 holds |
| logo_light_image | text | null, fk→media_images(filename) (restrict) — was `theme.logo.light` |
| logo_dark_image | text | null, fk→media_images(filename) (restrict) — was `theme.logo.dark` |
| theme | JSON | colours and other look settings, with no image names left in it |
| updated_at | text | |

Today the logo names live inside the theme JSON (`packages/media/src/images.ts:110-115`, `$.logo.light`
and `$.logo.dark`). No trigger checks them: `grep -l custom_themes packages/media/drizzle/*.sql`
prints nothing. As columns they can be real keys, because media's tables fold into core (U1) and
`media_images.filename` is unique (`packages/media/src/schema/images.ts:15`). The triggers
`products.image` uses today exist only because a key from a core table to media's table would have
made the packages depend on each other in a loop (`packages/media/drizzle/0001_image_references.sql`).
A key that refuses a delete matches the owner's call for receipt logos and menu photos: a photo in
use cannot be deleted, and the refusal says where it is used (`tables-venuebox.md` §1.10). The
printed-dot copy `theme.printedLogo` is a cache; see §6 and M3. Protections kept:
`custom_themes_name_key_uq`, `custom_themes_in_use_uq`, `custom_themes_in_use_ck`. Rows: 0–3.

---

## 2. Settings documents

**This area adds no row to `settings`.**

- `tenant_receipts` was the one settings-shaped table (one row, `id` pinned to 1). It is deleted
  (owner, 2026-11-04) because department receipts replaced it: `tables-venuebox.md` §6.8 has the same
  fields, and only the department's are printed. Nothing reads or writes it outside its own store:
  `git grep -n -E 'getPrintedReceipt\(|getReceipt\(|getVenueReceiptSettings\(|putVenueReceiptSettings\(|putReceipt\(|tenantReceipts' -- apps packages ':!*.test.ts'`
  finds only `packages/layouts/src/receipt-store.ts` and the export in `packages/db/src/index.ts:190`.
  The table is not in the configuration export: it is missing from
  `packages/db/src/configuration-transfer.ts:64-108`, and only an old test fixture names it.
- Which theme is in use stays `custom_themes.in_use` (R4: a flag on the row, not an id in a document).
- Every other value here configures one row (a profile's timeout, a printer's paper width), not the
  venue, so it stays a column on that row.

## 3. History

**This area keeps no typed history.** `drawer_opens` moves to `activity_log` (owner, 2026-11-04).
`activity_log` is for people to read: product logic never decides from it (README §3). So the one
place product code decided from drawer history leaves first.

**Open the drawer once per refund: a column on `refunds`.** Today `enqueueTenderRefundDrawer` looks
for an earlier `drawer_opens` row (`apps/server/src/receipt-print.ts:636-640`). In the target,
`refunds` gains `drawer_opened_at` (null, set-once), and the same function claims it in one update:
`update refunds set drawer_opened_at = ? where id = ? and drawer_opened_at is null`. No row changed
means the drawer already opened. It claims only after a drawer printer is found, because today no
printer means no row, so a later attempt may still open it (`:641-642`). The bill path stamps it too,
so the column means the same on both kinds of refund.

The guard trigger allows this, with one clause added. Stand-in test on the real text of
`tender_refunds_guard_update` (`packages/db/drizzle/0163_tender_refund_transitions.sql`), on a
completed cash refund. As written, the trigger ignores a column it does not name: the claim worked,
but a later update could also rewrite or clear the time (the control). With
`AND (old.drawer_opened_at IS NULL OR new.drawer_opened_at IS old.drawer_opened_at)` added, the first
claim changed one row, the second changed none, and rewriting or clearing was refused. So the merged
trigger must carry that clause, for both kinds of refund (`tables-ordersales.md` §1.11). This replaces
the partial unique index proposed earlier. `bill_payment_refunds_guard_update` has the same shape:
read, not run.

**The drawer's entry in `activity_log`:**

| kind | subject | person, device | `data` |
|---|---|---|---|
| `drawer.opened` | `print_job` / the kick job's id | the operator; the device, null on a calibration | `reason`, `sale_id`, `bill_payment_id`, `refund_id`, `authorized_by`, `via_override` |

The subject is what ties an open to its kick job, so the audit can show whether the drawer was
actually kicked, which today it cannot: "`drawer_opens` holds no job id"
(`packages/printing/src/runtime.ts:140`). The job's `status` and `delivered_at` answer that, and
`printer_id` is read from the job. `enqueuePrintJob` already returns the new job's id
(`packages/printing/src/outbox.ts:26`). The four `receipt-print.ts` sites insert the open before they
queue the job, so they swap that order (`:407/415`, `:552/560`, `:643/652`, `:671/678`);
`print-api.ts:1243-1244` already queues first. This delivers the open backlog item "`drawer_opens`:
decide the remaining UPDATE/DELETE restriction (A805 follow-up)" (`docs/backlog.md:6775`), because
`activity_log` is append-only. Its deletion from the backlog goes with the slice.

Its one remaining reader is the personal-data export (`apps/server/src/personal-data-actions.ts:172-186`),
which asks for opens where the person was operator or authoriser. The operator is `person_id`. The
authoriser stays inside `data` as `authorized_by`, so the export filters every `drawer.opened` row.
`activity_log` gains no second person column unless M7 shows that read matters. A person id inside
`data` carries no key.

Rows: 100–150 a day (cash payments plus manual opens), 36,000–54,000 a year.

**`activity_log` kinds this area could write later.** These are new: nothing records them today.
`grep -n "log.info|recordIncident|approvedBy|personId"` over `join-requests.ts`, `device-delete.ts`
and `printer-delete.ts` prints nothing, so who approved a device, for example, is not kept anywhere.
They are follow-ups, not built in this work (README U11), so only `drawer.opened` above is.
Subject ids go in `subject_kind`/`subject_id`/`person_id`/`device_id`; `data` carries names, not ids.

| kind | subject | when |
|---|---|---|
| `device.join_accepted` | device | an administrator approves a device's join (`person_id` = approver) |
| `device.join_denied` | join_request | a join is denied or fails the number check |
| `device.disabled` / `device.enabled` / `device.deleted` | device | the dashboard Devices screen |
| `device.profile_switched` | device | the active profile changes (`data`: from/to profile names) |
| `device.approved_profiles_changed` | device | `approveDeviceProfiles` (`device.ts:190`) |
| `device_profile.changed` | device_profile | a profile save (`data`: which sections changed) |
| `print_agent.enrolled` / `print_agent.revoked` | print_agent | agent pairing and revoking |
| `printer.added` / `printer.deleted` | printer | the dashboard Printers screen |

`print_jobs` is not history: it is an outbox, and its rows are the jobs themselves (`resend_of`
links a resend to its original). The receipt handover is a fact fixed on the job's row (R2), so it
becomes a column there and is not logged.

## 4. Mapping

| current | fate | target | why |
|---|---|---|---|
| devices | keep (widened) | devices | a real thing; loses `location_id`, `invoice_page_printer_id` and the duplicate `created_at`; gains the reader column, two lists and new checks |
| device_made_here_stations | fold into a list | devices.made_here_station_ids | a list owned by one device (R4 exception) |
| device_approved_profiles | keep (widened) | device_approved_profiles | one row per (device, profile), now also holds the zone memory |
| join_requests | keep | join_requests | a real pending pairing; loses `location_id` |
| print_agents | keep | print_agents | a real thing; loses `location_id` |
| printers | keep (widened) | printers | absorbs its holder and A4 printers; `pickup_roles` JSON becomes two flags; loses `ticket_scope` and `location_id` |
| print_jobs | keep (widened) | print_jobs | the outbox for every print, A4 included; `receipt_handover` JSON becomes two columns (R4) |
| drawer_opens | move | activity_log (`drawer.opened`) | product logic no longer reads it; refund-once moves to `refunds.drawer_opened_at` |
| device_profiles | keep (widened) | device_profiles | absorbs its side tables (R1) and its lists (R4 exception) |
| device_profile_printers | fold into a list | device_profiles.printer_lists | a list owned by one profile |
| printer_holders | merge into printers | printers | at most one row per printer (R1); same protection |
| custom_themes | keep | custom_themes | a real list; logo names leave the JSON for columns (R4) |
| tenant_receipts | delete | null | replaced by department receipts, with no caller outside its own store (R5) |
| page_printers | merge into printers | printers (kind `a4`) | one real thing, printers; the separate outbox has ended (owner, 2026-11-04) |
| device_profile_service_access | merge into device_profiles | device_profiles | one row per profile (R1) |
| device_profile_zones | fold into a list | device_profiles.order_zone_ids | a list owned by one profile |
| device_kitchen_screen_removals | delete | null | worked out from what the device chose minus what its profile now allows (R6, owner, 2026-11-04) |
| device_kitchen_screen_stations | fold into a list | devices.kitchen_views | a list owned by one device |
| device_kitchen_screen_zones | fold into a list | devices.kitchen_views | as above |
| device_kitchen_screens | fold into a list | devices.kitchen_views | up to three per device; since #2440 also carries `show_non_pass_stations` |
| device_profile_kitchen_screen_stations | fold into a list | device_profiles.kitchen_views | a list owned by one profile |
| device_profile_kitchen_screen_zones | fold into a list | device_profiles.kitchen_views | as above |
| device_profile_kitchen_screens | fold into a list | device_profiles.kitchen_views | up to three per profile |
| device_zone_selection_zones | fold into a list | device_approved_profiles.zone_ids | a list owned by one (device, profile) row |
| device_zone_selections | merge into device_approved_profiles | device_approved_profiles | same key `(device, profile)` |
| device_profile_admission_persons | delete | null | no per-person allow or deny; access follows role (owner, 2026-11-04) |
| device_profile_admission_roles | fold into a list | device_profiles.admitted_roles | a list owned by one profile |

## 5. Protections

Sources: each schema file named in §1, the triggers found by `grep CREATE TRIGGER` over every
`packages/*/drizzle/*.sql`, and `scripts/behavioural-triggers.test.ts:130`. Only one trigger lives
on these tables today, `device_profile_form_factor_locked`. The device binding triggers were dropped
in `packages/db/drizzle/0119_drop_device_binding_triggers.sql`, and that rule moved into
`setDeviceKitchenScreens`/`assertKitchenDisplayHasScreen` (`kitchen-screens.ts:548`, `:925`).
`scripts/append-only-triggers.test.ts` names none of these tables, and neither does
`scripts/write-path-tables.json`.

| current protection | new home |
|---|---|
| every `location_id` FK and every key that includes location (`devices_location_label_active_key`, `printers_local_key_key`, `page_printers_endpoint_uq`) | the location part is dropped (R10, A1301 S24/S26/S28); each unique key stays without it |
| devices: FKs to profile and printers, restrict | kept, except `invoice_page_printer_id`, which goes with its column |
| devices: FK from `receipt_printer_id`, `payment_slip_printer_id`, `cash_drawer_printer_id` as proof of a thermal printer | the new trigger on `devices` (§1.1) |
| `device_profile_form_factor_locked` trigger | kept on `device_profiles` |
| device_profiles: live-name unique, form-factor CHECK | kept |
| device_approved_profiles: PK, both FKs cascade | kept on the merged table (device side becomes no action, deleted explicitly at `device-delete.ts:204`) |
| device_zone_selections: PK, FKs device / profile cascade / start zone | the PK and FKs move onto `device_approved_profiles` |
| device_zone_selection_zones: PK, composite FK cascade, zone FK | **given up:** the shape holds one owner; duplicates and unknown zones are refused by `setDeviceZoneSelection`, which already checks both (`device-zone-selection.ts`) |
| device_made_here_stations: PK, FKs | **given up:** duplicates and unknown stations are refused by the writer; `station-delete.ts:193` clears the id |
| join_requests: PK, kind CHECK | kept |
| print_agents: unique `node_id` | kept |
| printers: transport, paper, resolution and transport-fields CHECKs | kept, with `ipp` and a kind CHECK |
| printers: `printers_ticket_scope_ck` | dropped with the unused column |
| printer_holders: PK `printer_id` (one holder) | holds by construction (one column); new CHECKs pair it with `held_at` and `portable` |
| printer_holders: FKs cascade with printer and with device | the printer side is moot (same row); the device side becomes ON DELETE SET NULL |
| print_jobs: kind and status CHECKs, three indexes, FKs | kept; kind gains `a4` |
| print_jobs: FK `printer_id` as proof of a thermal printer | `insertPrintJob` matches the job's kind to the printer's (§1.6), since no plain key can |
| drawer_opens: reason CHECK, target CHECK, FKs to device, printer, sale, bill payment and refund | **given up** in the database, because `activity_log` is one shape for every kind. One typed function writes every `drawer.opened` row, with the seven reasons as a type whose fields match what `drawer_opens_target_ck` required. Nothing decides from these rows, so a wrong one misleads a reader and cannot change an outcome |
| drawer_opens: "ledger" with no trigger (`drawer-opens.ts:16-17`) | strengthened: `activity_log` is append-only |
| drawer_opens: earlier-row check for one open per refund | `refunds.drawer_opened_at`, set-once under the guard trigger (§3) |
| device_profile_printers: three unique keys, role CHECK, target CHECK | **given up:** `setProfilePrinterLists` refuses a default off its list, a missing or deleted printer and, on any list but the invoice one, an A4 printer. One default per role is the shape. Duplicates within a role are refused by the route (`management-api.ts:532`), with the unique key behind it, so the writer takes that check over |
| device_profile_printers: FKs to printers, restrict | clearing moved to `deletePrinter` (§1, the stale-id point) |
| custom_themes: name_key unique, in_use unique, in_use CHECK | kept; logo columns gain real keys to `media_images` |
| tenant_receipts: singleton CHECK | dropped with the table (R5) |
| page_printers: format, media, port and resolution CHECKs; agent FK | kept on `printers`, applying to `a4` rows |
| device_profile_service_access: PK (one row per profile), NOT NULL department/start zone, FKs to department, zone, profile | one row per profile holds by construction; the NOT NULLs become the all-or-nothing CHECK; the FKs move onto the columns |
| device_profile_zones: PK, FK to the access row cascade, zone FK | **given up:** `checkedScope` validates the zones; the department scope is the CHECK on `device_profiles` |
| `device_profile_kitchen_screens` / `device_kitchen_screens`: composite PKs, screen CHECKs, `*_station_zones_ck` | one view per kind is the object's keys; the kinds and "a station view has no zone list" move to the writers (`replaceProfileKitchenScreens`, `setDeviceKitchenScreens`) |
| `*_kitchen_screen_stations`, `*_kitchen_screen_zones`: PKs, cascades, station and zone FKs, screen CHECKs, not-station CHECK | **given up:** `checkedStations` and `checkedZones` validate ids; a dead id drops at read |
| device_kitchen_screens: device FK deliberately `no action` (`schema/kitchen-screens.ts`) | moot: the list is on the device's own row |
| device_kitchen_screen_removals: device/station/zone FKs, screen CHECK, one-target CHECK, index | dropped with the table |
| device_profile_admission_roles: PK, FK cascade, role CHECK | **given up:** `parseProfileAdmission` checks the values (`management-api.ts:630`); a CHECK cannot read inside a list |
| device_profile_admission_persons: PK, FKs, cascade | dropped with the table |

Each "given up" is the cost of the owner's R4 exception, weighed against the evidence at the top of
§1. Nothing in those lists is a fiscal or money fact. The one that shows if a writer misses is the
printer list (§1).

## 6. Duplicates removed

1. **Kitchen view settings stored in two parallel table sets**, one for profiles and one for
   devices (`packages/venue-service/src/schema/kitchen-screens.ts`). The two sets have the same
   columns and the same CHECKs. There is one shape now, `kitchen_views`, on each owner's row. Both
   sides are still needed, because one is what the profile allows and the other is what the device
   picked.
2. **What a narrowing took from a device** (`device_kitchen_screen_removals`) can be worked out from
   two things already stored: the device's choice, which a narrowing never changes
   (`kitchen-screens.ts:793`), and the profile's current setting. A removal row is deleted as soon as
   the profile allows the item again (`:812-816`), so the table only ever holds "chosen but no longer
   allowed". It goes, with no "taken away" note (owner, 2026-11-04). The visible change is small:
   when a profile is narrowed, a kitchen display whose choice was "every station" simply shows fewer
   stations, and no longer lists the removed ones as "no longer available". The notice the dashboard
   shows when a profile is saved is worked out at save time from the before and after settings, so
   it is unchanged (`replaceProfileKitchenScreens`, `kitchen-screens.ts:157`, returns it). M2 checks
   the one place the two differ.
3. **`devices.created_at` and `devices.enrolled_at`**: both written at insert and never changed.
   One home: `enrolled_at`.
4. **A theme logo's printed dots stored twice**: `custom_themes.theme.printedLogo` and
   `department_receipts.logo_rasters` hold the same derived dots for the same picture, and
   `packages/media/src/image-edits.ts:85-97` rewrites both. The proper home is once per image in the
   media area (menu researcher). Until that lands, the theme copy stays in the theme JSON.
5. **A drawer open's printer**, `drawer_opens.printer_id`, is the same printer as its kick job's
   `print_jobs.printer_id`. One home: the job, named as the `drawer.opened` entry's subject.
6. **`tenant_receipts` and `department_receipts`** both claim to be the receipt trim; only the
   department one is used. One home: `department_receipts`.
7. **Two printer tables and two queues for printing.** One home for each: `printers` and
   `print_jobs`. `devices.invoice_page_printer_id` and `device_profile_printers.page_printer_id` go
   with them, because one id column can name either kind.

## 7. Depends on other areas

- **venuebox:** `departments` (FK from `device_profiles.order_department_id`). `locations` goes away
  (A1301).
- **floorkitchen:** `floor_zones` and `kitchen_stations` (FKs from `device_profiles` and
  `device_approved_profiles`, ids in the lists). `station_printers` becomes a list on the station, and
  `kitchen_print_jobs`/`kitchen_print_job_lines` → `print_jobs` are why print jobs cannot be deleted.
  A station's printer list must refuse an A4 printer, which a key to `printers` no longer does.
- **ordersales:**
  - `sales` (FK from `print_jobs`). `department_transfer_desks.receiving_profile_id` points at
    `device_profiles`. Many of their tables point at `devices`, which is why devices are soft-deleted.
  - `invoice_deliveries` becomes a record only (owner, 2026-11-04). It keeps `print_job_id`, and its
    `page_printer_id` becomes a `printer_id` key to `printers`. That column stays, because a delivery
    to a printer disabled after staging is recorded failed with no job
    (`apps/server/src/invoice-delivery.ts:70-83`), and the replay check and the alert read the printer
    from it. Its claim, lease and hold columns move to `print_jobs` (§1.7) or `outgoing_mail`.
  - `receipt_reprints` moves to `activity_log` and names a print job there.
  - `refunds` gains `drawer_opened_at` and the set-once clause in its merged trigger (§3).
    `drawer_opens` no longer holds a key into `refunds`.
- **fiscal:** `registros_facturacion.device_id` (`verifactu_records` in the target) and
  `payments.device_id` → `devices`. A device row can therefore never be removed.
- **payments (card readers):** `devices.card_reader_id` and `device_profiles.card_readers` are read
  and written only by `packages/payments`, and hold no key (§1.1). `card_readers.held_by_device_id`
  points at `devices`, which a `payments` table may do. See `tables-fiscal.md` §1.3.
- **people:** `persons` (FK from `print_jobs.handed_over_by`; `sessions.device_id`). A1002 must lose
  per-person exceptions (design §3, §6, §7, :346, :367), and its "IDs inside any retained JSON" line
  (:373) already covers `admitted_roles`.
- **menu / media:** `media_images.filename` for the theme logo columns, and a home for printed
  rasters per image (§6 item 4).
- **shared:** `activity_log` (§3).
- **Lists that follow table names** and must be edited when the tables change: the configuration
  export lists (`packages/db/src/configuration-transfer.ts:64-105`,
  `packages/venue-service/src/configuration-transfer.ts:706-710`,
  `packages/identity/src/configuration-transfer.ts:20-21`), the classification lists
  (`packages/db/src/classification.ts:108-153`, `packages/venue-service/src/classification.ts:23-33`),
  the `page_printers` branches in the import
  (`packages/provisioning/src/configuration-transfer.ts:740-742`), and the dashboard live-subscription
  names (`apps/dashboard/src/api/live-queries.ts`). `printers.held_by_device_id` must be added to the
  export's `omit` list, because devices are not exported.

**Configuration export and import need new code for the JSON lists.** Three gaps, read, not run:

1. *Import rewrites ids only in whole-value key columns.* It gives each row a new id and rewrites a
   field only when the whole value equals an old id
   (`packages/provisioning/src/configuration-transfer.ts:718-721`). Ids inside JSON keep the exporting
   venue's value. `scripts/id-columns-are-references.test.ts` says so itself, and A1002 warns of the
   same (:373). `printer_lists`, `order_zone_ids` and `kitchen_views` travel, so a table's declaration
   needs a way to name the ids inside a column. `card_readers` does not travel (readers are not
   exported, `packages/payments/src/configuration-transfer.ts:3`), so it goes in `omit`.
2. *Export drops a row whose key names a left-behind row, and does not look in JSON*
   (`leaveBehindReferences`, `:404-441`). A switched-off station or zone stays on a list
   (`readStored` filters it at read), so export must prune such ids from a list or import will fail on
   them, or carry them forward.
3. *The same rule now catches the wrong row.* `departments` and `floor_zones` are left behind when
   switched off (`packages/venue-service/src/configuration-transfer.ts:700`,
   `packages/db/src/configuration-transfer.ts:77`). Today a profile whose department or starting zone
   is off loses only its `device_profile_service_access` row, and travels unrestricted. Folded in,
   the keys sit on `device_profiles`, so the whole profile would be left behind, and with it every
   child row keyed to it. Export has to clear those columns instead (M4).

The guard `scripts/id-columns-are-references.test.ts` knows an id column by its name, so
`printer_lists` and `kitchen_views` would pass it unseen. It must learn the new declaration.

## 8. Measure before building

- **M1 — print job payload size.** Run `select count(*), sum(length(payload)), avg(length(payload))
  from print_jobs` on a venue with real service history (the Santet data venue). This gives A980 the
  growth figure README U10 promises. Emptying old payloads is its decision, including the number of
  days, which would also be how long staff can reprint by resending: a resend copies the original's
  payload (`packages/printing/src/outbox.ts:123`).
- **M2 — removal notes worked out on read.** Change `readDevicesKitchenScreens` so that "taken
  away" means the device's choice minus what the profile now allows, then run
  `pnpm --filter @waitron/venue-service exec vitest run kitchen-screens` and the
  `apps/server` device-api kitchen-screen tests. My reading of `kitchen-screens.ts:788-890`
  predicts that the only failing cases are a device whose choice is "every station/zone" and which
  used to show the narrowed items as "no longer available". The result that would change the design:
  failures anywhere else, which would mean a removal row carries a fact that cannot be derived.
- **M3 — printing a logo without the cached dots.** Time how long it takes to convert a theme logo
  to printer dots at print time, against reading the cached copy. If it takes more than about 50 ms
  per receipt, keep one cached copy per image (in media). If it is well under, drop both caches.
- **M4 — a configuration round trip.** Export a venue with a switched-off zone, station and
  department on a profile's lists and scope, and import it. Failing results: a profile missing, an
  id from the old venue in a list, or a dead id carried across.
- **M5 — every read of `printers` means one kind.** Add an `a4` printer to the fixtures of the
  printer, device, order and station suites, and run them. Failing result: an A4 printer in a
  receipt list, or a receipt-only route that accepts an A4 printer's id.
- **M6 — the A4 path on `print_jobs`.** Run the `invoice-page-print`, `page-print-api`,
  `print-agent` and `alert-sources` suites on the new shape with their assertions unchanged. Failing
  result: a behaviour the delivery row carried that neither the job nor the record now does.

- **M7 — the personal-data export's read of `authorized_by`.** Time it on the reference micro PC with
  five years of `drawer.opened` rows. A stand-in took about 64 ms for 270,000 such rows among 4.15 million
  others, through the `(kind, at)` index, on a developer Mac with the file in memory. The export runs it
  inside a write-lock turn (`personal-data-actions.ts:171`), so a sale can wait that long, on the rare
  day someone exports. Failing result: a wait a person at the till would notice. Then `activity_log`
  gains a second person column, with an index and a key to `persons`, which changes README §3.

## 9. Decisions for the owner

The owner settled D1, D4 and D5 on 4 November (§6, §1.3, §3). D2 follows README U1. D3 is handed to
A980 (README U10). No question is open in this area.
