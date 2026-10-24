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
   _Reset login_, re-enabling, and both disabling routes call it, so the four lists cannot drift.
   Each caller keeps its own status write (`pending` for reset and re-enable, `suspended` for
   disable) and its own `emailVerifiedAt` handling: reset and re-enable clear it as today;
   disabling leaves it (it is not a sign-in secret, and re-enabling clears it anyway).
2. **The edit route wipes only on the change INTO suspended** (`input.status === "suspended" &&
   person.status !== "suspended"`). Saving an already-suspended person's names changes nothing
   about sign-in.
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
4. **People disabled before this ships are not wiped.** `deactivatePerson` returns early for an
   already-suspended person (`staff.ts:288`). No clean-up code: no venue is live (home CLAUDE.md §3,
   "No backwards-compatibility or data-migration code until Waitron is in production").
5. **Guide and dialog text.** The staff guide's "Account access" section (EN
   `apps/server/src/guide/en/staff.md`, ES `apps/server/src/guide/es/staff.md`, same `{#account-access}`
   id) gains one sentence: disabling an account also deletes the person's PIN, password, passkeys,
   two-factor settings and Google link, so re-enabling sends a new invitation. If the dashboard's
   Disable confirmation dialog has body text, it gains the same short warning in EN and ES (keep
   it as short as the meaning allows); if it has none, leave the dialog.

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

1. Write failing tests in `staff.test.ts` (a new `describe("disabling deletes sign-in details")`):
   seed a person with every secret — PIN, password, two-factor secret, Google subject, one passkey,
   one recovery code, one two-factor enrolment, one passkey challenge (reuse the existing seeding
   helpers in the file or in `src/testing/`; read how the reset-login tests seed them). Then, by
   reading the rows:
   - after `deactivatePerson`, all eight are gone, status is `suspended`, `emailVerifiedAt` is
     unchanged, and PIN sign-in answers `pin.invalid`;
   - after `updatePersonDetails` with `status: "suspended"`, the same;
   - saving an already-suspended person's details (status stays `suspended`) does not fail;
   - another person's secrets are untouched by either (the wipe is keyed by the right id);
   - the person's working-time rows are untouched — if seeding one needs the workforce package and
     identity cannot depend on it, check instead that the wipe deletes from no table outside the
     eight named (state how in the test's name) and say so in the pull request;
   - re-enabling the disabled person (`reactivatePersonForInvitation`) still succeeds and leaves
     them `pending`.
   Run `pnpm --filter @waitron/identity exec vitest run src/staff.test.ts` and watch the new cases
   fail for the right reason (secrets still present).
2. Add `wipeSignInDetails` and call it from the four places (decision 1, 2). Remove the duplicated
   statements from `resetPersonLogin` and `reactivatePersonForInvitation`. Their existing tests
   must pass unedited.
3. Delete `suspendPerson` and `reactivatePerson` and their tests (decision 3); add any missing
   `deactivatePerson` refusal case first.
4. Omission controls, each run and reverted: remove the wipe call from `deactivatePerson` → its new
   test fails; from the edit route → its new test fails; drop the `totp_enrollments` delete from
   the wipe → a test fails. Record the three failing lines for the pull request.
5. Run `pnpm --filter @waitron/identity exec vitest run` (the whole package — the guard suites and
   concurrency tests included) and `pnpm --filter @waitron/identity typecheck`.

## Task 2 — routes, guide and dialog

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`; the dashboard
Disable dialog's strings only if decision 5 applies. Do not touch `apps/server/src/management-api.ts`
(open pull request #2031 changes it; no change is needed there).

1. Read the server's existing route tests for `/management-api/staff/:id/deactivate` and the edit
   route (`git grep -n "staff/.*deactivate" apps/server/src`). If no server-level test shows a
   disabled person's PIN no longer signing in, add one end-to-end case through the real route
   (disable, then a till PIN sign-in answers `pin.invalid`, then re-enable succeeds) — test first.
2. Guide sentence in EN and ES (decision 5). Run
   `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.
3. The dialog (decision 5), with its EN and ES strings, if it has body text; run that screen's test
   file.
4. Update `docs/backlog/data-protection.md`'s A980 detail and `docs/backlog.md`'s A980 entry: S4
   done — delete its point (open work only).

## Review focus

- No path still writes `suspended` without the wipe (`git grep -n '"suspended"'` in non-test
  source; the configuration import already blanks every secret,
  `packages/provisioning/src/configuration-transfer.ts:735-743`; the server's
  `apps/server/src/testing/watched-scrypt.ts:245` is a test harness).
- Reset login and re-enable behave exactly as before.
- The removed tests are justified one by one.
