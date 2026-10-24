# A980 slice S4: disabling a person deletes their sign-in details

**Status: plan, 2026-10-24.** Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.3 and
§5.2 defect 1; owner answer O2 ("yes — delete sign-in details at deactivation"). Overview:
[the build plan](2026-10-24-a980-data-protection-build.md), row S4. Branch
`feat/a980-s4-deactivation-wipe`. No migration. FULL review (sign-in).

## The defect

Disabling a person (the dashboard's **Disable** row action, `POST /management-api/staff/:id/deactivate`,
→ `deactivatePerson`, `packages/identity/src/staff.ts:263-291`), or saving their edit form with the
status set to suspended (`PUT /management-api/staff/:id` → `updatePersonDetails`,
`staff.ts:175-261`), marks them suspended and ends their sessions, but leaves their PIN hash,
password hash, two-factor secret, Google link, passkeys, recovery codes, two-factor enrolments and
pending passkey challenges in the database — and so in every backup copy. _Reset login_
(`resetPersonLogin`, `staff.ts:310-350`) and re-enabling (`reactivatePersonForInvitation`,
`staff.ts:352-393`) already delete all of them, each with its own copy of the same statements.

## Decisions this plan makes that the design does not

1. **One wipe function.** `wipeSignInDetails(tx, personId)` (module-private in `staff.ts`) sets
   `pinHash`, `passwordHash`, `totpSecret` and `googleSubject` to null and deletes the person's
   rows in `webauthn_credentials`, `recovery_codes`, `totp_enrollments` and `webauthn_challenges`.
   _Reset login_, re-enabling, and both disabling routes call it, so those four callers cannot
   drift apart. (Two other copies stay outside this slice: the emergency admin-recovery command,
   `apps/server/src/break-glass-command.ts:118-136`, raw SQL that sets people back to active, and the
   configuration import, which writes a non-null `disabled-import:<uuid>` into `pin_hash` and nulls
   the rest, `packages/provisioning/src/configuration-transfer.ts:735-743`.)
   Each caller keeps its own status write (`pending` for reset and re-enable, `suspended` for
   disable) and its own `emailVerifiedAt` handling: reset and re-enable clear it as today;
   disabling leaves it (it is not a sign-in secret, and re-enabling clears it anyway).
2. **Every save or disable that leaves a person suspended wipes.** The edit route wipes whenever
   the saved status is `suspended` (`staff.ts:206-208` already refuses every other status change),
   and `deactivatePerson`'s early return for an already-suspended person (`staff.ts:288`) becomes
   "wipe, then return" (no session work: their sessions ended when they were first disabled). This
   is simpler than wiping only on the change, and it lets an admin clear the leftovers of a person
   disabled before this ships, or brought in by an import, by pressing Disable or saving again.
3. **The two unused functions go.** `suspendPerson` (`staff.ts:567-577`) writes `suspended`
   without a wipe and `reactivatePerson` (`staff.ts:579-588`) writes `active` straight back,
   keeping the old PIN; neither is exported from `packages/identity/src/index.ts` nor called by any
   route (`git grep -n "suspendPerson\|reactivatePerson\b"` — only their own tests, the dashboard's
   unrelated client method of the same name calls the re-enable route). Keeping them would keep a
   path that contradicts O2. Their tests go with them: the `describe("suspendPerson /
   reactivatePerson")` block in `staff.test.ts` and their cases in `staff-authority.test.ts`. This
   is a test change the spec forces (owner rule 2026-10-05); list each removed case in the pull
   request under "Changed test checks", and say which existing `deactivatePerson` case already
   covers the same refusal (self-deactivation, upper-case id, staff actor refused) — add one where
   none does.
