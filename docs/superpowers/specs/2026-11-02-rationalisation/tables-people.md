> Appendix to [README.md](README.md), the rationalisation design of 2 November 2026: one researcher's proposal for this area, written to the shared rules. Where README.md §5 decides differently, README.md wins.

# People, sign-in, working time and rota — proposed tables

Area: identity (who can sign in and how), workforce (the legal working-time record, the attendance
checker, rotas, absences, swaps), workforce-es (Spanish collective-agreement rules) and staffing
(job positions and painted staffing needs). Read on `main` at `64eeabb036`. Everything here was
established by reading code and the latest drizzle snapshots
(`packages/identity/drizzle/meta/0010_snapshot.json`, `packages/workforce/drizzle/meta/0013_snapshot.json`,
`packages/workforce-es/drizzle/meta/0000_snapshot.json`, `packages/staffing/drizzle/meta/0003_snapshot.json`);
nothing was run or timed. Row counts are for the reference venue (one restaurant, 250 bills a day
× 4 lines, 360 days a year) and come from the area inventory unless I say otherwise.

(refreshed 2026-11-03 against main 68732329c1: every cite into a file that changed since
`64eeabb036` was re-read on main and re-pointed or narrowed. The four snapshots above are still each
set's latest and are unchanged (`git diff --quiet 64eeabb036 68732329c1 -- <snapshot>`), so the 32
tables and their columns are as before. A1301 S13 (#2397) took the location out of this area's
code: writers now fill `location_id` with `venueLocationId(tx)` (for example
`apps/server/src/attendance-capture.ts:104-110`, `packages/workforce/src/attendance-state.ts:42`,
`packages/workforce/src/clocking.ts:414-416`). The `location_id` columns and the keys that lead with
them stay until A1301's schema slices
(`docs/superpowers/plans/2026-11-01-a1301-remove-location.md:436-475`), so each "drop `location_id`"
below is work those slices do anyway; this design only says what replaces each location-led key.)

**Result: 32 current tables → 21 target tables** (one of them a new link table). No `location_id`
anywhere (R10).

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
  `apps/server/src/attendance-capture.ts:54-132`; rota writes, `apps/server/src/attendance-source-changes.ts:12-83`,
  called from `apps/server/src/workforce-api.ts:195-307`), and a stored hash of each day's evidence
  on `attendance_days` replaces the whole-history rescan as the safety net.
  (refreshed 2026-11-03 against main 68732329c1: new line numbers; the old text had the precedence
  backwards, saying copies were added only where no source row had the key.)
- **Every start rescans all history today.** When workforce is on and the box is the primary
  (`isSingletonPrimary`), boot calls `beginAttendanceDiscovery` (`apps/server/src/boot.ts:2346-2348`),
  which deletes the scan rows (`attendance-discovery.ts:199`) and restarts every source at cursor 0
  (`:206`) up to its current max rowid (`:179`); `nextAttendanceDay` evaluates no day until every
  scan is complete (`:505`), and a pass reads 100 rows (`apps/server/src/attendance-loop.ts:27`).
  From reading, not measured: after a year, the checker is blocked for as many passes as there are
  source rows ÷ 100 after each start. (refreshed 2026-11-03 against main 68732329c1: new line
  numbers.)
- **`attendance_operation_facts` is mostly a second copy.** The `session`, `bill-payment`,
  `refund` and `draft` (`event:`/`group:`) facts, and each order amendment under its own id, are
  written with the source row's own id and person (`apps/server/src/till-api.ts:1442-1450`,
  `apps/server/src/bill-payments.ts:1178-1187`, `apps/server/src/bill-refunds.ts:121-129`,
  `apps/server/src/tender-refunds.ts:134-142`, `apps/server/src/order-drafts.ts:1592-1600`,
  `apps/server/src/order-groups.ts:2558-2566`, `apps/server/src/working-order.ts:7272-7289`).
  Sessions and refunds also copy the row's own time. The others take the time from the write's own
  clock reading (`attendance.at`, or `reading.instant` for a bill payment, `bill-payments.ts:1150-1159`),
  while the source row's `created_at` is filled by `nowIso` at insert
  (`packages/db/src/schema/bill-payments.ts:57`, `order-drafts.ts:134`, `order-groups.ts:103`), so
  the copy's time can differ from the row's; by how much I have not measured. At `64eeabb036` the
  reader's comment gave the reason for copying: "Captured operations retain their location across
  later device and party changes". A1301 S13 (#2397) removed that comment and the reader's location
  filters, so the reason has gone; the copies are still written. What has no other home: order edits
  per revision (`${orderId}:${revision}:${action}`, `apps/server/src/working-order.ts:361-369`),
  kitchen service actions (`service:…`, `attendance-capture.ts:23-43`) and payments whose row names
  no person (`whole-payment`: card payments in flight, `apps/server/src/attendance-integrated.ts:19-60`,
  and a whole-order payment taken at the till, keyed by the order id,
  `apps/server/src/till-sale.ts:121-142`), because `payments` has no person column (still true in
  `packages/payments/drizzle/meta/0010_snapshot.json` on main, after A764). That remainder becomes
  `staff_activity`. (refreshed 2026-11-03 against main 68732329c1: new line numbers; the
  order-amendment copy and the till's `whole-payment` writer were missing, though both were already
  there at `64eeabb036`; "and time" narrowed to sessions and refunds.)
