> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: the taxpayer, the venue and the box

Area: the taxpayer (`tenants`), the venue (`locations`, being removed by A1301), departments and their
side tables, seasons, special days, opening hours for departments and zones, business-day settings,
and the box itself (`nodes`, the five `node.db` tables, `deployment`, membership, sealed state,
recovery packs, `incidents`, `change_log`, `scheduled_runs`, `tenant_credentials`). Also: how the
shared `settings` / `box_settings` tables fit the live-update, configuration-transfer and
backup-verification machinery.

Read at `main` = `64eeabb036`. Nothing was run except `git grep`/`sed`/`perl` text searches over the
tree; every behavioural statement below is "traced by reading" unless it says otherwise.

**Where A1301 stands.** A1301's design (`docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md`)
moves the venue's settings to a new one-row `venue_settings` table, plus `business_day_settings`,
`day_cutover_changes` and `venue_catalogues`, in its slice S23 (design §2.1 and its slice table). S23
has not started: `git grep -n 'table("venue_settings"'` prints nothing, and the A1301 branches that
exist are S2, S3, S4, S6 and S13 (`git branch -a | grep a1301`). The backlog says the schema slices
S20–S28 "get a plan of their own" (`docs/backlog.md:6442-6466`). So this design can still change what
S23 creates; decision D1 below is exactly that.

Reference venue: one restaurant, 250 bills a day × 4 lines, 360 trading days a year, one box, 1–3
departments, about 6 floor zones.

---

## 1. Target tables

Seventeen tables replace the area's 32. Columns marked "(new)" do not exist today.

### 1.1 `tenants` — the taxpayer (core set, `venue.db`, `state`, not append-only)

The legal person invoices are issued in the name of. Narrowed to the fiscal identity: the privacy
contact moves to `settings.venue` (§2).

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | integer | PK, CHECK `id = 1` | no |
| `country` | text | | no |
| `tax_id` | text | | no |
| `legal_name` | text | | no |
| `taxpayer_domicile` | text | | yes |
| `created_at` | text (timestamp) | | no |

Protections: `tenants_singleton_ck`; listed in `scripts/write-path-tables.json` (request code may
write it only through `taxpayer-name.ts` and `venue-apply.ts`; `privacy-contact.ts` drops off the
list because the privacy fields leave). Rows: 1.

### 1.2 `nodes` — each box that records sales (core, `venue.db`, `state`)

Unchanged except that A1301 S25 deletes `location_id`.

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | text | PK | no |
| `name` | text | | no |
| `filing_module` | text | | yes |
| `tax_module` | text | | yes |
| `public_key` | text | | yes |
| `endorsement` | JSON | | yes |
| `created_at` | text | | no |

Protections: write-path guard (three writer files). 22 foreign keys point at it, 13 from fiscal tables
(A1301 design §4). Rows: 1 (2 while a standby identity is reserved).

### 1.3 `deployment` — which environment this database was stamped for (core, `state`)

Kept as is: `id` integer PK (CHECK `= 1`), `environment` text (CHECK in `production`,
`preproduction`), `stamped_at` text. Not folded into `tenants`: an adopted mirror is stamped while it
holds no taxpayer row (`adoptFromPrimary` refuses unless the venue tables are empty,
`packages/provisioning/src/tenant-guard.ts:38-40`; `deployment` is written by `adopt.ts` per
`docs/developers/conventions-data.md:924-926`), so the two rows have different lifetimes. Protections:
both CHECKs, write-path guard. Rows: 1.

### 1.4 `node_membership` — the venue's signed list of boxes (core, `state`)

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | integer | PK default 1, CHECK `= 1` | no |
| `document` | JSON (signed) | | no |
| `updated_at` | text | | no |

`term` is dropped (R6): it is a copy of `document.body.term`, written from it on every save
(`packages/db/src/node-membership.ts:83-89,112-119`). The compare-and-set "save only if newer"
(`setWhere term < new term`, `:119`) becomes `json_extract(document, '$.body.term') < ?`. The document
itself must stay verbatim because it is signed. Used on a one-box venue too: seeded at first setup
(`apps/server/src/membership-seed.ts:22`) and read by the till API to list routable servers
(`apps/server/src/till-api.ts:1530`). Rows: 1.

### 1.5 `incidents` — problems shown as alerts (core, `state`)

Kept as is: `id`, `source`, `device_id` (FK devices, restrict), `sale_id` (FK sales), `code`,
`params` JSON, `severity`, `detected_at`, `acknowledged_at`, `acknowledged_by`, `acknowledged_note`.
It is a list people work through and product code reads it back (alerts screen, alert emails, Box
status), so it stays a table rather than `activity_log`. Protections: all of today's (§5). Rows:
0–10 a day, up to about 3,600 a year (never deleted).

### 1.6 `change_log` — live-update plumbing (core, `local`)

Kept: `id` text PK, `payload` JSON. Rows: 0 at rest.

### 1.7 `node_sealed_state` — this box's state files sealed with the recovery key (core, `local`)

Kept: `node_id` PK, `sealed` blob, `updated_at`. Not folded into `nodes`: `nodes` is `state` (copied
to a standby) while this row is `local`, rewritten by a timer and must not reach another box — a
different protection and lifetime (R1 exception). Rows: 1.

### 1.8 `recovery_packs` — each recovery pack a box has made (core, `local`)

Kept: `node_id`, `number` (unique together), `made_at`, `made_by`, `received_at`, `parts` JSON (an
allow-list with no ids or secrets, `packages/db/src/recovery-packs.ts:28-49`). Product code reads the
whole history back (`packStatus`, `apps/server/src/backup-recovery-pack-status.ts:221`), so it is a
typed history table. Rows: 1–3, plus one per pack remade.