4. **No clean-up of people disabled before this ships.** Nothing walks existing suspended people:
   no venue is live (home CLAUDE.md §3, "No backwards-compatibility or data-migration code until
   Waitron is in production"); decision 2 lets an admin clear one by hand.
5. **A disabled person's passkey now answers `passkey.not_registered`.** Today a disabled person
   keeps their passkey row, so a passkey sign-in reaches the status check and answers the general
   `passkey.verification_failed`; `docs/developers/conventions-ui.md` (the passkey part of the
   one-answer rule, about lines 773-779) states this and names
   `packages/identity/src/passkey.test.ts:704-715` as its guard. Once the row is deleted, the
   lookup misses first and answers `passkey.not_registered` (`passkey.ts:266`) — the owner-approved
   exception (home CLAUDE.md §3, "One owner-approved exception: `passkey.not_registered`"), the same
   answer a person gets after a login reset or after removing that passkey. It does not tell a
   disabled account from a reset one or a removed passkey, so it reveals no more than today's reset
   does. This is the spec's consequence (O2: passkeys are deleted at deactivation), not a choice:
   - change the `passkey.test.ts:704-715` case to expect `passkey.not_registered` after
     `deactivatePerson`, and list it under "Changed test checks";
   - ADD a case keeping the general refusal for a suspended person who still holds a passkey row
     (seeded by direct SQL, as `apps/server/src/management-api-passkey.test.ts:664` does — that
     server test stays valid and unedited);
   - update the conventions-ui.md passage and the comment atop `passkey.ts` (about lines 27-33) to
     say both: no row → `not_registered`; a row on a suspended person → the general refusal.
6. **Guide and dialog text.** The staff guide's "Account access" section (EN
   `apps/server/src/guide/en/staff.md`, ES `apps/server/src/guide/es/staff.md`, same `{#account-access}`
   id) gains one sentence: disabling an account also deletes the person's PIN, password, passkeys,
   two-factor settings and Google link, so re-enabling sends a new invitation. The Disable
   confirmation dialog's body (`apps/dashboard/src/i18n/strings.ts:1889` EN and `:5171` ES, "This
   signs the user out and prevents further login.") gains the deletion, as short as the meaning
   allows (e.g. "This signs the user out and deletes their PIN, password and passkeys."). The edit
   form's status menu (`person-edit.ts:252-253`) also offers suspended; it gets no extra hint (the
   guide sentence covers it, and product text stays as short as the meaning allows).

## Global constraints

- Every database test uses `useVenueDb`; rejected writes assert the domain error code.
- One transaction per request; the wipe runs inside the caller's `tx`, after the status write, and
  queries on the transaction are awaited in turn, never `Promise.all`.
- No permission change: both disabling routes already need `person.admin` (since A1000).
- English only in code and tests; Spanish only in `apps/server/src/guide/es/` and the dashboard's
  strings file.
- Commits `git commit -s`. Run `pnpm format:check` before each commit.

## Task 1 — the wipe, test first (packages/identity)

Files: `packages/identity/src/staff.ts`, `packages/identity/src/staff.test.ts`,
`packages/identity/src/staff-authority.test.ts`.