- **No product writer** (R5, greps in the area inventory, re-checked where marked): `availability`,
  `shift_templates`, `employments`, `convenio_config`, `pay_period_closures`, `pay_period_settings`
  are deleted; their features (A586 contract terms, A587 availability, "who closes a pay period")
  bring their own design (`docs/backlog/workforce.md:154-175`, `:222-229`, `:329-334`).
  (refreshed 2026-11-03 against main 68732329c1: A587's lines moved; the rest of this bullet is
  new.) A grep of non-test code on main for `insert`/`update`/`delete` on each table's drizzle name finds only
  `closePayPeriod` (`packages/workforce/src/pay-period-close.ts`) and `setPayPeriodSettings`
  (`packages/workforce/src/pay-periods.ts`), and neither has a caller outside tests. Five of the six
  are also listed for configuration transfer (`packages/workforce/src/configuration-transfer.ts:1-9`,
  `packages/workforce-es/src/configuration-transfer.ts:1-4`, both lists already there at
  `64eeabb036`), so an import inserts whatever rows a bundle carries
  (`packages/provisioning/src/configuration-transfer.ts:747`). Nothing in the product writes those
  rows first, but deleting the tables also takes them out of these lists, and so out of the
  configuration bundle.
- **Short-lived sign-in rows** get one table and one sweep: `webauthn_challenges` (no sweep at all;
  `passkey.ts:95` deletes only on completion), `google_oidc_states` (swept, `google-oidc.ts:55-60`)
  and `totp_enrollments` (≤1 per person, `profile.ts:169`) become `sign_in_challenges`. Ended till
  and dashboard sessions are pruned.
- **`shift_assignments` is one-to-one with `shifts`** (its primary key is `shift_id`) → folds into
  `shifts`, which needs staffing to join workforce's migration set (decision D1).
- **`workforce_chains` is a copy of the newest `time_entries` row** → deleted; the head is read with
  the existing unique index. The legal record's protections (append-only triggers, hash chain,
  unique chain position) are untouched.

---

## 1. Target tables

Types use the house column vocabulary (`packages/db/src/schema/columns.ts`): `id` text, `ts` ISO
text, `day` `YYYY-MM-DD` text, `count`/`int` integer, `bool` integer 0/1, `json` text.

### Identity (migration set `identity`, mandatory module)

#### `persons` — keep (state)
Everyone who can sign in: till staff (PIN) and dashboard accounts. ≈30 rows, +5–15 a year
(leavers stay, suspended). Includes the read mirror's synthetic "mirror viewer" admin
(`apps/server/src/mirror-session.ts:33-60`) — **second box** row, not a table.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| display_name, display_name_folded | text | not null; folded not null (see §6) |
| first_names, last_names, telephone, locale | text | null |
| pin_hash, password_hash, totp_secret | text | null |
| email, email_folded | text | null, folded null exactly when email is |
| pending_email, pending_email_folded | text | null — the one home of an address waiting for confirmation (§6) |
| email_verified_at, passkey_offered_at | ts | null |
| google_subject | text | null |
| role | text | not null, CHECK staff/supervisor/manager/admin |
| status | text | not null, CHECK pending/active/suspended |
| created_at | ts | not null |

Protections: all current ones (§5). New: CHECK `(email is null) = (email_folded is null)` and the
same for display name and pending email, so the unique indexes can read the folded column directly
instead of `case when folded is null then lower(...)` (`packages/identity/src/schema/persons.ts:20`).

#### `till_sessions` — rename of `sessions` (state, mutable)
One PIN sign-in on one device. 50–200 a day; with the retention in D3, ≈4,500–18,000 live rows.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| person_id | id | not null, **new FK → persons** (restrict) |
| device_id | id | not null, FK → devices (restrict) |
| opened_at | ts | not null — also attendance evidence ("sign-in") |
| ended_at | ts | null |

