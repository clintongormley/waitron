> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# People, sign-in, working time and rota — proposed tables

> **2026-11-05, A1343:** The every-start history rescan described in §§1 and 8 is superseded by restart reuse tied to the database file, the pre-migration schema version and applied migration versions. An interrupted startup can still cause a conservative rescan. The day-evidence read and write-path marking audit below remain open.

Area: identity (who can sign in and how), roles, workforce (the legal working-time record, the
attendance checker, rotas, absences, swaps), workforce-es (Spanish collective-agreement rules) and
staffing (painted staffing needs). First read on `main` at `64eeabb036`; brought into line with the
owner's review of 4 November against `main` at `e0da0ad18a`. Everything here was established by
reading code and the latest drizzle snapshots
(`packages/identity/drizzle/meta/0010_snapshot.json`, `packages/workforce/drizzle/meta/0013_snapshot.json`,
`packages/workforce-es/drizzle/meta/0000_snapshot.json`, `packages/staffing/drizzle/meta/0003_snapshot.json`);
nothing was run or timed. Row counts are for the reference venue (one restaurant, 250 bills a day
× 4 lines, 360 days a year) and come from the area inventory unless I say otherwise.

The `location_id` columns and the keys that lead with them stay until A1301's schema slices
(`docs/superpowers/plans/2026-11-01-a1301-remove-location.md:441-480`), so each "drop `location_id`"
below is work those slices do anyway; this design only says what replaces each location-led key.

**Result: 32 current tables → 26 target tables.** No `location_id` anywhere (R10).

| Group | Tables | Count |
| --- | --- | --- |
| Sign-in | `persons`, `till_sessions`, `dashboard_sessions`, `sign_in_challenges`, `account_actions`, `recovery_codes`, `webauthn_credentials` | 7 |
| Roles | `roles`, `person_roles` | 2 |
| The working-time record and rota | `time_entries`, `roster_versions`, `shifts`, `shift_swaps`, `absences` | 5 |
| The attendance checker | `attendance_days`, `staff_activity`, `attendance_questions`, `attendance_answers` | 4 |
| Built, kept for planned work | `availability`, `employments`, `shift_templates`, `pay_period_closures`, `pay_period_settings`, `convenio_config` (until A586) | 6 |
| Staffing | `staffing_days`, `staffing_blocks` | 2 |

## The short version

- **The attendance checker already reads the source tables directly.** `readAttendanceFacts`
  (`apps/server/src/attendance-facts.ts:9-63`) unions `sessions`, `order_amendments`,
  `order_draft_events`, `order_group_events`, `bill_payments` and `time_entries` for the day being
  checked. It takes a source row only where `attendance_operation_facts` has no row with the same
  source and key, and then adds that table's qualifying rows for the day (`:42-48`), so where a copy
  exists, the copy wins over its source row.
  So `attendance_source_state`'s ~1M watch rows a year are not evidence at all: they are a
  change detector — one remembered fingerprint per source row ever seen (`remember()`,
  `apps/server/src/attendance-discovery.ts:233-309`), never deleted (a vanished row is marked
  `fingerprint: "deleted"`, `:479-485`). I propose deleting the table and detecting change per DAY,
  not per row: the write paths already mark the affected day (the recorder,
  `apps/server/src/attendance-capture.ts:53-132`; rota writes, `apps/server/src/attendance-source-changes.ts:12-83`,
  called from `apps/server/src/workforce-api.ts:195-307`), and a stored hash of each day's evidence
  on `attendance_days` replaces the whole-history rescan as the safety net.
  After the redesign the checker reads `till_sessions`, `order_amendments`, `order_events` (README
  U3, in place of the draft and group event tables), `bill_payments`, `refunds` (in place of the
  two refund tables), `payments` (through its new `requested_by`), `time_entries` and
  `staff_activity`.
- **Every start rescans all history today.** When workforce is on and the box is the primary
  (`isSingletonPrimary`), boot calls `beginAttendanceDiscovery` (`apps/server/src/boot.ts:2362-2363`),
  which deletes the scan rows (`attendance-discovery.ts:199`) and restarts every source at cursor 0
  (`:206`) up to its current max rowid (`:179`); `nextAttendanceDay` evaluates no day until every
  scan is complete (`:505`), and a pass reads 100 rows (`apps/server/src/attendance-loop.ts:27`).
  From reading, not measured: after a year, the checker is blocked for as many passes as there are
  source rows ÷ 100 after each start.
- **`attendance_operation_facts` is mostly a second copy.** The `session`, `bill-payment`,
  `refund` and `draft` (`event:`/`group:`) facts, and each order amendment under its own id, are
  written with the source row's own id and person (`apps/server/src/till-api.ts:1438-1447`,
  `apps/server/src/bill-payments.ts:1159-1176`, `apps/server/src/bill-refunds.ts:114-129`,
  `apps/server/src/tender-refunds.ts:134-142`, `apps/server/src/order-drafts.ts:1588-1597`,
  `apps/server/src/order-groups.ts:2558-2567`, `apps/server/src/working-order.ts:7241-7250`).
  Sessions and refunds also copy the row's own time. The others take the time from the write's own
  clock reading (`attendance.at`, or `reading.instant` for a bill payment, `bill-payments.ts:1150-1156`),
  while the source row's `created_at` is filled by `nowIso` at insert
  (`packages/db/src/schema/bill-payments.ts:57`, `order-drafts.ts:134`, `order-groups.ts:103`), so
  the copy's time can differ from the row's; by how much I have not measured. The copies' old
  reason, keeping an operation's location through later changes, went with A1301 S13 (#2397); the
  copies are still written. What has no other home: order edits per revision
  (`${orderId}:${revision}:${action}`, `apps/server/src/working-order.ts:361-369`), kitchen service
  actions (`service:…`, `attendance-capture.ts:22-41`) and a whole-order payment taken at the till,
  keyed by the order id (`apps/server/src/till-sale.ts:121-139`). That remainder becomes
  `staff_activity`. Card payments in flight stop needing a row of their own: `payments` gains
  `requested_by` (owner, 2026-11-04), so the poller that watches them
  (`apps/server/src/attendance-integrated.ts:19-152`) and its JSON snapshot go.
- **Built tables with no product writer stay** (amended R5; owner, 2026-11-04). `availability`,
  `shift_templates`, `employments`, `pay_period_closures` and `pay_period_settings` are built and
  sound, and planned work uses them (A587, A586, A793 slice 6 and
  `docs/backlog/workforce.md:22`). `convenio_config` stays until A586 replaces it. So
  `time_entries.pay_period_closure_id` and its place in the entry hash stay too. A grep of non-test
  code on main for `insert`/`update`/`delete` on each table's drizzle name finds only `closePayPeriod`
  (`packages/workforce/src/pay-period-close.ts:75`) and `setPayPeriodSettings`
  (`packages/workforce/src/pay-periods.ts:64`), and neither has a caller outside tests. Five of the
  six stay in the configuration bundle as they are today
  (`packages/workforce/src/configuration-transfer.ts:1-9`,
  `packages/workforce-es/src/configuration-transfer.ts:1-4`).
