> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: devices, device profiles and printers

Area: devices, join requests, device profiles and everything hanging off them, print agents,
printers, page printers, print jobs, drawer opens, themes and `tenant_receipts`. 27 current tables
(from `area-devices.json`), read at `main` 64eeabb036. Read-only: nothing was run except `grep`/`git
grep` and file reads. Every "the code does X" below is a citation, not a test result.

**In one line:** 27 tables become 19. The seven kitchen-screen tables become three: one shape holds
both what a profile allows and what a device chose. The "what a narrowing took away" notes are worked
out when read instead of stored. Two one-row-per-parent side tables fold into their parents
(`printer_holders` into `printers`, `device_profile_service_access` into `device_profiles`). A
device's approved profiles and its remembered floor zones share one table, because both have one row
per device per profile. `tenant_receipts` is deleted because nothing uses it. Two JSON values that
hold ids or person ids become real columns (`print_jobs.receipt_handover`, the theme logos).

---

## 1. Target tables

Notation: `pk` primary key, `fk→t` foreign key to table t, `null` = nullable (otherwise NOT NULL).
All tables are in `venue.db`. No table has `location_id` (R10, A1301). Reference venue: one
restaurant, 250 bills a day with 4 lines each, 360 days a year, 4 tills, 2 kitchen screens and
3 thermal printers.

### 1.1 `devices` — core set, `state`, not append-only

What it is: each enrolled screen (till, phone, tablet, kitchen display) that signs in with a device
cookie. It keeps its row after Delete, because fiscal records, sales, orders and sessions point at it
(`registros_facturacion.device_id`, `sales.device_id`, `working_orders.device_id`,
`sessions.device_id`; the FK list in `area-*.json`).

| column | type | key / null |
|---|---|---|
| id | text | pk |
| device_profile_id | text | fk→device_profiles (restrict) |
| label | text | |
| token_hash | text | `""` once deleted (`apps/server/src/device-delete.ts:213`) |
| active | integer flag | default 1 |
| deleted_at | text | null |
| receipt_printer_id | text | null, fk→printers (restrict) |
| payment_slip_printer_id | text | null, fk→printers (restrict) |
| cash_drawer_printer_id | text | null, fk→printers (restrict) |
| invoice_printer_id | text | null, fk→printers (restrict) |
| invoice_page_printer_id | text | null, fk→page_printers (restrict) |
| last_seen_at | text | null |
| battery_level | integer | null |
| battery_charging | integer flag | null |
| battery_reported_at | text | null |
| enrolled_at | text | |

Removed: `location_id` (R10), and `created_at`. `created_at` is a second copy of `enrolled_at`: both
are filled at insert by `$defaultFn(nowIso)` (`packages/db/src/schema/devices.ts:71-72`). `git grep
-n -E "enrolled_at|enrolledAt *[:=]"` finds no code that rewrites either, and no reader of
`devices.createdAt`.

Protections: unique `label` among active devices (today `devices_location_label_active_key`, minus
the location). New CHECKs, which the code already holds but the schema left out only because a CHECK
would have made drizzle-kit rebuild `devices` (`devices.ts:46-48`, `:60-62`). A first migration
written fresh before go-live has no rebuild to avoid:
- `invoice_printer_id is null or invoice_page_printer_id is null` (`selectDevicePrinter` sets one and
  clears the other, `devices.ts:46-47`);
- `battery_level between 0 and 100` (held today only by `PUT /api/device/battery`, `devices.ts:60-61`);
- `deleted_at is null or active = 0` (Delete sets both, `device-delete.ts:211-212`).

Rows: 6 live, plus deleted devices, which are kept.

### 1.2 `device_profiles` — core set (see D2), `state`, not append-only

What it is: a reusable set-up that devices run. It now also holds the profile's ordering scope, which
used to be the side table `device_profile_service_access`.

| column | type | key / null |
|---|---|---|
| id | text | pk |
| name | text | |
| form_factor | text enum (`till`, `phone-portrait`, `tablet-landscape`, `kds`) | |
| capabilities | JSON array of capability flags (no ids) | default `[]` |
| inactivity_timeout_seconds | integer | null = never |
| starting_screen | text | null |
| order_department_id | text | null, fk→departments — was `device_profile_service_access.department_id` |
| order_every_zone | integer flag | null — was `.every_zone` |
| order_starting_zone_id | text | null, fk→floor_zones — was `.starting_zone_id` |
| created_at, updated_at | text | |
| retired_at | text | null |

Protections:
- kept: unique live `name` (`device_profiles_live_name_key`), and the form-factor CHECK;
- kept: the trigger `device_profile_form_factor_locked`
  (`packages/db/drizzle/0161_restore_profile_form_factor_lock.sql`);