### 1.9 `day_cutover_changes` — when the trading day starts, over time (core, `state`)

The only home for "what time does the business day start". Renamed from
`location_day_cutover_changes` as A1301 planned, and it also absorbs `locations.day_cutover` (§6.1):
setup writes the first row, and the earliest row applies to every day before it.

| column | type | key | null |
| --- | --- | --- | --- |
| `effective_business_day` | text `YYYY-MM-DD` | PK | no |
| `day_cutover` | text `HH:MM:00` | | no |

Protections: the date and time CHECKs kept; the location FK goes with the location. A row whose day has
passed is never changed (enforced today in code, `protectHistory` in
`apps/server/src/business-day-start.ts:217-218`); a trigger could make that a database refusal — see
§8. Rows: 1–3.

### 1.10 `departments` — a part of the business that sells under its own rules (venue-service, `state`)

Folds in `department_sale_policies` and `department_receipts` (both keyed one-to-one by
`department_id`, schema `packages/venue-service/src/schema/service.ts:92-113` and
`schema/department-receipts.ts`). Both are written by the same screens as the department, and the
receipt editor already writes both side tables at once (`DepartmentReceiptWrite` carries `receipt`
and `policy`, `packages/shared/src/receipt-text.ts:19-22`).

| column | type | key | null | from |
| --- | --- | --- | --- | --- |
| `id` | text | PK | no | departments |
| `name` | text | unique among active | no | departments |
| `trading_name` | text | | no | departments |
| `is_default` | flag | one default (partial unique) | no | departments |
| `active` | flag | | no | departments |
| `needs_clearing` | flag | | no | departments |
| `late_send_needs_manager` | flag | | no | departments |
| `release_reminder_minutes` | integer | | yes | departments |
| `order_start` | text `table`/`counter` | CHECK | no | sale policies |
| `paid_when` | text `prepay`/`ticket_then_pay` | CHECK | no | sale policies |
| `collection_number` | text `none`/`numbered` | CHECK | no | sale policies |
| `receipt_print_mode` | text `auto`/`on_request` | CHECK | no | sale policies |
| `print_trading_name` | flag | | no | sale policies |
| `operation_description` (new as a column) | text | | yes | `department_receipts.receipt.$.operationDescription` — it is the text filed with AEAT (`apps/server/src/sale-operation-description.ts:38-49`), so it becomes a real column |
| `receipt_text` | JSON | | yes | `department_receipts.receipt` less `logo` and `operationDescription`: `printAddress`, `phone`, `email`, `headerSubtitle`, `footerMessage` (per-language texts) |
| `receipt_logo_image_id` (new) | text | FK → `media_images.id`, on delete set null — see D6 | yes | `department_receipts.receipt.$.logo`, today a media file NAME inside JSON |
| `receipt_logo_rasters` | JSON | | yes | `department_receipts.logo_rasters` (a cache, §8) |
| `receipt_updated_at` | text | | yes | `department_receipts.updated_at` |
| `created_at` | text | | no | departments |

Protections: the two partial unique indexes lose `location_id` (A1301 S6: the default key becomes a
partial unique index on the flag); the four enum CHECKs move here; the two side tables' foreign keys
to `departments` disappear because the rows are one. Classification `state`. Rows: 1–3.

### 1.11 `seasons`, 1.12 `special_days`, 1.13 `special_day_dates` (venue-service, `state`)

Kept, less `location_id` (A1301):

- `seasons`: `id`, `name`, `starts_on` (`MM-DD`), `colour`. Unique `name`, unique `starts_on`; CHECKs
  on name and `starts_on`. The colour has no CHECK on purpose today, because adding one rebuilds the
  table and the rebuild's drop cascades its weeks (`schema/seasons.ts:29-30`); if A760 squashes the
  sets before go-live (`docs/backlog.md:6509`) the CHECK can be written into the new baseline. Rows: 4.
- `special_days`: `id`, `name`, `repeats_yearly`. CHECK on name. Rows: 3–10.
- `special_day_dates`: `id`, `special_day_id` (FK cascade), `date`, `closed_all_day`,
  `holiday_name`. Unique `date`; CHECK on the date. Rows: 5–20, a few more a year.

They stay tables: each has its own identity, other rows point at them (opening hours, staffing days),
and people manage them as lists.

### 1.14 `opening_hours` — every painted time range, for a department or a zone (venue-service, `state`)

Replaces `department_days`, `department_day_ranges`, `zone_days` and `zone_day_ranges` (§6.2, D4).

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | text | PK | no |
| `department_id` | text | FK → departments, cascade | yes |
| `zone_id` | text | FK → the zone's service row (today `zone_service_policies.zone_id`), cascade | yes |
| `season_id` | text | FK → seasons, cascade | yes |
| `weekday` | integer 0–6 (0 = Sunday) | | yes |
| `special_day_date_id` | text | FK → special_day_dates, cascade | yes |
| `kind` | text `period` / `closed` / `open` | | no |
| `period_id` | text | FK (`period_id`, `department_id`) → `menu_periods(id, department_id)` | yes |
| `starts_at` | text `HH:MM:00` | | no |
| `ends_at` | text `HH:MM:00` | | no |

CHECKs:

- one owner: `(department_id is null) <> (zone_id is null)` — the same pattern `staffing_days`
  already uses for "a department OR a station" (`packages/staffing/src/schema/staffing.ts:62-99`);