Index `(device_id)` kept; **new** index `(opened_at)` for the checker's day read (§8). Pruning:
ended rows older than the attendance-evidence window (D3) are deleted by the attendance sweep.
Since A941 (#2409), a till action also refuses a request whose enrolled-device proof names a device
other than the session's `device_id` (`apps/server/src/till-session.ts:137-156`), so `device_id`
now matters for authorising actions as well as for reading the session. The table's shape did not
change. (refreshed 2026-11-03 against main 68732329c1: A941 added.)

#### `dashboard_sessions` — rename of `management_sessions` (state, mutable)
One dashboard sign-in. 2–10 a day; pruned, so tens of rows.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| person_id | id | not null, **new FK → persons** (restrict) |
| created_at, last_seen_at | ts | not null |
| ended_at | ts | null |

Pruned: a row is deleted when it ends, or once `last_seen_at` is older than the idle timeout
(`IDLE_TIMEOUT_MS`, 30 minutes, `packages/identity/src/management-session.ts:13`); the sign-in and
sign-out go to `activity_log` (§3). Today ended rows are kept forever and read only by the personal
data export (`packages/identity/src/personal-data.ts:87-93`). The mirror viewer's fixed session
(`mirror-session.ts:13-14`) is **second box**.

#### `sign_in_challenges` — merge of `webauthn_challenges`, `google_oidc_states`, `totp_enrollments` (state)
A sign-in or enrolment ceremony in flight, lifetime 5–10 minutes (`CHALLENGE_TTL_MS`
`passkey.ts:43`, `STATE_TTL_MS` `google-oidc.ts:15`, `TOTP_ENROLLMENT_TTL_MS` `profile.ts:159`).
0–20 rows: every insert first deletes expired rows (as Google already does, `google-oidc.ts:55-60`).

| column | type | key / null |
| --- | --- | --- |
| id | id | PK (the handle the browser sends back) |
| kind | text | not null, CHECK passkey_registration/passkey_login/passkey_check/google_login/google_link/totp_enrolment |
| person_id | id | null, **new FK → persons** (cascade) |
| challenge | text | null — passkey kinds only |
| state_hash | text | null, UNIQUE where not null, CHECK length 64 — Google kinds only |
| nonce, verifier | text | null — Google kinds only |
| encrypted_secret | text | null — totp_enrolment only |
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
| purpose | text | not null, CHECK invitation/password_reset/email_change |
| token_hash | text | not null, UNIQUE, CHECK length 64 |
| code_hash | text | null, CHECK length 64 |
| code_expires_at | ts | null |
| code_attempts | int | not null ≥ 0 |
| created_at, expires_at | ts | not null, CHECK expires_at > created_at |
| used_at | ts | null |

`target_email` is dropped: it repeats `persons.pending_email` (§6).

#### `recovery_codes` — keep (state)
Single-use two-factor backup codes, 10 per person who has two-factor. 20–50 rows. Columns as today
(`id`, `person_id` FK restrict, `code_hash` CHECK length 64, `created_at`, `used_at`).

#### `webauthn_credentials` — keep (state)
A registered passkey. 2–10 rows. Columns and protections as today (UNIQUE `credential_id`, FK
`person_id` restrict).

### Workforce (migration set `workforce`, toggleable module)

#### `time_entries` — keep (ledger, **append-only**) — the legal working-time record
Every clock-in, clock-out, break, correction and confirmation, hash-chained per node. 30–60 a day,
11,000–22,000 a year. Columns as today minus `pay_period_closure_id` (always null in the product,
because nothing closes a pay period — `docs/backlog/workforce.md:222-229`; D2). Every append-only
trigger, CHECK, unique index and foreign key stays (§5). `node_id → nodes` stays (one chain per
node, A1268, `docs/superpowers/specs/2026-11-01-a1268-clock-ins-per-venue-design.md:61-63`).

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
| staff_role_id | id | null, FK → staff_roles (restrict) — from `shift_assignments` |
| department_id | id | null, FK → departments (cascade) — from `shift_assignments` |
| station_id | id | null, FK → kitchen_stations (cascade) — from `shift_assignments` |
| created_at | ts | not null |

`roster_version_id` becomes not null because both product inserts pass a version: the copy into a
new draft (`packages/workforce/src/clocking.ts:326-329`) and `addShift`, whose `versionId` is a
required string (`clocking.ts:127-128`, `:413-419`). A null today comes only from deleting a
version (the FK's `set null`, `packages/workforce/src/schema/shifts.ts:42`; a grep of non-test code
finds no write of a null version); `packages/staffing/src/rota.ts:287-290` attaches such a shift to a
version before editing it. (refreshed 2026-11-03 against main 68732329c1: the old cites pointed at
error lines, not inserts.) New CHECK: `staff_role_id is null` exactly when `department_id` and
`station_id` are both null, otherwise exactly one area (`shift_assignments_one_area_ck` carried
over). If D1 is refused, `shift_assignments` stays as the R1 exception, for the module-toggle reason.

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
| start_at, end_at | ts | not null, CHECK end > start — saved bounds. A new mark with different bounds is refused (`attendance-state.ts:32-34`); `nextAttendanceDay` re-derives them only while the day is unevaluated and refuses a change after (`apps/server/src/attendance-discovery.ts:507-529`, `:548-550`) (refreshed 2026-11-03 against main 68732329c1: "fixed when the row is written" was too strong, at `64eeabb036` too) |
| dirty_revision, evaluated_revision | int | not null, CHECK as today |
| next_due_at | ts | not null |
| evidence_hash | text | null — hash of the evidence the last evaluation read (new, §8) |

`deferred_shift_ids` (a JSON list of shift ids, R4) is dropped: it is written once
(`packages/workforce/src/end-of-day.ts:412-419`) and read only for its length
(`attendance-loop.ts:48`, `attendance-discovery.ts:537`). The same evaluation sets `next_due_at`
to the earliest deferred shift's end (`end-of-day.ts:393`), or the day's end when none is deferred,
so "has deferred shifts" is `next_due_at > end_at`. Index `(next_due_at)`. (refreshed 2026-11-03
against main 68732329c1: new line numbers.)

#### `staff_activity` — rename of `attendance_operation_facts`, narrowed (state)
"This person did something on the till at this moment", for activity no other table records with
an actor and time: order edits per revision, kitchen service actions, card payments in flight
(until `payments` carries a person, D5). Estimate 1,000–2,000 a day (order edits dominate; the
inventory's 1,500–2,500 includes the copies that go); with D3's window, 90,000–180,000 live rows.

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
| outcome | text | not null, CHECK pending/qualifying/refused |

Indexes: `(business_day, person_id, at)`, `(person_id, at, sequence)`, `(outcome, sequence)`.

#### `attendance_questions` — keep, absorbs `attendance_mail` (state)
A question about someone's working day ("you were clocked out automatically — when did you
leave?") and its reminder email. 400–1,800 a year.

| column | type | key / null |
| --- | --- | --- |
| id | id | PK; UNIQUE (id, person_id) for the composite FKs |
| attendance_day_id | id | not null, FK → attendance_days (restrict) — replaces the copied `business_day`, `start_at`, `end_at` (§6) |
| person_id | id | not null, FK → persons (restrict) |
| shift_key | text | not null; UNIQUE (person_id, shift_key) |
| kind | text | CHECK automatic-out/missing-times |
| missing_kinds | json | not null (enum strings, not ids) |
| open_entry_id, automatic_entry_id, resolved_by_entry_id | id | null, FK (id, person_id) → time_entries |
| evidence_keys | json | not null — opaque matching tokens (D7) |
| active | bool | not null |
| canonical_question_id | id | null, FK (id, person_id) → attendance_questions |
| inactive_reason | text | null |
| created_at | ts | not null |
| mail_status | text | null, CHECK pending/sending/sent/rejected/unknown/cancelled — from `attendance_mail.status` |
| mail_claim_token, mail_claimed_at | text, ts | null — from `attendance_mail` |
| mail_next_attempt_at | ts | null |
| mail_recipient | text | null |
| mail_outcome | text | null, CHECK sent/rejected/unknown |

`attendance_mail` had one row per question (`attendance_mail_question_uq`) and the same lifetime,
so it folds in (R1). Its CHECKs move with it, guarded by `mail_status is not null`. Index
`(mail_status, mail_next_attempt_at, id) where mail_status is not null` for the email worker.

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
| input | json | not null |
| created_at | ts | not null |

`entry_ids` (JSON list of time-entry ids, R4) moves to the link table below; its "at least one"
CHECK becomes a write-path assertion plus a test.

#### `attendance_answer_entries` — new link table (ledger, **append-only**)
Which working-time entries an answer wrote. ≈1–2 per answer.
Columns: `answer_id` FK → attendance_answers, `entry_id` FK → time_entries; PK (answer_id, entry_id).

### Staffing (migration set `staffing` today; `workforce` if D1)

#### `staff_roles` — keep (state)
Job positions (waiter, cook…) with colour and order. 5–10 rows. Drop `location_id`; UNIQUE
becomes `(name)`. CHECKs as today.

#### `person_staff_roles` — keep (state, link)
Who can fill which position. 25–40 rows. Both FKs cascade, PK (person_id, staff_role_id). R7.

#### `staffing_days` — keep (state)
A painted staffing plan for one area on one weekday of a season, or one special date. 30–80 rows.
As today; its FKs point at departments, kitchen stations, seasons and special-day dates (§7).

#### `staffing_blocks` — keep (state)
One painted need ("two waiters 13:00–16:00") inside a staffing day. 100–300 rows. As today.

---

## 2. Settings documents

**None required by this design.** Every current table that held settings has no product writer and
goes under R5 (§4). If the owner keeps one of those features (D2), its document is:

- `settings.workforce` (from `pay_period_settings`): `payPeriod.frequency` text, one of
  monthly/weekly/fortnightly, default `"monthly"` (the reader's fallback today,
  `packages/workforce/src/pay-periods.ts`); `payPeriod.anchorDate` day or null, required exactly
  when fortnightly (`pay_period_settings_anchor_ck`).
- `settings.workforce-es` (from `convenio_config`, module-owned per R8): `workingDaysPerWeek` int
  1–7; `overtimeModel` daily_accrual/period_net; `referencePeriodDays`, `compensationWindowDays`,
  `dailyTargetMinutes` int or null; `maxWeeklyMinutes`, `minInterShiftRestMinutes`,
  `maxOrdinaryDailyMinutes`, `breakThresholdMinutes`, `minBreakMinutes`, `weeklyRestMinutes`,
  `annualOvertimeCapHours`, `nightWindowStartMinute`, `nightWindowEndMinute` int;
  `nightPremiumBasisPoints` int or null; `splitShiftPremiumCents` int or null;
  `breaksCountAsWorked` bool. No defaults are proposed here: the values are the asesor's to state.

## 3. History

**Typed history tables that remain** (product code reads them back):
- `time_entries` — read by `packages/workforce/src/record-reads.ts` and `hours-reads.ts` (till
  Hours, dashboard My hours), `apps/server/src/till-clock-state.ts`, the checker
  (`end-of-day.ts:144-146`) and `packages/workforce-es/src/record-export.ts` (registro de jornada,
  which since A1301 S14/S15b (#2404, #2408) takes no location and prints the venue's name). (refreshed
  2026-11-03 against main 68732329c1: new line number; export note added.)
- `attendance_answers` + `attendance_answer_entries` — read by `attendance-response-commands.ts`
  (replay), `attendance-reads.ts`, `attendance-question-responses.ts`.

**To `activity_log`** (audit only; all of these are new — no person-change audit exists today: a
grep for audit or role-change logging in `packages/identity/src/staff.ts` and `profile.ts` found
none):

| kind | subject | written by |
| --- | --- | --- |
| `person.created`, `person.updated` | person | `staff.ts`, `profile.ts`, provisioning import |
| `person.role_changed` (`data`: from, to) | person | `staff.ts` |
| `person.suspended`, `person.reactivated` | person | `staff.ts` |
| `person.pin_reset`, `person.password_changed` | person | `staff.ts`, `profile.ts`, `account-action.ts` |
| `person.email_changed` | person | `account-action.ts` (on confirmation) |
| `person.two_factor_enabled`, `person.two_factor_disabled`, `person.recovery_codes_replaced`, `person.recovery_code_used` | person | `profile.ts`, `mfa.ts`, `staff.ts`, `apps/server/src/break-glass-command.ts` |
| `person.passkey_added`, `person.passkey_removed` | webauthn_credential | `passkey.ts`, `profile.ts`, `staff.ts` |
| `person.google_linked`, `person.google_unlinked` | person | `google-oidc.ts`, `profile.ts` |
| `dashboard.signed_in` (`data`: method), `dashboard.signed_out` | person | `management-session.ts` |
| `staff_role.holders_changed` | staff_role | `packages/staffing/src/staff-roles.ts` (it replaces holders by delete-then-insert, so nothing else keeps who held a role) |
| `attendance.reminder_sent`, `attendance.reminder_failed` | attendance_question | `attendance-mail.ts` (the question keeps only the latest state) |

Not logged, because the row itself keeps the fixed fact (R2): rota publication
(`roster_versions.published_by_person_id`, `published_at`), absence and swap decisions
(`decided_by_person_id`, `decided_at`). Till sign-ins are not logged: `till_sessions` is the record
while it is evidence, and 50–200 a day is the most frequent identity event.

## 4. Mapping

| current | fate | target | why |
| --- | --- | --- | --- |
| google_oidc_states | merge into | sign_in_challenges | a sign-in ceremony in flight; same lifetime and sweep as the passkey and TOTP rows |
| management_account_actions | rename to | account_actions | emailed proofs keep their own lifetime and attempts; `target_email` dropped (§6) |
| management_sessions | rename to | dashboard_sessions | kept, but ended/idle rows deleted; sign-in history → activity_log |
| persons | keep | persons | the person; folded-key CHECKs tightened |
| recovery_codes | keep | recovery_codes | many per person, each used once |
| sessions | rename to | till_sessions | kept as attendance evidence; pruned after the evidence window; FK to persons added |
| totp_enrollments | merge into | sign_in_challenges | a 10-minute ceremony, ≤1 per person (`profile.ts:169`) |
| webauthn_challenges | merge into | sign_in_challenges | a 5-minute ceremony that today is never swept (`passkey.ts:95` only) |
| webauthn_credentials | keep | webauthn_credentials | a registered passkey |
| absences | keep | absences | requests with their decision on the row |
| attendance_day_work | rename to | attendance_days | one row per business day; JSON id list dropped; evidence hash added |
| attendance_mail | merge into | attendance_questions | one row per question, same lifetime (R1) |
| attendance_operation_facts | rename to | staff_activity | only activity with no other actor-stamped row; copies of sessions, payments, refunds, draft/group events go |
| attendance_questions | keep | attendance_questions | gains the mail columns and a day FK; loses copied bounds and location |
| attendance_response_commands | rename to | attendance_answers | becomes append-only; `entry_ids` → link table |
| attendance_source_state | delete | null | a per-row change detector; replaced by per-day dirty marks and an evidence hash (§8) |
| availability | delete | null | no product writer; A587 brings its design |
| employments | delete | null | no product writer; A586 brings per-person contract terms (D2) |
| pay_period_closures | delete | null | nothing in the product closes a pay period (D2) |
| pay_period_settings | delete | null | no product writer; reader always falls back to monthly (D2) |
| roster_versions | keep | roster_versions | loses location |
| shift_swaps | keep | shift_swaps | as today |
| shift_templates | delete | null | no product reader or writer |
| shifts | keep | shifts | absorbs shift_assignments (D1); version made not null |
| time_entries | keep | time_entries | the legal record; loses `pay_period_closure_id` (D2) |
| workforce_chains | delete | null | a copy of the newest time entry, readable through the unique chain index (R6, D6) |
| convenio_config | delete | null | no product writer; A586 moves rule sets per person (D2) |
| person_staff_roles | keep | person_staff_roles | link table, both FKs (R7) |
| shift_assignments | merge into | shifts | one-to-one with shifts (D1) |
| staff_roles | keep | staff_roles | loses location |
| staffing_blocks | keep | staffing_blocks | grows, a list people edit |
| staffing_days | keep | staffing_days | has identity, blocks point at it |

## 5. Protections

Append-only triggers come from `appendOnly()` in each module's classification
(`packages/workforce/src/classification.ts:12-13`) and are listed in
`scripts/append-only-triggers.test.ts:60, 75`. None of this area's tables has a behavioural trigger
(no hit for any of them in `scripts/behavioural-triggers.test.ts`, and no `create trigger` in any
of the four sets' `drizzle/*.sql`; both re-checked on main 68732329c1).

Identity's backup check also reads these tables by name (`packages/identity/src/backup-verification.ts:173-235`,
unchanged since `64eeabb036`; its test was hardened by A1314, #2429). It decrypts
`persons.totp_secret` and `totp_enrollments.encrypted_secret`; checks the token and code hashes of
`sessions`, `management_sessions`, `recovery_codes` and `management_account_actions`; checks the
shape of `webauthn_challenges` and `google_oidc_states` rows (encodings, lengths, and whether
`person_id` is set for the purpose or mode); and marks any row whose `person_id` names no person.
The merge into `sign_in_challenges` and the renames (D8) move each case to the new table name: the
TOTP decrypt and the two shape checks apply to `sign_in_challenges` by kind. (refreshed 2026-11-03 against main 68732329c1: this check was
missing from the old text.)

| current table | protection | home |
| --- | --- | --- |
| google_oidc_states | CHECK mode in login/link | `sign_in_challenges` kind CHECK |
| | CHECK state_hash length 64 | `sign_in_challenges` CHECK on state_hash |
| management_account_actions | UNIQUE token_hash; index (person_id, purpose); CHECKs purpose, token/code hash length, attempts ≥ 0, expiry > created; FK person restrict | `account_actions`, unchanged |
| | CHECK target_email set exactly for email_change | dropped with the column; the redeem path requires `persons.pending_email` (it already matches on it, `account-action.ts:235`) |
| management_sessions | UNIQUE token_hash; CHECK length 64; index (person_id) | `dashboard_sessions`; FK person added |
| persons | four UNIQUE partial indexes (email, live display name, google subject, pending email) | kept, reading the folded column directly |
| | CHECKs non-empty name/contact/secrets, role, status | kept |
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
| attendance_mail | UNIQUE question_id | implicit: the columns live on the question |
| | index (status, next_attempt_at, id) | partial index on `attendance_questions` |
| | CHECKs status, outcome, claim pair, sending shape | moved to `attendance_questions`, guarded by `mail_status is not null` |
| | FK question restrict | implicit |
| attendance_operation_facts | UNIQUE (source, key) | `staff_activity`, kept |
| | indexes day / pending / person | kept, without location |
| | CHECK source | narrowed to order/whole-payment |
| | CHECK kind | narrowed to order/payment |
| | CHECKs outcome, offset | kept |
| | FK person restrict | kept; FK location dropped (R10) |
| attendance_questions | UNIQUE (person, location, shift_key) | UNIQUE (person_id, shift_key) |
| | UNIQUE (id, person, location) | UNIQUE (id, person_id) |
| | index own | kept without location |
| | CHECKs kind, bounds, activity, canonical, automatic | kept; bounds CHECK moves to `attendance_days` (where the bounds now live) |
| | FKs to time_entries (id, person) ×3, to itself, to persons | kept, location dropped from the composite |
| attendance_response_commands | index (person, question); CHECK action; FKs persons ×3, question composite | `attendance_answers`, kept |
| | CHECK entry_ids non-empty JSON array | dropped with the column; the write path asserts ≥1 link row and a test pins it; the link table's two FKs are stronger than the JSON CHECK |
| | (none) | **new** append-only triggers |
| attendance_source_state | UNIQUE scope, watch index, CHECKs source/kind/shape, FK location | dropped with the table |
| availability | index; CHECKs weekday, minutes, window, effective; FK | dropped with the table (R5) |
| employments | index; CHECKs minutes, dates; FK | dropped with the table (R5) |
| pay_period_closures | append-only triggers; UNIQUE chain position, UNIQUE period; CHECKs period, sequence, predecessor, hash; FK node | dropped with the table (R5, D2) |
| pay_period_settings | CHECKs singleton, frequency, anchor | dropped; the anchor/frequency rule moves to the document's validation if D2 keeps it |
| roster_versions | partial UNIQUE published period | kept without location |
| | CHECKs period, publish shape, status; FK published_by | kept |
| shift_swaps | indexes ×3; CHECK status; FKs persons ×3, from_shift cascade, to_shift set null | kept |
| shift_templates | index; CHECKs label, weekday, minutes; FK | dropped with the table (R5) |
| shifts | indexes (person, starts_at), (roster_version); CHECKs offsets, interval; FK person restrict | kept |
| | FK roster_version set null | becomes not null + cascade (a draft's shifts go with it; `removeShift` already deletes only a shift on a draft version or on none, `clocking.ts:444-464`; refreshed 2026-11-03 against main 68732329c1: new cite) |
| | FK location | dropped (R10) |
| time_entries | append-only triggers | kept |
| | UNIQUE (id, person); UNIQUE chain position (node, sequence); indexes person/event, person/chain, corrects | kept |
| | CHECKs author kind, direction, missing kind, author, offset, correction shape, entry hash, sequence, chaining, whole-second times, entry kind, captured-by source/device, correction status | kept; `time_entries_correction_shape_ck` loses its `pay_period_closure_id` term with the column |
| | FKs persons ×3, device, node, corrects, responds (both forms) | kept |
| | FK pay_period_closure | dropped with the column (D2) |
| workforce_chains | CHECK pointer all-or-none; FKs node, last entry | dropped with the table; the chain's fork protection was always `time_entries_chain_position_uq` (`chain.ts:48-53`), which stays |
| | backup check that the head matches the newest entry (`packages/workforce/src/backup-verification.ts:161-185`) | dropped (D6): nothing left to compare |
| convenio_config | UNIQUE location; CHECKs working days, overtime model; FK location | dropped with the table (R5) |
| person_staff_roles | PK pair; FKs cascade | kept |
| shift_assignments | CHECK one area | `shifts` CHECK (extended for "no staffing role") |
| | FKs shift cascade, department cascade, station cascade, role restrict | on `shifts` (shift FK becomes the row itself) |
| staff_roles | UNIQUE (location, name) | UNIQUE (name) |
| | CHECKs name, colour | kept; FK location dropped |
| staffing_blocks | index; CHECKs headcount, quarter-hour step; FKs cascade | kept |
| staffing_days | four partial UNIQUEs; CHECKs one area, one day, weekday; FKs cascade | kept |

## 6. Duplicates removed

1. **Activity evidence stored twice.** Sessions, bill payments, refunds, draft/group events and
   order amendments are copied into `attendance_operation_facts` with the source row's id and
   person; sessions and refunds also copy its time (citations in the short version). One home: the
   source row. The checker reads it directly; it already does for all of them except refunds, which
   join the union from `bill_payment_refunds` and `tender_refunds` (both carry `requested_by`,
   `created_at` and `state` in main's latest drizzle snapshots). `staff_activity` keeps only
   what has no other home. Reading the source row instead moves a bill payment's or draft event's
   time from the write's clock reading to the row's `created_at`, so measurement 3's tests cover a
   fact near a day's boundary. (refreshed 2026-11-03 against main 68732329c1: amendments added; the
   time claim narrowed; the refund columns re-read.)
2. **Every source row's fingerprint** in `attendance_source_state` watch rows — a copy of
   person/time/outcome per row (`attendance-discovery.ts:261-268`; since A1301 S13 it no longer
   carries the location). One home: the source rows; change is tracked per day. (refreshed
   2026-11-03 against main 68732329c1: new lines, location gone.)
3. **The chain head.** `workforce_chains` repeats the newest `time_entries` row's id, hash,
   sequence and `recorded_at` (`packages/workforce/src/schema/workforce-chains.ts:10-21`). One home:
   `time_entries`. The attendance scan's use of it (`attendance-discovery.ts:183-186`, refreshed
   2026-11-03 against main 68732329c1) goes with
   discovery; `record-reads.ts:100-110` enumerates chains from it and would read
   `select distinct node_id from time_entries where person_id = ?` instead.
4. **A day's bounds on every question.** `attendance_questions.business_day/start_at/end_at` repeat
   the day row's and must match it (`attendance-questions.ts:123-129` throws "bounds changed";
   refreshed 2026-11-03 against main 68732329c1: new lines).
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

## 7. Depends on other areas

- **devices / box area:** `till_sessions.device_id → devices`, `time_entries.captured_by_device_id
  → devices`, `time_entries.node_id → nodes`. `device_profile_admission_persons` (identity set
  today) references `persons` and belongs to the devices area's inventory, not this one.
- **venue-service / floor-kitchen areas:** `shifts.department_id → departments`,
  `shifts.station_id → kitchen_stations`, `staffing_days → departments, kitchen_stations, seasons,
  special_day_dates`.
- **orders and sales area:** the checker reads `order_amendments` (actor_id, event_at),
  `order_draft_events` (actor_id, created_at), `order_group_events` (actor_id, created_at),
  `bill_payments` (requested_by, created_at, received_at), `bill_payment_refunds` and
  `tender_refunds` (requested_by, created_at, state). It needs those columns kept and a time index
  on each. None of the four order and bill tables has one on main: their indexes in
  `packages/db/drizzle/meta/0204_snapshot.json` (unchanged since `64eeabb036`) are
  `order_amendments` (working_order_id) and (working_order_id, sequence_no), `order_draft_events`
  (draft_id), `order_group_events` (party_id) and (group_id), and `bill_payments`
  (working_order_id, submission_id). (refreshed 2026-11-03 against main 68732329c1: the old list
  left out the two unique keys; neither is on a time column.)
- **payments area (D5):** a `requested_by` person column on `payments`, set when a card payment
  starts, would let the in-flight `whole-payment` rows be read directly and remove the last poller
  (`attendance-integrated.ts:19-152`; refreshed 2026-11-03 against main 68732329c1: new lines).
- **venue clock (venue/box area):** business-day bounds come from the venue clock, which the reader
  takes from `readVenueClock` on main (`attendance-facts.ts:13`, since A1301 S13). (refreshed
  2026-11-03 against main 68732329c1: was `readLocationClock`.)
- **activity_log and settings:** used as defined centrally.

## 8. Measure before building

1. **The day-evidence read at a year's volume.** Seed one year (≈1M source rows) and time
   `readAttendanceFacts` for one day. Today it filters by `julianday(r.at)` over a union with no
   time index on any source (`attendance-facts.ts:43`), inside the attendance pass's write
   transaction (`attendance-loop.ts:24`), which holds the venue's write lock (refreshed 2026-11-03 against main 68732329c1: new lines). Failing result: more
   than a few tens of milliseconds per day even with time indexes on each source and plain text
   comparison → keep `staff_activity` as the one evidence table for every kind (copies included) and
   index only it.
2. **The evidence-hash sweep.** On start (and after a restore), recompute the evidence hash for
   every day still inside the evidence window (D3, ≈90 days) and re-evaluate days whose hash
   changed. Time it at a year's volume. Failing result: the sweep holds the write lock long enough
   to delay a sale (the pass would have to be split per day, or run only after a restore).
3. **That write-path marking covers every change.** Before deleting discovery, list each change the
   watches catch — a bill payment received after the day was checked, a shift moved between days
   (needs both old and new day marked at the write, `attendance-source-changes.ts:38-40`, `:59-82` keep
   "previous days" in the watch row today; refreshed 2026-11-03 against main 68732329c1: new lines), a correction to a time entry from an earlier day, a
   venue-clock change — and write a failing test for each against the new design. Failing result:
   a change with no write path to hook → that one source keeps a narrow watch.
4. **The derived chain head.** `EXPLAIN QUERY PLAN` on the head query must show
   `time_entries_chain_position_uq` and no table scan; time an append at 22,000 entries. Failing
   result: a scan → keep `workforce_chains`.
5. **Activity volume.** Count `staff_activity` rows per bill on a real service (the 6–10 per bill
   figure is from reading `working-order.ts:361-369`, not measured; refreshed 2026-11-03 against main 68732329c1: new lines). Failing result: well over
   2,000 a day → collapse order edits to one row per person per order per minute before building.
6. **Email change without `target_email`.** A test: request address A, then B, then redeem A's
   link — must be refused. Failing result: it confirms B → keep the column.

## 9. Decisions for the owner

- **D1. Fold staffing into the workforce module.** `shift_assignments` is one-to-one with `shifts`,
  but staffing is a separate toggleable module that requires workforce
  (`packages/composition/src/modules.ts:388-391`, refreshed 2026-11-03 against main 68732329c1), so putting its columns on `shifts` with foreign
  keys to `staff_roles` would make workforce depend on staffing — a loop. Staffing has no meaning
  without rotas. **Recommend:** merge the `staffing` set into `workforce` (staff roles, painted
  staffing days and blocks become part of "rota"); `shifts` carries role and area. If refused,
  `shift_assignments` stays as the stated R1 exception.
- **D2. Delete the six tables with no product writer.** `employments` (overtime sums refuse without
  a row, so they never work in the product today), `convenio_config` (rota warnings treat a
  missing row as "no rules", `apps/server/src/workforce-api.ts:285-288`, refreshed 2026-11-03 against main 68732329c1), `pay_period_closures` and
  `pay_period_settings` (closing a period is called only from tests), `availability`,
  `shift_templates`. Deleting `pay_period_closures` also removes `time_entries.pay_period_closure_id`,
  which is one of the inputs to the entry hash (`packages/workforce/src/chain-hash.ts:91`) — a
  change to the legal record's hash format, harmless before go-live and impossible after it. Note:
  `docs/backlog/workforce.md:410` (refreshed 2026-11-03 against main 68732329c1) already says "a closed period keeps its frozen record", which no
  product path does. **Recommend:** delete all six now; A586 and the pay-period
  item bring their own tables or documents.
- **D3. How long attendance evidence is kept.** `staff_activity` rows and ended `till_sessions`
  are evidence for questions, not the legal record. **Recommend:** delete them 90 days after their
  business day, never while an active question's day is inside that range (the A664 retention
  inventory proposes 90 days for this class of processing state,
  `docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md:228-233`). Without a window,
  they grow by ≈400,000–800,000 rows a year.
- **D4. Dashboard sign-in history in `activity_log`, rows deleted.** **Recommend:** yes — the
  session row exists only while it can sign someone in; "who signed in when" is audit.
- **D5. A person on card payments.** **Recommend:** the payments area adds `requested_by` to
  `payments`, so the in-flight card-payment poller and its JSON snapshot go. Without it,
  `staff_activity` keeps the `whole-payment` rows and a small poller.
- **D6. Delete `workforce_chains`.** The backup check that the head matches the newest entry goes
  with it. Anyone able to drop the append-only triggers can also edit the head row in the same
  file, so I believe the check adds little against deliberate change; it would catch a backup that
  lost its newest entries but kept the head, which I have not seen a path to. **Recommend:** delete.
- **D7. Evidence keys stay as text tokens.** `attendance_questions.evidence_keys` is a JSON list of
  `source:id` strings — row ids, so R4 bites in letter. They are only compared as sets
  (`end-of-day.ts:186-271`, `attendance-questions.ts:101`; refreshed 2026-11-03 against main 68732329c1: new lines), never used to fetch a row, and they span
  several tables, so no foreign key could check them. A link table would need every kind of
  evidence in one table — the copy §6.1 removes. **Recommend:** keep them as matching tokens and say
  so at the column; choose the link table only if measurement 1 forces the single evidence table
  anyway.
- **D8. Renames.** `sessions` → `till_sessions`, `management_sessions` → `dashboard_sessions`,
  `management_account_actions` → `account_actions`, `attendance_day_work` → `attendance_days`,
  `attendance_operation_facts` → `staff_activity`, `attendance_response_commands` →
  `attendance_answers`. **Recommend:** do them in the same reset, since every one of these tables
  changes shape anyway.