- new: CHECK `(order_department_id is null) = (order_starting_zone_id is null) and
  (order_department_id is null) = (order_every_zone is null)`. This is the side table's NOT NULLs
  restated: either the whole scope is there or none of it is (a profile with no row was unrestricted,
  `packages/venue-service/src/schema/service.ts:160-161`);
- new: unique `(id, order_department_id)`, which `device_profile_zones` points at (1.6);
- new: CHECK `form_factor <> 'kds' or inactivity_timeout_seconds is null`. The code already forces
  this on write and the schema says the database does not (`device-profiles.ts:44-45`).

**Should a profile's configuration be one JSON document?** No. Almost all of it is lists of ids
(printers per role, zones, stations, a department, kitchen screens, admitted people), and R4/R7 keep
those as columns and link tables so that foreign keys check them. What is left is three scalar
values plus `capabilities`. Those are already typed columns with CHECKs, and moving them into a
document would only lose the CHECKs.

Rows: 3–6 live, plus retired ones.

### 1.3 `device_approved_profiles` — core set, `state` (merged with `device_zone_selections`)

What it is: one row per device per profile the device may run, holding what the device remembers
for that profile.

| column | type | key / null |
|---|---|---|
| device_id | text | pk part, fk→devices (no action; `device-delete.ts` deletes explicitly) |
| device_profile_id | text | pk part, fk→device_profiles (cascade) |
| starting_zone_id | text | null, fk→floor_zones — was `device_zone_selections.starting_zone_id` |
| zones_saved_at | text | null = the device never saved a zone choice under this profile (today: "no `device_zone_selections` row", `packages/venue-service/src/device-zone-selection.ts:67-78`) |

Protections: the PK, and both FKs. New CHECK `starting_zone_id is null or zones_saved_at is not
null`.

Meaning: the device's active profile (`devices.device_profile_id`) counts as approved whether or not
it has a row, as it does today (`apps/server/src/device.ts:186-188`). The difference is that saving a
zone choice under the active profile now writes a row here. `readApprovedAlternatives` already
leaves the active profile out (`device.ts:157`), so nothing new appears in the list.
`keepApprovedAfterSwitch` stops deleting the new active profile's row (`device.ts:235-241`), because
that row now holds its zone memory. Cost (D4): withdrawing approval of a profile also forgets the
device's zones for it.

Rows: 4–12.

### 1.4 `device_approved_profile_zones` — core set, `state` (was `device_zone_selection_zones`)

| column | type | key / null |
|---|---|---|
| device_id | text | pk part |
| device_profile_id | text | pk part |
| zone_id | text | pk part, fk→floor_zones |

FK `(device_id, device_profile_id)` → `device_approved_profiles` (cascade). This is a real R7 link
between two checked rows. Rows: 0–30.

### 1.5 `device_made_here_stations` — core set, `state` — kept as is

`(device_id fk→devices, station_id fk→kitchen_stations)`, pk on both. A real R7 link. Rows: 0–4.

### 1.6 `device_profile_zones` — moves to the core set (see D2), `state`

The zones a profile may order in, used when `order_every_zone = 0`.

| column | type | key / null |
|---|---|---|
| device_profile_id | text | pk part |
| department_id | text | |
| zone_id | text | pk part, fk→floor_zones |

FK `(device_profile_id, department_id)` → `device_profiles(id, order_department_id)`, ON DELETE
CASCADE, ON UPDATE RESTRICT. This keeps today's guarantee that zone rows exist only under a scope
(the old FK to `device_profile_service_access`, `service.ts:203-207`). A profile with no department
cannot hold zone rows, because a non-null child key has to match a parent whose
`order_department_id` is the same value. The writer already deletes and rewrites the whole scope
(`packages/venue-service/src/profile-access.ts:247-268`), so RESTRICT on update costs nothing. Rows:
0–20.

### 1.7 `device_profile_printers` — core set, `state` — kept as is

The printers each profile offers per role, in order, with at most one default. A real link between
checked rows. All its protections stay: the three unique keys, the role CHECK, and the target CHECK
(exactly one of `printer_id` and `page_printer_id`, and a page printer only for the `invoice` role;
`packages/db/src/schema/device-profile-printers.ts:47-63`). Rows: 6–15.

### 1.8 `kitchen_screens` — venue-service set, `state` (merges `device_profile_kitchen_screens` + `device_kitchen_screens`)

One kitchen screen setting, owned either by a profile (what the profile offers or allows) or by a
device (what that device chose within it).

| column | type | key / null |
|---|---|---|
| id | text | pk |
| device_profile_id | text | null, fk→device_profiles (cascade) |
| device_id | text | null, fk→devices (no action, as today: `packages/venue-service/src/schema/kitchen-screens.ts:112-115`) |
| screen | text enum (`station`, `pass`, `pass_monitor`) | |
| every_station | integer flag | default 0 |
| every_zone | integer flag | default 0 |