- one day: `(season_id is null) <> (special_day_date_id is null) and (season_id is null) = (weekday is null)`;
- `weekday between 0 and 6`;
- the 15-minute step on both times;
- kind by owner and day (new — today "the writers check", comments at `schema/seasons.ts:144,211`
  and `season-weeks.ts:107,156`): a department row is `period` with a `period_id`, or `closed` with no
  period only on a special-day date; a zone row has no `period_id` and is `closed`, or `open` only on a
  special-day date.

Indexes: (`department_id`, `season_id`, `weekday`, `starts_at`) where `department_id` is not null;
(`zone_id`, `season_id`, `weekday`, `starts_at`) where `zone_id` is not null; (`special_day_date_id`);
(`season_id`) for the cascade.

Rows: today's ranges — 60–200 department ranges and 0–300 zone ranges — so about 60–500. The 56–250
"day" container rows disappear.

### 1.15 `scheduled_runs` — each run of a recurring background duty (scheduler, `state`)

Kept as is (`id`, `duty`, `period_from`, `period_to`, `generation`, `state`, `attempts`,
`next_attempt_at`, `started_at`, `finished_at`, `summary`, `error_code`, `created_at`, `updated_at`).
It is a work queue the scheduler reads back (`packages/scheduler/src/run.ts`, `store.ts`) and Box
health reads (`apps/server/src/pass.ts`), so it is a typed table, not `activity_log`. Only the Stripe
reconciliation uses it today (`rg -c 'runDue\('` in `boot.ts` = 1, per the tables file). Rows: 0
without Stripe; about 360–700 a year with it.

### 1.16 `tenant_credentials` — the venue's sealed secrets (credentials set, `local`)

Kept: `purpose` PK, `ciphertext`, `iv`, `auth_tag`, `key_version`, `updated_at`, with its four CHECKs.
The two purposes marked DEPRECATED and never written (`sync.mirror_token`, `membership.node_key`,
`packages/credentials/src/purposes.ts`) are deleted from the purpose list (R5; before go-live names may
be deleted, CLAUDE.md §3 "Before a venue is live, rename/delete freely"). Non-secret fields sealed
alongside the secrets are D7. Not merged with the box's signing key: that key was moved OUT of this
table into `node.db` on purpose so a spare holding a copy of `venue.db` still knows who it is
(`conventions-data.md:1459-1463`). Rows: 4–6.

### 1.17 `box` — what this box remembers about itself (node set, `node.db`, `local`)

Folds the one-row-per-box `node.db` tables into one row per box (R1: they are all facts about the same
thing, each keyed by `node_id`, one row each).

| column | type | null | from |
| --- | --- | --- | --- |
| `node_id` | text PK | no | all five |
| `recovery_key_verifier` | text | yes | `node_recovery_key.verifier` |
| `recovery_key_name` | text | yes | `node_recovery_key.key_name` |
| `recovery_key_changed_at` | text | yes | `node_recovery_key.updated_at` |
| `signing_key_ciphertext` | blob | yes | `node_signing_key.ciphertext` |
| `signing_key_iv` | blob | yes | `node_signing_key.iv` |
| `signing_key_auth_tag` | blob | yes | `node_signing_key.auth_tag` |
| `signing_key_version` | integer | yes | `node_signing_key.key_version` |
| `signing_key_changed_at` | text | yes | `node_signing_key.updated_at` |
| `mode` (second box) | text `primary`/`mirror`, default `primary` | no | `node_mode.mode` |
| `singleton_role` (second box) | text `primary`/`secondary`, default `primary` | no | `node_mode.singleton_role` |
| `role_changed_at` (second box) | text | yes | `node_mode.updated_at` |

CHECKs: the recovery-key pair is all-or-none; the signing-key group is all-or-none with
`signing_key_version >= 1`, `octet_length(iv) = 12`, `octet_length(auth_tag) = 16`; the three
`node_mode` CHECKs. Write-path guard: one entry, `box`, whose allowed files are today's four
(`mode.ts`, `recovery-key.ts`, `node-signing-key.ts`; `mirror-link.ts` and `primary-key.ts` only if D2
keeps them). A missing row still reads as "sole primary", as `readNodeMode` does today
(`packages/node-db/src/mode.ts`). Rows: 1.

If D2 keeps the mirror arc, the mirror link (`relay_url`, `box_hostname`, `box_ca_pem`,
`origin_node_id`, `adopted_at`) and the pinned main-box key (`primary_node_id`, `public_key`,
`pinned_at`) become nullable "second box" column groups here, each all-or-none.

---

## 2. Settings documents

How the shared `settings` table fits (asked in the brief) is in §2.4. Three rows from this area, all
in `venue.db`'s `settings`; nothing from this area goes into `box_settings`.

### 2.1 `settings.venue` (owned by core)

| field | type | default | from |
| --- | --- | --- | --- |
| `name` | text, required | — | `locations.name` |
| `invoiceLocales` | array of 1–2 language codes, required | — | `locations.invoice_locales` |
| `fiscalTerritory` | text | `"ES-common"` | `locations.fiscal_territory` |
| `addressLine1`, `addressLine2`, `postalCode`, `city`, `province` | text or null | null | `locations.*` same names |
| `privacyNoticeUrl` | text or null | null | `tenants.privacy_notice_url` |
| `privacyEmail` | text or null | null | `tenants.privacy_email` |
| `operationDescription` | text | — | `locations.operation_description` — **only if D3 keeps it** |

Not carried: `bump_mode` and `fire_control` are deleted as unused (A1301 design §2.1, with its
greps); `catalogue_id` (the default menu) is an id, so under R4 it becomes a flag on `catalogues`
(menu area, §7).

