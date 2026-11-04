> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# Target design: the taxpayer, the venue and the box

Area: the taxpayer (`tenants`), the venue (`locations`, being removed by A1301), departments and their
side tables, seasons, special days, opening hours for departments and zones, business-day settings,
and the box itself (`nodes`, the eight `node.db` tables, `deployment`, membership, sealed state,
recovery packs, `incidents`, `change_log`, `scheduled_runs`, `tenant_credentials`). Also: how the
shared `settings` table fits the live-update, configuration-transfer and backup-verification machinery.

The area has 35 current tables: the 32 this design was first written for, plus the three handover
tables A1018 slice 1 (#2417) added to `node.db` (§1.18). This appendix is brought into line with the
owner's review of 4 November 2026 (ledger: `docs/handoffs/2026-11-02-schema-rationalisation.md`). First
read at `main` `64eeabb036` and refreshed at `68732329c1`; every passage the review changed was re-read
at `e0da0ad18a`. Nothing was run except `git grep`/`sed`/`perl` text searches over the tree and the
stand-in timing in §8.2; every behavioural statement below is "traced by reading" unless it says
otherwise.

**Where A1301 stands.** A1301's design (`docs/superpowers/specs/2026-11-01-a1301-remove-location-design.md`)
moves the venue's settings to a new one-row `venue_settings` table, plus `business_day_settings`,
`day_cutover_changes` and `venue_catalogues`, in its slice S23 (design §2.1 and its slice table,
`:620`). This design replaces that (owner, 2026-11-04). The venue's settings become the `settings.venue`
and `settings.business_day` documents, the default menu becomes a flag on `menus`, and only
`day_cutover_changes` stays a table; S23 creates no `venue_settings`, `venue_catalogues` or
`business_day_settings`. The cost is the language triggers reading JSON (§8.2) and a per-module trigger
replacing a CHECK. Nothing built changes: S23 has not started (`git grep -n -E
'table\("(venue_settings|venue_catalogues|business_day_settings|day_cutover_changes)"' -- packages`
prints nothing), and S20–S28 are still open with no plan (`docs/backlog.md:6557`,
`docs/superpowers/plans/2026-11-01-a1301-remove-location.md:124-125`).

Reference venue: one restaurant, 250 bills a day × 4 lines, 360 trading days a year, one box, 1–3
departments, about 6 floor zones.

---

## 1. Target tables

Twenty tables replace the area's 35 (owner, 2026-11-04), and nineteen once A1323 lands and
`recovery_packs` goes (§1.8). The three handover tables stay as they are (§1.18). A947 slice 3b's plan
adds one more `node.db` table, which is not counted here (§7).

### 1.1 `taxpayer` (today `tenants`, renamed by README §5 U9) — the taxpayer (core set, `venue.db`, `state`, not append-only)

The legal person invoices are issued in the name of. It stays a table rather than a settings document
(owner, 2026-11-04): its columns are typed and required, and the write-path guard judges a table.
Narrowed to the fiscal identity: the privacy contact moves to `settings.venue` (§2).

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | integer | PK, CHECK `id = 1` | no |
| `country` | text | | no |
| `tax_id` | text | | no |
| `legal_name` | text | | no |
| `taxpayer_domicile` | text | | yes |
| `created_at` | text (timestamp) | | no |

Protections: `taxpayer_singleton_ck`; listed in `scripts/write-path-tables.json` (request code may
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

Protections: write-path guard (three writer files, `scripts/write-path-tables.json:11-15`). 22 foreign
keys from 21 tables point at it today, 13 of them from fiscal tables (A1301 design §4). Rows: 1, or 2 on
a venue with a spare.

**`public_key` and `endorsement` both stay.** The owner asked whether either copies the signed
`node_membership` document. Neither does.

- `public_key` is the trust anchor that checks that document (`readMembershipTrustSetTx`,
  `packages/db/src/node-identity.ts:33-38`; used at `apps/server/src/node-membership-api.ts:49`,
  `rebuild-first-start.ts:61`, `start-peer-check.ts:169`). Reading keys from the document they verify
  would be circular.
- `endorsement` is the main box's signature over a spare's key. It is the source: the mint copies it
  INTO the document (`apps/server/src/membership-mint.ts:67,73`), so dropping the column would leave
  the mint nothing to carry.
- A947 keeps it. What A947 gives up is the reserved FISCAL identity (design §4 item 3), not the spare's
  `nodes` row. Today `insertReservedNodeTx` is the column's only writer
  (`packages/db/src/reserved-identity.ts:26-31`), reached only from
  `apps/server/src/reserved-identity.ts:77-85`, after a check no real join can pass yet (`:68-69`), so
  the column is null on a real box today (read, not run). The A947 3b plan (revision 4, not built) keeps that writer and moves
  it to the main box: Task 6.2 inserts the spare's row with its endorsement, and Task 4.4 has every
  chart carry each listed box's endorsement from this column
  (`docs/superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md:1786-1792, 1148-1150`). Backup
  verification reads it too (`packages/db/src/backup-evidence.ts:293, 345`).

### 1.3 `deployment` — which environment this database was stamped for (core, `state`)

Kept as is: `id` integer PK (CHECK `= 1`), `environment` text (CHECK in `production`,
`preproduction`), `stamped_at` text. Not folded into `taxpayer` or `settings.venue`: an adopted mirror is
stamped before it holds any venue row (`stampDeployment`, `apps/server/src/adopt.ts:167`; the spare
holds no venue row until the stream brings one, `apps/server/src/reserved-identity.ts:68-69`), so the
rows have different lifetimes. Not its own settings row either: that would lose the database CHECK on
`environment` and the write-path guard, which judges a table (`scripts/write-path-tables.json:2`).
Protections: both CHECKs, write-path guard. Rows: 1.

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
(`apps/server/src/till-api.ts:1531`). Rows: 1.

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
different protection and lifetime (R1 exception). A1323 changes how the row is sealed (to a public key
whose private half only the master key can calculate, owner, 2026-11-04); the row stays. Rows: 1.

### 1.8 `recovery_packs` — each recovery pack a box has made (core, `local`), until A1323 lands

Kept for now: `node_id`, `number` (unique together), `made_at`, `made_by`, `received_at`, `parts` JSON (an
allow-list with no ids or secrets, `packages/db/src/recovery-packs.ts:28-49`). Product code reads the
whole history back (`packStatus`, `apps/server/src/backup-recovery-pack-status.ts:221`). Rows: 1–3,
plus one per pack remade.

It goes with A1323's one master key, replaced by one saved date on `box` (owner, 2026-11-04). The trace
of who reads it (read, not run):

- **`takenKeyNames` is no obstacle.** It only stops a new server key repeating a name an old pack
  recorded (`apps/server/src/break-glass.ts:32-44`), for the pack route
  (`backup-recovery-pack-api.ts:299`) and `chooseBreakGlassKeyName` (`break-glass.ts:49-58`, used by
  adoption, `adopt.ts:186`). A1323 removes the server key, so the check goes with it. If a named key
  did stay, a name is a day plus four random characters from 24
  (`packages/provisioning/src/server-key-name.ts:4-12`), so a repeat needs the same day and a 1 in
  331,776 draw.
- **Going with the server key:** `keyInForceOf` (`backup-recovery-pack-api.ts:193-212`) and the server-key
  half of `keepList` (`backup-recovery-pack-status.ts:148`).
- **Not covered by one date:** open question Q1 (§9).
- **Lists to update:** `packages/handover/src/manifest.ts:82`, `packages/db/src/classification.ts:268, 281`,
  and A980's personal-data list (`docs/backlog/data-protection.md:92`).

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

### 1.10 `departments` — a part of the business that sells under its own rules (core, `state`)

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
| `receipt_logo_image_id` (new) | text | FK → `media_images.id`, on delete restrict | yes | `department_receipts.receipt.$.logo`, today a media file NAME inside JSON |
| `receipt_logo_rasters` | JSON | | yes | `department_receipts.logo_rasters` (a cache, §8) |
| `transfer_desk_profile_id` (new) | text | FK → `device_profiles.id`, on delete set null | yes | `department_transfer_desks.receiving_profile_id`: a choice of a row, so a column (R4; `tables-ordersales.md` §4) |
| `receipt_updated_at` | text | | yes | `department_receipts.updated_at` |
| `created_at` | text | | no | departments |

Protections: the two partial unique indexes lose `location_id` (A1301 S21: the default key becomes a
partial unique index on the flag, design `:618`); the four enum CHECKs move here; the two side tables'
foreign keys to `departments` disappear because the rows are one. Classification `state`. Rows: 1–3.

**The logo is a checked key, and a delete of an image in use is refused with where it is used** (owner,
2026-11-04). The image library already answers a delete that way, for menu photos and logos alike
(`deleteImage`, `packages/media/src/images.ts:414-430`); the key adds the database's own refusal. Media
and departments are both in the core set under U1, so the old ordering problem is gone, and media
reads this column directly instead of searching receipt JSON (`image-edits.ts:72-90`,
`images.ts:104-109`). The backup check that names `department_receipts.receipt.$.logo`
(`packages/media/src/backup-verification.ts:162`) follows it. Configuration transfer rewrites the key
like any other foreign key (§2.4), and media's tables travel in the same bundle.

### 1.11 `seasons`, 1.12 `special_days`, 1.13 `special_day_dates` (core, `state`)

Kept, less `location_id` (A1301):

- `seasons`: `id`, `name`, `starts_on` (`MM-DD`), `colour`. Unique `name`, unique `starts_on`; CHECKs
  on name and `starts_on`. The colour has no CHECK on purpose today, because adding one rebuilds the
  table and the rebuild's drop cascades its weeks (`schema/seasons.ts:29-30`); if A760 squashes the
  sets before go-live (`docs/backlog.md:6618`) the CHECK can be written into the new baseline. Rows: 4.
- `special_days`: `id`, `name`, `repeats_yearly`. CHECK on name. Rows: 3–10.
- `special_day_dates`: `id`, `special_day_id` (FK cascade), `date`, `closed_all_day`,
  `holiday_name`. Unique `date`; CHECK on the date. Rows: 5–20, a few more a year.

They stay tables: each has its own identity, other rows point at them (opening hours, staffing days),
and people manage them as lists. `special_days` and `special_day_dates` stay two tables, as the owner
asked to check: a special day holds several dates, each with its own hours (`parseEntries` takes the
day's `held` dates and paints each, `packages/venue-service/src/special-days.ts:563-588, 642-660`), and
a repeating day reads its stored dates as a rule for later years (`:212-220`).

### 1.14 `opening_hours` — every painted time range, for a department or a zone (core, `state`)

Replaces `department_days`, `department_day_ranges`, `zone_days` and `zone_day_ranges` with one table
(owner, 2026-11-04; §6.2). `staffing_days` already uses the same one-owner shape.

| column | type | key | null |
| --- | --- | --- | --- |
| `id` | text | PK | no |
| `department_id` | text | FK → departments, cascade | yes |
| `zone_id` | text | FK → `floor_zones.id`, cascade | yes |
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
  and `season-weeks.ts:106,155`): a department row is `period` with a `period_id`, or `closed` with no
  period only on a special-day date; a zone row has no `period_id` and is `closed`, or `open` only on a
  special-day date.

Indexes: (`department_id`, `season_id`, `weekday`, `starts_at`) where `department_id` is not null;
(`zone_id`, `season_id`, `weekday`, `starts_at`) where `zone_id` is not null; (`special_day_date_id`);
(`season_id`) for the cascade.

Rows: today's ranges — 60–200 department ranges and 0–300 zone ranges — so about 60–500. The 56–250
"day" container rows disappear.

A zone's rows cascade from `zone_service_policies` today. That table folds into `floor_zones`
(`tables-floorkitchen.md`), so the step that ends a zone's service must delete the zone's hours itself.
It already deletes `zone_days` explicitly (`packages/venue-service/src/service-delete-settings.ts:371`,
then the service row at `:399`); that delete moves to `opening_hours`.

### 1.15 `reconciliation_runs` (today `scheduled_runs`) — each run of payment reconciliation (payments, `state`)

Renamed, and `packages/scheduler` folds into `packages/payments`: payment reconciliation is its only
user, Stripe today (`runDue`, one caller, `apps/server/src/boot.ts:3548`) and SumUp planned (A949). Columns
kept as they are (`id`, `duty`, `period_from`, `period_to`, `generation`, `state`, `attempts`,
`next_attempt_at`, `started_at`, `finished_at`, `summary`, `error_code`, `created_at`, `updated_at`).
It is a work queue product code reads back (`packages/scheduler/src/run.ts`, `store.ts`), so it stays a
typed table, not `activity_log`. Rows: 0 without Stripe; about 360–700 a year with it.

### 1.16 `venue_credentials` (today `tenant_credentials`, renamed by README §5 U9) — the venue's sealed secrets (core under U1, `local`)

Kept: `purpose` PK, `ciphertext`, `iv`, `auth_tag`, `key_version`, `updated_at`, with its four CHECKs.
The two purposes marked DEPRECATED and never written (`sync.mirror_token`, `membership.node_key`,
`packages/credentials/src/purposes.ts:28-33`) are deleted from the purpose list (dead, so amended R5
allows it; before go-live names may be deleted, CLAUDE.md §3).

**Only real secrets are sealed** (owner, 2026-11-04). Several purposes hold settings that are not
secret: SMTP `from`, Stripe `successUrl`/`cancelUrl`, the bucket's `endpoint`/`region`/`bucket`/`prefix`,
the certificate's `certKind`, and most of `backup.archive`'s `settings` document
(`packages/credentials/src/purposes.ts`). They move to their owning module's settings document, where
they are visible, transferable and live-updating; the payments, backups and email areas define those
documents. `backup.stream`'s `venueId` goes altogether (§2.1).

There is one sealing method with a key per purpose (owner, 2026-11-04): two-step sign-in secrets stay
on `persons` but use the same code path (`tables-people.md`). The box's signing key stays out of this
table: it moved to `node.db` on purpose, so a spare holding a copy of `venue.db` still knows who it is
(`docs/developers/conventions-data.md:1459-1466`). Rows: 4–6.

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
`node_mode` CHECKs. Write-path guard: one entry, `box`, whose allowed files are today's five
(`mode.ts`, `recovery-key.ts`, `node-signing-key.ts`, `mirror-link.ts`, `primary-key.ts`;
`scripts/write-path-tables.json:6-10`). A missing row still reads as "sole primary", as `readNodeMode`
does today (`packages/node-db/src/mode.ts`). Rows: 1.

Because U5 keeps the mirror arc, the mirror link (`relay_url`, `box_hostname`, `box_ca_pem`,
`origin_node_id`, `adopted_at`) and the pinned main-box key (`primary_node_id`, `public_key`,
`pinned_at`) become nullable "second box" column groups here, each all-or-none. Adoption writes both,
and nothing else in product code does (`apps/server/src/adopt.ts:179,187`). A1018's start check reads
both: the other box's answer is checked with the pinned key (`peerKeyOf`,
`apps/server/src/handover-signing.ts:36-41`, through `readStoredTrustSet`, `membership-trust.ts:35-43`)
and its certificate with the mirror link's (`readMirrorLink`, `apps/server/src/start-peer-check.ts:186-195`).
`mode` and `singleton_role` stay as `box` columns, because boot's fence path and promotion read them.

A1323 replaces the three `recovery_key_*` columns with the master key's check value and adds the one
saved date of §1.8. It is wanted, not designed (`docs/backlog/box.md:2027`), so this table shows today's
columns.

### 1.18 Kept as tables of their own: `node.db`'s three handover tables (node set, `local`)

A1018 slice 1 (#2417) added three tables to `node.db`, in the node set's second migration
(`packages/node-db/drizzle/0001_chubby_dust.sql`). U5 keeps all three, beside `box`, because A1018
builds on them. None folds into `box`: a box has many operation rows, at most one open; product
code reads the events back (`apps/server/src/restricted-page.ts:76-83`), and they cannot go to
`activity_log`, which lives in `venue.db` (README §3) and so is overwritten when a box takes the other
box's copy; the restriction is written once and a different value is refused
(`packages/node-db/src/handover.ts:126-147`), while `box` is rewritten on every role change.

- `node_handover_operations`: this box's progress through each handover operation it takes part
  in. Columns `node_id`, `operation_id` (primary key together), `role` (`source`/`destination`),
  `scenario` (`controlled`/`emergency`), `source_node_id`, `destination_node_id`, `binding` JSON,
  `fingerprint`, `state` (13 states), `waiting_reason`, `created_at`, `updated_at`. CHECKs on role,
  scenario and state. A partial unique index allows at most one open operation per box
  (`node_handover_one_open_uq`). Schema: `packages/node-db/src/schema/node-handover.ts:33-67`.
- `node_handover_events`: what this box decided and received during handovers. Columns
  `event_id` (primary key), `node_id`, `operation_id` (nullable), `kind`, `detail` JSON, `envelope`,
  `recorded_at`. The schema comment says it is insert-only because its writer has no update
  (`:69`); no trigger enforces that, since the node set lists no append-only tables
  (`packages/migrations/migrations.manifest.json`, set `node`).
- `node_handover_restriction`: why this box no longer acts as the main box. One row per box
  (`node_id` primary key). Columns `operation_id` (nullable), `kind` (`handed-over`/`superseded`),
  `successor_node_id`, `membership_term`, `recorded_at`. CHECK on kind. Schema `:84-102`. Boot reads
  it (`apps/server/src/boot.ts:1801`), as do the step-down, membership and peer-status code
  (`handover-stepdown.ts:145`, `node-membership-api.ts:87`, `peer-status-api.ts:108`).

All three are classified `local`, "this box's own handover record, in node.db, keyed by this box's
node id" (`packages/node-db/src/classification.ts:6,14-16`). None has a foreign key: the schema
comments say node.db holds no venue table and no key crosses the two files. The write-path guard
lists one writer file for all three, `packages/node-db/src/handover.ts`
(`scripts/write-path-tables.json:3-5`). Rows were not measured.

---

## 2. Settings documents

How the shared `settings` table fits is in §2.4. Two rows from this area, both in
`venue.db`'s `settings`.

### 2.1 `settings.venue` (owned by core)

| field | type | default | from |
| --- | --- | --- | --- |
| `name` | text, required | — | `locations.name` |
| `invoiceLocales` | array of 1–2 language codes, required | — | `locations.invoice_locales` |
| `contentLanguages` | array of 1–200 language codes, no duplicates | set at first setup from the country pack | `content_languages.languages` |
| `defaultContentLanguage` | text, must be in `contentLanguages` | set at first setup | `content_languages.default_language` |
| `fiscalTerritory` | text | `"ES-common"` | `locations.fiscal_territory` |
| `addressLine1`, `addressLine2`, `postalCode`, `city`, `province` | text or null | null | `locations.*` same names |
| `privacyNoticeUrl` | text or null | null | `tenants.privacy_notice_url` |
| `privacyEmail` | text or null | null | `tenants.privacy_email` |
| `holidayArea` | object or null | null | §2.3 |
| `cloudVenueId` | text or null | null | the venue's id at Waitron Cloud; see below |

Content languages sit here beside invoice languages, not in the menu's document (owner, 2026-11-04);
`tables-menu.md` holds their rules.

Not carried: `bump_mode` and `fire_control` are deleted as unused (A1301 design §2.1; `fire_control` goes
in A1301 S28); `operation_description` is deleted (§6.5); `catalogue_id` (the default menu) is an id, so
under R4 it becomes the flag `menus.is_default` (menu area, §7).

"An operational venue exists" (A1301 §3's live-venue guard) becomes "the `settings` row `venue`
exists"; the primary key on `module` makes a second one impossible.

**The venue's id.** Inside the box the venue needs no id, like the taxpayer row. Waitron Cloud assigns
one when a box connects, and it belongs to the Cloud account (owner, 2026-11-02;
`docs/superpowers/specs/2026-11-04-a1301-venue-id-design.md`, whose details still await the owner's
approval). That design proposes a one-row `cloud_venue` table and says it folds into this document
under A1308, so here it is the field `cloudVenueId`; null means not connected. It is a plain value, not
a key to another row, so R4 does not forbid it. A restore carries it because it is in `venue.db`.
Configuration transfer must not, since an importing venue keeps its own. A box not connected to Cloud
backs up where its owner says, and nothing derives a folder name from a venue id.

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

### 2.3 `holidayArea` (a field of `settings.venue`)

`{ country, provinceCode, cityKey, areaKey }` or null, from the `holiday_geographies` row matching the
venue's address. It joins `settings.venue`, not a one-field `settings.venue_service` document (owner,
2026-11-04): venue-service is in core under U1.

The field records which place the choice was made for, so a later address change reads as "no area
chosen", which is what today's lookup does when no row matches (`readHolidays`,
`packages/venue-service/src/holidays.ts:134-144`). Dropped: the row `id` (R4), `location_id`, and the
`city` display text (the venue address holds it). Lost: today's table can remember a choice per city
if the venue's address moves back and forth (`createGeography` adds a row per place, `:120-132`); one
venue = one premises makes that moot.

### 2.4 How a per-module `settings` row fits the live-update machinery, transfer and backup verification

**Live updates — today a save of one module's row would wake EVERY settings watcher.** Three facts:

1. The change trigger puts an `id` in the change only when the table has a column literally named
   `id` (`packages/db/src/change-feed.ts:44-46,115`). A table keyed by `module` produces
   `{ "type": "settings" }` with no id.
2. The server matches a subscription when either side has no id
   (`apps/server/src/live-api.ts:117-121`), so an id-less change matches every `settings` interest.
3. Dashboard dependencies are plain type names with no id — `QUERY_DEPENDENCIES` is
   `Record<query, string[]>` turned into `{ type }` (`apps/dashboard/src/api/live-queries.ts:586`,
   `attendance.ts:58`), and `scripts/live-subscriptions.test.ts:10-33` checks type names only.

So with the table as centrally defined, saving `settings.menu` would make every open dashboard
re-run every query that depends on any settings document. The smallest fix that keeps the dashboard
side and the guard unchanged in shape: let a change source name a column whose value is appended to
its type, so the trigger emits `type = 'settings.' || module` (e.g. `settings.venue`), each module
declaring its document key so `liveResourceTypes` (`apps/server/src/live-resources.ts`) admits
`settings.<key>` — `parseInterests` refuses unknown types (`live-api.ts:78`). Dependencies then read
`"settings.venue"`, `"settings.business_day"`. This is a change to the central definition's plumbing,
not to the table; it is unverified (§8, first item). The alternative — emit `id = module` and let
dependencies carry ids — touches every dependency list's type.

**Configuration export/import.** Today a table may be declared by one module only
(`packages/provisioning/src/configuration-transfer.ts:172`), the import EMPTIES every declared table
before inserting (`:690-701`; for `persons` it keeps the administrators), and it rewrites ids only in
`id`, foreign-key and declared `references` columns (`:662-665,720`), never inside JSON. So `settings`
cannot be declared as a transferred table by each module: one owner would have to declare it, and the
import would wipe the rows of modules that did not transfer. It needs its own path: each module says
whether its document transfers; the export writes `{ key: { version, doc } }`; the import replaces only
those keys, runs the module's validator and shape upgrade, resets `revision`, and sets `updated_by` to
the importer or null (a source person id means nothing on the target). R4 is what makes this safe: an
id inside a document would arrive naming the source venue's row, because nothing rewrites JSON.

From this area, `venue` and `business_day` do not transfer as documents. Format 10 (#2415) carries the
taxpayer's fields, the venue's fields and the day start side by side in the bundle's `venue` field
(`PreparedVenue`, `configuration-transfer.ts:34-53`, built at `:118-137`), with the default menu as the
top-level `defaultCatalogueId` (`:133`) and the privacy contact as `privacyContact` (`:134`). That field
gains `holidayArea` (today `holiday_geographies` is a transferred table,
`packages/venue-service/src/configuration-transfer.ts:725`) and the two content-language fields (today
`content_languages`, `packages/catalogue/src/configuration-transfer.ts:208`, read at import by
`packages/media/src/configuration-transfer.ts:64`), and loses `operationDescription` (`:41`).
`cloudVenueId` stays out of it.

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

---

## 3. History

**To `activity_log`** (people read these; product logic never decides from them):

| kind | subject | data | replaces / why |
| --- | --- | --- | --- |
| `membership.node_removed` | `node`, removed node id; `person_id` | `{ contactUrl, term }` | `membership_removals` — only inserted, never read (`apps/server/src/membership-removal.ts:266`; `git grep membershipRemovals` finds no reader). Second box. |
| `membership.node_cleared` | `node`, cleared node id; `person_id` | `{ term }` | `membership_clearances` — only inserted (`membership-removal.ts:312`). Second box. |
| `taxpayer.legal_name_changed` (new) | `taxpayer`, 1; `person_id` | `{ from, to }` | the legal name printed on invoices is editable from the dashboard (A494, `packages/provisioning/src/taxpayer-name.ts`) and the old value is overwritten today |
| `credentials.saved` / `credentials.removed` (new) | `credential`, purpose; `person_id` | `{ keyVersion }` (never the secret) | who replaced the card-provider keys or the AEAT certificate; `venue_credentials` keeps only `updated_at` |
| `box.recovery_key_replaced` (new) | `node`, node id; `person_id` | `{ keyName }` | overwritten in place today |
| `box.signing_key_rotated` (new) | `node`, node id | `{ keyVersion }` | overwritten in place today |
| `box.role_changed` (new, second box) | `node`, node id | `{ mode, singletonRole, cause: adopt / promote / fenced }` | `node_mode` keeps only the latest |

Settings saves (who changed which document) are the central design's to log. Q2 (§9) asks whether the
three `box.*` kinds can live in `activity_log` at all.

**Typed history tables that remain**, each read back by product code:

- `day_cutover_changes` — the venue clock (`readVenueClockAndPlace` reads the table,
  `packages/db/src/venue.ts:88-93`; `readVenueClock` wraps it, `:118-120`), which day a sale belongs
  to (`packages/reporting/src/business-day.ts`), attendance (`packages/workforce/src/attendance-responses.ts:25`)
  (both through `readVenueClock`), setup's re-apply check (`packages/provisioning/src/venue-apply.ts:270-276`).
- `recovery_packs` — `packStatus` (`apps/server/src/backup-recovery-pack-status.ts:221`), until A1323.
- `reconciliation_runs` — `packages/scheduler/src/run.ts`.
- `incidents` — `apps/server/src/alerts-api.ts`, `box-alert-email.ts`, `box-health.ts`.

---

## 4. Mapping (every current table)

| current | fate | why |
| --- | --- | --- |
| `locations` | → `settings.venue` + `settings.business_day` + `day_cutover_changes`; `catalogue_id` → `menus.is_default` (menu area); `bump_mode`, `fire_control`, `operation_description` deleted | one venue per box (A1301); its fields are settings with no identity once nothing points at it (R3); the default menu is an id (R4); the description is §6.5 |
| `tenants` | keep as `taxpayer` (privacy fields → `settings.venue`) | the fiscal identity, typed and protected by the write-path guard |
| `nodes` | keep (less `location_id`) | 22 tables point at it |
| `incidents` | keep | a worked list, read back by alerts |
| `change_log` | keep | live-update plumbing |
| `deployment` | keep | protected stamp with its own lifetime |
| `node_membership` | keep (drop `term`) | signed document; `term` is a copy of `document.body.term` |
| `membership_removals` | → `activity_log` (`membership.node_removed`) | audit rows nothing reads back |
| `membership_clearances` | → `activity_log` (`membership.node_cleared`) | audit rows nothing reads back |
| `node_sealed_state` | keep | `local`, rewritten by a timer; different protection from `nodes` |
| `recovery_packs` | keep until A1323, then → one saved date on `box` | history read back by `packStatus`; §1.8 |
| `location_business_day_settings` | → `settings.business_day` (its `revision`) | a lone revision counter; the settings row has one |
| `location_day_cutover_changes` | rename to `day_cutover_changes` (absorbs `locations.day_cutover`) | typed history read by the venue clock |
| `node_mirror_link` | merge into `box` as second-box columns (U5) | written only by adoption (`adopt.ts:179`, `:187`); A1018's start check reads both |
| `node_mode` | merge into `box` (second-box columns) | one row per box |
| `node_primary_key` | merge into `box` as second-box columns (U5) | as `node_mirror_link` |
| `node_recovery_key` | merge into `box` | one row per box |
| `node_signing_key` | merge into `box` | one row per box |
| `department_sale_policies` | merge into `departments` | one-to-one side table |
| `departments` | keep (absorbs sale policies and receipt design) | the real thing |
| `holiday_geographies` | → `settings.venue` (`holidayArea`) | a single choice, no identity |
| `department_receipts` | merge into `departments` (logo becomes a checked key) | one-to-one side table; logo was a media name inside JSON |
| `department_day_ranges` | merge into `opening_hours` | §1.14 |
| `department_days` | merge into `opening_hours` | a container with no meaning of its own (§6.2) |
| `seasons` | keep | identity, pointed at |
| `special_day_dates` | keep | identity, pointed at |
| `special_days` | keep | identity, listed |
| `zone_day_ranges` | merge into `opening_hours` | §1.14 |
| `zone_days` | merge into `opening_hours` | container, same shape as `department_days` |
| `department_floor_plan_sets` | merge into `floor_plan_sets` (floor area owns; U1 puts departments in core) | one-to-one extension of `floor_plan_sets`, whose only other column is `id` after A1301 |
| `scheduled_runs` | rename to `reconciliation_runs`, in the payments set | work queue read back; payment reconciliation is its only user |
| `tenant_credentials` | rename to `venue_credentials` (two dead purposes deleted; non-secret fields move out) | sealed secrets, `local` |
| `node_handover_operations` | keep, a table of its own (U5, §1.18) | many rows per box, at most one open (`packages/node-db/src/schema/node-handover.ts:33-67`) |
| `node_handover_events` | keep, a table of its own (U5, §1.18) | a history product code reads back (`restricted-page.ts:76-83`); `activity_log` is in `venue.db`, which a copy overwrites |
| `node_handover_restriction` | keep, a table of its own (U5, §1.18) | one row per box, written once, a different value refused (`handover.ts:126-147`); `box` is rewritten on every role change |

---

## 5. Protections

| current protection | new home / dropped |
| --- | --- |
| `tenants_singleton_ck` | kept on `taxpayer`, as `taxpayer_singleton_ck` |
| `tenants_country_tax_id_key` (unique) | dropped: with `id = 1` enforced there is one row, so the index cannot refuse anything |
| write-path guard on `tenants` (3 files) | kept on `taxpayer`, 2 files (`privacy-contact.ts` no longer writes it) |
| `locations_invoice_locales_len` (1–2 entries) | stays a database rule (owner, 2026-11-04): a `settings` trigger for `module = 'venue'` refusing a document whose `invoiceLocales` is not a 1–2 element array (a trigger, not a CHECK, so a later per-module rule never rebuilds `settings`), plus the venue module's validator |
| `locations_bump_mode_ck`, `locations_fire_control_ck` | dropped with the unused columns |
| `locations.catalogue_id` FK → catalogues | becomes `menus.is_default` with a partial unique index "one default" (menu area) |
| four triggers reading `locations.invoice_locales` (`working_order_lines_check_*locales_insert/_update`, `packages/db/drizzle/0110_printing_retirement_restore_readers.sql`) | rewritten to read `json_extract((select doc from settings where module = 'venue'), '$.invoiceLocales')` — A1301 §2.3's plan with the source changed; its behaviour cases in `scripts/behavioural-triggers.test.ts` move with it |
| `nodes.location_id` FK | deleted (A1301 S25) |
| write-path guard on `nodes`, `deployment` | kept |
| `deployment_singleton_ck`, `deployment_environment_ck` | kept |
| `node_membership_singleton_ck` | kept |
| compare-and-set on `node_membership.term` | kept, on `json_extract(document, '$.body.term')` |
| append-only triggers on `membership_removals`, `membership_clearances` (`scripts/append-only-triggers.test.ts:51-52`) | `activity_log` is append-only |
| `incidents`: `incidents_open_dedup` (partial unique), three indexes, `severity`/`code`/`source`/`source_device` CHECKs, FK `device_id` (restrict), FK `sale_id` | all kept |
| `change_log` excluded from the change feed (`packages/db/src/classification.ts:286`) | kept; `node_sealed_state` and `recovery_packs` stay excluded too |
| `recovery_packs_node_number_uq`; the part allow-list in `insertRecoveryPack` | kept until A1323 removes the table |
| `location_business_day_settings` revision CHECK (integer ≥ 0) and its FK | the `settings` row's `revision` (central definition) |
| `location_day_cutover_changes` PK, date and time CHECKs | kept on `day_cutover_changes`, key without location |
| `node_mode` CHECKs (mode, singleton_role, not mirror+primary) | kept on `box` |
| `node_signing_key` CHECKs (version ≥ 1, iv 12 bytes, tag 16 bytes) | kept on `box`, plus all-or-none for the group |
| write-path guard on the five `node.db` tables | one entry for `box`, listing the same writer files. Weaker: the guard judges a file per table, so it can no longer tell `mode.ts` from `recovery-key.ts` writing the other's columns. The three handover tables' entries stay (`scripts/write-path-tables.json:3-5`) |
| `department_sale_policies` four enum CHECKs, FK to departments | CHECKs on `departments`; FK unnecessary (same row) |
| `department_receipts` FK to departments | unnecessary (same row) |
| a logo named inside `department_receipts.receipt` (no database check) | gained: FK `departments.receipt_logo_image_id` → `media_images.id`, on delete restrict |
| `departments_location_name_key`, `departments_one_default_per_location_key` | kept without `location_id` (A1301 S21, §1.10) |
| `holiday_geographies` unique place key, city CHECK, FK | dropped: one document entry has no duplicates; city check moves to the module's validator — a database refusal becomes a code refusal |
| `department_days` FKs (cascade to department, season, date), one-day and weekday CHECKs, partial unique season/date keys, `department_days_department_key` | FKs and CHECKs move to `opening_hours`; the unique day keys and the composite-key target are dropped because there is no day row any more (several ranges per day were always allowed) |
| `department_day_ranges` FK (`day_id`, `department_id`) → days | dropped: the department is on the same row |
| `department_day_ranges` FK (`period_id`, `department_id`) → `menu_periods(id, department_id)` | kept on `opening_hours` |
| step CHECKs on both range tables, `kind` CHECK on zone ranges | kept on `opening_hours`; plus the new kind-by-owner CHECK (gained) |
| `zone_days` FKs (zone cascade, season cascade, date cascade), CHECKs, unique keys | as for `department_days`; the zone key now points at `floor_zones` (§1.14) |
| `seasons` FKs and location-scoped unique keys; name and `starts_on` CHECKs | unique keys without location; CHECKs kept |
| `special_days` name CHECK; `special_day_dates` FK cascade, unique date, date CHECK | kept (without location) |
| `department_floor_plan_sets` FKs, unique name per department, one default per department, name CHECK | move to `floor_plan_sets` (floor area) |
| `scheduled_runs_key` unique, state/period/generation/attempts CHECKs | kept on `reconciliation_runs`, the unique key renamed to match |
| `tenant_credentials` PK and four CHECKs | kept on `venue_credentials` |

No migration-SQL trigger sits on any of the area's 35 tables, and only the four language checks read
one (perl scan of every set's `drizzle/*.sql` for `create trigger … on <table>` and for trigger bodies
naming an area table; control: the same scan lists `working_orders` with 8 and `media_images` with 10;
a later grep covered the three migration files added up to `68732329c1`, the one creating the
handover tables among them). Code-created triggers: the append-only pair above and the change-feed
triggers.

---

## 6. Duplicates removed

1. **The day start, twice.** `locations.day_cutover` is the starting value and
   `location_day_cutover_changes` the later changes; `cutoverAt` starts from the first and walks the
   second (`packages/shared/src/business-day-clock.ts:50-57`). Setup writes the first
   (`venue-apply.ts:306-318`), the editor the second (`business-day-start.ts:229-235`). One home:
   `day_cutover_changes`, with setup writing the first row.
2. **The day containers, twice.** `department_days`/`zone_days` are the same shape (owner × season ×
   weekday, or owner × special date) and neither means anything without its ranges: every reader
   inner-joins the ranges (`business-day-schedule.ts:73-144`, `operations.ts:309-312`,
   `special-days.ts:269-291,880-901`, `service-delete-settings.ts:161-172`); the one left join
   (`readDepartmentSeasonWeeks`/`readZoneSeasonWeeks`, `season-weeks.ts:207-282`) turns an empty day
   into an empty list, the same as a missing day (`seasonWeekList`, `:188-196`); and special-day writes
   skip the day row when there are no ranges (`special-days.ts:1063,1085`). Readers already UNION the
   department and zone halves (`business-day-schedule.ts:120-144`, `special-days.ts:269-291`). One home:
   `opening_hours`.
3. **The clock revision.** `location_business_day_settings` holds only a revision; it becomes the
   `settings.business_day` row's own revision.
4. **The membership term.** `node_membership.term` copies `document.body.term`.
5. **The operation description, three times.** `locations.operation_description`, each department's
   receipt `operationDescription`, and the configured default `operationDescriptionDefault`. Production
   files the department's or the configured default (`apps/server/src/sale-operation-description.ts:39-49`).
   One home: `departments.operation_description`. The venue's copy is deleted, and the description
   becomes a required input to record a sale (owner, 2026-11-04). It can reach AEAT's
   `DescripcionOperacion`, so this is a fiscal slice, which the owner lands. Deleting it removes:
   `operationDescriptionFor`'s fallback (`packages/core/src/operation-description.ts:4-7`, called at
   `record-sale.ts:347`, `record-correction.ts:304`, `record-substitution.ts:226`); setup's fill
   (`apps/server/src/setup-api.ts:502-507`); the write and the re-apply comparison in
   `packages/provisioning/src/venue-apply.ts` (`:252,289,310`) and `venue-plan.ts` (`:25,55,90,208`); the
   CLI option (`cli.ts:217`); the bundle's field (`configuration-transfer.ts:41,493`); and `readVenue`'s
   field (`packages/db/src/venue.ts:12,37`). Two scripts pass none today and take the venue's, so they
   pass their own text: `apps/server/scripts/demo-seed/seed-sales.ts` and
   `apps/server/scripts/testing/sale.ts` (`git grep -c operationDescription` finds no match in either).
6. **Receipt policy split from receipt design.** `print_trading_name`/`receipt_print_mode` live in
   `department_sale_policies`, the rest of the receipt in `department_receipts`, and one editor writes
   both. One home: `departments`.
7. **The receipt logo, as a name inside JSON.** `department_receipts.receipt.$.logo` names a media
   file, so media has to scan JSON to find and rename it (`packages/media/src/image-edits.ts:72-90`,
   `images.ts:104-109`). One home: `departments.receipt_logo_image_id` (§1.10).
8. **Venue receipt vs department receipt.** `tenant_receipts` (devices area) stores the same fields
   (header, footer, phone, email, logo, print-address, logo pictures) for the whole venue, but its
   read/write functions have no caller outside `packages/layouts/src/receipt-store.ts`
   (`git grep -n -w -E 'getReceipt|getPrintedReceipt|getVenueReceiptSettings|putReceipt|putVenueReceiptSettings|getStoredLogoRasters' -- apps packages ':!*.test.ts'`
   prints only the barrel export and a comment). One home: the department; `tenant_receipts` is deleted
   (README U6; `tables-devices.md`).
9. **The privacy contact on the taxpayer row.** Not a duplicate, but a setting on a protected identity
   row; it moves to `settings.venue`.
10. **Holiday area's city.** `holiday_geographies.city` repeats the venue address's city; the document
    keeps only the key used to match.
11. **Not removed, named:** the box's role is held both in `node_mode` (`mode`, `singleton_role`) and in
    the membership document's `standing`; the backlog's "Node-role collapse" item owns that
    (`docs/backlog.md:5989`). `nodes.public_key` also appears inside signed endorsements, and
    `nodes.endorsement` is copied into the signed document. Signed documents stay verbatim and the
    columns are their sources (§1.2), so both stay.

---

## 7. Depends on other areas

- **Menu area:** the default menu becomes the flag `menus.is_default` ("one default", partial unique
  index), replacing `locations.catalogue_id`. `location_catalogues` goes with no `venue_catalogues` in its
  place. `opening_hours.period_id` keeps a composite key to `menu_periods(id, department_id)`, which needs
  `menu_periods` to keep its unique (`id`, `department_id`) index. `media_images` is the logo target
  (§1.10). `contentLanguages` and `defaultContentLanguage` move from the menu's document to
  `settings.venue` (§2.1), and `settings.catalogue` is now `settings.menu`.
- **Floor area:** `opening_hours.zone_id` points at `floor_zones`, and the end of a zone's service
  deletes its hours explicitly (§1.14). `department_floor_plan_sets` folds into `floor_plan_sets`.
  `zone_sale_policies` folds into `floor_zones`, whose override columns mirror `departments.order_start` …
  `receipt_print_mode`.
- **People area:** `staffing_days` points at `departments`, `seasons`, `special_day_dates`; it uses
  the same one-owner pattern as `opening_hours`. `incidents.acknowledged_by` and `settings.updated_by` get
  keys to `persons` (README U11); `recovery_packs.made_by` stays a plain id, since a `local` table holds no
  key into a `state` one. Two-step sign-in secrets share `venue_credentials`' sealing method (§1.16).
- **Order/sales area:** `incidents.sale_id` → `sales`; `departments.transfer_desk_profile_id` replaces
  `department_transfer_desks` (§1.10); the sale keeps its own `receipt_trading_name`, a fact fixed at write.
- **Devices area:** `incidents.device_id` → `devices`; `departments.transfer_desk_profile_id` →
  `device_profiles`; `tenant_receipts` is deleted (§6.8).
- **Fiscal area:** 13 fiscal tables point at `nodes`; the time zone is a hashed input once A696 lands
  (A1301 §2.4), so moving it from `locations` to `settings.business_day` is a fiscal slice, as is §6.5;
  `nodes.filing_module` is chosen at setup from `fiscalTerritory`.
- **Payments / backups / email:** each area defines the settings document that takes the non-secret
  fields leaving `venue_credentials` (§1.16); `reconciliation_runs` and the scheduler's code move into
  `payments`.
- **Central `settings` definition:** the per-row change type (§2.4); the document-upgrade rule for
  backup verification; a transfer path for documents; per-module triggers on `settings`.
- **A1301:** S23 changes (see "Where A1301 stands"). The venue-id design names this file's old line
  numbers for its `cloud_venue` fold (`2026-11-04-a1301-venue-id-design.md`, "A1308"); §2.1 now holds that text.
- **A947 slice 3b:** its plan adds a `node_pair_link` table to `node.db` in PR 3b-5
  (`docs/superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md:54-56`). It is not in this design's
  count, and `box` does not absorb it, since nothing here has read it beyond that line.
- **A1323:** removes `recovery_packs`, replaces `box.recovery_key_*`, and changes how
  `node_sealed_state` is sealed (§1.7, §1.8, §1.17). It is wanted, not designed.

---

## 8. Measure before building

1. **Per-module wake-up.** Save `settings.menu` with one dashboard subscribed to
   `settings.venue` and one to `settings.menu`. Failing result: the `settings.venue` subscriber
   receives an event — then the change-feed extension in §2.4 is not working, and a busy settings
   screen would refresh every other open screen.
2. **Language triggers reading a document.** The language rule stays in the database (owner,
   2026-11-04). Time a 2,001-line order (the size CLAUDE.md §4 names) inserting `working_order_lines` with
   the four triggers reading `json_extract` from `settings`, against today's join on `locations`, on the
   reference micro PC. Failing result: the triggers cost more than 10 ms across that order — then keep
   the languages in a typed column, which means a one-row venue table after all. Stand-in so far, on a
   developer Mac with `node:sqlite`, 2,001 rows in one transaction, not the real schema: 0.5 ms with no
   trigger, 5.9 ms reading a typed row, 6.9 ms reading a settings document (the ledger's run, 4 November);
   a second run, medians of 41, gave 0.4, 3.9 and 4.3 ms. Both triggers refused a wrong language.
3. **Document upgrades vs backup verification.** Take a backup, raise a document's `version` with an
   upgrade-on-read, restore and verify. Failing result: verification refuses — then the read-time
   upgrade rule in §2.4 must be written into the central definition, or core's comparison must accept a
   declared document upgrade.
4. **Logo picture cache.** Time turning the stored logo into printer dots for one 80 mm receipt on the
   reference box. Failing result for the cache: under about 20 ms — then drop
   `receipt_logo_rasters` and convert at print time (R6); otherwise keep it, and decide with the media
   area whether the cache belongs to the image rather than the department.
5. **Day-start history protection.** A trigger refusing an update or delete of a `day_cutover_changes`
   row whose day has passed: run the editor's replace-a-pending-change path against it. Failing
   result: the legitimate replacement is refused (it deletes a FUTURE row, which must stay allowed).

---

## 9. Decisions for the owner

The owner settled D1 to D7 on 4 November 2026; each is now stated in the body. Two questions are left.

- **Q1. What replaces the pack history when A1323 lands?** The owner chose one saved date on `box` in
  place of `recovery_packs`. The trace in §1.8 found three things a date alone does not cover.
  (a) A pack goes out of date when the bucket or archive settings change (`reasonsFor` compares each
  part's `settingsRevision`, `apps/server/src/backup-recovery-pack-status.ts:77-97`), and A1323 keeps
  bucket details in the pack. Comparing the saved date with the backup settings document's `updated_at`
  would keep this, though any save of that document would then count. (b) First setup uses pack 1's row
  as its restart marker across the two database files
  (`packages/provisioning/src/first-setup-node-key.ts:179-205`). (c) The box remembers packs made but not
  confirmed, tells old packs to keep after a key change (`unreceivedOf`, `keepList`), and prints a pack
  number. A1323 keeps one key unless it is lost, so (c) may simply go. Not settled: this belongs in
  A1323's design.
- **Q2. Can the `box.*` kinds live in `activity_log`?** §3 sends `box.recovery_key_replaced`,
  `box.signing_key_rotated` and `box.role_changed` there. U5 keeps `node_handover_events` out of
  `activity_log` because `activity_log` is in `venue.db`, which a copy overwrites. The same reason reaches
  these three on a spare, which holds the main box's copy: `adopt.ts:177` sets a spare's role, and a spare
  keeps its own server key (`adopt.ts:186`). Not settled by the ledger.