Protections:
- CHECK `(device_profile_id is null) <> (device_id is null)`: exactly one owner;
- CHECK on the `screen` values, and CHECK `screen <> 'station' or every_zone = 0` (both
  `*_station_zones_ck` checks today);
- partial unique `(device_profile_id, screen)` and partial unique `(device_id, screen)`, which are
  today's two composite PKs;
- unique `(id, screen)`, the target for 1.10's foreign key.

Rows: 5–12.

### 1.9 `kitchen_screen_stations` — venue-service set, `state` (merges the two `*_kitchen_screen_stations`)

`(kitchen_screen_id fk→kitchen_screens cascade, station_id fk→kitchen_stations)`, pk on both. A
real R7 link. Rows: 0–16.

### 1.10 `kitchen_screen_zones` — venue-service set, `state` (merges the two `*_kitchen_screen_zones`)

| column | type | key / null |
|---|---|---|
| kitchen_screen_id | text | pk part |
| screen | text | |
| zone_id | text | pk part, fk→floor_zones |

FK `(kitchen_screen_id, screen)` → `kitchen_screens(id, screen)` (cascade). CHECK on the `screen`
values, and CHECK `screen <> 'station'`. Both are today's `*_not_station_ck`, which works only
because the child carries the parent's `screen` through the composite key. Rows: 0–18.

### 1.11 `device_profile_admission_persons` — identity set, `state` — kept as is

`(device_profile_id fk cascade, person_id fk→persons cascade, admitted flag)`, pk on the first two.
A real R7 link. Rows: 0–5.

### 1.12 `device_profile_admission_roles` — identity set, `state` — kept as is

`(device_profile_id fk cascade, role enum CHECK)`. This is not a link between rows (a role is an
enum value), so folding it into a JSON column on `device_profiles` was considered. It stays a table
for two reasons. A CHECK cannot validate the items of a JSON array in SQLite (it would need
`json_each`, which is a subquery). And identity is a `toggleable` module
(`packages/composition/src/modules.ts:213`), so R8 keeps its tables in its own set. Rows: 0–12.

### 1.13 `join_requests` — core set, `local`, not append-only

Columns as today minus `location_id`: `id pk, node_id, kind (device|print_agent, CHECK), label,
token_hash, verification_number, decoy_numbers (JSON list of two-digit numbers, not ids), created_at`.
`node_id` stays. It is how a `local` table says which node a row belongs to (CLAUDE.md §3), and every
verb filters on it (`apps/server/src/join-requests.ts:26`). With one box, it always holds that box's
id. Rows: 0–2.

### 1.14 `print_agents` — core set, `state`

As today minus `location_id`: `id pk, name, host null, setup_url null, setup_port null, node_id null
(unique), token_hash, active, last_seen_at null, enrolled_at`. Unique `node_id`
(`print_agents_tenant_node_key`) keeps "at most one self-enrolled agent per node" (used at
`join-requests.ts:713-726`). Second box: the reason `node_id` has no FK is the mirror
(`packages/db/src/schema/print-agents.ts:21-23`, `apps/server/src/mirror-bundle.ts`). The column
itself is also needed with one box. Rows: 1–2.

### 1.15 `printers` — core set, `state` (absorbs `printer_holders`)

| column | type | key / null |
|---|---|---|
| id | text | pk |
| name | text | |
| transport | text enum (usb, network_tcp, bluetooth, cloud_poll) | |
| local_key | text | null |
| host | text | null |
| port | integer | null, default 9100 |
| poll_id | text | null |
| poll_token_hash | text | null |
| paper_width | text enum (58mm, 80mm) | |
| resolution | text enum (180dpi, 203dpi) | |
| has_cash_drawer | integer flag | |
| portable | integer flag | |
| picks_up_receipts | integer flag | default 1 — was `pickup_roles` containing `receipt` |
| picks_up_payment_slips | integer flag | default 1 — was `pickup_roles` containing `payment_slip` |
| held_by_device_id | text | null, fk→devices (set null) — was `printer_holders.device_id` |
| held_at | text | null — was `printer_holders.held_at` |
| active | integer flag | |
| deleted_at | text | null |

Removed: `location_id` (R10). Also `ticket_scope`: its own schema comment says it is unused
(`packages/db/src/schema/printers.ts:23`), and `git grep -n -E "\.ticketScope|printTicketScope" --
apps packages ':!*.test.ts'` finds only its declaration and export.

Protections:
- kept: CHECKs on transport, paper width and resolution, and `printers_transport_fields_ck`;
- kept: partial unique `local_key` where `local_key is not null and deleted_at is null`, minus the
  location;
