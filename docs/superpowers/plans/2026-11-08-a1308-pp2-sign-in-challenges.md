# A1308 pp2 — one table for sign-in ceremonies in flight, and the passkey name column goes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** the three tables that hold a sign-in or enrolment ceremony for a few minutes
(`webauthn_challenges`, `google_oidc_states`, `totp_enrollments`) become one, `sign_in_challenges`,
with a key to `persons`, a CHECK per kind and "one pending authenticator setup per person" held by
the database. Every insert first deletes expired rows. The passkey `name` column goes (README,
"Additions of 6 November 2026").

**Architecture:** one new schema file in core; the passkey, Google and two-step code keep their
ceremonies and only change where they read and write; identity's backup check, personal-data file
and the staff and break-glass clean-ups read the new table by `kind`. A ceremony's "a few minutes"
is its `expires_at`; the sweep is one statement inside the insert helper.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, Lit (one dashboard label).

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U10 (expired challenges
pruned) and U11 (person keys), "Additions of 6 November 2026" (`webauthn_credentials` row);
[people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1 `sign_in_challenges`, §4
and §5 (rows for the three tables and `webauthn_credentials`, and the backup-check paragraph). The
README wins where they differ.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6: nothing fiscal).

**Cites** read at `a086eedfb7`, before pp1's rename script; names below are pp1's (`till_sessions`,
`dashboardSessions`).

**Changed by design (named here, not stops under rules §5.3):**
- An expired passkey registration or check challenge can now be swept by any other person's insert
  before its owner submits it. Its owner then gets the refusal for an unknown challenge
  (`passkey.verification_failed`, from `consumeChallenge` finding no row) instead of today's
  expiry refusal (the age check at `passkey.ts:113`). Expired login challenges are already swept
  today (`passkey.ts:250-257`), so their answer does not change. Tests asserting the expiry code
  after another insert are re-pointed to the unknown-challenge code; a test with no other insert
  keeps the expiry code.
- The personal-data file's `sign-in.json` passkeys lose `name` (`personal-data.ts:146`); `provider`
  stays, and is the value A403 wrote into `name` (`passkey.ts:227`).
- `packages/identity/src/index.test.ts:92-101` asserts `webauthn_challenges`' declarations; it is
  replaced by the `sign_in_challenges` declaration case (Task 1).

---

## What it builds

- `packages/db/src/schema/identity/sign-in-challenges.ts`: table `sign_in_challenges` (state, core):

| column | type (house vocabulary) | rule |
| --- | --- | --- |
| `id` | `id`, primary key | the handle the browser sends back |
| `kind` | `enumType(["passkey_registration","passkey_login","passkey_check","google_login","google_link","totp_enrolment"])` | not null; `sign_in_challenges_kind_ck` |
| `person_id` | `id` | null; `sign_in_challenges_person_fk` → `persons(id)` on delete cascade |
| `challenge` | `label` | passkey kinds only |
| `state_hash` | `label` | Google kinds only; `sign_in_challenges_state_hash_ck` length 64 |
| `nonce`, `verifier` | `label` | Google kinds only |
| `encrypted_secret` | `label` | `totp_enrolment` only; sealed as `persons.totp_secret` is |
| `created_at` | `tsString` | not null; set by `insertSignInChallenge` from the same `now` as `expires_at`, so a test's fixed clock (`google-oidc.test.ts:131`) controls both |
| `expires_at` | `tsString` | not null; `sign_in_challenges_expiry_ck`: `expires_at > created_at` |

  Indexes: `sign_in_challenges_person_idx` (`person_id`), for the deletes by person and the cascade;
  `sign_in_challenges_state_hash_uq` unique on `state_hash` where `state_hash is not null`;
  `sign_in_challenges_totp_person_uq` unique on `person_id` where `kind = 'totp_enrolment'`.

  `sign_in_challenges_shape_ck`, one CHECK, true exactly when:
  - a passkey kind has `challenge` set, `state_hash`, `nonce`, `verifier`, `encrypted_secret` null,
    and `person_id` null for `passkey_login`, set for the other two;
  - a Google kind has `state_hash`, `nonce`, `verifier` set, `challenge` and `encrypted_secret`
    null, and `person_id` null for `google_login`, set for `google_link`;
  - `totp_enrolment` has `encrypted_secret` set and non-empty, `person_id` set, the other four null.

  The person rules are the ones identity's backup check reads today
  (`packages/identity/src/backup-verification.ts:215-229`).