- **Short-lived sign-in rows** get one table and one sweep: `webauthn_challenges` (no sweep at all;
  `passkey.ts:95` deletes only on completion), `google_oidc_states` (swept, `google-oidc.ts:55-60`)
  and `totp_enrollments` (≤1 per person, `profile.ts:169`) become `sign_in_challenges`. Dashboard
  session rows are deleted when they end (owner, 2026-11-04). Ended till sessions stay until A980
  agrees a period (README U10).
- **`shift_assignments` is one-to-one with `shifts`** (its primary key is `shift_id`) → folds into
  `shifts`. The loop that stood in the way has gone: staffing's tables join the `workforce` set and
  roles join core (README U1).
- **One list of roles for access and for the rota** (owner, 2026-11-04). `staff_roles` and
  `person_staff_roles` go into A1002's roles and memberships, with colour, position and an on-rota
  flag on the role, and `persons.role` goes with them. A person may hold several roles. A1002 lands
  before this area's slice, so the slice only folds `staff_roles` and `person_staff_roles` in.
  `persons.role` can only go with A1002's whole-person checks.
- **Two-step sign-in secrets use one sealing method, with a key per purpose** (owner, 2026-11-04),
  and `WAITRON_ACCOUNT_KEY` goes (§6 item 8).
- **Reminder emails leave the attendance tables.** `attendance_mail` becomes rows in `outgoing_mail`
  (README U4), so no `mail_*` columns land on `attendance_questions`.
- **`workforce_chains` is a copy of the newest `time_entries` row** → deleted (owner, 2026-11-04);
  the head is read with the existing unique index. The legal record's protections (append-only
  triggers, hash chain, unique chain position) are untouched.

---

## 1. Target tables

Types use the house column vocabulary (`packages/db/src/schema/columns.ts`): `id` text, `ts` ISO
text, `day` `YYYY-MM-DD` text, `count`/`int` integer, `bool` integer 0/1, `json` text.

### Identity and roles (core migration set, README U1)

#### `persons` — keep (state)
Everyone who can sign in: till staff (PIN) and dashboard accounts. ≈30 rows, +5–15 a year
(leavers stay, suspended). Includes the read mirror's synthetic "mirror viewer" admin
(`apps/server/src/mirror-session.ts:33-60`) — **second box** row, not a table.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| display_name, display_name_folded | text | not null; folded not null (see §6) |
| first_names, last_names, telephone, locale | text | null |
| pin_hash, password_hash | text | null |
| totp_secret | text | null — the two-step secret, sealed by the one sealing method (§6 item 8) |
| email, email_folded | text | null, folded null exactly when email is |
| pending_email, pending_email_folded | text | null — the one home of an address waiting for confirmation (§6) |
| email_verified_at, passkey_offered_at | ts | null |
| google_subject | text | null |
| status | text | not null, CHECK pending/active/suspended |
| created_at | ts | not null |

`role` is gone: what a person may do comes from `person_roles` (below). A1002 §7 lists every reader
of the single role that has to change with it.

Protections: all current ones (§5), except the role CHECK, which goes with the column. New: CHECK
`(email is null) = (email_folded is null)` and the same for display name and pending email, so the
unique indexes can read the folded column directly instead of `case when folded is null then
lower(...)` (`packages/identity/src/schema/persons.ts:20`).

#### `till_sessions` — rename of `sessions` (state, mutable)
One PIN sign-in on one device. 50–200 a day, so ≈18,000–72,000 rows a year (§8, README U10).

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| person_id | id | not null, **new FK → persons** (restrict) |
| device_id | id | not null, FK → devices (restrict) |
| opened_at | ts | not null — also attendance evidence ("sign-in") |
| ended_at | ts | null |

Index `(device_id)` kept; **new** index `(opened_at)` for the checker's day read (§8). This design
prunes nothing here: rows are evidence for questions, so the period is A980's to agree (README
U10), and the bench measures the table unpruned. A till action also refuses a request whose
enrolled-device proof names a device other than the session's `device_id`
(`apps/server/src/till-session.ts:137-156`, A941), so `device_id` matters for authorising actions as
well as for reading the session.

#### `dashboard_sessions` — rename of `management_sessions` (state, mutable)
One dashboard sign-in that can still be used. 2–10 a day; tens of rows.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| person_id | id | not null, **new FK → persons** (restrict) |
| created_at, last_seen_at | ts | not null |
| ended_at | ts | null |

A row exists only while it can sign someone in (owner, 2026-11-04). It is deleted when the session
ends, and the sign-in and sign-out go to `activity_log` (§3). A row left idle past the timeout
(`IDLE_TIMEOUT_MS`, 30 minutes, `packages/identity/src/management-session.ts:13`) stays, and answers
`management_session.expired`, until the daily tidy-up job deletes it (`jobs.md` R16 `housekeeping`); a cookie for a
deleted row gets `management_session.required` instead, which changes only the sign-in page's
message (read, not run). Every write that stamps `ended_at` today becomes a delete
(`management-session.ts:108-114`, `packages/identity/src/account-action.ts:334`,
`apps/server/src/break-glass-command.ts:146`).

The personal data export reads ended rows today (`packages/identity/src/personal-data.ts:87-93`). It
reads the two `activity_log` kinds instead, which is a person reading their own record, not product
logic deciding from the log. It loses `last_seen_at`, and a session that lapsed idle shows a sign-in
with no sign-out.

The mirror viewer's fixed session (`mirror-session.ts:13-14`) is **second box**. Its code ends and
revives that one row (`mirror-session.ts:70-130`), so it alone keeps using `ended_at` until A1113
retires the viewer.

#### `sign_in_challenges` — merge of `webauthn_challenges`, `google_oidc_states`, `totp_enrollments` (state)
A sign-in or enrolment ceremony in flight, lifetime 5–10 minutes (`CHALLENGE_TTL_MS`
`passkey.ts:43`, `STATE_TTL_MS` `google-oidc.ts:15`, `TOTP_ENROLLMENT_TTL_MS` `profile.ts:159`).
0–20 rows: every insert first deletes expired rows (as Google already does, `google-oidc.ts:55-60`),
and the daily tidy-up clears the rest (`jobs.md` R16).

| column | type | key / null |
| --- | --- | --- |
| id | id | PK (the handle the browser sends back) |
| kind | text | not null, CHECK passkey_registration/passkey_login/passkey_check/google_login/google_link/totp_enrolment |
| person_id | id | null, **new FK → persons** (cascade) |
| challenge | text | null — passkey kinds only |
| state_hash | text | null, UNIQUE where not null, CHECK length 64 — Google kinds only |
| nonce, verifier | text | null — Google kinds only |
| encrypted_secret | text | null — totp_enrolment only; sealed as `persons.totp_secret` is (§6 item 8) |
| created_at, expires_at | ts | not null, CHECK expires_at > created_at |