- new: CHECK `(held_by_device_id is null) = (held_at is null)`;
- new: CHECK `held_by_device_id is null or portable = 1` (making a printer fixed drops its holder:
  `packages/layouts/src/device-equipment.ts:629-633`);
- new: CHECK `deleted_at is null or active = 0` (`apps/server/src/printer-delete.ts:193`);
- "one holder per printer" (the old `printer_holders` PK) now holds by construction: a printer has
  one `held_by_device_id`.

Rows: 3.

### 1.16 `page_printers` — core set, `state`

As today minus `location_id`. The unique endpoint key becomes `(host, port, resource_path)`. The
CHECKs on format, media, port range and resolution stay, and so does `agent_id fk→print_agents`.
`supported_formats` is a JSON list of formats the printer reported (not ids). Rows: 0–1.

A merge with `printers` was considered and rejected. The two have different outboxes (`print_jobs`
for thermal printers, `invoice_deliveries` for page printers: `apps/server/src/invoice-page-print.ts:82-91`).
Their connection columns hardly overlap. And keeping them apart is what lets plain foreign keys check
that a receipt, slip or drawer role names a thermal printer (`devices.*_printer_id`,
`device_profile_printers.printer_id`).

### 1.17 `print_jobs` — core set, `state`, not append-only (an outbox)

| column | type | key / null |
|---|---|---|
| id | text | pk |
| printer_id | text | fk→printers |
| claimed_by | text | null, fk→print_agents |
| payload | blob | (see D3) |
| kind | text (`document`, `drawer`) | |
| receipt_copy | integer flag | null |
| handed_over_by | text | null — person id, no FK (persons is in the identity set, the same reason as `drawer_opens.person_id`) — was `receipt_handover.personId` |
| handed_over_at | text | null — was `receipt_handover.confirmedAt` |
| status | text enum (queued, printing, done, failed) | |
| attempts | integer | |
| last_error | text | null |
| created_at, claimed_at null, delivered_at null | text | |
| resend_of | text | null, fk→print_jobs |
| sale_id | text | null, fk→sales |

Removed: `location_id`. `receipt_handover` breaks R4 (a person id inside JSON). It is written at
`apps/server/src/receipt-print.ts:503` and read at `:444`; those are its only uses (`grep -rn
receiptHandover`).

Protections: the CHECKs on kind and status, and the three indexes (`print_jobs_pull_idx`,
`print_jobs_resend_of_idx`, `print_jobs_sale_id_idx`) stay. New CHECK `(handed_over_by is null) =
(handed_over_at is null)`.

Rows: about 3–5 per bill, so 750–1,250 a day and 270,000–450,000 a year. No code deletes any
(`area-devices.json` notes the grep). Four other areas' tables point at it (`kitchen_print_jobs`,
`kitchen_print_job_lines`, `receipt_reprints`, `invoice_deliveries`), so rows cannot simply be
removed; D3 covers emptying old payloads instead.

### 1.18 `drawer_opens` — core set, `ledger`, **append-only** (typed history, see §3 and D5)

| column | type | key / null |
|---|---|---|
| id | text | pk |
| print_job_id | text | **new**, unique, fk→print_jobs — the drawer-kick job written in the same transaction |
| device_id | text | null, fk→devices |
| person_id | text | person id, no FK (identity set) |
| opened_at | text | |
| reason | text enum (cash_sale, manual, calibration, bill_payment, bill_refund, card_slip, tender_refund) | |
| sale_id | text | null, fk→sales |
| bill_payment_id | text | null, fk→bill_payments |
| tender_refund_id | text | null, fk→tender_refunds |
| authorized_by | text | null, person id |
| via_override | integer flag | |

Change: `printer_id` is replaced by `print_job_id`, and the printer is read from the job. Every
insert writes a drawer job in the same transaction: `receipt-print.ts:401/409`, `:549/:557`,
`:639/:648`, `:667/:674`, and `apps/server/src/print-api.ts:1247-1248`. Today the audit row cannot
say whether the kick was ever delivered: "`drawer_opens` holds no job id"
(`packages/printing/src/runtime.ts:143`). The job's `status`/`delivered_at` now answer that.

Protections:
- the reason CHECK stays;
- `drawer_opens_target_ck` (`packages/db/src/schema/drawer-opens.ts:58-71`) stays, except that its
  calibration branch drops `printer_id is not null` (the not-null `print_job_id` replaces it);
- new: unique `tender_refund_id` where not null. This is the "at most one open per refund" rule that
  `receipt-print.ts:632-636` checks by reading first;
- new: update and delete refused by `appendOnly()` triggers. `git grep -n -E
  "drawer_opens|update\(drawerOpens\)|delete\(drawerOpens\)"` outside tests and migrations finds no
  update or delete.