"An operational venue exists" (A1301 §3's live-venue guard) becomes "the `settings` row `venue`
exists"; the primary key on `module` makes a second one impossible.

### 2.2 `settings.business_day` (owned by core)

| field | type | default | from |
| --- | --- | --- | --- |
| `timeZone` | IANA zone name | `"Europe/Madrid"` | `locations.time_zone` |

This row's `revision` IS the venue clock's revision, replacing `location_business_day_settings`. Today
that counter is bumped on every day-start change (`business-day-start.ts:180-187,236`), on a time-zone
change (`apps/server/src/venue-details.ts:255-261`) and by zone repair (`venue-zone-repair.ts:80`),
and an edit naming a stale revision is refused `venue.business_day_changed`
(`business-day-start.ts:107-108`). In the new design a writer of `day_cutover_changes` saves this row
in the same transaction with the revision it read, which gives the same refusal. It is a separate
row from `venue` for the reason A1301 kept a separate table (design line 139): a venue-name save must
not wake, or conflict with, the business-day screens.

### 2.3 `settings.venue_service` (owned by venue-service)

| field | type | default | from |
| --- | --- | --- | --- |
| `holidayArea` | `{ country, provinceCode, cityKey, areaKey }` or null | null | the `holiday_geographies` row matching the venue's address |

The document records which place the choice was made for, so a later address change reads as "no
area chosen", which is what today's lookup does when no row matches (`readHolidays`,
`packages/venue-service/src/holidays.ts:153-155`). Dropped: the row `id` (R4), `location_id`, and the
`city` display text (the venue address holds it). Lost: today's table can remember a choice per city
if the venue's address moves back and forth (`createGeography` adds a row per place, `:127-143`); one
venue = one premises makes that moot. If another area also adds a `venue_service` document, the fields
merge into one document.

### 2.4 How a per-module `settings` row fits the live-update machinery, transfer and backup verification

**Live updates — today a save of one module's row would wake EVERY settings watcher.** Three facts:

1. The change trigger puts an `id` in the change only when the table has a column literally named
   `id` (`packages/db/src/change-feed.ts:44-46,115`). A table keyed by `module` produces
   `{ "type": "settings" }` with no id.
2. The server matches a subscription when either side has no id
   (`apps/server/src/live-api.ts:117-121`), so an id-less change matches every `settings` interest.
3. Dashboard dependencies are plain type names with no id — `QUERY_DEPENDENCIES` is
   `Record<query, string[]>` turned into `{ type }` (`apps/dashboard/src/api/live-queries.ts:587`,
   `attendance.ts:58`), and `scripts/live-subscriptions.test.ts:10-33` checks type names only.

So with the table as centrally defined, saving `settings.catalogue` would make every open dashboard
re-run every query that depends on any settings document. The smallest fix that keeps the dashboard
side and the guard unchanged in shape: let a change source name a column whose value is appended to
its type, so the trigger emits `type = 'settings.' || module` (e.g. `settings.venue`), each module
declaring its document key so `liveResourceTypes` (`apps/server/src/live-resources.ts`) admits
`settings.<key>` — `parseInterests` refuses unknown types (`live-api.ts:78`). Dependencies then read
`"settings.venue"`, `"settings.business_day"`. This is a change to the central definition's plumbing,
not to the table; it is unverified (§8, first item). The alternative — emit `id = module` and let
dependencies carry ids — touches every dependency list's type.

**Configuration export/import.** Today a table may be declared by one module only
(`packages/provisioning/src/configuration-transfer.ts:202`), the import EMPTIES every declared table
before inserting (`:732-737`), and it rewrites ids only in `id`, foreign-key and declared `references`
columns (`:705,759`), never inside JSON. So `settings` cannot be declared as a transferred table by
each module: one owner would have to declare it, and the import would wipe the rows of modules that
did not transfer (box-local or not exported). It needs its own path: each module says whether its
document transfers; the export writes `{ key: { version, doc } }`; the import replaces only those keys,
runs the module's validator and shape upgrade, resets `revision`, and sets `updated_by` to the importer
or null (a source person id means nothing on the target). R4 is what makes this safe: an id inside a
document would arrive naming the source venue's row, because nothing rewrites JSON. From this area:
`venue` and `business_day` already travel in the bundle's `venue.location` block
(`configuration-transfer.ts:95-160`) and are written by the provision request, so they do not
transfer as documents; `venue_service.holidayArea` transfers (today `holiday_geographies` is a
transferred table, `packages/venue-service/src/configuration-transfer.ts:725`).

**Backup verification.** Each table must have exactly one owning module (the compatibility check
refuses a table claimed twice, `apps/server/src/backup-verification-compatibility.ts:170-175`; the
inventory test requires every migrated table declared once,
`packages/composition/src/backup-verification.inventory.test.ts:16-40`). So `settings` is core's.
Core's check compares every row of each core table before and after migration and refuses any changed
value (`packages/db/src/backup-evidence.ts:40-95`, only declared `addedColumns` may differ). That has
one consequence for documents: **a document's shape upgrade must happen when it is read (and be saved
on the next save), never in a migration**, or every backup taken before the upgrade fails
verification. Traced by reading; §8 says how to test it. A module may still check its own document's
meaning in its `verifyRestoredData` by querying its row. `verifyCoreBackupData` reads `locations`
and `nodes.location_id` today (`backup-evidence.ts:258-275`); it would read "the `venue` settings row
exists".