Shape CHECK by kind (which columns are set, and that `person_id` is set for `passkey_registration`,
`passkey_check`, `google_link`, `totp_enrolment`). A partial UNIQUE `(person_id) where kind =
'totp_enrolment'` keeps "one pending authenticator setup per person" in the database instead of in
`profile.ts:169`'s delete-first.

#### `account_actions` — rename of `management_account_actions` (state)
An emailed proof waiting to be used: account activation, password reset, email change. 0–10 rows;
days-long lifetime and an attempt counter, so not merged with the minutes-long challenges.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| person_id | id | not null, FK → persons (restrict) |
| issued_by | id | null, FK → persons (restrict) — A1002 §5 target, 2026-11-08: administrator issuer's person ID; null for self-service; identity only, no authority snapshot |
| purpose | text | not null, CHECK invitation/password_reset/email_change |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| code_hash | text | null, CHECK length 64 |
| code_expires_at | ts | null |
| code_attempts | int | not null ≥ 0 |
| created_at, expires_at | ts | not null, CHECK expires_at > created_at |
| used_at | ts | null |

`target_email` is dropped: it repeats `persons.pending_email` (§6). `code_hash` is a keyed hash, and
its key becomes the `account-action-code` purpose key (§6 item 8).

#### `recovery_codes` — keep (state)
Single-use two-factor backup codes, 10 per person who has two-factor. 20–50 rows. Columns as today
(`id`, `person_id` FK restrict, `code_hash` CHECK length 64, `created_at`, `used_at`).

#### `webauthn_credentials` — keep (state)
A registered passkey. 2–10 rows. Columns and protections as today (UNIQUE `credential_id`, FK
`person_id` restrict).

#### `roles` — merge of A1002's roles and `staff_roles` (state)
The one list of roles, for access and for the rota (owner, 2026-11-04). A role can grant privileges,
appear on the rota, or both: Supervisor grants privileges, and a "Cook" role may grant none and
appear on the rota. Four built-ins plus 5–10 job positions and any custom roles. A1002 §4's
2026-11-08 correction fixes the two state tables as `roles` and `person_roles`.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| preset_key | text | null, UNIQUE where not null, CHECK staff/supervisor/manager/admin — A1002's four built-ins |
| name, name_folded | text | null on a built-in, whose name is translated in code; set on every other role; folded UNIQUE where not null and `retired_at` is null, so a retired role's name can be used again; CHECK `trim(name) <> ''` — from `staff_roles.name` |
| colour | text | not null, default `grey`, CHECK the calendar colours — from `staff_roles` |
| position | count | not null, default 0 — from `staff_roles` |
| on_rota | bool | not null — **new**: the role appears on the rota and the staffing painter |
| retired_at | ts | null — **new**: set when a role a shift has used is retired (owner, 2026-11-04) |
| permissions | JSON | not null — list of declared permission IDs; ordinary saved grants only; Admin stores an empty list and receives every current/future declared permission from constants in code (A1002 §3–§4, corrected 2026-11-08) |

A1002 §4's corrected approval has no privilege catalogue, grants, seed-completion or authority-revision
tables. Policy role IDs are JSON on their owning device/reason/bill-limit rows, not additional role tables.

What changes for the rota, read in `packages/staffing/src/`:
- `listStaffRoles` (`staff-roles.ts:124`), which `readRotaWeek` uses (`rota.ts:53`), lists every
  role today; it lists only `on_rota` roles. `reorderStaffRoles`' "each of them exactly once"
  (`staff-roles.ts:201-218`) then means each on-rota role.
- A name is compared exactly after trimming today (`staff-roles.ts:57-66`). A1002 §3 compares a
  custom role's name after Unicode folding, so "Café" and "CAFE" clash.
- Changing who holds a role moves from staffing's holders route, gated by `staffing.manage`
  (`routes.ts:161-162`, `:337-345`), to A1002's membership change. That needs `person.admin`, and
  the person's whole result must stay within what the assigner holds (A1002 §5). Manager holds
  `person.admin` by default (owner, 2026-11-04), so managers go on assigning roles.
- **A role a shift has used is retired, not deleted** (owner, 2026-11-04). Today the delete is refused
  for as long as a shift names the role (`staff_role.in_use`,
  `packages/staffing/src/staff-roles.ts:221-275`), and shifts are never deleted once published, so such
  a role can never go. Under this design the same action sets `retired_at` and, in one transaction,
  removes the role's memberships, its list references and its painted `staffing_blocks` rows, which
  today go through the foreign key's cascade when the role row is deleted. The role leaves every list
  and every holder, and its row stays, so past shifts keep the name. A role no shift has used is
  deleted, as today. Built-in roles are neither (A1002 §3).
- A past week's rota must still name a retired role. The cards look a shift's role up in the week's
  list (`packages/staffing/src/dashboard/rota-cards.ts:158`), so `readRotaWeek` adds every role that
  week's shifts name, retired or off the rota. Read, not run.
- **The rota keeps warning about someone outside a role, and does not refuse them.** The rota offers
  everyone, sorted into people who hold the role and people who do not
  (`packages/staffing/src/dashboard/rota-model.ts:229-242`), and draws "outside staff role" as a warning
  (`rota-cards.ts:112`, `:171`). `addRotaShift` checks that the role exists, not that the person holds it
  (`rota.ts:226-249`). A manager covering a gap can put a waiter on the bar and see the warning.

#### `person_roles` — merge of `persons.role` and `person_staff_roles` (state, link)
Who holds which role, several per person (A1002 §3). 30–70 rows. PK (person_id, role_id).
`person_id` FK cascade, as `person_staff_roles` today. `role_id` FK restrict, because A1002 §4 has a
role's deletion remove its memberships itself, in one transaction. R7.

### Workforce (migration set `workforce`, can be switched off)

#### `time_entries` — keep (ledger, **append-only**) — the legal working-time record
Every clock-in, clock-out, break, correction and confirmation, hash-chained per node. 30–60 a day,
11,000–22,000 a year. Columns as today, `pay_period_closure_id` included: it stays null in the
product, because nothing closes a pay period (`docs/backlog/workforce.md:222-229`), and it stays an
input to the entry hash (`packages/workforce/src/chain-hash.ts:91`), so the hash format does not
change. Every append-only trigger, CHECK, unique index and foreign key stays (§5). `node_id → nodes`
stays (one chain per node, A1268,
`docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md:61-63`).