Rows: 100–150 a day (cash payments plus manual opens), 36,000–54,000 a year.

### 1.19 `custom_themes` — core set, `state`

| column | type | key / null |
|---|---|---|
| id | text | pk |
| name | text | |
| name_key | text | unique |
| in_use | integer | null or 1, unique (at most one in use) — already a flag on the row, so R4 holds |
| logo_light_image | text | null — was `theme.logo.light` (a `media_images.filename`) |
| logo_dark_image | text | null — was `theme.logo.dark` |
| theme | JSON | colours and other look settings, with no image names left in it |
| updated_at | text | |

Today the logo names live inside the theme JSON (`packages/media/src/images.ts:110-115`, `$.logo.light`
and `$.logo.dark`). No trigger checks them: `grep -l custom_themes packages/media/drizzle/*.sql`
prints nothing. As columns they get the same check `products.image` has, triggers in the media set
(`packages/media/drizzle/0001_image_references.sql`), because a real FK from a core table to media's
table would make the packages depend on each other in a loop (`0001_image_references.sql:13-18`).
The printed-dot copy `theme.printedLogo` is a cache; see §6 and M3. Protections kept:
`custom_themes_name_key_uq`, `custom_themes_in_use_uq`, `custom_themes_in_use_ck`. Rows: 0–3.

---

## 2. Settings documents

**This area adds no row to `settings` or `box_settings`.**

- `tenant_receipts` was the one settings-shaped table (one row, `id` pinned to 1). It is deleted
  rather than moved, because nothing reads or writes it outside its own store:
  `git grep -n -E 'getPrintedReceipt\(|getReceipt\(|getVenueReceiptSettings\(|putVenueReceiptSettings\(|putReceipt\(|tenantReceipts' -- apps packages ':!*.test.ts'`
  finds only `packages/layouts/src/receipt-store.ts` and the export in `packages/db/src/index.ts:191`.
  Receipt trim now lives on `department_receipts` (venue-service). One correction to
  `area-devices.json`: the table is **not** in the configuration export. It is missing from
  `packages/db/src/configuration-transfer.ts:76-111`, and only an old test fixture names it.
- Which theme is in use stays `custom_themes.in_use` (R4: a flag on the row, not an id in a document).
- Every other value here configures one row (a profile's timeout, a printer's paper width), not the
  venue, so it stays a column on that row.

## 3. History

**Typed history kept:** `drawer_opens`, because product code reads it back:
- `apps/server/src/receipt-print.ts:632-636` reads it so a refund opens the drawer at most once.
  The new unique key makes the database hold this rule too.
- `apps/server/src/personal-data-actions.ts:172-186`, the personal-data export for a person.

It also has a CHECK across seven reasons that a JSON `data` blob in `activity_log` could not keep.

**`activity_log` kinds this area would write.** These are new: nothing records them today.
`grep -n "log.info|recordIncident|approvedBy|personId"` over `join-requests.ts`, `device-delete.ts`
and `printer-delete.ts` prints nothing, so who approved a device, for example, is not kept anywhere.
Subject ids go in `subject_kind`/`subject_id`/`person_id`/`device_id`; `data` carries names, not ids.

| kind | subject | when |
|---|---|---|
| `device.join_accepted` | device | an administrator approves a device's join (`person_id` = approver) |
| `device.join_denied` | join_request | a join is denied or fails the number check |
| `device.disabled` / `device.enabled` / `device.deleted` | device | the dashboard Devices screen |
| `device.profile_switched` | device | the active profile changes (`data`: from/to profile names) |
| `device.approved_profiles_changed` | device | `approveDeviceProfiles` (`device.ts:191`) |
| `device_profile.changed` | device_profile | a profile save (`data`: which sections changed) |
| `print_agent.enrolled` / `print_agent.revoked` | print_agent | agent pairing and revoking |
| `printer.added` / `printer.deleted` | printer | the dashboard Printers screen |

`print_jobs` is not history: it is an outbox, and its rows are the jobs themselves (`resend_of`
links a resend to its original). The receipt handover is a fact fixed on the job's row (R2), so it
becomes a column there and is not logged.

## 4. Mapping