1. Write failing tests in `staff-lifecycle.test.ts` (it resets the database per test, where the
   disable, reset and re-enable tests already live; `staff.test.ts` shares one database). Seed a
   person with every secret — PIN, password, two-factor secret, Google subject (columns, by SQL as
   the reset tests do at about `:340-342`), plus one passkey, one recovery code, one two-factor
   enrolment and one passkey challenge (rows; shared helpers are in
   `packages/identity/test/fixtures.ts`). Then, BY READING THE ROWS (a PIN sign-in already answers
   `pin.invalid` for any suspended person, `credential.ts:52-62`, so it proves nothing about the
   wipe):
   - after `deactivatePerson`, all eight are gone, status is `suspended`, `emailVerifiedAt` is
     unchanged;
   - after `updatePersonDetails` with `status: "suspended"`, the same;
   - a person ALREADY suspended (by SQL) who still holds every secret: `deactivatePerson` wipes
     them, and so does saving their details with status `suspended` (decision 2);
   - another person's secrets are untouched by each (the wipe is keyed by the right id);
   - re-enabling (`reactivatePersonForInvitation`) a person suspended by SQL who still holds every
     secret leaves none and leaves them `pending` (today's re-enable test checks only the status,
     so without this the refactor could drop re-enable's wipe unnoticed);
   - reset login leaves none of the four ROW kinds (today's reset test checks only the columns).
   Run `pnpm --filter @waitron/identity exec vitest run src/staff.test.ts` and watch the new cases
   fail for the right reason (secrets still present).
2. Add `wipeSignInDetails` and call it from the four places (decision 1, 2). Remove the duplicated
   statements from `resetPersonLogin` and `reactivatePersonForInvitation`. Their existing tests
   must pass unedited.
3. Delete `suspendPerson` and `reactivatePerson` and their tests (decision 3). First add the
   `deactivatePerson` refusal cases nothing covers yet (existing ones:
   `staff-lifecycle.test.ts:523-572`): an admin disabling themselves; an upper-case id for SOMEONE
   ELSE (the update must fold the case); a staff-role actor refused with
   `authorization.not_permitted`. Then remove: the `describe("suspendPerson / reactivatePerson")`
   block in `staff.test.ts` (its "suspend blocks login; reactivate restores it" case is the
   behaviour O2 rules out), their cases in `staff-authority.test.ts`, and change the
   `listActiveStaff` test at `staff.test.ts:564` to make its suspended person with
   `deactivatePerson` or by SQL. List each under "Changed test checks" with its replacement.
3b. Decision 5's passkey changes (test change, new case, conventions-ui.md, `passkey.ts` comment).
4. Omission controls, each run and reverted: remove the wipe call from `deactivatePerson` → its new
   test fails; from the edit route → its test fails; from `reactivatePersonForInvitation` → its
   test fails; from the already-suspended branch → its test fails; drop the `totp_enrollments`
   delete from the wipe → a test fails. Record the three failing lines for the pull request.
5. Run `pnpm --filter @waitron/identity exec vitest run` (the whole package — the guard suites and
   concurrency tests included) and `pnpm --filter @waitron/identity typecheck`.

## Task 2 — routes, guide and dialog

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`, the Disable
dialog's strings in `apps/dashboard/src/i18n/strings.ts`, one server test file. No change is needed
in `apps/server/src/management-api.ts` (the staff routes each call identity inside one transaction).

1. One server-level case through the real route (beside the existing one at
   `apps/server/src/management-api.accounts-and-receipt-config.test.ts:1984`): give a staff member a
   PIN, a passkey and at least one working-time entry (the server depends on both identity and
   workforce; identity cannot seed workforce rows — `packages/workforce/package.json` depends on
   identity), disable them through `POST /management-api/staff/:id/deactivate`, then READ THE ROWS:
   the secrets are gone and the working-time entries are unchanged (the design's S4 test column:
   "the person's time entries untouched"). Write it before Task 1's code is on the branch if you
   can; otherwise show it fails with the wipe call removed.
2. Guide sentence in EN and ES (decision 6). Run
   `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.
3. The dialog (decision 6), EN and ES strings; run the staff screen's test file.
4. Update `docs/backlog/data-protection.md`'s A980 detail and `docs/backlog.md`'s A980 entry: S4
   done — delete its point (open work only).

## Review focus

- No path still writes `suspended` without the wipe (`git grep -n '"suspended"'` in non-test
  source; the configuration import nulls the secrets and writes a `disabled-import:` value into
  `pin_hash`, `packages/provisioning/src/configuration-transfer.ts:735-743`; the server's
  `apps/server/src/testing/watched-scrypt.ts:245` is a test harness).
- The passkey answer change (decision 5) is exactly as stated, and the documented rule now matches.
- Reset login and re-enable behave exactly as before.
- The removed tests are justified one by one.