The chain head is read from this table: `select id, entry_hash, recorded_at, sequence_no from
time_entries where node_id = ? order by sequence_no desc limit 1`, served by
`time_entries_chain_position_uq (node_id, sequence_no)`. The append code already relies on the one
write transaction, not a lock, and on that unique index against a fork (`packages/workforce/src/chain.ts:48-53`),
and the clamped `recorded_at` it writes is non-decreasing per chain (`chain.ts:110-117`), so the
newest row's `recorded_at` is the high-water mark the head stores today.

#### `roster_versions` — keep (state)
One week's rota, draft/published/superseded. 52–100 a year. Drop `location_id`; the partial UNIQUE
becomes `(period_start, period_end) where status = 'published'`. Other columns and CHECKs as today.

#### `shifts` — keep, absorbs `shift_assignments` (state)
One planned shift. ≈18 a day, 6,500–10,000 a year.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| person_id | id | not null, FK → persons (restrict) |
| roster_version_id | id | **not null**, FK → roster_versions (cascade, so deleting a draft takes its shifts) |
| starts_at, ends_at | ts | not null, CHECK ends > starts |
| starts_offset_minutes, ends_offset_minutes | int | not null, CHECK −840..840 |
| role_id | id | null, FK → roles (restrict) — from `shift_assignments.staff_role_id` |
| department_id | id | null, FK → departments (cascade) — from `shift_assignments` |
| station_id | id | null, FK → kitchen_stations (cascade) — from `shift_assignments` |
| created_at | ts | not null |

`roster_version_id` becomes not null because both product inserts pass a version: the copy into a
new draft (`packages/workforce/src/clocking.ts:326-329`) and `addShift`, whose `versionId` is a
required string (`clocking.ts:127-128`, `:413-419`). A null today comes only from deleting a
version (the FK's `set null`, `packages/workforce/src/schema/shifts.ts:42`; a grep of non-test code
finds no write of a null version); `packages/staffing/src/rota.ts:279-282` attaches such a shift to a
version before editing it. New CHECK: `role_id is null` exactly when `department_id` and
`station_id` are both null, otherwise exactly one area (`shift_assignments_one_area_ck` carried
over).

#### `shift_swaps` — keep (state)
A give-away or swap request, the colleague's acceptance and the manager's decision. 50–200 a year.
As today.

#### `absences` — keep (state)
A request to be away and its decision. 100–300 a year. As today.

#### `attendance_days` — rename of `attendance_day_work` (state)
The checker's work item: one row per business day. 360 a year.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| business_day | day | not null, **UNIQUE** |
| start_at, end_at | ts | not null, CHECK end > start — saved bounds. A new mark with different bounds is refused (`attendance-state.ts:32-34`); `nextAttendanceDay` re-derives them only while the day is unevaluated and refuses a change after (`apps/server/src/attendance-discovery.ts:507-529`, `:548-550`) |
| dirty_revision, evaluated_revision | int | not null, CHECK as today |
| next_due_at | ts | not null |
| evidence_hash | text | null — hash of the evidence the last evaluation read (new, §8) |

`deferred_shift_ids` (a JSON list of shift ids, R4) is dropped: it is written once
(`packages/workforce/src/end-of-day.ts:412-419`) and read only for its length
(`attendance-loop.ts:48`, `attendance-discovery.ts:537`). The same evaluation sets `next_due_at`
to the earliest deferred shift's end (`end-of-day.ts:393, :417`), or the day's end when none is deferred,
so "has deferred shifts" is `next_due_at > end_at`. Index `(next_due_at)`.

#### `staff_activity` — rename of `attendance_operation_facts`, narrowed (state)
"This person did something on the till at this moment", for activity no other table records with
an actor and time: order edits per revision, kitchen service actions, and a whole-order payment
taken at the till. Estimate 1,000–2,000 a day (order edits dominate; the inventory's 1,500–2,500
includes the copies that go), so ≈360,000–720,000 rows a year. This design prunes nothing here: the
period is A980's to agree (README U10), and the bench measures the table unpruned.

| column | type | key / null |
| --- | --- | --- |
| sequence | integer | PK autoincrement |
| source | text | not null, CHECK order/whole-payment |
| key | text | not null; UNIQUE (source, key) |
| person_id | id | not null, FK → persons (restrict) |
| kind | text | not null, CHECK order/payment |
| at | ts | not null |
| offset_minutes | int | not null, CHECK −840..840 |
| business_day | day | not null — fixed when written |

Indexes: `(business_day, person_id, at)`, `(person_id, at, sequence)`.

`outcome` and its index go. Only three writers pass anything but "qualified": the card payment in
flight (`attendance-integrated.ts:31`, `:41`), a bill payment (`bill-payments.ts:1153`) and a bill
refund (`bill-refunds.ts:118`). All three stop writing here, so every remaining row qualifies.

#### `attendance_questions` — keep (state)
A question about someone's working day ("you were clocked out automatically — when did you
leave?"). 400–1,800 a year.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK; UNIQUE (id, person_id) for the composite FKs |
| attendance_day_id | id | not null, FK → attendance_days (restrict) — replaces the copied `business_day`, `start_at`, `end_at` (§6) |
| person_id | id | not null, FK → persons (restrict) |
| shift_key | text | not null; UNIQUE (person_id, shift_key) |
| kind | text | CHECK automatic-out/missing-times |
| missing_kinds | json | not null (enum strings, not ids) |
| open_entry_id, automatic_entry_id, resolved_by_entry_id | id | null, FK (id, person_id) → time_entries |
| evidence_keys | json | not null — a list of `source:id` labels to compare, not links |
| active | bool | not null |
| canonical_question_id | id | null, FK (id, person_id) → attendance_questions |
| inactive_reason | text | null |
| created_at | ts | not null |

`evidence_keys` stays a list of labels (owner, 2026-11-04). The labels name row ids, but they are
only compared as sets (`end-of-day.ts:186-271`, `attendance-questions.ts:101`), never used to fetch a
row, and they span several tables, so no foreign key could check them. The column says so where it
is declared.

The reminder email is a row in `outgoing_mail` (README U4; its columns are in `jobs.md`), with the
"don't send after" time every queued mail carries. `attendance_mail`'s rules have to survive the
move, or reminders change. Each of these is today's behaviour, read, not run:
- One mail per question (`attendance_mail_question_uq`; `attendance-questions.ts:78-81`).
- A mail not yet sent is cancelled when its question is answered, merged or retired, and one being
  sent is left alone (`packages/workforce/src/attendance-mail.ts:22-35`,
  `attendance-rota.ts:46-57`, `end-of-day.ts:57-68`).
- A cancelled mail is reopened if its question comes back, unless a send may already have gone out
  (`end-of-day.ts:85-111`).
- Merging or retiring a question asks whether its mail has been attempted, and if so cancels the
  surviving question's mail, so a person is not reminded twice (`attendance-questions.ts:215-223`,
  `end-of-day.ts:215-225`).
