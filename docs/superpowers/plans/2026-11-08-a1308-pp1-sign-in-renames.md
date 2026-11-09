# A1308 pp1 — sign-in tables renamed, and keyed to the person: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `sessions` becomes `till_sessions`, `management_sessions` becomes `dashboard_sessions`
and `management_account_actions` becomes `account_actions` (design U9); the two session tables gain
a foreign key to `persons` (U11); `till_sessions` gains an index on `opened_at` for the attendance
checker's day read.

**Architecture:** one committed, idempotent rename script does every rename (rules §1). The hand
edits after it are the two keys, the index, the comments that said "no key", the two tests that
relied on there being no key, and the two cookie-shape screens the backlog calls dead.

**Changed by design (named here, not stops under rules §5.3):** the tests whose set-up the new keys
refuse (Task 3) — `packages/identity/src/authorize.test.ts:140-152`,
`packages/identity/src/management-session.test.ts:105-117`, `packages/identity/src/profile.test.ts:540-546`
(deletes a person holding a dashboard session) — and `packages/identity/src/index.test.ts:30-69`,
which asserts the session tables declare no key to `persons`.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the slice-1a rebuild command, the
root `typescript` package (version 6 API) for the script's parsing.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §5 U9 and U11;
[people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1 (`till_sessions`,
`dashboard_sessions`, `account_actions`), §4 and §5 (their rows). The README wins where they differ.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

**Who lands:** the lane. Nothing here changes `sales`, invoice numbering, the fiscal record, the
fiscal identity, AEAT sending or a value that feeds a fiscal hash (rules §6).

**Cites** were read at `a086eedfb7` (rules §5.1 says how a moved cite is treated).

---

## Where this plan sits

This is the first of twelve plans for the people and working time area, in build order:

| # | Plan | Tables |
| --- | --- | --- |
| pp1 | this one | `sessions` → `till_sessions`, `management_sessions` → `dashboard_sessions`, `management_account_actions` → `account_actions`; person keys |
| pp2 | [sign-in challenges](2026-11-08-a1308-pp2-sign-in-challenges.md) | `webauthn_challenges`, `google_oidc_states`, `totp_enrollments` → `sign_in_challenges`; `webauthn_credentials.name` dropped |
| pp3 | [dashboard sign-ins and account actions](2026-11-08-a1308-pp3-dashboard-sessions-and-account-actions.md) | `dashboard_sessions` rows deleted on sign-out, history in `activity_log`; `account_actions.target_email` dropped |
| pp4 | [person folded keys](2026-11-08-a1308-pp4-person-folded-keys.md) | `persons`: folded columns required, unique indexes read them, names lose "tenant" |
| pp5 | [one sealing method](2026-11-08-a1308-pp5-one-sealing-method.md) | no table; two-step secrets sealed by `@waitron/credentials`, `WAITRON_ACCOUNT_KEY` removed |
| pp6 | [chain head](2026-11-08-a1308-pp6-chain-head.md) | `workforce_chains` deleted |
| pp7 | [shifts and convenio](2026-11-08-a1308-pp7-shifts-and-convenio.md) | `shift_assignments` → `shifts`; `roster_version_id` required; `convenio_config` one row |
| pp8 | [attendance days, questions, answers](2026-11-08-a1308-pp8-attendance-days-questions-answers.md) | `attendance_day_work` → `attendance_days`; questions point at their day; `attendance_response_commands` → append-only `attendance_answers` |
| pp9 | [day marks at every write](2026-11-08-a1308-pp9-attendance-day-marks.md) | no table; every write that changes attendance evidence marks its day |
| pp10 | [staff activity](2026-11-08-a1308-pp10-staff-activity.md) | `attendance_operation_facts` → `staff_activity`; sign-ins, payments, refunds and amendments read where they live |
| pp11 | [card payments](2026-11-08-a1308-pp11-card-payments.md) | card payments read from `payments`; the in-flight poller deleted; `staff_activity` narrowed; `payments_created_at_idx` |
| pp12 | [re-check recent days](2026-11-08-a1308-pp12-recheck-recent-days.md) | `attendance_source_state` and the discovery scan deleted; recent days re-checked after a restore, migration or format change |

The build order estimated 5–7 pull requests. It is twelve because the attendance rewrite cannot be
one pull request under the size cap and is split by risk (pp8 reshapes; pp9 adds the marks with the
old safety net still running; pp10 and pp11 change what is read; pp12 removes the safety net), and
pp6 is kept apart because it changes the working-time record's append path (flagged in its pull
request, README U11).