**Does `box_settings` belong in `node.db`?** Yes, for settings that describe this machine and must
not follow `venue.db` to another box — and only those. What that brings, from the code:

- It stays on the box when a spare holds a copy of `venue.db` (that is what `node.db` is for,
  `conventions-data.md:1459-1463`), and comes back with a full restore: a restore places the
  archive's `node.dump` as `node.db` (case "places the archive's node.dump as node.db" in
  `apps/server/src/restore-file-placement.test.ts:304`, read, not run).
- It is never streamed to the bucket (`conventions-data.md:1463`); a bucket restore gets it only
  through the sealed state's `node.dump` entry, so a change is safe only after the sealed-state refresh
  has run (§8).
- `node.db` has no `change_log`, and `withTransaction` refuses the node handle
  (`conventions-data.md:1485-1487`), so a `box_settings` save wakes no dashboard by itself; the writer
  must publish its own event, as the non-table resources `backup_status` and others do
  (`live-resources.ts`).
- A change that also writes `venue.db` follows the two-file rules: node lock outside venue lock, venue
  saved first (`conventions-data.md:1475-1484`).
- It is outside configuration transfer (which reads `venue.db` only) — correct for box-local values.
- Backup verification checks the node sets against the archive's node copy
  (`backup-verification-compatibility.ts:162-180`), so `box_settings` is owned by the node set.
- Key it `(node_id, module)`: the five `node.db` tables carry `node_id` (`conventions-data.md:1520-1521`),
  and the local-table rule asks each to say what ties a row to its node.

---

## 3. History

**To `activity_log`** (audit only; nothing in product code reads these back):

| kind | subject | data | replaces / why |
| --- | --- | --- | --- |
| `membership.node_removed` | `node`, removed node id; `person_id` | `{ contactUrl, term }` | `membership_removals` — only inserted, never read (`apps/server/src/membership-removal.ts:266`; `git grep membershipRemovals` finds no reader). Second box. |
| `membership.node_cleared` | `node`, cleared node id; `person_id` | `{ term }` | `membership_clearances` — only inserted (`membership-removal.ts:312`). Second box. |
| `taxpayer.legal_name_changed` (new) | `tenant`, 1; `person_id` | `{ from, to }` | the legal name printed on invoices is editable from the dashboard (A494, `packages/provisioning/src/taxpayer-name.ts`) and the old value is overwritten today |
| `credentials.saved` / `credentials.removed` (new) | `credential`, purpose; `person_id` | `{ keyVersion }` (never the secret) | who replaced the card-provider keys or the AEAT certificate; `tenant_credentials` keeps only `updated_at` |
| `box.recovery_key_replaced` (new) | `node`, node id; `person_id` | `{ keyName }` | overwritten in place today |
| `box.signing_key_rotated` (new) | `node`, node id | `{ keyVersion }` | overwritten in place today |
| `box.role_changed` (new, second box) | `node`, node id | `{ mode, singletonRole, cause: adopt / promote / fenced }` | `node_mode` keeps only the latest |

Settings saves (who changed which document) are the central design's to log.

**Typed history tables that remain**, each read back by product code:

- `day_cutover_changes` — `readVenueClock` (`packages/db/src/venue.ts:85`), which day a sale belongs
  to (`packages/reporting/src/business-day.ts`), attendance (`packages/workforce/src/attendance-responses.ts`),
  setup's re-apply check (`packages/provisioning/src/venue-apply.ts:272`).
- `recovery_packs` — `packStatus` (`apps/server/src/backup-recovery-pack-status.ts:221`).
- `scheduled_runs` — `packages/scheduler/src/run.ts`, `apps/server/src/pass.ts`.
- `incidents` — `apps/server/src/alerts-api.ts`, `box-alert-email.ts`, `box-health.ts`.

---

## 4. Mapping (every current table)

| current | fate | why |
| --- | --- | --- |
| `locations` | → `settings.venue` + `settings.business_day` + `day_cutover_changes`; `catalogue_id` → flag on `catalogues` (menu area); `bump_mode`, `fire_control` deleted | one venue per box (A1301); its fields are settings with no identity once nothing points at it (R3); the default menu is an id (R4) |
| `tenants` | keep (privacy fields → `settings.venue`) | the fiscal identity, protected by the write-path guard |
| `nodes` | keep (less `location_id`) | 22 tables point at it |
| `incidents` | keep | a worked list, read back by alerts |
| `change_log` | keep | live-update plumbing |
| `deployment` | keep | protected stamp with its own lifetime |
| `node_membership` | keep (drop `term`) | signed document; `term` is a copy of `document.body.term` |
| `membership_removals` | → `activity_log` (`membership.node_removed`) | audit rows nothing reads back |
| `membership_clearances` | → `activity_log` (`membership.node_cleared`) | audit rows nothing reads back |
| `node_sealed_state` | keep | `local`, rewritten by a timer; different protection from `nodes` |
| `recovery_packs` | keep | history read back by `packStatus` |
| `location_business_day_settings` | → `settings.business_day` (its `revision`) | a lone revision counter; the settings row has one |
| `location_day_cutover_changes` | rename to `day_cutover_changes` (absorbs `locations.day_cutover`) | typed history read by the venue clock |
| `node_mirror_link` | delete (D2), or merge into `box` as second-box columns | adoption cannot finish today |
| `node_mode` | merge into `box` (second-box columns) | one row per box |
| `node_primary_key` | delete (D2), or merge into `box` as second-box columns | written only by adoption |
| `node_recovery_key` | merge into `box` | one row per box |
| `node_signing_key` | merge into `box` | one row per box |
| `department_sale_policies` | merge into `departments` | one-to-one side table |
| `departments` | keep (absorbs sale policies and receipt design) | the real thing |
| `holiday_geographies` | → `settings.venue_service` (`holidayArea`) | a single choice, no identity |
| `department_receipts` | merge into `departments` (logo becomes an image FK, D6) | one-to-one side table; logo was a media name inside JSON |
| `department_day_ranges` | merge into `opening_hours` | D4 |
| `department_days` | merge into `opening_hours` | a container with no meaning of its own (§6.2) |
| `seasons` | keep | identity, pointed at |
| `special_day_dates` | keep | identity, pointed at |
| `special_days` | keep | identity, listed |
| `zone_day_ranges` | merge into `opening_hours` | D4 |
| `zone_days` | merge into `opening_hours` | container, same shape as `department_days` |
| `department_floor_plan_sets` | merge into `floor_plan_sets` (floor area owns; D5) | one-to-one extension of `floor_plan_sets`, whose only other column is `id` after A1301 |
| `scheduled_runs` | keep | work queue read back |
| `tenant_credentials` | keep (two dead purposes deleted; D7) | sealed secrets, `local` |