- The sender re-reads the question and reconciles the person's day in the transaction that claims
  the mail, and sends nothing if the question has gone (`apps/server/src/attendance-email-worker.ts:73-127`).

#### `attendance_answers` — rename of `attendance_response_commands` (ledger, **append-only, new**)
Each answer given to a question (confirm, propose times, approve, decline…), who asked and who
authorised it, so a repeated request is recognised (`readAttendanceCommand` replay,
`packages/workforce/src/attendance-response-commands.ts`). 500–3,000 a year. Nothing updates or
deletes it today (grep of `update(attendanceResponseCommands)` in non-test code: no hit), so
`appendOnly()` costs nothing and protects the audit trail.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| requested_by_person_id, authorized_by_person_id, person_id | id | not null, FK → persons (restrict) |
| question_id | id | null, FK (question_id, person_id) → attendance_questions |
| action | text | CHECK confirm/request/propose/approve/decline/accept/disagree |
| entry_ids | json | not null; CHECK a JSON array with at least one id, as today |
| input | json | not null |
| created_at | ts | not null |

`entry_ids` stays a list on the answer, under R4's exception for a short list owned by one row: ≈1–2 ids
an answer, and every read found goes through the answer it belongs to
(`attendance-response-commands.ts:44`, `:190`, `attendance-reads.ts:52`, `attendance-responses.ts:68-72`).
The ids are labels the database does not check, which is the price of having no link table.

#### `availability`, `employments`, `shift_templates` — keep (state)
Built, with no product writer yet; they stay under the amended R5 (owner, 2026-11-04). The rota and
the overtime sum read `employments` (`packages/staffing/src/rota.ts:62-66`,
`packages/workforce/src/clocking.ts:608`), and the personal data export reads `availability`
(`packages/workforce/src/personal-data.ts:81`). Columns and protections as today; only
`shift_templates` has a `location_id` to drop.

#### `pay_period_closures` — keep (ledger, **append-only**); `pay_period_settings` — keep (state)
Built for closing a pay period, which nothing in the product does yet; A793's slice 6 waits for it
(`docs/backlog/workforce.md:222-229`). Columns and protections as today.

#### `convenio_config` — keep until A586 (migration set `workforce-es`, state)
One row of collective-agreement rules per venue today. A586 plans rule sets per person and removes
this table. Rota warnings treat a missing row as "no rules"
(`apps/server/src/workforce-api.ts:285-288`). `location_id` goes, and its unique key becomes a
one-row check.

### Staffing (tables in migration set `workforce`, README U1; the code stays its own module)

#### `staffing_days` — keep (state)
A painted staffing plan for one area on one weekday of a season, or one special date. 30–80 rows.
As today; its FKs point at departments, kitchen stations, seasons and special-day dates (§7).

#### `staffing_blocks` — keep (state)
One painted need ("two waiters 13:00–16:00") inside a staffing day. 100–300 rows. As today, with
`staff_role_id` renamed `role_id`, FK → roles (cascade, as today).

---

## 2. Settings documents

**None required by this design.** `pay_period_settings` and `convenio_config` are settings in shape,
but both stay tables (§1).

## 3. History