- `insertSignInChallenge(tx, row)` in `packages/identity/src/sign-in-challenges.ts`: deletes rows
  with `expires_at <= now` or `expires_at > now + 10 minutes` (a clock stepped back; the longest
  lifetime is 10 minutes, `google-oidc.ts:13`, `profile.ts:161`), then inserts. Every insert goes
  through it.
- Lifetimes, unchanged: passkey 5 minutes (`CHALLENGE_TTL_MS`, `passkey.ts:44`), Google 10
  (`STATE_TTL_MS`, `google-oidc.ts:13`), two-step 10 (`TOTP_ENROLLMENT_TTL_MS`, `profile.ts:161`).
  A passkey row's `expires_at` is `created_at + CHALLENGE_TTL_MS`; `consumeChallenge` keeps its own
  age check (`passkey.ts:113`, including the ahead-of-clock allowance) unchanged.
- `webauthn_credentials.name` dropped: registration stops writing it (`passkey.ts:227`),
  `readPasskeys` stops selecting it (`profile.ts:253`), the personal-data file drops it
  (`personal-data.ts:146`), the dashboard labels a passkey by its
  provider, or "Passkey N" when the provider is unknown.
- Identity's backup check, personal-data file, `deleteSignInRows` (`staff.ts:186-191`) and
  break-glass's raw clean-up (`apps/server/src/break-glass-command.ts:137`) read and delete the new
  table.
- The backlog: delete what pp1 left of `docs/backlog/dashboard.md` "## Task 1b" and its line in
  `docs/backlog/architecture.md` "What A1308 retires"; delete `docs/backlog/dashboard.md` "## Passkey
  name column after A760" and its line in the architecture bundle.

## What it leaves out

| Left out | Owner |
| --- | --- |
| The daily tidy-up job that deletes expired rows nobody inserts after | the job runner (batch 3, `jobs.md` R16 `housekeeping`); until then the insert sweep keeps the table to tens of rows |
| How `persons.totp_secret` and `encrypted_secret` are sealed | pp5 (this plan moves the column, not the seal) |
| Dashboard sessions | pp3 |
| A history of passkeys added or removed | follow-up outside A1308 (README U11) |

## Files

- Create: `packages/db/src/schema/identity/sign-in-challenges.ts`,
  `packages/db/src/schema/identity/sign-in-challenges.test.ts`,
  `packages/identity/src/sign-in-challenges.ts`, `packages/identity/src/sign-in-challenges.test.ts`.
- Delete: `packages/db/src/schema/identity/google-oidc-states.ts`, `totp-enrollments.ts`; the
  `webauthnChallenges` table and `challengePurpose` from `webauthn.ts:54-75`.
- Modify: `packages/db/src/schema/identity/index.ts`, `webauthn.ts` (drop `name`, `:26`),
  `packages/db/src/index.ts`, `packages/db/src/classification.ts:415`, `:420`, `:435`,
  `packages/identity/src/classification.ts` (`IDENTITY_TABLES`),
  `packages/identity/src/passkey.ts:85-115`, `:182-200`, `:248-266`, `:361-386`, `:222-228`,
  `packages/identity/src/google-oidc.ts:45-67`, `:100-122`,
  `packages/identity/src/profile.ts:161-231`, `:249-264`,
  `packages/identity/src/staff.ts:186-191`, `packages/identity/src/personal-data.ts:118-146`,
  `packages/identity/src/index.test.ts:92-101`,
  `packages/identity/src/backup-verification.ts:196-229`, `packages/identity/src/index.ts`,
  `apps/server/src/break-glass-command.ts:137`, `apps/dashboard/src/api/client.ts:395-402`,
  `apps/dashboard/src/screens/profile-screen.ts:976-978`,
  `apps/server/src/testing/clear-provision-fixture.ts` (table list),
  `packages/composition/src/backup-verification.test.ts:203-204`,
  `packages/identity/src/schema-ownership.test.ts`, `packages/identity/src/backup-verification.test.ts:277`, `:348-388`,
  `scripts/schema-constraints.test.ts` (key row).