| current | fate | target | why |
|---|---|---|---|
| devices | keep | devices | a real thing; loses `location_id` and the duplicate `created_at`, gains three CHECKs |
| device_made_here_stations | keep | device_made_here_stations | R7 link between two checked rows |
| device_approved_profiles | keep (widened) | device_approved_profiles | one row per (device, profile), now also holds the zone memory |
| join_requests | keep | join_requests | a real pending pairing; loses `location_id` |
| print_agents | keep | print_agents | a real thing; loses `location_id` |
| printers | keep (widened) | printers | absorbs its holder; `pickup_roles` JSON becomes two flags; loses `ticket_scope` and `location_id` |
| print_jobs | keep | print_jobs | the outbox; `receipt_handover` JSON becomes two columns (R4) |
| drawer_opens | keep, made append-only | drawer_opens | typed history read back by product code; `printer_id` becomes `print_job_id` |
| device_profiles | keep (widened) | device_profiles | absorbs `device_profile_service_access` (R1) |
| device_profile_printers | keep | device_profile_printers | R7 link with order and default |
| printer_holders | merge into printers | printers | at most one row per printer (R1); same protection |
| custom_themes | keep | custom_themes | a real list; logo names leave the JSON for columns (R4) |
| tenant_receipts | delete | null | no caller outside its own store (R5) |
| page_printers | keep | page_printers | a real thing; loses `location_id` |
| device_profile_service_access | merge into device_profiles | device_profiles | one row per profile (R1) |
| device_profile_zones | keep, re-pointed | device_profile_zones | R7 link; now points at `device_profiles` directly |
| device_kitchen_screen_removals | delete | null | worked out from what the device chose minus what its profile now allows (R6, D1) |
| device_kitchen_screen_stations | merge into kitchen_screen_stations | kitchen_screen_stations | same shape as the profile list |
| device_kitchen_screen_zones | merge into kitchen_screen_zones | kitchen_screen_zones | same shape as the profile list |
| device_kitchen_screens | merge into kitchen_screens | kitchen_screens | same shape as the profile row; one owner column each |
| device_profile_kitchen_screen_stations | merge into kitchen_screen_stations | kitchen_screen_stations | as above |
| device_profile_kitchen_screen_zones | merge into kitchen_screen_zones | kitchen_screen_zones | as above |
| device_profile_kitchen_screens | merge into kitchen_screens | kitchen_screens | as above |
| device_zone_selection_zones | rename | device_approved_profile_zones | R7 link under the merged parent |
| device_zone_selections | merge into device_approved_profiles | device_approved_profiles | same key `(device, profile)` |
| device_profile_admission_persons | keep | device_profile_admission_persons | R7 link to persons |
| device_profile_admission_roles | keep | device_profile_admission_roles | an enum list with a CHECK; identity is toggleable (R8) |

## 5. Protections

Sources: each schema file named in §1, the triggers found by `grep CREATE TRIGGER` over every
`packages/*/drizzle/*.sql`, and `scripts/behavioural-triggers.test.ts:130`. Only one trigger lives
on these tables today, `device_profile_form_factor_locked`. The device binding triggers were dropped
in `packages/db/drizzle/0119_drop_device_binding_triggers.sql`, and that rule moved into
`setDeviceKitchenScreens`/`assertKitchenDisplayHasScreen` (`kitchen-screens.ts:566`, `:923`).
`scripts/append-only-triggers.test.ts` names none of these tables, and neither does
`scripts/write-path-tables.json`.

| current protection | new home |
|---|---|
| every `location_id` FK and every key that includes location (`devices_location_label_active_key`, `printers_local_key_key`, `page_printers_endpoint_uq`) | the location part is dropped (R10, A1301 S24/S26/S28); each unique key stays without it |
| devices: FKs to profile and printers, restrict | kept |
| `device_profile_form_factor_locked` trigger | kept on `device_profiles` |
| device_profiles: live-name unique, form-factor CHECK | kept |
| device_approved_profiles: PK, both FKs cascade | kept on the merged table (device side becomes no action, deleted explicitly at `device-delete.ts:204`) |
| device_zone_selections: PK, FKs device / profile cascade / start zone | the PK and FKs move onto `device_approved_profiles` |
| device_zone_selection_zones: PK, composite FK cascade, zone FK | kept on `device_approved_profile_zones` |
| device_made_here_stations: PK, FKs | kept |
| join_requests: PK, kind CHECK | kept |
| print_agents: unique `node_id` | kept |
| printers: transport, paper, resolution and transport-fields CHECKs | kept |
| printers: `printers_ticket_scope_ck` | dropped with the unused column |
| printer_holders: PK `printer_id` (one holder) | holds by construction (one column); new CHECKs pair it with `held_at` and `portable` |
| printer_holders: FKs cascade with printer and with device | the printer side is moot (same row); the device side becomes ON DELETE SET NULL |
| print_jobs: kind and status CHECKs, three indexes, FKs | kept |
| drawer_opens: reason CHECK, target CHECK, FKs | kept; the calibration branch's `printer_id` clause moves to the not-null `print_job_id` |
| drawer_opens: "ledger" with no trigger (`drawer-opens.ts:16-17`) | strengthened to append-only (D5) |
| device_profile_printers: three unique keys, role CHECK, target CHECK | kept |
| custom_themes: name_key unique, in_use unique, in_use CHECK | kept; logo columns gain media-set reference triggers |
| tenant_receipts: singleton CHECK | dropped with the table (R5) |
| page_printers: format, media, port and resolution CHECKs; agent FK | kept |
| device_profile_service_access: PK (one row per profile), NOT NULL department/start zone, FKs to department, zone, profile | one row per profile holds by construction; the NOT NULLs become the all-or-nothing CHECK; the FKs move onto the columns |
| device_profile_zones: PK, FK to the access row cascade, zone FK | PK and zone FK kept; the access FK becomes the composite FK to `device_profiles(id, order_department_id)` |
| `device_profile_kitchen_screens` / `device_kitchen_screens`: composite PKs, screen CHECKs, `*_station_zones_ck` | the partial unique keys and the same CHECKs on `kitchen_screens`, plus the one-owner CHECK |
| `*_kitchen_screen_stations`: PK, cascade, station FK, screen CHECK | PK, cascade and station FK kept; the screen CHECK is no longer needed (no screen column) |
| `*_kitchen_screen_zones`: PK, cascade, zone FK, screen CHECK, not-station CHECK | all kept, through the `(kitchen_screen_id, screen)` composite FK |
| device_kitchen_screens: device FK deliberately `no action` (`kitchen-screens.ts:112-115`) | kept for device-owned rows |
| device_kitchen_screen_removals: device/station/zone FKs, screen CHECK, one-target CHECK, index | dropped with the table (D1) |
| admission tables: PKs, FKs, role CHECK | kept |