pp1–pp8 need only batch 1 and A1002. pp9–pp12 also need os6 (`order_events`), os12 and os13
(`refunds`), pa3 (`payments.requested_by`; the build order moves pa3 ahead of pp9) and, for pp11 and
pp12, slice 0's year-of-trading bench. So the lane builds pp1–pp8, then other work, then pp9–pp12.

## Area files for the package move

The CI package move (agreed 2026-11-08, design not written; area order from the build order's "Order of areas", the owner accepted the proposed order on 2026-11-09) will move this
area's server code into its own package. These `apps/server/src` files belong to people and working
time, each with its `*.test.ts` siblings (`<name>.test.ts`, `<name>.*.test.ts`):

- Attendance: `attendance-*.ts` (`attendance-capture`, `attendance-discovery`,
  `attendance-email`, `attendance-email-worker`, `attendance-export-api`, `attendance-export-csv`,
  `attendance-export-pdf`, `attendance-export-request`, `attendance-facts`,
  `attendance-integrated`, `attendance-loop`, `attendance-request`, `attendance-source-changes`),
  `management-attendance-api.ts`, `till-attendance-api.ts`, `personal-data-time-record.ts`.
- Clock and rota: `till-clock-api.ts`, `till-clock-state.ts`, `hours-request.ts`,
  `workforce-api.ts`, `schedule-api.ts`.
- Sign-in and accounts: `account-email.ts`, `account-key.ts` (deleted by pp5),
  `account-rate-limit.ts`, `till-session.ts`, `pin-check-ahead.ts`, `me-api.ts`,
  `session-locale.ts`, `login-locale.ts`, `google-oidc.ts`, `break-glass.ts`,
  `break-glass-command.ts`, `bin-break-glass.ts`.
- Test helpers: `apps/server/src/testing/clock-venue.ts`, `signed-in-till.ts`;
  `apps/server/test/attendance-export-fixture.ts`.
- Not this area although they touch its tables: `management-api.ts` (shared by several areas'
  routes), `mirror-session.ts` (second box; since #2592, A1113, it holds only `endMirrorViewer`), `personal-data-export-api.ts`,
  `personal-data-actions.ts` (every area's data), `till-api.ts`, `till-sale.ts`, `working-order.ts`,
  `order-*.ts`, `bill-*.ts` (orders and sales).

**Where the move sits:** after pp12, as its own pull request. pp11 and pp12 delete about 850 lines
of the attendance code above (`attendance-discovery.ts` 620, `attendance-integrated.ts` 152,
`attendance-source-changes.ts` 83, at `a086eedfb7`) and about 1,900 lines of their tests; moving them
first would move code that is then deleted, and every later plan cites `apps/server/src/...:line`.
If the build order wants this area's move earlier, the sign-in, clock and rota files can move after pp8 and
the attendance files after pp12.

---

## What it builds

- `scripts/a1308/pp1-sign-in-renames.mjs` and its test: the three table renames and their
  identifiers, files and constraint names.
- `till_sessions.person_id` gains `till_sessions_person_fk` → `persons(id)`, on delete restrict.
- `dashboard_sessions.person_id` gains `dashboard_sessions_person_fk` → `persons(id)`, on delete
  restrict.
- `till_sessions_opened_at_idx` on `till_sessions(opened_at)`.
- The two cookie-shape screens the backlog names ("the UUID shape screens in `requireSession` and
  the till logout route") go: `isUuid(token)` in `requireSession` (`apps/server/src/till-session.ts:101`)
  and in the till sign-out route (`apps/server/src/till-api.ts:1512`). A value that is not a UUID
  hashes to no row, so the refusal and the sign-out's answer are unchanged (since #2534 the
  sign-out looks the token up with `openSessionPerson` and clears the cookie only when the request
  carries no `x-waitron-person` header, `till-api.ts:1514-1529` on `48d527dbc8`; a token that hashes to
  no row still ends nothing and answers ok). `signedInPersonOn` (`till-session.ts:116-127` on
  `48d527dbc8`, which throws nothing: it answers nobody, the person, or a refusal its caller throws)
  and the dashboard sign-out
  (`management-api.ts:1050`) keep their checks: the backlog does not name them.
- The backlog entry "Task 1b (#554, session cookies stored only as hashes)" loses the parts this
  plan finishes (the screens sentence, the two session keys); pp2 finishes and deletes the rest.

## What it leaves out

| Left out | Owner |
| --- | --- |
| Error codes `session.*`, `management_session.*`; function names such as `startManagementSession`; routes; cookie names | not renamed: U9 renames tables. A later rename is free before go-live (CLAUDE.md §3) but is not this plan's |
| Dashboard sessions deleted on sign-out, `activity_log` history | pp3 |
| `target_email` | pp3 |
| A key on `webauthn_challenges`, `google_oidc_states`, `totp_enrollments` | pp2 (their merged table gets it) |
| `account_actions.issued_by` | A1002 cut 2 (already landed; carried inside the renamed table) |
| Pruning ended till sessions | A980 (README U10) |
| `location_id` anywhere | slice 5 (assumed landed) |

## Files

- Create: `scripts/a1308/pp1-sign-in-renames.mjs`, `scripts/a1308/pp1-sign-in-renames.test.mjs`.
- Renamed by the script: `packages/db/src/schema/identity/sessions.ts` → `till-sessions.ts`,
  `management-sessions.ts` → `dashboard-sessions.ts`, `management-account-actions.ts` →
  `account-actions.ts` (and every import of them).
- Changed by the script (uncounted): every file in `apps`, `packages`, `scripts` that names the
  old identifiers or SQL names (Task 1 lists the rules), including
  `packages/db/src/classification.ts:390`, `:405`, `:410`; `packages/identity/src/classification.ts:6-15`;
  `packages/identity/src/backup-verification.ts:204-213`; `packages/identity/src/schema-ownership.test.ts`;
  `packages/composition/src/composition.test.ts:272-274`; `scripts/schema-constraints.test.ts:193`, `:298`;
  `apps/server/src/testing/clear-provision-fixture.ts:40`;
  `apps/server/scripts/demo-seed/testing/madrid-semantics.ts:238`, `:330`;
  `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es,manifest}.json`.
- Hand edits: `packages/db/src/schema/identity/till-sessions.ts`, `dashboard-sessions.ts` (keys,
  index, comments); `packages/identity/src/authorize.ts:46` and
  `packages/identity/src/management-session.ts:38-44` (comments); `apps/server/src/till-session.ts:101`;
  `apps/server/src/till-api.ts:1512`; `packages/identity/src/authorize.test.ts:140-152`;
  `packages/identity/src/management-session.test.ts:105-117`; `packages/identity/src/profile.test.ts:540-546`;
  `packages/identity/src/index.test.ts:30-69`; `scripts/schema-constraints.test.ts`
  (two key rows); `packages/identity/src/personal-data.ts:88` (one local renamed before the script,
  Task 1 step 1).
- Generated (uncounted): `packages/db/drizzle/0000_baseline.sql`, `packages/db/drizzle/meta/*`,
  `scripts/migration-baseline-epoch.json`.
- Docs: `docs/backlog/dashboard.md` ("Task 1b", lines 55-63, partly); the bundle line "Person-id columns … have no foreign
  key" stays (other areas' columns), and this plan's two columns are listed as done in the pull
  request description.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Rename script | 210 |
| Its test | 110 |
| Schema keys, index, comments | 30 |
| Cookie-shape screens and their tests | 30 |
| The four re-pointed key tests and the new key/index tests | 120 |
| Schema-constraints rows, backlog | 20 |
| **Total** | **≈ 520** |

Uncounted: the script's output (about 140 files: `git grep -l` over the four unambiguous names
finds 108 at `a086eedfb7`, plus the `sessions` users), and the generated migration files.

## Finish line

From the worktree root, each must pass and print a `Tests` count (CLAUDE.md §4):

```bash
pnpm exec vitest run scripts/a1308/pp1-sign-in-renames.test.mjs
pnpm --filter @waitron/identity exec vitest run src/authorize.test.ts src/management-session.test.ts \
  src/login.test.ts src/profile.test.ts src/staff-lifecycle.test.ts src/backup-verification.test.ts \
  src/schema-ownership.test.ts src/personal-data.test.ts src/index.test.ts
pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/me-api.test.ts \
  src/device-delete.db.test.ts src/attendance-facts.test.ts src/attendance-discovery.test.ts \
  src/management-api.test.ts src/break-glass-command.test.ts \
  src/till-session.person.test.ts src/till-api.session-person.test.ts
pnpm --filter @waitron/composition exec vitest run src/composition.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts \
  scripts/write-path-tables.test.ts scripts/live-subscriptions.test.ts
node scripts/a1308/pp1-sign-in-renames.mjs --write && git diff --exit-code
git grep -nE '\bmanagement_sessions\b|\bmanagement_account_actions\b|\bmanagementSessions\b|\bmanagementAccountActions\b' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

The second-to-last line proves the script is idempotent on its own output (rules §1); the last
proves no old name is left (exit 1 means no match).

## Expected protection-list difference

Every line appears under each of the six `DIFF composition=… phase=… database=venue` headers (two
compositions × `sql-only`, `migrated`, `change-feed`). None of the three tables is a change-feed
source (measured on the base list at `a086eedfb7`: no `waitron_change_sessions_*`,
`…management_sessions_*` or `…management_account_actions_*` trigger), so no trigger line.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `sessions` → `till_sessions` | `missing table sessions`; `extra table till_sessions`; `missing index sessions.primary key(id)`; `extra index till_sessions.primary key(id)`; `missing index sessions_open_idx`; `extra index till_sessions_open_idx`; `missing index sessions_token_hash_uq`; `extra index till_sessions_token_hash_uq`; `extra index till_sessions_opened_at_idx` | "UNIQUE token_hash; CHECK 64; index device; FK device restrict → `till_sessions`; FK person added; index opened_at added" |
| `management_sessions` → `dashboard_sessions` | `missing table management_sessions`; `extra table dashboard_sessions`; `missing index management_sessions.primary key(id)`; `extra index dashboard_sessions.primary key(id)`; `missing index management_sessions_open_idx`; `extra index dashboard_sessions_open_idx`; `missing index management_sessions_token_hash_uq`; `extra index dashboard_sessions_token_hash_uq` | "UNIQUE token_hash; CHECK length 64; index (person_id) → `dashboard_sessions`; FK person added" |
| `management_account_actions` → `account_actions` | `missing table management_account_actions`; `extra table account_actions`; `missing index management_account_actions.primary key(id)`; `extra index account_actions.primary key(id)`; `missing index management_account_actions_person_idx`; `extra index account_actions_person_idx`; `missing index management_account_actions_token_hash_uq`; `extra index account_actions_token_hash_uq` | "`account_actions`, unchanged" |

The builder checks by hand, in the new list's JSON, that `till_sessions` holds the same columns,
CHECK (`till_sessions_token_hash_ck`) and device key as `sessions` did, plus
`person_id->persons(id)` on delete restrict, and the same for the other two (a whole renamed table
prints as one line, so its contents are not compared by the tool). Any other line is a stop.

## Stop points (beyond rules §5)

1. The script's collision check (Task 1) names a file other than
   `packages/identity/src/personal-data.ts`.
2. A test other than the two named in Task 3 deletes a person who still holds a session and fails
   with a foreign-key refusal: it relied on there being no key. List it and ask; do not change its
   assertion.
3. A product path (not a test) deletes a `persons` row that can hold a session: the new keys change
   what it does (backlog "Task 1b": "Doing so would change what deleting a person does"). At
   `a086eedfb7` `git grep -n "delete(persons)\|delete from persons" -- apps packages ':!*.test.ts'`
   finds none, but the configuration import empties declared tables with a generic delete that
   reaches `persons` (`packages/provisioning/src/configuration-transfer.ts:712-716`, `where role <>
   'admin'` before A1002). Read what it deletes at the build head: if it can delete a person who holds
   a till or dashboard session without deleting the session first, the import is refused at commit
   once the keys exist; stop.

## Needs

- Batch 1, all of it: 1a's rebuild command; slice 5 (no `location_id` anywhere).
- A1002 cut 2 (design §10: "A1002 lands before the people slice"): it adds `issued_by` to
  `management_account_actions` and replaces `persons.role`; this plan renames the table after it.
- Inside this area: nothing (first plan).

## Assumptions about batch 1 and A1002

- **B1 (1a):** `pnpm --filter @waitron/server migration-baseline rebuild --set core` regenerates
  core's starting migration; generated-file conflicts on rebase are resolved by taking `main`'s copy
  and re-running it (rules §2.4).
- **B2 (Madrid baseline):** whatever batch 1 set for following a schema change in
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and its JSON fixtures is followed;
  the script renames the table keys inside those JSON files, which is the simplest form of that.
- **B3 (A1002):** the account-action table keeps its name until this plan; A1002 did not rename it.
  If A1002 already renamed any of the three tables, the script skips that name and the plan's
  prediction for it is dropped (record it in the pull request).

---

## Global Constraints

- Rules §1–§9 apply in full.
- Codex builds, Claude reviews (rules §7).
- Never edit `drizzle/*.sql`, `drizzle/meta/*` or the epoch file by hand (rules §2.3).
- Every commit `git commit -s`; plain English in commit messages and the pull request.

## Review Focus

1. **A `sessions` that is not the table.** The word is used for other things: the device-delete
   impact key (`apps/server/src/device-delete.ts:138`), the working-time export's sections
   (`packages/workforce-es/src/record-export.ts:171`, `:367`), a store test's own table
   (`packages/store/src/index.test.ts:23`). The script must leave them alone; the test pins it.
2. **The two tests that change** (Task 3) change because the state they built is now refused by the
   database, not because behaviour moved. The reviewer checks each now asserts the refusal.
3. **Deleted cookie-shape screens.** The refusal codes and statuses for a non-UUID cookie must be
   unchanged in the existing tests.

---

### Task 1: The rename script

**Files:** create `scripts/a1308/pp1-sign-in-renames.mjs`, `scripts/a1308/pp1-sign-in-renames.test.mjs`.

**Interfaces:**

- `node scripts/a1308/pp1-sign-in-renames.mjs [--write]`. Without `--write` it prints each file it
  would change and exits 0; with it, it writes. It reads the file list from `git ls-files apps
  packages scripts` minus `**/drizzle/**`.
- Before writing anything, a collision check: for each target identifier (`tillSessions`,
  `dashboardSessions`, `accountActions`) it exits 1 naming every file that already declares that
  name and would also be rewritten.

**Rules the script applies, in this order:**

1. **Unambiguous names, everywhere, as whole words:** `management_account_actions` →
   `account_actions`; `managementAccountActions` → `accountActions`; `management_sessions` →
   `dashboard_sessions`; `managementSessions` → `dashboardSessions`. Constraint and index names
   that begin with the table name follow (`management_sessions_open_idx` → `dashboard_sessions_open_idx`).
2. **File renames:** the three schema files above; import specifiers ending in
   `/management-sessions.js`, `/management-account-actions.js`, `/identity/sessions.js` follow.
3. **The drizzle identifier `sessions`:** only in files that import a binding named `sessions` from
   `@waitron/db`, `@waitron/identity` or a relative path ending `/identity/sessions.js` (and the
   schema file itself). Parse with the root `typescript` package (`ts.createSourceFile`), and rename
   every `Identifier` whose text is `sessions` except when it is the name of a property access
   (`x.sessions`), a property assignment key, a shorthand property in an object literal that is not
   the import, or a declaration of a different binding in an inner scope. Apply edits by position,
   from the end of the file. Also, in any file:
   - an export specifier named `sessions` in an `export { … } from` whose module path ends
     `/identity/sessions.js`, `/schema/identity/index.js`, `/schema/identity.js` or is `@waitron/db`
     (`packages/db/src/schema/identity/index.ts:9`, `packages/db/src/index.ts:389`,
     `packages/identity/src/index.ts:25`), and the same name inside a plain `export { … }` list of a
     file that imported it;
   - a property access `X.sessions` where `X` is a namespace import (`import * as X`) of
     `@waitron/db`, `@waitron/db/schema/identity.js`, `@waitron/identity` or `../src/index.js` inside
     those packages (`packages/identity/src/backup-verification.test.ts:106` `schema.sessions`,
     `packages/identity/src/index.test.ts:36` `api.sessions`).
4. **The SQL table name `sessions`:** inside template literals and string literals, replace
   `\b(from|join|into|update|exists|table)\s+"?sessions"?\b` keeping the keyword and quoting; a
   template literal whose whole text is `sessions` (the row source at
   `apps/server/src/attendance-discovery.ts:118`); and the exact
   string literal `"sessions"` only in this list of files:
   `packages/db/src/classification.ts`, `packages/identity/src/classification.ts`,
   `packages/identity/src/backup-verification.ts`, `packages/identity/src/backup-verification.test.ts`,
   `packages/identity/src/schema-ownership.test.ts`, `packages/composition/src/composition.test.ts`,
   `scripts/schema-constraints.test.ts`, `packages/db/src/schema/identity/sessions.ts`,
   `apps/server/src/attendance-discovery.test.ts` (`table: "sessions"` at `:394`), and the
   three `madrid-before-move.*.json` fixtures (as a JSON key or table-name value). Index and check
   names `sessions_open_idx`, `sessions_token_hash_uq`, `sessions_token_hash_ck` →
   `till_sessions_…`, as whole words.
5. **Never touched:** `packages/workforce-es/src/record-export*.ts`,
   `packages/workforce/src/record-schema.test.ts`, `packages/store/src/**`, `apps/dashboard/**`,
   `apps/server/src/device-delete*.ts`'s `key: "sessions"`, `apps/server/src/device-api.delete.test.ts`,
   `apps/server/src/attendance-export-*.test.ts`, `apps/server/test/attendance-export-fixture.ts`
   (their `"sessions"` are section and impact keys).

- [ ] **Step 1: Resolve the known collision by hand, in its own commit.** In
  `packages/identity/src/personal-data.ts:88` rename the local `dashboardSessions` to
  `dashboardSessionRows` (and its use at `:153`, keeping the output key `dashboardSessions`).
  Commit: `git commit -s -m "Rename a local that the sign-in table rename would shadow"`.
- [ ] **Step 2: Write the failing test** `scripts/a1308/pp1-sign-in-renames.test.mjs` over a
  temporary folder of small fixture files (never the real tree):
  - `"renames the three tables, their identifiers, files and constraint names"`: a schema file, a
    file importing `{ sessions, managementSessions }` from `@waitron/db` and selecting from both, a
    raw `sql` with `from sessions s join devices d`, and a classification list with `"sessions"`;
    after `--write` each reads the new names.
  - `"renames re-exports and namespace accesses"`: an index file with
    `export { sessions } from "./sessions.js"`, a test with `import * as schema from
    "@waitron/db/schema/identity.js"` using `schema.sessions`, and one with `api.sessions`.
  - `"leaves sessions alone where it is not the table"`: a record-export file with
    `section("sessions", …)`, a device-delete file with `counted("sessions", n)` and an object
    `{ sessions: 3 }` in an importing file; all unchanged.
  - `"is idempotent"`: a second `--write` changes no byte.
  - `"refuses a collision"`: a file importing `sessions` from `@waitron/db` and declaring
    `const tillSessions = 1` → exit 1 naming the file, nothing written.
- [ ] **Step 3: Run** `pnpm exec vitest run scripts/a1308/pp1-sign-in-renames.test.mjs`; expect
  failure (no script).
- [ ] **Step 4: Implement** the script.
- [ ] **Step 5: Run** the test; expect pass.
- [ ] **Step 6: Run the script on the tree** (`--write`), then `pnpm -r typecheck` for the packages
  it changed (the hook's scoped typecheck covers it on push; run identity, db, server, composition,
  workforce now). Fix nothing by hand except what Step 1 did; a type error from the script is a bug
  in the script.
- [ ] **Step 7: Commit** the script, its test and its output in one commit:
  `git commit -s -m "Rename the sign-in tables with a committed script (pp1)"`. The commit body
  says the output is the script's and lists Step 1's hand edit.

### Task 2: Keys and the day-read index

**Files:** `packages/db/src/schema/identity/till-sessions.ts`, `dashboard-sessions.ts`,
`scripts/schema-constraints.test.ts`; create `packages/db/src/schema/identity/sign-in-keys.test.ts`.

- [ ] **Step 1: Write the failing tests** in `sign-in-keys.test.ts` (`useVenueDb`):
  - `"refuses a till session for a person who does not exist"`: insert a `till_sessions` row with a
    random `person_id` → a `FOREIGN KEY constraint failed` refusal.
  - `"refuses deleting a person who holds a till session"` and the same for a dashboard session.
  - `"still opens a till session for a real person"` and `"still starts a dashboard session"`
    (the legitimate write, CLAUDE.md §4).
  - `"plans the day read on opened_at"`: `EXPLAIN QUERY PLAN select id from till_sessions where
    opened_at >= ? and opened_at < ?` names `till_sessions_opened_at_idx`.
  Add rows `["till_sessions", ["person_id"], "persons"]` and `["dashboard_sessions", ["person_id"],
  "persons"]` to `scripts/schema-constraints.test.ts`'s key list.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/identity/sign-in-keys.test.ts`
  and `pnpm exec vitest run scripts/schema-constraints.test.ts`; expect failure.
- [ ] **Step 3: Implement.** `personId: id("person_id").notNull()` plus a
  `foreignKey({ columns: [t.personId], foreignColumns: [persons.id], name: "till_sessions_person_fk" }).onDelete("restrict")`
  (the array form, as `recovery-codes.ts:16-21`), and
  `index("till_sessions_opened_at_idx").on(t.openedAt)`. The same key on `dashboard_sessions` named
  `dashboard_sessions_person_fk`. Delete the "No key to `persons`" comments
  (`till-sessions.ts:17-18`, `dashboard-sessions.ts:16-18`) and the stale halves of
  `packages/identity/src/authorize.ts:46` and `management-session.ts:41-43` ("the table declares no
  key to `persons`"); keep the inner join.
- [ ] **Step 4: Rebuild** `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 5: Run** Step 2's commands; expect pass.
- [ ] **Step 6: Commit** `git commit -s -m "Key both session tables to the person and index till sign-ins by time"`.

### Task 3: The two tests that relied on there being no key

**Files:** `packages/identity/src/authorize.test.ts:140-152`, `packages/identity/src/management-session.test.ts:105-117`.

Both build a session whose person row has been deleted, a state the database now refuses. This is
the intended change, named here, not a stop (rules §4): the behaviour they guarded ("a session
whose person is gone signs nobody in") is now guaranteed by the key.

- [ ] **Step 1:** Rewrite `"throws session.not_open when the session's person row has been
  deleted"` as `"refuses deleting the person behind an open till session"`: the same set-up, then
  the delete is refused with a foreign-key error, and `authorize` afterwards still answers for the
  person (the session is unchanged). Same for `"throws management_session.required when the
  session's person row has been deleted"` → `"refuses deleting the person behind a dashboard
  session"`.
  Likewise `profile.test.ts:540-546` `"refuses a live session whose person row no longer exists…"`
  → `"refuses deleting the person behind a live dashboard session"`, and in `index.test.ts:30-69`
  the "one foreign key, to its device" declaration case now expects two keys (device and person),
  and the dashboard-session declaration case its one key to `persons`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/identity exec vitest run src/authorize.test.ts src/management-session.test.ts src/profile.test.ts src/index.test.ts`; expect pass.
- [ ] **Step 3:** Run every test file Stop point 2 could catch:
  `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts src/me-api.test.ts src/boot.test.ts src/units-api.test.ts src/till-api.receipt.test.ts src/certificate-reminder-worker.test.ts src/handover-compare.test.ts`
  and `pnpm --filter @waitron/identity exec vitest run src/profile.test.ts src/staff.email.test.ts src/profile-admission.test.ts`
  (each deletes a person at `a086eedfb7`; most delete the session first). A foreign-key failure is
  Stop point 2.
- [ ] **Step 4: Commit** `git commit -s -m "Turn the person-gone session tests into refusal tests"`.

### Task 4: The cookie-shape screens

**Files:** `apps/server/src/till-session.ts:101`; `apps/server/src/till-api.ts:1512`.

- [ ] **Step 1: Find the tests that send a non-UUID cookie** to `requireSession` and to the till
  sign-out (`git grep -n "not-a-uuid\|isUuid" -- apps/server/src/*.test.ts`). If none exists for one
  of the two, write it now: `"refuses a till cookie that is not a UUID with session.required"`,
  `"signs a till out with a cookie that is not a UUID: clears the cookie and answers ok"` (sent with
  no `x-waitron-person` header: since #2534 a sign-out carrying the header never clears the cookie,
  `till-api.ts:1512-1513`). Run them;
  they pass on the current code (they pin the behaviour the deletion must keep).
- [ ] **Step 2:** Delete the two `isUuid(token)` conditions (keep `token === null`). Keep the import
  and re-export: `till-session.ts:71` and `promote-api.ts:22` still use it.
- [ ] **Step 3: Run** the Step 1 tests; expect pass, unchanged.
- [ ] **Step 4: Commit** `git commit -s -m "Drop the two cookie-shape screens that only saved a lookup"`.

### Task 5: Protection list, backlog, finish

- [ ] **Step 1:** Run the protection list before (on the base, in a throwaway worktree, rules §3)
  and after; paste the report into the pull request, marked line by line against the table above.
- [ ] **Step 2:** In `docs/backlog/dashboard.md` "## Task 1b (#554, session cookies stored only as
  hashes)", delete the first two sentences (the `requireSession` and till logout screens, finished by
  Task 4) and the two session tables from
  the list of keys, leaving only `totp_enrollments` and `google_oidc_states`; pp2 deletes what is
  left, with its line in `docs/backlog/architecture.md` "What A1308 retires".
- [ ] **Step 3:** Run the finish line. Commit, then `/finish-branch`.