- Madrid fixtures: the three old table names appear in all three
  `packages/country-es/test-fixtures/demo/madrid-before-move.*.json` files at `a086eedfb7`
  (`grep -c` prints 18, 9 and 9); they are replaced by `sign_in_challenges` the way batch 1 set
  for a merged table (pp1 assumption B2).
- Generated (uncounted): core's starting migration, its snapshot, the epoch file.
- Docs: `apps/server/src/guide/{en,es}/` only if a guide names a passkey's typed name (grep
  `passkey` in both; at `a086eedfb7` the profile guide describes the provider name — read, not run).

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| Schema file and its exports, classification | 80 |
| Insert helper | 30 |
| Passkey, Google, two-step, staff, break-glass call sites | 120 |
| Personal-data and backup check | 75 |
| Passkey name (server, client type, label) | 20 |
| Schema tests (every CHECK refuses and accepts) | 170 |
| Helper and flow tests (sweep, one enrolment, ceremonies, swept refusal) | 175 |
| Backup-check, personal-data and declaration test edits | 80 |
| **Total** | **≈ 750** |

Uncounted: deleted schema files and the generated migration files.

## Finish line

```bash
pnpm --filter @waitron/db exec vitest run src/schema/identity
pnpm --filter @waitron/identity exec vitest run src/sign-in-challenges.test.ts src/passkey.test.ts \
  src/google-oidc.test.ts src/profile.test.ts src/staff-lifecycle.test.ts src/personal-data.test.ts \
  src/backup-verification.test.ts src/schema-ownership.test.ts src/classification.test.ts src/index.test.ts
pnpm --filter @waitron/server exec vitest run src/break-glass-command.test.ts src/google-oidc.test.ts \
  src/me-api.test.ts src/personal-data-export-api.test.ts
pnpm --filter @waitron/composition exec vitest run src/backup-verification.test.ts src/composition.test.ts
pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts \
  scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts scripts/live-subscriptions.test.ts
git grep -nE 'webauthn_challenges|google_oidc_states|totp_enrollments|webauthnChallenges|googleOidcStates|totpEnrollments' -- apps packages scripts ':!**/drizzle/**'; test $? -eq 1
```

Each Vitest run must print a `Tests` count (CLAUDE.md §4). Browser suites run headless Chromium;
check free memory first (CLAUDE.md §2).

## Expected protection-list difference

Lines without a phase note appear under all six `database=venue` headers. Measured on the base list
(`a086eedfb7`): none of the three old tables has a change-feed trigger; `webauthn_credentials` has
`waitron_change_webauthn_credentials_{insert,update,delete}`, whose `when` lists its columns.

| Table | Lines | Design reason (appendix §5) |
| --- | --- | --- |
| `webauthn_challenges` | `missing table webauthn_challenges`; `missing index webauthn_challenges.primary key(id)` | "CHECK purpose → `sign_in_challenges` kind CHECK" |
| `google_oidc_states` | `missing table google_oidc_states`; `missing index google_oidc_states.primary key(id)` | "CHECK mode → kind CHECK; CHECK state_hash length 64 → CHECK on state_hash" |
| `totp_enrollments` | `missing table totp_enrollments`; `missing index totp_enrollments.primary key(id)`; `missing index totp_enrollments_person_idx` | "index person; CHECK secret non-empty → shape CHECK; partial UNIQUE one per person" |
| `sign_in_challenges` (new) | `extra table sign_in_challenges`; `extra index sign_in_challenges.primary key(id)`; `extra index sign_in_challenges_person_idx`; `extra index sign_in_challenges_state_hash_uq`; `extra index sign_in_challenges_totp_person_uq` | the merge |
| `webauthn_credentials` | `missing table webauthn_credentials.columns[name]`; `changed table webauthn_credentials.columnOrder`; under the two `change-feed` headers only: `changed trigger waitron_change_webauthn_credentials_update.when` | 6 November addition |