**Typed history tables that remain** (product code reads them back):
- `time_entries` — read by `packages/workforce/src/record-reads.ts` and `hours-reads.ts` (till
  Hours, dashboard My hours), `apps/server/src/till-clock-state.ts`, the checker
  (`end-of-day.ts:144-146`) and `packages/workforce-es/src/record-export.ts` (registro de jornada,
  which since A1301 S14/S15b (#2404, #2408) takes no location and prints the venue's name).
- `attendance_answers` — read by `attendance-response-commands.ts`
  (replay), `attendance-reads.ts`, `attendance-question-responses.ts`.

**To `activity_log`.** It is for people to read, and product logic never decides from it (README
§3). Only the two `dashboard.*` kinds are built by this work, because they replace rows that are
now deleted. Every other kind below is new and is a follow-up (README U11): no person-change audit
exists today (a grep for audit or role-change logging in `packages/identity/src/staff.ts` and
`profile.ts` found none).

| kind | subject | written by |
| --- | --- | --- |
| `dashboard.signed_in` (`data`: method), `dashboard.signed_out` | person | `management-session.ts` |
| `person.created`, `person.updated` | person | `staff.ts`, `profile.ts`, provisioning import |
| `person.roles_changed` (`data`: added, removed) | person | A1002's membership change, which replaces `staff.ts`'s `setRole` and `setStaffRoleHolders`, a delete-then-insert that keeps no record of who held a role (`staff-roles.ts:180-199`). **2026-11-08:** this proposed kind is superseded by `role.member_added` / `role.member_removed` in [approved A1002 §7](../2026-10-22-a1002-custom-roles-design.md#7-replacement-audit-follow-each-consumer-to-its-meaning). |
| `person.suspended`, `person.reactivated` | person | `staff.ts` |
| `person.pin_reset`, `person.password_changed` | person | `staff.ts`, `profile.ts`, `account-action.ts` |
| `person.email_changed` | person | `account-action.ts` (on confirmation) |
| `person.two_factor_enabled`, `person.two_factor_disabled`, `person.recovery_codes_replaced`, `person.recovery_code_used` | person | `profile.ts`, `mfa.ts`, `staff.ts`, `apps/server/src/break-glass-command.ts` |
| `person.passkey_added`, `person.passkey_removed` | webauthn_credential | `passkey.ts`, `profile.ts`, `staff.ts` |
| `person.google_linked`, `person.google_unlinked` | person | `google-oidc.ts`, `profile.ts` |

Not logged, because the row itself keeps the fixed fact (R2): rota publication
(`roster_versions.published_by_person_id`, `published_at`), absence and swap decisions
(`decided_by_person_id`, `decided_at`). Till sign-ins are not logged: `till_sessions` is the record,
and 50–200 a day is the most frequent identity event. A reminder's sending state lives on its
`outgoing_mail` row.

## 4. Mapping

| current | fate | target | why |
| --- | --- | --- | --- |
| google_oidc_states | merge into | sign_in_challenges | a sign-in ceremony in flight; same lifetime and sweep as the passkey and TOTP rows |
| management_account_actions | rename to | account_actions | emailed proofs keep their own lifetime and attempts; `target_email` dropped (§6) |
| management_sessions | rename to | dashboard_sessions | a row lives only while it can sign in; sign-in history → activity_log |
| persons | keep | persons | the person; folded-key CHECKs tightened; `role` moves to person_roles |
| recovery_codes | keep | recovery_codes | many per person, each used once |
| sessions | rename to | till_sessions | kept as attendance evidence; FK to persons added; any pruning is A980's (README U10) |
| totp_enrollments | merge into | sign_in_challenges | a 10-minute ceremony, ≤1 per person (`profile.ts:169`) |
| webauthn_challenges | merge into | sign_in_challenges | a 5-minute ceremony that today is never swept (`passkey.ts:95` only) |
| webauthn_credentials | keep | webauthn_credentials | a registered passkey |
| absences | keep | absences | requests with their decision on the row |
| attendance_day_work | rename to | attendance_days | one row per business day; JSON id list dropped; evidence hash added |
| attendance_mail | merge into | outgoing_mail | one queue for every email (README U4); the rules that must survive are in §1 |
| attendance_operation_facts | rename to | staff_activity | only activity with no other actor-stamped row; copies of sessions, payments, refunds, draft/group events go; `outcome` goes |
| attendance_questions | keep | attendance_questions | gains a day FK; loses copied bounds and location |
| attendance_response_commands | rename to | attendance_answers | becomes append-only; `entry_ids` stays a list |
| attendance_source_state | delete | null | a per-row change detector; replaced by per-day dirty marks and an evidence hash (§8) |
| availability | keep | availability | built and sound; A587 builds on it (amended R5) |
| employments | keep | employments | built and sound; the rota and overtime read it; A586 builds on it (amended R5) |
| pay_period_closures | keep | pay_period_closures | built and sound; A793 slice 6 waits for it (amended R5) |
| pay_period_settings | keep | pay_period_settings | built and sound; reader falls back to monthly (amended R5) |
| roster_versions | keep | roster_versions | loses location |
| shift_swaps | keep | shift_swaps | as today |
| shift_templates | keep | shift_templates | built and sound; planned scheduling work (amended R5); loses location |
| shifts | keep | shifts | absorbs shift_assignments; version made not null |
| time_entries | keep | time_entries | the legal record, unchanged |
| workforce_chains | delete | null | a copy of the newest time entry, readable through the unique chain index (R6) |
| convenio_config | keep until A586 | convenio_config | one row per venue today; A586 replaces it with rule sets per person; loses location |
| person_staff_roles | merge into | person_roles | one list of roles (owner, 2026-11-04) |
| shift_assignments | merge into | shifts | one-to-one with shifts |
| staff_roles | merge into | roles | one list of roles; colour and position kept, on-rota flag and `retired_at` added, location lost |
| staffing_blocks | keep | staffing_blocks | grows, a list people edit |
| staffing_days | keep | staffing_days | has identity, blocks point at it |

## 5. Protections

Append-only triggers come from `appendOnly()` in each module's classification
(`packages/workforce/src/classification.ts:12-13`) and are listed in
`scripts/append-only-triggers.test.ts:62, :77`. None of this area's tables has a behavioural trigger
(no hit for any of them in `scripts/behavioural-triggers.test.ts`, and no `create trigger` in any
of the four sets' `drizzle/*.sql`; both re-checked on main e0da0ad18a).

Identity's backup check also reads these tables by name (`packages/identity/src/backup-verification.ts:173-235`).
It decrypts `persons.totp_secret` and `totp_enrollments.encrypted_secret`; checks the token and code
hashes of `sessions`, `management_sessions`, `recovery_codes` and `management_account_actions`;
checks the shape of `webauthn_challenges` and `google_oidc_states` rows (encodings, lengths, and
whether `person_id` is set for the purpose or mode); and marks any row whose `person_id` names no
person. The merge into `sign_in_challenges` and the renames move each case to the new table name:
the decrypt and the two shape checks apply to `sign_in_challenges` by kind. The decrypt changes too:
it takes its key from `WAITRON_ACCOUNT_KEY` or a fallback made from the vault key today (`:68-90`)
and accepts only version 1 (`:108`); it takes the purpose key from the vault key ring instead, at
the value's stamped version. Staffing's check of `staff_roles` rows
(`packages/staffing/src/backup-verification.ts:96-103`) moves to identity's, on `roles`. `packages/workforce/src/backup-verification.ts`
does not name `attendance_mail`, so its move changes no backup check.

| current table | protection | home |
| --- | --- | --- |
| google_oidc_states | CHECK mode in login/link | `sign_in_challenges` kind CHECK |
| | CHECK state_hash length 64 | `sign_in_challenges` CHECK on state_hash |
| management_account_actions | UNIQUE token_hash; index (person_id, purpose); CHECKs purpose, token/code hash length, attempts ≥ 0, expiry > created; FK person restrict | `account_actions`, unchanged |
| | CHECK target_email set exactly for email_change | dropped with the column; the redeem path requires `persons.pending_email` (it already matches on it, `account-action.ts:235`) |
| management_sessions | UNIQUE token_hash; CHECK length 64; index (person_id) | `dashboard_sessions`; FK person added |
| persons | four UNIQUE partial indexes (email, live display name, google subject, pending email) | kept, reading the folded column directly |
| | CHECKs non-empty name/contact/secrets, status | kept |
| | CHECK role | gone with the column; a role's presets are CHECKed on `roles` |
| recovery_codes | index person; CHECK hash 64; FK restrict | kept |
| sessions | UNIQUE token_hash; CHECK 64; index device; FK device restrict | `till_sessions`; FK person added; index opened_at added |
| totp_enrollments | index person; CHECK secret non-empty | `sign_in_challenges` shape CHECK; partial UNIQUE one per person |
| webauthn_challenges | CHECK purpose | `sign_in_challenges` kind CHECK |
| webauthn_credentials | UNIQUE credential_id; index person; FK restrict | kept |
| absences | index (person, starts_on); CHECKs range, kind, status; FKs restrict | kept |
| attendance_day_work | UNIQUE (location, business_day) | `attendance_days` UNIQUE (business_day) |
| | index (location, next_due_at) | index (next_due_at) |
| | CHECKs bounds, revisions | kept |
| | FK location | dropped (R10) |
| attendance_mail | UNIQUE question_id | `outgoing_mail_key_uq`, on `attendance:<question>` (§1) |
| | index (status, next_attempt_at, id) | `outgoing_mail_due_idx` |
| | CHECKs status, claim pair, sending shape | the same CHECKs on `outgoing_mail` |
| | CHECK outcome | gone with the column: `status` holds the outcome |
| | FK question restrict | dropped: core cannot key into a switchable set, so the queue row holds the question's id as a plain value. Nothing deletes a question today (a grep of non-test code for `delete(attendanceQuestions)` finds no hit) |
| attendance_operation_facts | UNIQUE (source, key) | `staff_activity`, kept |
| | indexes day / person | kept, without location |
| | index pending | dropped with `outcome` |
| | CHECK source | narrowed to order/whole-payment |
| | CHECK kind | narrowed to order/payment |
| | CHECK outcome | dropped with the column |
| | CHECK offset | kept |
| | FK person restrict | kept; FK location dropped (R10) |
| attendance_questions | UNIQUE (person, location, shift_key) | UNIQUE (person_id, shift_key) |
| | UNIQUE (id, person, location) | UNIQUE (id, person_id) |
| | index own | kept without location |
| | CHECKs kind, bounds, activity, canonical, automatic | kept; bounds CHECK moves to `attendance_days` (where the bounds now live) |
| | FKs to time_entries (id, person) ×3, to itself, to persons | kept, location dropped from the composite |
| attendance_response_commands | index (person, question); CHECK action; FKs persons ×3, question composite | `attendance_answers`, kept |
| | CHECK entry_ids non-empty JSON array | `attendance_answers`, kept |
| | (none) | **new** append-only triggers |
| attendance_source_state | UNIQUE scope, watch index, CHECKs source/kind/shape, FK location | dropped with the table |
| availability | index; CHECKs weekday, minutes, window, effective; FK | kept |
| employments | index; CHECKs minutes, dates; FK | kept |
| pay_period_closures | append-only triggers; UNIQUE chain position, UNIQUE period; CHECKs period, sequence, predecessor, hash; FK node | kept |
| pay_period_settings | CHECKs singleton, frequency, anchor | kept |
| roster_versions | partial UNIQUE published period | kept without location |
| | CHECKs period, publish shape, status; FK published_by | kept |
| shift_swaps | indexes ×3; CHECK status; FKs persons ×3, from_shift cascade, to_shift set null | kept |
| shift_templates | index; CHECKs label, weekday, minutes | kept, index without location |
| | FK location | dropped (R10) |
| shifts | indexes (person, starts_at), (roster_version); CHECKs offsets, interval; FK person restrict | kept |
| | FK roster_version set null | becomes not null + cascade (a draft's shifts go with it; `removeShift` already deletes only a shift on a draft version or on none, `clocking.ts:444-464`) |
| | FK location | dropped (R10) |
| time_entries | append-only triggers | kept |
| | UNIQUE (id, person); UNIQUE chain position (node, sequence); indexes person/event, person/chain, corrects | kept |
| | CHECKs author kind, direction, missing kind, author, offset, correction shape, entry hash, sequence, chaining, whole-second times, entry kind, captured-by source/device, correction status | kept |
| | FKs persons ×3, device, node, corrects, responds (both forms), pay_period_closure | kept |
| workforce_chains | CHECK pointer all-or-none; FKs node, last entry | dropped with the table; the chain's fork protection was always `time_entries_chain_position_uq` (`chain.ts:48-53`), which stays |
| | backup check that the head matches the newest entry (`packages/workforce/src/backup-verification.ts:161-185`) | dropped: nothing left to compare |
| convenio_config | UNIQUE location | a one-row check, until A586 removes the table |
| | CHECKs working days, overtime model | kept |
| | FK location | dropped (R10) |
| person_staff_roles | PK pair | `person_roles` PK |
| | FKs cascade | person FK kept; role FK becomes restrict (A1002 §4) |
| shift_assignments | CHECK one area | `shifts` CHECK (extended for "no staffing role") |
| | FKs shift cascade, department cascade, station cascade, role restrict | on `shifts` (shift FK becomes the row itself) |
| staff_roles | UNIQUE (location, name) | partial UNIQUE on `roles.name_folded` |
| | CHECKs name, colour | on `roles`; FK location dropped |
| staffing_blocks | index; CHECKs headcount, quarter-hour step; FKs cascade | kept |
| staffing_days | four partial UNIQUEs; CHECKs one area, one day, weekday; FKs cascade | kept |

## 6. Duplicates removed

1. **Activity evidence stored twice.** Sessions, bill payments, refunds, draft/group events and
   order amendments are copied into `attendance_operation_facts` with the source row's id and
   person; sessions and refunds also copy its time (citations in the short version). One home: the
   source row. The checker reads it directly: `till_sessions`, `order_amendments`, `bill_payments`,
   `time_entries` as today, `order_events` for draft and group events (README U3, indexed on person
   and time), `refunds` for both kinds of refund (its `requested_by`, `created_at` and `state`,
   `tables-ordersales.md` §1.11), and `payments` for card payments, through `requested_by`.
   `staff_activity` keeps only what has no other home. Reading the source row instead moves a bill
   payment's or draft event's time from the write's clock reading to the row's `created_at`, so
   measurement 3's tests cover a fact near a day's boundary. A card payment's time moves the same
   way: the copy took the start of the attempt (`attendance-integrated.ts:39`), and the row's
   `created_at` (`packages/payments/src/schema/payments.ts:83`) is when the row was written.
2. **Every source row's fingerprint** in `attendance_source_state` watch rows — a copy of
   person/time/outcome per row (`attendance-discovery.ts:261-268`). One home: the source rows;
   change is tracked per day.
3. **The chain head.** `workforce_chains` repeats the newest `time_entries` row's id, hash,
   sequence and `recorded_at` (`packages/workforce/src/schema/workforce-chains.ts:10-21`). One home:
   `time_entries`. The attendance scan's use of it (`attendance-discovery.ts:183-186`) goes with
   discovery; `record-reads.ts:100-110` enumerates chains from it and would read
   `select distinct node_id from time_entries where person_id = ?` instead. The backup check that
   the head matches the newest entry goes with the table (owner, 2026-11-04). Anyone able to drop
   the append-only triggers could also edit the head row in the same file, so I believe the check
   adds little against deliberate change; it would catch a backup that lost its newest entries but
   kept the head, which I have not seen a path to.
4. **A day's bounds on every question.** `attendance_questions.business_day/start_at/end_at` repeat
   the day row's and must match it (`attendance-questions.ts:123-129` throws "bounds changed").
   One home: `attendance_days`, through `attendance_day_id`.
5. **The address waiting for confirmation.** `persons.pending_email` (`profile.ts:326-327`) and
   `management_account_actions.target_email` (`account-action.ts:130`) hold the same address; the
   redeem already requires them equal (`account-action.ts:235`) and a new pending address deletes
   the old links (`profile.ts:335`). One home: `persons.pending_email`, which also carries the
   uniqueness index. The code hash, which mixes in `target_email` (`account-action.ts:208`), mixes
   in `pending_email` instead.
6. **Deferred shift ids** on the day row repeat what `next_due_at > end_at` says (§1).
7. **Kept on purpose:** `persons.*_folded` repeat the name and emails in accent-folded form. The
   fold is done in JavaScript (`packages/identity/src/fold.ts`), which SQLite cannot do, and the
   unique indexes need it — a concurrency guarantee, so it stays (R6). The tighter CHECKs make
   "folded is set whenever the source is" a database rule instead of the comment at
   `packages/identity/src/schema/persons.ts:32-34`.
8. **Two ways of sealing a secret.** `persons.totp_secret` and pending enrolments are sealed by
   `encryptTotpSecret` (`packages/identity/src/mfa.ts:19-62`). `venue_credentials` is sealed by
   `seal` and `open` (`packages/credentials/src/cipher.ts`). Both use AES-256-GCM. Only the second
   binds the purpose into the sealed value, so a value moved to another purpose will not open
   (`cipher.ts:24-29`). One home (owner, 2026-11-04): `seal` and `open`, with the purpose `totp`
   bound in, and a key per purpose. `identity` already depends on `@waitron/credentials`. The value
   stays one text column, holding the key version, nonce, tag and sealed bytes, as the first
   method's does.

   The key comes from the vault key ring, and `WAITRON_ACCOUNT_KEY` is removed completely. Today
   that variable's two uses are derived keys: `accountPurposeKey` makes `totp` and
   `account-action-code` from it (`apps/server/src/account-key.ts:24-26`, `boot.ts:1693-1695`,
   `:2155`). A primary with no value makes its account key from the vault key once
   (`account-key.ts:11-13`) and saves it, and a spare gets the same value in its join bundle
   (`mirror-bundle.ts:49`), which also carries the vault key ring, so nothing is left that the ring
   does not already reach.

   Two costs, reasoned, not tested (measurement 7). The vault key's rotation re-seals
   `venue_credentials` and `node_signing_key` rows only (`packages/credentials/src/store.ts:260-289`),
   so it must also re-seal every `persons.totp_secret`, and a pending enrolment must either be
   re-sealed or lapse. The 10-minute emailed code (`account-action.ts:31`) is a keyed hash that
   cannot be re-sealed, so a check during a rotation has to try the previous key too. `TotpKeyRing`
   already takes a previous entry (`mfa.ts:14-17`), though boot never fills it (`boot.ts:1693-1695`).
9. **Two lists of roles.** `persons.role` and `staff_roles` both answer "what is this person here
   as". One home: `roles` and `person_roles` (owner, 2026-11-04).

## 7. Depends on other areas

- **devices / box area:** `till_sessions.device_id → devices`, `time_entries.captured_by_device_id
  → devices`, `time_entries.node_id → nodes`. `device_profile_admission_persons` is deleted
  (`tables-devices.md`; owner, 2026-11-04), and a device profile's admission list holds role ids from
  `roles` as JSON, so deleting a role must also clear those lists (A1002 §6). The same goes for
  adjustment reasons' role lists (`tables-fiscal.md`).
- **core tables from other areas:** `shifts.department_id → departments`,
  `shifts.station_id → kitchen_stations`, `staffing_days → departments, kitchen_stations, seasons,
  special_day_dates`.
- **A1002:** every reader of `persons.role`, every role-list policy and the staffing screens' role
  routes change with `roles` and `person_roles`. Configuration transfer moves too: `staff_roles` and
  `person_staff_roles` leave staffing's list (`packages/staffing/src/configuration-transfer.ts:3-11`)
  for A1002's export of roles and memberships, under which imported people stay suspended. Staffing's
  personal data file reads role names from the new tables
  (`packages/staffing/src/personal-data.ts:13-18`). Live subscriptions naming the old tables move
  (`packages/staffing/src/dashboard/live-queries.ts`).
- **orders and sales area:** the checker reads `order_amendments` (actor_id, event_at),
  `order_events` (person, at), `bill_payments` (requested_by, created_at, received_at) and `refunds`
  (requested_by, created_at, state). It needs those columns kept and a time index on each.
  `order_events` has one by README U3. Neither of the other two existing tables has one on main:
  their indexes in `packages/db/drizzle/meta/0204_snapshot.json` are `order_amendments`
  (working_order_id) and (working_order_id, sequence_no), and `bill_payments` (working_order_id,
  submission_id). `refunds` is a new table, so its time index goes on in `tables-ordersales.md` §1.11.
- **payments area:** `payments.requested_by`, a person column set when a card payment starts
  (owner, 2026-11-04), lets the checker read a settled card payment directly and removes the last
  poller (`attendance-integrated.ts:19-152`). `tables-fiscal.md` draws it.
- **email:** `outgoing_mail` carries the reminder (§1). `jobs.md` draws the table and its sender.
- **venue clock (venue/box area):** business-day bounds come from the venue clock, which the reader
  takes from `readVenueClock` (`attendance-facts.ts:13`).
- **activity_log and settings:** used as defined centrally.

## 8. Measure before building

1. **The day-evidence read at a year's volume.** Seed one year (≈1M source rows) and time
   `readAttendanceFacts` for one day. Today it filters by `julianday(r.at)` over a union with no
   time index on any source (`attendance-facts.ts:43`), inside the attendance pass's write
   transaction (`attendance-loop.ts:24`), which holds the venue's write lock. Failing result: more
   than a few tens of milliseconds per day even with time indexes on each source and plain text
   comparison → keep `staff_activity` as the one evidence table for every kind (copies included) and
   index only it.
2. **The evidence-hash sweep.** On start (and after a restore), recompute the evidence hash for
   every day and re-evaluate days whose hash changed, which is what today's whole-history rescan
   covers. Time it at a year's volume, on tables nothing has pruned (README U10). Failing result:
   the sweep holds the write lock long enough to delay a sale → split the pass per day, limit it to
   recent days, or run it only after a restore.
3. **That write-path marking covers every change.** Before deleting discovery, list each change the
   watches catch — a bill payment received after the day was checked, a shift moved between days
   (needs both old and new day marked at the write, `attendance-source-changes.ts:38-40`, `:59-82` keep
   "previous days" in the watch row today), a correction to a time entry from an earlier day, a
   venue-clock change — and write a failing test for each against the new design. Failing result:
   a change with no write path to hook → that one source keeps a narrow watch.
4. **The derived chain head.** `EXPLAIN QUERY PLAN` on the head query must show
   `time_entries_chain_position_uq` and no table scan; time an append at 22,000 entries. Failing
   result: a scan → keep `workforce_chains`.
5. **Activity volume.** Count `staff_activity` rows per bill on a real service (the 6–10 per bill
   figure is from reading `working-order.ts:361-369`, not measured). Failing result: well over
   2,000 a day → collapse order edits to one row per person per order per minute before building.
6. **Email change without `target_email`.** A test: request address A, then B, then redeem A's
   link — must be refused. Failing result: it confirms B → keep the column.
7. **Sealing across a rotation.** Failing tests first: rotate the vault key with a person enrolled,
   then sign in with their authenticator; send an emailed code, rotate, then use the code inside its
   10 minutes. Failing result: either one stops working → the rotation is not finished.

## 9. Decisions for the owner

Every decision in this file is settled and stated above: a role a shift has used is retired, and the
rota keeps warning (§1, `roles`); A1002 lands first (the short version); `entry_ids` stays a list, so
`attendance_answer_entries` goes; `pay_period_settings` stays a table. A1002's own §11 question, what
happens to a person whose only role is deleted, is that design's to settle. No question is open in this
area.