## 6. Duplicates removed

1. **Kitchen-screen settings stored in two parallel table sets**, one for profiles and one for
   devices (`packages/venue-service/src/schema/kitchen-screens.ts:26-110` and `:112-230`). The two
   sets have the same columns and the same CHECKs. There is one home now, `kitchen_screens` with an
   owner column each. Both sides are still needed, because one is what the profile allows and the
   other is what the device picked.
2. **What a narrowing took from a device** (`device_kitchen_screen_removals`) can be worked out from
   two things already stored: the device's choice, which a narrowing never changes
   (`kitchen-screens.ts:786`), and the profile's current setting. A removal row is deleted as soon as
   the profile allows the item again (`:805-809`), so the table only ever holds "chosen but no longer
   allowed". It goes (D1), and M2 measures the one place the two differ.
3. **`devices.created_at` and `devices.enrolled_at`**: both written at insert and never changed.
   One home: `enrolled_at`.
4. **A theme logo's printed dots stored twice**: `custom_themes.theme.printedLogo` and
   `department_receipts.logo_rasters` hold the same derived dots for the same picture, and
   `packages/media/src/image-edits.ts:85-97` rewrites both. The proper home is once per image in the
   media area (menu researcher). Until that lands, the theme copy stays in the theme JSON.
5. **A drawer open's printer**, `drawer_opens.printer_id`, is the same printer as its kick job's
   `print_jobs.printer_id`. One home: the job, through the new `print_job_id`.
6. **`tenant_receipts` and `department_receipts`** both claim to be the receipt trim; only the
   department one is used. One home: `department_receipts`.

## 7. Depends on other areas

- **venuebox:** `departments` (FK from `device_profiles.order_department_id`; see D2). `locations`
  goes away (A1301).
- **floorkitchen:** `floor_zones` and `kitchen_stations` (FKs from 1.2–1.10). Their
  `station_printers` → `printers` and `kitchen_print_jobs`/`kitchen_print_job_lines` → `print_jobs`
  are why print jobs cannot be deleted.
- **ordersales:** `sales`, `bill_payments` and `tender_refunds` (FKs from `drawer_opens`, and `sales`
  from `print_jobs`). Their `invoice_deliveries` points at `page_printers`, `print_agents` and
  `print_jobs`; `receipt_reprints` points at `print_jobs`; `department_transfer_desks.receiving_profile_id`
  points at `device_profiles`. Many of their tables point at `devices`, which is why devices are
  soft-deleted.
- **fiscal:** `registros_facturacion.device_id` and `payments.device_id` → `devices`. A device row can
  therefore never be removed.
- **payments (card readers):** `card_readers`, `card_reader_holders`, `device_card_readers` and
  `device_profile_card_readers` (in `area-fiscal.json`, `payments` set) point at `devices` and
  `device_profiles`, and have the same shape as printers. The suggestion is to mirror §1.15: fold
  the holder into `card_readers.held_by_device_id`. `device_card_readers` (one row per device) would
  fold into a `devices.card_reader_id` column under R1, but that puts a payment-module column on a
  core table, so it is the payments researcher's R8 call. The device and printer design here does not
  depend on how they decide.
