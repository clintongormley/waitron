# Users, sign-in and the dashboard shell — detail

The open entries are listed in [the backlog](../backlog.md), under "Users, sign-in and the dashboard shell". This file holds
their full text.

## `date-utils.test.ts` has a test titled as guarding "against a vacuous pass"

- Found by #612 (the rest of `apps/dashboard`), not fixable in a comments-only change.
  `date-utils.test.ts` has a test titled as guarding "against a vacuous pass", but #612's
  review removed the timezone pin and ran the file under `TZ=UTC`, and all four cases failed on
  their own. `catalogues` in `apps/dashboard/src/i18n/strings.ts` is read by nothing but
  `i18n/t.test.ts` (`t.ts` registers `{ en, es }` with the kit), so that test's "registers en-GB"
  case tests nothing that runs. The browser project in `apps/dashboard/vitest.config.ts` still
  excludes `.stryker-tmp`, though the app has no Stryker config. Not restored, by the review's
  choice: a note that `#sessionPermissions` only guides the screen and every module route is still
  checked on the server (not traced).

## `setEmail` in `packages/identity/src/staff.ts`, unlike `updatePersonDetails`, never checks the new email against other people's pending emails

- Identity code, found by #559: `setEmail` in `packages/identity/src/staff.ts`,
  unlike `updatePersonDetails`, never checks the new email against other people's pending
  emails; `manager-login.ts` reports an authenticator secret it cannot decrypt as a failed login
  (`password.invalid`, logged with the reason `unreadable_secret` since C95), like a wrong code.
  Identity's coverage reads 99.85 statements / 99.75 branches, not 100: the
  `management_session.required` throw in `profile.ts`'s `ownSession`, as it stands since #554,
  is reached by no test.