The builder checks by hand that the new table's JSON holds the four CHECKs, the key with
`onDelete: "cascade"`, and no other column. Any other line is a stop.

## Stop points (beyond rules §5)

1. A passkey, Google or two-step test changes an assertion other than a table name, the
   `name`-to-`provider` label or the swept-challenge refusal named above, or the
   `name`-to-`provider` label (rules §5.3). The ceremonies must behave exactly as before.
2. The personal-data file changes beyond the passkey `name` field named above: the three lists
   (`personal-data.ts:118-141`: two-step
   setups started, passkey registrations started, Google links started) changes. It must not.
3. A product path inserts a second pending two-step setup without deleting the first (the new
   unique index refuses it). `profile.ts:171` deletes first today; if another path is found, stop.

## Needs

- pp1 (this area). Batch 1 and A1002 cut 2, as pp1.

---

## Global Constraints

- Rules §1–§9 apply in full. Codex builds, Claude reviews.
- `sign_in_challenges` is `state` and is copied with the venue (as the three were,
  `packages/db/src/classification.ts:415-435`).
- No new error code. Every refusal a ceremony gives today it gives unchanged, except the swept
  expired challenge named above.
- Every commit `git commit -s`.

## Review Focus

1. **The shape CHECK.** Each of the six kinds gets one test that a correct row is accepted and one
   per rule that a wrong row is refused (Task 1). A CHECK that refuses a real ceremony's row would
   stop every sign-in of that kind.
2. **The sweep's second half.** Deleting rows whose `expires_at` is more than 10 minutes ahead is
   Google's existing clock-step rule (`google-oidc.ts:57`) applied to all kinds; a passkey row is
   never more than 5 minutes ahead, so it cannot catch a live one.
3. **Cascade on person delete.** A ceremony row is the only person-keyed row here that cascades;
   every other person key refuses (U11). Reason: a ceremony in flight is worthless once its person
   is gone and holds no history (appendix §1 draws it so).

---

### Task 1: The table

**Files:** create `packages/db/src/schema/identity/sign-in-challenges.ts` and its test; modify
`index.ts`, `packages/db/src/index.ts`, `packages/db/src/classification.ts`,
`packages/identity/src/classification.ts`, `scripts/schema-constraints.test.ts`.

- [ ] **Step 1: Write the failing tests** in `sign-in-challenges.test.ts` (`useVenueDb`), one
  `describe` per kind:
  - `"accepts a well-formed <kind> row"` for each of the six.
  - `"refuses a passkey row with no challenge"`, `"…with a state hash"`, `"refuses a passkey login
    that names a person"`, `"refuses a passkey registration with no person"`.
  - `"refuses a Google row with no nonce"`, `"…a state hash not 64 long"`, `"refuses a Google login
    that names a person"`, `"refuses a Google link with no person"`.
  - `"refuses a two-step setup with an empty secret"`, `"…with no person"`, `"…with a challenge"`.
  - `"refuses an unknown kind"`, `"refuses expiry at or before creation"`.
  - `"refuses a second pending two-step setup for one person"` and `"accepts two-step setups for two
    people"`.
  - `"refuses two rows with the same state hash"`.
  - `"refuses a row for a person who does not exist"`; `"deletes a person's rows with the person"`.
  Each refusal asserts the SQLite constraint message names the expected constraint (rules §4).
  Add `["sign_in_challenges", ["person_id"], "persons"]` to `scripts/schema-constraints.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/identity/sign-in-challenges.test.ts`; expect failure.