- **people:** `persons` (FK from `device_profile_admission_persons`; plain ids in
  `drawer_opens.person_id`/`authorized_by` and `print_jobs.handed_over_by`); `sessions.device_id`.
- **menu / media:** `media_images.filename` for the theme logo columns, and a home for printed
  rasters per image (§6 item 4).
- **shared:** `activity_log` (§3).
- **Lists that follow table names** and must be edited when the tables change: the configuration
  export lists (`packages/db/src/configuration-transfer.ts:80-111`,
  `packages/venue-service/src/configuration-transfer.ts:706-710`,
  `packages/identity/src/configuration-transfer.ts:20-21`), the classification lists
  (`packages/db/src/classification.ts:108-153`, `packages/venue-service/src/classification.ts:23-33`),
  and the dashboard live-subscription names (`apps/dashboard/src/api/live-queries.ts`).
  `printers.held_by_device_id` must be added to the export's `omit` list, because devices are not
  exported. The export of `kitchen_screens` must skip rows owned by a device, together with their
  child rows. Today's `leaveBehindWhenSet` filters one table at a time
  (`configuration-transfer.ts:80`), so the children need a filter through their parent row.

## 8. Measure before building

- **M1 — print job payload size.** Run `select count(*), sum(length(payload)), avg(length(payload))
  from print_jobs` on a venue with real service history (the Santet data venue). If a year at
  reference volume (about 400,000 jobs) comes to more than about 200 MB, D3's emptying of old
  payloads is worth building. If it is a few tens of MB, leave the table alone. The result that
  would change the design: a large size.
- **M2 — removal notes worked out on read.** Change `readDevicesKitchenScreens` so that "taken
  away" means the device's choice minus what the profile now allows, then run
  `pnpm --filter @waitron/venue-service exec vitest run kitchen-screens` and the
  `apps/server` device-api kitchen-screen tests. My reading of `kitchen-screens.ts:786-871` predicts
  that the only failing cases are a device whose choice is "every station/zone" and which used to
  show the narrowed items as "no longer available". The result that would change the design:
  failures anywhere else, which would mean a removal row carries a fact that cannot be derived.
- **M3 — printing a logo without the cached dots.** Time how long it takes to convert a theme logo
  to printer dots at print time, against reading the cached copy. If it takes more than about 50 ms
  per receipt, keep one cached copy per image (in media). If it is well under, drop both caches.
- **M4 — the new composite keys.** Write through `device_profile_zones → device_profiles(id,
  order_department_id)` and `kitchen_screen_zones → kitchen_screens(id, screen)` in a test. A key
  whose target has no matching unique index is refused only at the first write, not at migrate time
  (CLAUDE.md §3), so a migration that succeeds proves nothing. Also check that each of the old
  refusals still happens: a zone row under an unrestricted profile, and a zone on a station screen.

## 9. Decisions for the owner

- **D1 — kitchen screens: one table set, and no stored removal notes.** I recommend yes. 7 tables
  become 3. The visible change is small: when a profile is narrowed, a kitchen display whose choice
  was "every station" simply shows fewer stations. It no longer lists the removed ones as "no longer
  available". The notice the dashboard shows when a profile is saved is worked out at save time from
  the before and after settings, so it is unchanged (`replaceProfileKitchenScreens` returns it,
  `kitchen-screens.ts:206-215`). The cost is an owner column with two possible parents and an export
  filter (§7). Decide after M2.
- **D2 — where the device-profile tables live.** Folding service access into `device_profiles` means
  a core table points at `departments`, which is in the venue-service set today. Venue-service is
  `mandatory` (`packages/composition/src/modules.ts:192`), so there is no swappable module to protect.
  I recommend moving `departments` into the core set (the venuebox researcher's table) so that the FK
  can exist. If that is refused, `device_profile_service_access` stays a separate table, and the only
  reason is which set can reference which.
- **D3 — empty old print job payloads.** Only if M1 shows real size: after a job is `done` or
  `failed` and some number of days old, set `payload` to empty and keep the row (the four tables in §7
  still point at it). A resend copies the original's payload (`packages/printing/src/outbox.ts:121`), so
  the number of days is also how long staff can reprint by resending. I recommend 30 days, as a
  constant in code, not a setting.
- **D4 — approvals and zone memory share a row.** Withdrawing a device's approval for a profile also
  forgets the floor zones that device chose under it. I recommend yes: the remembered zones are only
  useful while the device may run that profile.
- **D5 — make `drawer_opens` append-only and tie each open to its kick job.** This closes the open
  backlog item "`drawer_opens`: decide the remaining UPDATE/DELETE restriction (A805 follow-up)"
  (`docs/backlog.md:6685`). I recommend yes. No code updates or deletes the table today, and with the
  job id the audit can show whether the drawer was actually kicked.
