# A1308 pp3 — a dashboard sign-in row lives only while it can sign in, and an emailed proof stops copying the address: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** (1) Ending a dashboard session deletes its `dashboard_sessions` row, and the sign-in and
sign-out are written to `activity_log` as `dashboard.signed_in` and `dashboard.signed_out`; the
personal-data file reads them from there. The mirror viewer's one fixed session keeps using
`ended_at`. (2) `account_actions.target_email` goes: an email-change proof uses the person's
`pending_email`, which its code hash now mixes in (appendix §6 item 5, measurement 6).

**Architecture:** `startManagementSession` and `endManagementSession` take a required `method` and
`reason` and call slice 2's `recordActivity` in the same transaction. Every other writer that
stamped `ended_at` deletes instead and records one `dashboard.signed_out` per row it deletes. The
email change reads `persons.pending_email` at issue and at redemption.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Hono, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §3 R2 ("`activity_log` is for
people to read"), §5 U10 (ended dashboard sign-ins pruned, history in `activity_log`), U11
(`activity_log` scope); [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1
`dashboard_sessions` and `account_actions`, §3 (the two kinds), §5, §6 item 5, §8 measurement 6.
Slice 2's plan ([`2026-11-08-a1308-2-activity-log.md`](2026-11-08-a1308-2-activity-log.md)) fixes
`recordActivity`, `readActivityForPerson`, `ActivityKindData` and `ACTIVITY_KINDS`; its "What it
leaves out" gives `dashboard.signed_in`, `dashboard.signed_out` "and the download reading them" to
this area.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6: nothing fiscal). The `method` script (Task 1) also edits
test files and one fixture under `packages/fiscal-verifactu/test/`; no fiscal code changes.

**Cites** read at `a086eedfb7`; names are pp1's. Slice 3a-ii
([plan](2026-11-08-a1308-3a-ii-mail-queue.md)) adds `issueQueuedAccountAction`, which issues an
email change to the pending address read at send; slice 3a-iii
([plan](2026-11-08-a1308-3a-iii-account-mail.md)) makes the profile save queue the mail and rewrites
`profile.ts:337` and `:340-345`. This plan builds on both.

---

## What it builds

- Two kinds in `packages/db/src/activity-kinds.ts`, both `subject: "person"` (the person whose
  session it is):
  - `"dashboard.signed_in": { readonly method: "password" | "passkey" | "google" | "invitation" | "setup" }`
  - `"dashboard.signed_out": { readonly reason: "signed_out" | "operation_finished" | "password_changed" | "account_action_completed" | "access_removed" | "break_glass" }`
  - `person_id` (who did it): the person themself, except `access_removed` (the administrator whose
    request removed access) and `break_glass` (null: an operator at a terminal, no person).
- `startManagementSession(tx, { personId, method })` records `dashboard.signed_in`.
  `endManagementSession(tx, token, reason)` deletes the row and records `dashboard.signed_out`;
  it still returns whether a live row was ended.
- The bulk ends delete and record one entry per row: `account-action.ts:335-338`
  (`account_action_completed`), `profile.ts:391-399` (`password_changed`, every row but the current
  one), `staff.ts:166-176` `revokePersonAccess` (`access_removed`), `break-glass-command.ts:146`
  (`break_glass`).
- `resolveManagementSession` keeps its `ended_at is null` filter (only the mirror row can have
  `ended_at` set now) and its two refusals: a row past the idle timeout answers
  `management_session.expired` until the tidy-up job deletes it; a cookie whose row is gone answers
  `management_session.required` (README U10 says so; today an ended row answers the same).
- Until the daily tidy-up job exists ([jr7](2026-11-08-a1308-jr7-housekeeping.md)), rows left idle
  past the timeout accumulate at today's rate (2–10 sign-ins a day, appendix §1) and answer
  `management_session.expired`, as they do today.
- The personal-data file: `dashboardSessions` (`personal-data.ts:88-96`, rows with `openedAt`,
  `lastSeenAt`, `endedAt`) becomes `dashboardSignIns`: the person's two kinds, oldest first, each
  `{ at, event: "signed_in" | "signed_out", method: string | null, reason: string | null }`, read
  with `readActivityForPerson(tx, personId, { kinds: ["dashboard.signed_in", "dashboard.signed_out"] })`
  and then **kept only where `subjectKind === "person"` and `subjectId === personId`**:
  `readActivityForPerson` also returns entries the person did to someone else (slice 2's plan:
  "Entries the person did (`person_id`) or that were done to them"), and an administrator's file
  must not list the sign-outs they forced on others. It loses `last_seen_at`, and a session that
  lapsed idle shows a sign-in with no sign-out (appendix §1, accepted). A sign-out an administrator
  recorded (`access_removed`) is in the signed-out person's file, because its subject is that person.
- `account_actions.target_email` and `account_actions_target_email_ck` dropped. Issuing an email
  change reads `persons.pending_email` (as 3a-ii already does); the code hash is
  `hashCode(codeKey, pendingEmail, "email_change", code)`; redemption reads the person's current
  `pending_email` for both the code check and the email swap (it already requires them equal,
  `account-action.ts:239`). The personal-data file's account-action rows lose `newEmail`
  (`personal-data.ts:108`); the pending address stays in the profile section (`:41`).

## What it leaves out

| Left out | Owner |
| --- | --- |
| Deleting idle dashboard sessions nobody signs out | the job runner's daily tidy-up (batch 3, `jobs.md` R16) |
| The mirror viewer's session (`mirror-session.ts:70-130`) | unchanged until A1113 retires the viewer (appendix §1) |
| Till sign-ins in `activity_log` | not logged: `till_sessions` is the record (appendix §3) |
| Other person audit kinds (`person.*`) | follow-ups outside A1308 (README U11) |
| Renaming `management_session.*` codes or `*ManagementSession` functions | not renamed (pp1 "leaves out") |
| How the account-action code key is derived | pp5 |

## Files

- Modify: `packages/db/src/activity-kinds.ts` (two kinds), `packages/identity/src/management-session.ts`,
  `packages/identity/src/manager-login.ts:151`, `packages/identity/src/passkey.ts:332`,
  `packages/identity/src/google-oidc.ts:152`, `packages/identity/src/account-action.ts`
  (`:335-341`, the email-change issue and redemption around `:104`, `:134`, `:192-245`, `:415`),
  `packages/identity/src/profile.ts:340-345`, `:391-399`, `packages/identity/src/staff.ts:166-176`
  (and `revokePersonAccess`'s callers, which pass the actor), `packages/identity/src/personal-data.ts:85-110`,
  `packages/provisioning/src/venue-apply.ts:562`, `apps/server/src/break-glass-command.ts:146`,
  `apps/server/src/management-api.ts:1052`, `:1103`, `apps/server/src/promote-api.ts:204`,
  `apps/server/src/mirror-bundle-api.ts:179`, `apps/server/src/operation-authentication.ts:128`,
  `apps/server/src/carry-on.ts:285`, `packages/db/src/schema/identity/account-actions.ts`
  (drop the column and CHECK), `packages/fiscal-verifactu/test/certificate-diagnosis-parent-fixtures.ts:53`
  (adds `method: "password"`).
- Create: `scripts/a1308/pp3-sign-in-method.mjs`, `.test.mjs` (Task 1 step 3a).
- Tests: `packages/identity/src/management-session.test.ts`, `account-action.test.ts`,
  `profile.test.ts`, `staff-lifecycle.test.ts`, `personal-data.test.ts`;
  `apps/server/src/personal-data-export-api.test.ts`, `break-glass-command.test.ts`,
  `management-api.test.ts` (sign-out); `apps/server/src/handover-dormant-setup.test.ts:232`,
  `box-retire.route.test.ts:255-268`, `boot.attendance-responses.test.ts:181`, `:209`,
  `zone-clock-stop-interaction.test.ts:83` (they name `dashboard_sessions` after pp1; read each, and
  where a test snapshots the table after a sign-out, see Stop point 2).
- Docs: the personal-data guide or README if it lists `dashboardSessions`
  (`apps/server/src/personal-data-readme.ts`; grep `dashboardSessions`); `docs/developers/conventions-data.md`
  only if it says dashboard sessions are ended by stamping (grep `ended_at`).
- Generated (uncounted): core's starting migration, snapshot, epoch.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Kinds, start/end functions | 50 |
| Seven callers of start/end, four bulk ends | 90 |
| `method` script (`scripts/a1308/pp3-sign-in-method.mjs`) and its test | 110 |
| Personal-data file (both changes) | 40 |
| Account action: column, issue, redemption | 50 |
| Tests: sessions and activity (Task 1–2) | 180 |
| Tests: bulk ends | 90 |
| Tests: measurement 6, its control, and the email change | 100 |
| Personal-data and export test re-points, the administrator's-file case | 70 |
| **Total** | **≈ 780** |

Uncounted: the `method` script's output (220 `startManagementSession(` calls in 156 test files
and 9 helpers at `a086eedfb7`), and the generated migration files.

## Finish line

```bash
pnpm --filter @waitron/identity exec vitest run src/management-session.test.ts src/account-action.test.ts \
  src/account-action.concurrency.test.ts src/profile.test.ts src/staff-lifecycle.test.ts \
  src/personal-data.test.ts src/manager-login.test.ts src/passkey.test.ts src/google-oidc.test.ts
pnpm --filter @waitron/server exec vitest run src/management-api.test.ts src/me-api.test.ts \
  src/personal-data-export-api.test.ts src/break-glass-command.test.ts src/promote-api.test.ts \
  src/operation-authentication.test.ts src/mirror-session.test.ts src/handover-dormant-setup.test.ts \
  src/box-retire.route.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts
pnpm --filter @waitron/db exec vitest run src/activity-log.test.ts
pnpm exec vitest run scripts/a1308/pp3-sign-in-method.test.mjs
node scripts/a1308/pp3-sign-in-method.mjs --write && git diff --exit-code
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts \
  scripts/migration-upgrade.test.ts scripts/write-path-tables.test.ts scripts/personal-log-params.test.ts
git grep -nE 'targetEmail|target_email' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

## Expected protection-list difference

Under all six `database=venue` headers. `account_actions` and `dashboard_sessions` are not
change-feed sources (base list), so no trigger line.

| Table | Lines | Design reason |
| --- | --- | --- |
| `account_actions` | `missing table account_actions.columns[target_email]`; `missing table account_actions.checks[account_actions_target_email_ck]`; `changed table account_actions.columnOrder` | appendix §5: "CHECK target_email set exactly for email_change — dropped with the column; the redeem path requires `persons.pending_email`" |

`dashboard_sessions` keeps every column (`ended_at` stays for the mirror row): no line. Any other
line is a stop.

## Stop points (beyond rules §5)

1. **Measurement 6 fails** (Task 4): with the column gone, A's code confirms any address. The
   design's fallback: keep `target_email`. Stop; the watcher confirms before the builder keeps the
   column and drops Task 4. (Task 4 explains why only its mutant control can show the failure.)
2. A test that snapshots `dashboard_sessions` after a sign-out (for example
   `box-retire.route.test.ts:255-268`, which compares the table before and after) can only pass with
   a changed expected row set. Name each in the question; the change is intended (the row is
   deleted), but it is the watcher's to confirm under rules §5.3.
3. `revokePersonAccess` has a caller with no person behind the request (a background job): stop;
   do not record a guessed actor.
4. `scripts/personal-log-params.test.ts` or the logger's personal-data mask needs a new key: the
   kinds carry no name or email (slice 2's rule 1), so it must not.

## Needs

- pp1 (names), pp2 (personal-data file edits sit beside it).
- Slice 2 (`activity_log`, `recordActivity`, `readActivityForPerson`); slice 3a-ii
  (`issueQueuedAccountAction`); slice 3a-iii (the profile save queues the email change).
- In flight (rules §8): an A980 slice that changes the personal-data download
  (`packages/identity/src/personal-data.ts`) lands before this plan starts, or waits for it.

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- `activity_log` is for people to read: nothing in this plan reads it to decide anything; only the
  personal-data file reads it (README §3 R2).
- Every write in the caller's one transaction (CLAUDE.md §3).
- Every commit `git commit -s`.

## Review Focus

1. **A sign-out path left stamping `ended_at`.** After Task 3, `git grep -n "endedAt" -- packages/identity apps/server/src | grep -i "dashboardSessions"`
   finds only `mirror-session.ts` and `resolveManagementSession`'s filter.
2. **Who `person_id` names.** `access_removed` records the administrator, not the person signed
   out; a test pins it.
3. **The code hash.** A code issued for one pending address must fail after the pending address
   changes (Task 4's tests), and still pass when it has not.

---

### Task 1: The kinds, and starting a session

**Files:** `packages/db/src/activity-kinds.ts`, `packages/identity/src/management-session.ts`,
`manager-login.ts`, `passkey.ts`, `google-oidc.ts`, `account-action.ts:341`,
`packages/provisioning/src/venue-apply.ts:562`, the fiscal-verifactu test fixture.

**Interfaces:**

```ts
export type DashboardSignInMethod = "password" | "passkey" | "google" | "invitation" | "setup";
export function startManagementSession(
  tx: Transaction,
  input: { personId: string; method: DashboardSignInMethod },
): Promise<ManagementSession>;
```

- [ ] **Step 1: Write the failing test** in `management-session.test.ts`:
  `"records dashboard.signed_in with the method"` — start a session with `method: "passkey"`;
  `readActivityForPerson` returns one entry, kind `dashboard.signed_in`, subject the person,
  `personId` the person, `data` `{ method: "passkey" }`.
- [ ] **Step 2: Run, see it fail** (the kind does not exist: a type error is the failure).
- [ ] **Step 3: Implement.** Add the two kinds to `ActivityKindData` and `ACTIVITY_KINDS` (subject
  `"person"`), with a comment each saying what `person_id` names. Pass the method at each product
  caller: manager-login `password`, passkey `passkey`, Google `google`, invitation completion
  `invitation`, venue setup `setup`.
- [ ] **Step 3a: The test callers, by script.** `scripts/a1308/pp3-sign-in-method.mjs [--write]`
  (with a `.test.mjs`: adds the field to an object literal, leaves a call that already has `method`
  alone, idempotent, exits 1 naming a call whose argument is not an object literal): in every
  `*.test.ts`, `test/**` and `src/testing/**` file, a call `startManagementSession(tx, { … })` gains
  `method: "password"` in its object literal. Commit the script and its output on their own; list
  any hand edit in the pull request.
- [ ] **Step 4: Run** the identity and provisioning finish-line runs; expect pass.
- [ ] **Step 5: Commit** `git commit -s -m "Record each dashboard sign-in in the activity log"`.

### Task 2: Ending a session deletes it

**Files:** `management-session.ts`, `management-api.ts:1052`, `:1103`, `promote-api.ts:204`,
`mirror-bundle-api.ts:179`, `operation-authentication.ts:128`, `carry-on.ts:285`.

**Interfaces:**

```ts
export type DashboardSignOutReason = "signed_out" | "operation_finished" | "password_changed"
  | "account_action_completed" | "access_removed" | "break_glass";
/** Deletes the live row for this token and records dashboard.signed_out. True if one was ended. */
export function endManagementSession(tx: Transaction, token: string, reason: DashboardSignOutReason): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests** in `management-session.test.ts`:
  - `"deletes the row when the session ends and records dashboard.signed_out"`: after
    `endManagementSession(tx, token, "signed_out")` the row is gone and the log holds the entry with
    `{ reason: "signed_out" }`.
  - `"answers management_session.required for a cookie whose session has ended"` (keeps today's
    code; the row is gone rather than stamped).
  - `"keeps answering management_session.expired for an idle row until it is deleted"`.
  - `"records nothing when no live session matches the token"` (returns false, no entry).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** the delete-and-record, and pass the reason at each caller: the dashboard
  sign-out route (`management-api.ts:1052`) `signed_out`; the operation sign-ins that end their own
  session (`management-api.ts:1103`, `promote-api.ts:204`, `mirror-bundle-api.ts:179`,
  `operation-authentication.ts:128`, `carry-on.ts:285`) `operation_finished`. Before choosing for
  `management-api.ts:1103`, read the route: if it is not an operation sign-in, stop (rules §5.1).
- [ ] **Step 4: Run** the server finish-line run.
- [ ] **Step 5: Commit** `git commit -s -m "End a dashboard session by deleting its row"`.

### Task 3: The bulk ends, and the personal-data file

**Files:** `account-action.ts:335-338`, `profile.ts:391-399`, `staff.ts:166-176` and its callers,
`break-glass-command.ts:146`, `personal-data.ts:85-110`, their tests,
`apps/server/src/personal-data-export-api.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `staff-lifecycle.test.ts`: `"removing a person's access deletes their dashboard sessions and
    records who removed it"` — two live sessions; after the suspension both rows are gone and two
    `dashboard.signed_out` entries say `{ reason: "access_removed" }` with `personId` the
    administrator and subject the person.
  - `profile.test.ts`: `"changing the password signs out the other dashboard sessions only"` — the
    current row stays; the other is deleted with `password_changed`.
  - `account-action.test.ts`: `"completing a password reset deletes the person's dashboard
    sessions"` with `account_action_completed`.
  - `break-glass-command.test.ts`: `"break-glass deletes the admin's dashboard sessions and records
    break_glass with no person"`.
  - `personal-data.test.ts`: `"lists dashboard sign-ins and sign-outs from the activity log"` — sign
    in with a password, sign out; `dashboardSignIns` is two entries, oldest first, with method and
    reason; the old `dashboardSessions` key is gone.
  - `personal-data.test.ts`: `"an administrator's file leaves out the sign-out they forced on
    someone else"` — the administrator suspends a person who had signed in; the administrator's
    `dashboardSignIns` holds only their own entries; the suspended person's holds the
    `access_removed` sign-out.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Each bulk end selects the live rows it would have stamped (same
  `where`), deletes them, and records one entry per deleted row (await in turn, never
  `Promise.all`, CLAUDE.md §3). `revokePersonAccess(tx, personId, actorId)`: each caller passes the
  person id its own `authorizeManager` call returned (Stop point 3). Break-glass records with
  `personId: null`. The personal-data file reads the two kinds as above. Update the existing
  personal-data and export tests that asserted `dashboardSessions` rows: they now assert the
  equivalent `dashboardSignIns` entries (the same sign-in and sign-out moments the test made); this
  re-point is the intended shape change named in "What it builds".
- [ ] **Step 4: Run** the finish line's identity and server runs.
- [ ] **Step 5: Commit** `git commit -s -m "Delete ended dashboard sessions everywhere and list sign-ins from the log"`.

### Task 4: `target_email` goes (measurement 6)

**Files:** `packages/db/src/schema/identity/account-actions.ts`, `account-action.ts`, `profile.ts:340-345`,
`personal-data.ts:105-110`, `account-action.test.ts`, `profile.test.ts`.

**Why measurement 6 cannot fail as the appendix wrote it.** An email change is confirmed only by
its emailed code (`confirmEmailChangeByCode`, `account-action.ts:184-245`); there is no email-change
link to redeem. Asking for B stamps A's action used (`:107-116`), and the profile save invalidates
the person's links (`profile.ts:337-339`, as 3a-iii leaves it), so "A, then B, then A's code" is
refused whether or not `target_email` exists, and deleting the column in a scratch edit does not
compile. The case that tells the designs apart is a code checked against the wrong address, so the
measurement runs with a mutant as its control.

- [ ] **Step 1: Write measurement 6 as tests, first,** in `account-action.test.ts`:
  - `"refuses A's code after a newer address was asked for"` — save pending A and issue its code
    (3a-ii's `issueQueuedAccountAction`), save pending B and issue B's, confirm with A's code:
    refused with today's wrong-code answer, `persons.email` unchanged; B's code then confirms B.
  - `"refuses A's code when the pending address changed underneath it"` — issue A's code, set the
    person's `pending_email` to B directly in the test (no invalidation), confirm with A's code:
    refused, because the hash mixes in the pending address read at confirmation.
- [ ] **Step 2: The control.** After Step 3's implementation, make a scratch mutant that leaves
  `pending_email` out of the code hash (hash the key, purpose and code only) and run the second
  case: **it must then confirm B**. That is the failing result the tests guard against; if the
  second case still refuses under the mutant, the test does not prove the hash: fix it before going
  on. Restore the code; record both runs in the pull request.
- [ ] **Step 3: Implement.** Drop `targetEmail` and its CHECK from the schema; the email-change
  issue writes no address and hashes the code with the person's `pending_email`; the code check at
  redemption reads the person's current `pending_email` (an action whose person has no pending
  address is refused with the same code as an unknown link); the swap uses the pending address
  read in the same transaction, guarded as today by `eq(persons.pendingEmail, …)`. The personal-data
  file's account-action rows drop `newEmail`; update its test to the new row shape (named here as
  intended).
- [ ] **Step 4: Rebuild** core; run the identity finish-line run and Step 1's tests; expect pass.
- [ ] **Step 5: Commit** `git commit -s -m "Email-change proofs read the pending address instead of copying it"`.

### Task 5: Protection list, docs, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** Grep docs for the old behaviour: `git grep -n "ended_at\|dashboardSessions\|target_email" -- docs/developers apps/server/src/guide apps/server/src/personal-data-readme.ts`;
  correct each sentence that describes ending by stamping or the old file shape (CLAUDE.md §1).
- [ ] **Step 3:** Run the finish line; `/finish-branch`.