---

## 5. Protections

| current protection | new home / dropped |
| --- | --- |
| `tenants_singleton_ck` | kept on `tenants` |
| `tenants_country_tax_id_key` (unique) | dropped: with `id = 1` enforced there is one row, so the index cannot refuse anything |
| write-path guard on `tenants` (3 files) | kept, 2 files (`privacy-contact.ts` no longer writes it) |
| `locations_invoice_locales_len` (1–2 entries) | a `settings` trigger for `module = 'venue'` refusing a document whose `invoiceLocales` is not a 1–2 element array (a trigger, not a CHECK, so a later per-module rule never rebuilds `settings`), plus the venue module's validator |
| `locations_bump_mode_ck`, `locations_fire_control_ck` | dropped with the unused columns |
| `locations.catalogue_id` FK → catalogues | becomes a flag on `catalogues` with a partial unique index "one default" (menu area) |
| four triggers reading `locations.invoice_locales` (`working_order_lines_check_*locales_insert/_update`, `packages/db/drizzle/0110_printing_retirement_restore_readers.sql`) | rewritten to read `json_extract((select doc from settings where module = 'venue'), '$.invoiceLocales')` — A1301 §2.3's plan with the source changed; its behaviour cases in `scripts/behavioural-triggers.test.ts` move with it |
| `nodes.location_id` FK | deleted (A1301 S25) |
| write-path guard on `nodes`, `deployment` | kept |
| `deployment_singleton_ck`, `deployment_environment_ck` | kept |
| `node_membership_singleton_ck` | kept |
| compare-and-set on `node_membership.term` | kept, on `json_extract(document, '$.body.term')` |
| append-only triggers on `membership_removals`, `membership_clearances` (`scripts/append-only-triggers.test.ts:51-52`) | `activity_log` is append-only |
| `incidents`: `incidents_open_dedup` (partial unique), three indexes, `severity`/`code`/`source`/`source_device` CHECKs, FK `device_id` (restrict), FK `sale_id` | all kept |
| `change_log` excluded from the change feed (`packages/db/src/classification.ts:286`) | kept; `node_sealed_state` and `recovery_packs` stay excluded too |
| `recovery_packs_node_number_uq`; the part allow-list in `insertRecoveryPack` | kept |
| `location_business_day_settings` revision CHECK (integer ≥ 0) and its FK | the `settings` row's `revision` (central definition) |
| `location_day_cutover_changes` PK, date and time CHECKs | kept on `day_cutover_changes`, key without location |
| `node_mode` CHECKs (mode, singleton_role, not mirror+primary) | kept on `box` |
| `node_signing_key` CHECKs (version ≥ 1, iv 12 bytes, tag 16 bytes) | kept on `box`, plus all-or-none for the group |
| write-path guard on the five `node.db` tables | one entry for `box`, listing the same writer files. Weaker: the guard judges a file per table, so it can no longer tell `mode.ts` from `recovery-key.ts` writing the other's columns |
| `department_sale_policies` four enum CHECKs, FK to departments | CHECKs on `departments`; FK unnecessary (same row) |
| `department_receipts` FK to departments | unnecessary (same row) |
| `departments_location_name_key`, `departments_one_default_per_location_key` | kept without `location_id` (A1301 S6) |
| `holiday_geographies` unique place key, city CHECK, FK | dropped: one document entry has no duplicates; city check moves to the module's validator — a database refusal becomes a code refusal |
| `department_days` FKs (cascade to department, season, date), one-day and weekday CHECKs, partial unique season/date keys, `department_days_department_key` | FKs and CHECKs move to `opening_hours`; the unique day keys and the composite-key target are dropped because there is no day row any more (several ranges per day were always allowed) |
| `department_day_ranges` FK (`day_id`, `department_id`) → days | dropped: the department is on the same row |
| `department_day_ranges` FK (`period_id`, `department_id`) → `menu_periods(id, department_id)` | kept on `opening_hours` |
| step CHECKs on both range tables, `kind` CHECK on zone ranges | kept on `opening_hours`; plus the new kind-by-owner CHECK (gained) |
| `zone_days` FKs (zone cascade, season cascade, date cascade), CHECKs, unique keys | as for `department_days` |
| `seasons` FKs and location-scoped unique keys; name and `starts_on` CHECKs | unique keys without location; CHECKs kept |
| `special_days` name CHECK; `special_day_dates` FK cascade, unique date, date CHECK | kept (without location) |
| `department_floor_plan_sets` FKs, unique name per department, one default per department, name CHECK | move to `floor_plan_sets` (floor area) |
| `scheduled_runs_key` unique, state/period/generation/attempts CHECKs | kept |
| `tenant_credentials` PK and four CHECKs | kept |