- [ ] **Step 3: Implement** the table (columns and rules above; array-form `foreignKey`, as
  `recovery-codes.ts:16-21`). Classify it `state` in `packages/db/src/classification.ts` in place of
  the three, with the reason "a sign-in or enrolment ceremony in flight; minutes long". Replace the
  three names with `sign_in_challenges` in `IDENTITY_TABLES`.
- [ ] **Step 4: Rebuild** `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 5: Run** Step 2 and `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts`; expect pass.
- [ ] **Step 6: Commit** `git commit -s -m "Add one table for sign-in ceremonies in flight (pp2)"`. The old
  tables are still declared; the next tasks move their users.

### Task 2: The insert helper and the three ceremonies

**Files:** create `packages/identity/src/sign-in-challenges.ts` and test; modify `passkey.ts`,
`google-oidc.ts`, `profile.ts`, `staff.ts`, `personal-data.ts`, `index.ts`.

**Interfaces:**

```ts
// packages/identity/src/sign-in-challenges.ts
export type SignInChallengeKind = "passkey_registration" | "passkey_login" | "passkey_check"
  | "google_login" | "google_link" | "totp_enrolment";
/** Deletes expired and far-ahead rows, then inserts one. Returns the new row's id. */
export function insertSignInChallenge(tx: Transaction, row: {
  kind: SignInChallengeKind; personId: string | null; lifetimeMs: number; now?: Date; // created_at = now, expires_at = now + lifetimeMs
  challenge?: string; stateHash?: string; nonce?: string; verifier?: string; encryptedSecret?: string;
}): Promise<string>;
export const LONGEST_CHALLENGE_LIFETIME_MS: number; // 10 * 60 * 1000
```

- [ ] **Step 1: Write the failing tests** in `packages/identity/src/sign-in-challenges.test.ts`:
  `"deletes expired rows of every kind before inserting"`, `"deletes a row more than ten minutes
  ahead"`, `"keeps a live row of another kind"`, `"stamps created_at and expires_at from one now"`.
  In `passkey.test.ts`: `"an expired registration challenge swept by another person's insert is
  refused as unknown"` (the changed refusal, named above).
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** the helper, then move each caller (the mapping is exact; nothing else in
  the ceremony changes):
  - `passkey.ts`: purpose `registration`/`login`/`check` → kind `passkey_registration`/`passkey_login`/`passkey_check`.
    Inserts at `:182`, `:264`, `:361` go through the helper with `lifetimeMs: CHALLENGE_TTL_MS`.
    The login-start delete of old login challenges (`:250-257`) goes: the helper's sweep covers it.
    `consumeChallenge` (`:85-115`) deletes from `sign_in_challenges` where `id` and `kind` match and,
    when given, `person_id`; its age check is unchanged.
  - `google-oidc.ts`: mode `login`/`link` → kind `google_login`/`google_link`. The insert (`:52-67`)
    goes through the helper (its own sweep at `:52-58` goes). The claim (`:100-122`) deletes where
    `state_hash` matches, the kind is a Google kind, and `expires_at` is within today's window
    (`:107-109`, unchanged); it maps the kind back to `mode` for its callers, whose types do not change.
  - `profile.ts`: two-step setup start (`:169-180`) keeps its delete of the person's pending setup
    (`:171`) and inserts through the helper; confirm (`:192-213`) and cancel (`:231`) read and delete
    `kind = 'totp_enrolment'` rows for the person.
  - `staff.ts:189-190`: one delete of the person's `sign_in_challenges` rows whose kind is a
    passkey kind or `totp_enrolment` replaces the two (a pending Google link was not deleted there
    before, and is not now; same for break-glass in Task 3).
  - `personal-data.ts:118-141`: the three lists read `sign_in_challenges` by kind, with the same
    output fields (`startedAt`/`expiresAt` for two-step, `startedAt` for passkey registrations,
    `expiresAt` for Google links).
- [ ] **Step 4: Run** the finish line's identity run; expect pass with unchanged assertions.
- [ ] **Step 5: Commit** `git commit -s -m "Move the passkey, Google and two-step ceremonies onto sign_in_challenges"`.

