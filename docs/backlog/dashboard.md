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

## Dashboard leftovers from the coverage branch

**Dashboard leftovers from the coverage branch — OPEN (found 2026-09-23, PR #538).** Each from
reading unless marked run:

- `wt-dialog` re-sends the native dialog's `close` event as `wt-close`
  (`packages/ui/src/components/wt-dialog.ts`), and the native event arrives a task after the dialog
  closes — the same mechanism the catalogue screen's nested forms guard against (#741). So a dialog
  reopened within that task is shut again: `wt-dialog`'s own close handler (`onClose`) sets its
  `open` to false, which closes the native dialog, and then the screen's handler clears its state.
  `staff-screen.ts` and `purchases-screen.ts` have no guard; their tests wait out the late close
  rather than guard it (`staff-screen.test.ts`, `purchases-screen.test.ts`). `profile-screen.ts`'s
  flag (`#closingModal`) protects the screen's mode but, we believe (by reading, not tested), not
  the dialog itself. `apps/dashboard/src/widgets/allergen-picker.ts` avoids the problem by mounting
  a fresh dialog for each open (`keyed`). Seen once under coverage load in a test (run); we believe
  a person cannot reopen it that fast; not tested.
- `login-screen.ts` checks an account link's purpose with `=== null`, so a reply with no purpose at
  all would pass; the server always sends one.
- Guards no test can reach, left uncovered rather than deleted: the canvas editor's "no draft" and
  "no selected card" guards, several `?? []` and `?? null` fallbacks in the printers, payments,
  kitchen, backup, devices, profile, extra-list and option-list files, and a
  handful in `dashboard-app.ts` and `login-screen.ts`. **Next action:** delete them with a
  receipt each, or leave them as defensive code by decision.

## A person row written from outside `packages/identity` still folds its key ASCII-only

**A person row written from outside `packages/identity` still folds its key ASCII-only — OPEN
(found 2026-09-23, task F1's review wave).** SQLite's `lower()` folds ASCII and nothing else, so the
three unique indexes on `persons` stopped refusing two staff whose names differ only in the case of
an accented letter — José García beside JOSÉ GARCÍA, on a Spanish product. The repair stores a
folded key in its own column (`packages/identity/src/fold.ts`: trim, NFC, lower, NFC) and each
index reads `case when <folded> is null then lower(<raw>) else <folded> end`. **The `case` is why
this entry exists:** a bare index on the folded column alone would put every row that did not carry
one OUTSIDE the uniqueness check, which is worse than the defect. The two real paths that create a
person are routed — `packages/provisioning/src/venue-apply.ts`'s admin insert and
`apps/server/src/mirror-session.ts` both call the exported `foldForUniqueness`. **What is left
open:** every remaining writer outside `packages/identity` is a fixture or a seed, each still
folding ASCII-only, and the column is still nullable, so nothing at the compiler stops a new writer
forgetting it. **Next action:** decide whether the column becomes mandatory — which breaks every
fixture at the compiler rather than silently — or whether a guard over the write sites is enough.

## Task 1b (#554, session cookies stored only as hashes)

**Task 1b** (#554, session cookies stored only as hashes). Nothing fails when the UUID shape
screens in `requireSession` and the till logout route are deleted — a non-UUID value hashes to no
row, so the screens now only save a lookup. Also open: now that both ends are `state`, the
keys #426 dropped could be declared again — `sessions` to `persons`, and
`management_sessions`, `totp_enrollments` and `google_oidc_states` to `persons` (`sessions`' key to
`tills` went with that table in A238, and `sessions.device_id` holds one to `devices`). Doing so would
change what deleting a person does.

## Roles the admin can edit (A7)

A person's role is one of four values (`personRole` in `packages/identity/src/schema/persons.ts`).
The seam is already right: no call site gates on a role string — every one asks for a PERMISSION and
one map turns a role into its set (`packages/identity/src/permissions.ts`) — and a session reads the
role from the database on each request, so an edited role takes effect at once. Roles and their
permissions become rows the admin owns, per tenant, with the four seeded as defaults; no compatibility
code.

The design turns on the **ladder**: a module contributes a permission by naming only the lowest role
that should hold it (`grantedFrom`, on `ModulePermission` in `packages/module/src/module.ts`) and identity spreads it
upward. A custom role has no position, so either every custom role declares where it sits, or the
module contract names a permission group instead. Pick one before writing schema;
`packages/composition/src/role-parity.ts` proves at compile time that the contract's roles and
identity's are one list, and whatever replaces the union keeps an equivalent tie. Then: who may edit
a role (`person.admin` plus nobody mints or widens beyond what they hold, and a venue is never left
with nobody who can administer roles); a role in use (deleting or narrowing one changes live
sessions on their next request); storage (a table in identity's own migration set with a
classification entry — never an enum, CLAUDE.md §2); names (built-ins are translated from
`roleName`, `apps/dashboard/src/i18n/domain.ts:135`, custom ones will not be).

## Row menus in plain `<table>`s are unchecked at phone width

- **Row menus in plain `<table>`s are unchecked at phone width.** `variant-table.ts` and
  `option-list-form.ts` (`apps/dashboard/src/widgets/`) put a `wt-row-actions` in a plain table,
  not `wt-data-table`, so `pinned` does not reach them; `product-editor.ts` also contains both a
  `<table>` and a row menu (found by grep, not read). None has a phone-width case and none was
  measured.

## A keydown guard that cancels Escape while a save runs did not keep one dialog open

- **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** On
  Task 1's reasons screen (`packages/adjustments/src/dashboard/reasons-screen.ts`) a real Escape
  during a save closed the editor although its keydown handler called `preventDefault()` and
  `stopPropagation()`; the screen now sets `wt-modal`'s `dismissible` to false while busy, and
  `wt-dialog` sets `closedby="none"` while `dismissible` is off. Why that screen behaved
  differently has not been established. The same keydown guard is on other dashboard forms:
  those whose tests press a real Escape during a save also ignore a close while busy in their
  `wt-close` handler, except the Departments and zones screen
  (`packages/venue-service/src/dashboard/venue-operations-screen.ts`), whose handler has no such
  check and which does not set `dismissible`. The rest were tried only with a hand-built
  `KeyboardEvent` (`sections-screen`, `modifiers-screen`, `add-to-menus`, `extra-list-form`,
  `option-list-form`, `option-label-form` and `variant-form`, under `apps/dashboard/src`) or not at all
  (`#guardEscape` in `apps/dashboard/src/screens/menus-screen.ts`). **Next action:** repeat the reasons-screen case
  recording which element has focus just before the Escape; then press a real Escape during a
  save on each form tried only with a hand-built event or not at all, and move the ones that close
  to `dismissible`.

## Decisions and deliberate limits

- Left open by the owner's choice (W110, #1255, "One word for 'switched off, kept for the record'
  across the dashboard"): a Delete label can be stale, because the watcher list does not re-read on
  a watcher's Done marks nor the course list on draft lines, order lines or kitchen items, in which
  case a confirmed Delete switches the row off instead.