No migration-SQL trigger sits on any of the area's 32 tables, and only the four language checks read
one (perl scan of every set's `drizzle/*.sql` for `create trigger … on <table>` and for trigger bodies
naming an area table; control: the same scan lists `working_orders` with 8 and `media_images` with 10).
Code-created triggers: the append-only pair above and the change-feed triggers.

---

## 6. Duplicates removed

1. **The day start, twice.** `locations.day_cutover` is the starting value and
   `location_day_cutover_changes` the later changes; `cutoverAt` starts from the first and walks the
   second (`packages/shared/src/business-day-clock.ts:50-57`). Setup writes the first
   (`venue-apply.ts:306-318`), the editor the second (`business-day-start.ts:229-235`). One home:
   `day_cutover_changes`, with setup writing the first row.
2. **The day containers, twice.** `department_days`/`zone_days` are the same shape (owner × season ×
   weekday, or owner × special date) and neither means anything without its ranges: every reader
   inner-joins the ranges (`business-day-schedule.ts:69-147`, `operations.ts:335-338`,
   `special-days.ts:268-290,898-918`, `service-delete-settings.ts:187-202`); the one left join
   (`readDepartmentSeasonWeeks`/`readZoneSeasonWeeks`, `season-weeks.ts:208-285`) turns an empty day
   into an empty list, the same as a missing day (`seasonWeekList`, `:189-197`); and special-day writes
   skip the day row when there are no ranges (`special-days.ts:1080,1102`). Readers already UNION the
   department and zone halves (`business-day-schedule.ts:117-147`, `special-days.ts:268-290`). One home:
   `opening_hours`.
3. **The clock revision.** `location_business_day_settings` holds only a revision; it becomes the
   `settings.business_day` row's own revision.
4. **The membership term.** `node_membership.term` copies `document.body.term`.
5. **The operation description, three times.** `locations.operation_description`, each department's
   receipt `operationDescription`, and the configured default `operationDescriptionDefault`. Production
   files the department's or the configured default (`sale-operation-description.ts:38-49`); the
   venue's is the fallback only when a caller passes none (`packages/core/src/sale-location.ts:6-32`,
   used by `record-sale.ts:348`, `record-correction.ts:298`, `record-substitution.ts:226`), which A1301
   says no production route does (design §3). One home: `departments.operation_description` (D3).
6. **Receipt policy split from receipt design.** `print_trading_name`/`receipt_print_mode` live in
   `department_sale_policies`, the rest of the receipt in `department_receipts`, and one editor writes
   both. One home: `departments`.
7. **The receipt logo, as a name inside JSON.** `department_receipts.receipt.$.logo` names a media
   file, so media has to scan JSON to find and rename it (`packages/media/src/image-edits.ts:73-90`,
   `images.ts:104-109`). One home: `departments.receipt_logo_image_id` (D6).
8. **Venue receipt vs department receipt.** `tenant_receipts` (devices area) stores the same fields
   (header, footer, phone, email, logo, print-address, logo pictures) for the whole venue, but its
   read/write functions have no caller outside `packages/layouts/src/receipt-store.ts`
   (`git grep -n -w -E 'getReceipt|getPrintedReceipt|getVenueReceiptSettings|putReceipt|putVenueReceiptSettings|getStoredLogoRasters' -- apps packages ':!*.test.ts'`
   prints only the barrel export and a comment). One home: the department; deleting `tenant_receipts`
   is the devices area's R5 call.
9. **The privacy contact on the taxpayer row.** Not a duplicate, but a setting on a protected identity
   row; it moves to `settings.venue`.
10. **Holiday area's city.** `holiday_geographies.city` repeats the venue address's city; the document
    keeps only the key used to match.
11. **Not removed, named:** the box's role is held both in `node_mode` (`mode`, `singleton_role`) and in
    the membership document's `standing`; the backlog's "Node-role collapse" item owns that
    (`docs/backlog.md:5891`). `nodes.public_key` also appears inside signed endorsements; signed
    documents must stay verbatim, so both stay.

---

## 7. Depends on other areas

- **Menu area:** the default menu becomes a flag on `catalogues` ("one default", partial unique index
  on the flag column), replacing `locations.catalogue_id`; `location_catalogues` → `venue_catalogues`
  is theirs. `opening_hours.period_id` keeps a composite key to `menu_periods(id, department_id)`,
  which needs `menu_periods` to keep its unique (`id`, `department_id`) index. `media_images` is the
  logo target (D6).
- **Floor area:** `opening_hours.zone_id` points at whatever holds "a zone served by a department"
  (today `zone_service_policies.zone_id`, cascade). If that folds into `floor_zones`, the key moves
  there and must still cascade when a zone stops being served. `department_floor_plan_sets` folds into
  `floor_plan_sets` (D5). `zone_sale_policies` overrides the department's sale-policy columns per zone;
  if it folds into `floor_zones`, its override columns mirror `departments.order_start` … `receipt_print_mode`.
- **People area:** `staffing_days` points at `departments`, `seasons`, `special_day_dates`; it uses
  the same one-owner pattern as `opening_hours`. `incidents.acknowledged_by`, `settings.updated_by`
  and `recovery_packs.made_by` hold person ids.