### Task 3: Backup check, break-glass, and the old tables go

**Files:** `packages/identity/src/backup-verification.ts`, its test,
`packages/composition/src/backup-verification.test.ts`, `apps/server/src/break-glass-command.ts`,
`apps/server/src/testing/clear-provision-fixture.ts`, the deleted schema files.

- [ ] **Step 1: Re-point the backup-check tests first** (`backup-verification.test.ts:277`,
  `:348-388`): every case that builds a bad row in one of the three tables builds the same bad row in
  `sign_in_challenges` with the matching kind, and keeps its expected result (`invalid`,
  `unsupported`, `decryption_unavailable`). Add `"marks a sign-in challenge whose person is gone"`
  only if the generic person check does not already cover it (it does at `:184-190` for any table
  with `person_id`; then no new case).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** One `case "sign_in_challenges":` switching on `row.kind`: passkey kinds
  run today's `webauthn_challenges` rule (`:215-221`, person rule by kind), Google kinds today's
  `google_oidc_states` rule (`:222-229`), `totp_enrolment` today's `totp_enrollments` rule (`:198-200`).
  An unknown kind is `invalid`. Break-glass's raw `delete from totp_enrollments` (`:137`) becomes
  `delete from sign_in_challenges where person_id=${targetId} and kind='totp_enrolment'` (it deleted
  only two-step setups before). Delete the three old table
  definitions and every export; update `clear-provision-fixture.ts` and the composition test's
  table names.
- [ ] **Step 4: Rebuild** core; run the finish line's identity, server and composition runs.
- [ ] **Step 5: Commit** `git commit -s -m "Check and clean sign-in ceremonies in one table; drop the three old ones"`.

### Task 4: The passkey name column

**Files:** `packages/db/src/schema/identity/webauthn.ts:26`, `packages/identity/src/passkey.ts:227`,
`packages/identity/src/profile.ts:249-264`, `apps/dashboard/src/api/client.ts:397`,
`apps/dashboard/src/screens/profile-screen.ts:976-978`, and any test that sets or reads `name` on a
passkey (`git grep -n "webauthnCredentials\b" -- '*.test.ts'` and the dashboard's profile tests).

- [ ] **Step 1: Write the failing test** in `apps/dashboard/src/screens/profile-screen.test.ts`:
  `"labels a passkey by its provider, or Passkey N when the provider is unknown"` (two passkeys, one
  with `provider: "iCloud Keychain"`, one with `provider: null`; the second reads "Passkey 2"). It
  fails because the screen reads `name`.
- [ ] **Step 2: Implement.** Drop the column, its write and its place in the personal-data file
  (`personal-data.ts:146`; update `personal-data.test.ts`'s expected passkey rows, named above);
  `readPasskeys` returns
  `{ id, createdAt, lastUsedAt, provider }`; the client type loses `name`; the label is
  `key.provider ?? t("profile.passkey_number")…`. Existing tests that built a passkey with a `name`
  drop the field; their assertions about the label now read the provider (the same value A403
  writes today: `passkeyProviderName(aaguid)`, `passkey.ts:227`), so the visible text is unchanged.
- [ ] **Step 3: Rebuild** core; run the profile screen suite and the identity profile suite.
- [ ] **Step 4: Commit** `git commit -s -m "Drop the stored passkey name; label passkeys by provider"`.

### Task 5: Protection list, backlog, finish

- [ ] **Step 1:** Protection list before and after (rules §3); paste the report, marked against the
  table above.
- [ ] **Step 2:** Backlog: delete what pp1 left of `docs/backlog/dashboard.md` "## Task 1b (#554,
  session cookies stored only as hashes)" and its line in `docs/backlog/architecture.md` "What A1308
  retires"; delete `docs/backlog/dashboard.md` "## Passkey name column after A760" and the bundle
  line "**Passkey name column after A760:**" in `docs/backlog/architecture.md`.
- [ ] **Step 3:** Run the finish line; `/finish-branch`.