- **Order/sales area:** `incidents.sale_id` → `sales`; `sale_receipt_headers` snapshots the trading
  name at sale time (a fact fixed at write).
- **Devices area:** `incidents.device_id` → `devices`; `tenant_receipts` (§6.8).
- **Fiscal area:** 13 fiscal tables point at `nodes`; the time zone is a hashed input once A696 lands
  (A1301 §2.4), so moving it from `locations` to `settings.business_day` is a fiscal slice; `nodes.filing_module`
  is chosen at setup from `fiscalTerritory`.
- **Payments / backups / email:** the non-secret fields sealed in `tenant_credentials` (D7).
- **Central `settings` definition:** the per-row change type (§2.4); the document-upgrade rule for
  backup verification; a transfer path for documents; per-module triggers on `settings`.

---

## 8. Measure before building

1. **Per-module wake-up.** Save `settings.catalogue` with one dashboard subscribed to
   `settings.venue` and one to `settings.catalogue`. Failing result: the `settings.venue` subscriber
   receives an event — then the change-feed extension in §2.4 is not working, and a busy settings
   screen would refresh every other open screen.
2. **Language triggers reading a document.** Time a 2,001-line order (the size CLAUDE.md §4 names)
   inserting `working_order_lines` with the four triggers reading `json_extract` from `settings`,
   against today's join on `locations`. Failing result: a clearly slower insert (say more than 10% on
   the reference box) — then keep the languages in a typed column, which means a one-row venue table
   after all (D1's alternative).
3. **Document upgrades vs backup verification.** Take a backup, raise a document's `version` with an
   upgrade-on-read, restore and verify. Failing result: verification refuses — then the read-time
   upgrade rule in §2.4 must be written into the central definition, or core's comparison must accept a
   declared document upgrade.
4. **Logo picture cache.** Time turning the stored logo into printer dots for one 80 mm receipt on the
   reference box. Failing result for the cache: under about 20 ms — then drop
   `receipt_logo_rasters` and convert at print time (R6); otherwise keep it, and decide with the media
   area whether the cache belongs to the image rather than the department.
5. **Sealed-state lag for `box_settings`.** Change a `box_settings` row, then restore from the bucket.
   Failing result: the change is missing — then a `box_settings` save must trigger the sealed-state
   refresh.
6. **Day-start history protection.** A trigger refusing an update or delete of a `day_cutover_changes`
   row whose day has passed: run the editor's replace-a-pending-change path against it. Failing
   result: the legitimate replacement is refused (it deletes a FUTURE row, which must stay allowed).

---

## 9. Decisions for the owner

- **D1. The venue's settings as `settings` documents, not A1301's `venue_settings` table.** S23 has
  not started, so the change is free now. Recommendation: yes — `settings.venue` and
  `settings.business_day`, the default menu as a `catalogues` flag. The cost is the language triggers
  reading JSON (§8.2) and a per-module trigger replacing a CHECK.
- **D2. The second-box data in `node.db`.** Adoption writes `node_mirror_link` and `node_primary_key`,
  but finishing it cannot succeed today and nothing copies the main box's data
  (`apps/server/src/finish-adoption.ts:29-43`); whether the setup wizard should still offer "Add a
  mirror node" is an open owner decision (`docs/backlog.md:703-706`); the mirror and failover are
  recorded as coming afterwards (`docs/backlog.md:9,35`). Recommendation: delete those two tables'
  data and the wizard option now (R11); keep `mode`/`singleton_role` as `box` columns marked "second
  box", because boot's fence path and promotion read them and removing promotion is the larger
  "Node-role collapse" call.
- **D3. Delete the venue's operation description** and make the description a required input to
  record a sale (§6.5). Fiscal: it can reach AEAT's `DescripcionOperacion`, so you land it.
  Recommendation: delete; the demo seed passes its own text.
- **D4. One `opening_hours` table for departments and zones** (vs two tables, one per owner).
  Recommendation: one; the readers already union the two halves, and `staffing_days` uses the same
  one-owner shape. The alternative keeps two tables but still drops the day containers.
- **D5. Where departments live.** Folding `department_floor_plan_sets` into `floor_plan_sets` puts a
  key to `departments` (venue-service set) on a core table, and a set may only reference sets applied
  before it (`requires`, composition comment at `packages/composition/src/modules.ts:142-143`).
  venue-service is not a swappable module (the only slot is fiscal, `modules.ts:142-145`).
  Recommendation: move `departments` (and with it seasons, special days and opening hours, which
  nothing in core needs but which belong with it) into the core set; then every key into them comes
  from a later set. Alternative: keep `department_floor_plan_sets` as a link table.
- **D6. The receipt logo as a checked key to `media_images`.** The media set is applied after
  venue-service (`packages/migrations/migrations.manifest.json` order), and media imports venue-service
  today only to search receipt JSON for logos (`image-edits.ts:3`, `images.ts:15`). Recommendation:
  make the logo a column with a key to `media_images`, apply media's set before the set holding
  `departments`, and have media find "which department uses this image" through a seam. Fallback if
  that order cannot change: a plain text column naming the image, still out of JSON.
- **D7. Secrets only in `tenant_credentials`.** Several sealed purposes hold settings that are not
  secret: SMTP `from`, Stripe `successUrl`/`cancelUrl`, the bucket's `endpoint`/`region`/`bucket`/
  `prefix`/`venueId`, the certificate's `certKind`, and `backup.archive`'s whole settings document
  (`packages/credentials/src/purposes.ts`). Recommendation: move them to their owning module's
  settings document (visible, transferable, live-updating) and seal only the secret values; the
  payments, backups and email areas define those documents.
