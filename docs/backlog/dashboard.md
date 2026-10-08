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

## The older collapse-only sidebar test still needs a useful assertion (C35, #822) — OPEN

- **The older collapse-only sidebar test still needs a useful assertion (C35, #822) — OPEN.**
  A325's independent review deleted the app's scroll correction: the new lower-header check
  failed by 128px, while "keeps the clicked group header … when collapsing …" still passed.
  The older test and its existing assertions were retained. Find a collapse-only case that
  needs the app's correction before changing or retiring that test.

## Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29)

- **Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29).** A page saying
  what the section is for and what is in it, opened by the section's header. It was the answer to
  C35's question about the header of the section you are on; A161 (#979) has since answered that
  question another way — that header now collapses its section, as every other header does — so
  whether this page is still wanted, and what would open it, is the owner's call. If wanted, it
  needs a spec: brainstorm what each section's page says.

## Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
  (1) tables inside a dialog or picker offer no chooser, by choice; (2) the servers list
  (`apps/dashboard/src/screens/servers-screen.ts`) offers no chooser, its one column beside the
  buttons holding several facts together — **DECIDED (owner, 2026-09-29): leave it**, unsplit and
  with no chooser; (3) nothing checks that a NEW dashboard table offers the chooser; (4) where a
  screen keeps its search and filters outside the table (staff, card readers) or the table has none
  (alerts, venue operations), the Customise icon button sits alone on a row above the table rather than
  beside those controls — moving a screen's own controls into the table's toolbar would fix it;
  (5) the read-only tables a few screens draw as plain HTML tables rather than `wt-data-table`s have
  no chooser: planned against actual (`apps/dashboard/src/screens/planned-actual-screen.ts`), the
  roster (`apps/dashboard/src/screens/roster-screen.ts`), the four report tables on the sales screen
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), the overdue table on the overview
  (`apps/dashboard/src/screens/dashboard-overview-screen.ts`) and the top-sellers table both of
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`); (6) the printers screen's
  view keys (`printers:agents`, `printers:table`, `printers:jobs`) are the only dashboard view keys
  that use a colon and lack the `waitron.` prefix — cheap to rename until a venue is live.

## A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left open

- **A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left
  open:** three dialogs still draw their own refusal because none has a `wt-form-actions` row in its
  footer to hand it to: the menus screen's add-products window has its row inside the
  `section-add-products` component, and `packages/bookings/src/dashboard/booking-form.ts` and
  `apps/till/src/widgets/supervisor-override-dialog.ts` put bare `wt-button`s in the footer slot. A
  `wt-form-actions` wrapped in another element inside a dialog's footer would keep its message in
  the footer; none does today. Not looked at on screen after #961's review fixes.

## A form in a modal stops at `--wt-form-max-width` (C105, #965) — left open

- **A form in a modal stops at `--wt-form-max-width` (C105, #965) — left open:** a
  `wt-disclosure`'s heading row (the product editor's Kitchen, Descriptors and Nutrition sections,
  among others) and a screen's own paragraphs still run the modal's full width; and forms built in
  `wt-dialog` rather than `wt-modal` (the ingredient form, the till's party name dialog, among
  others) are held only by the dialog's own 768px limit — whether they should follow the modal's
  form width is the owner's call.

## Decisions and deliberate limits

- Left open by the owner's choice (W110, #1255, "One word for 'switched off, kept for the record'
  across the dashboard"): a Delete label can be stale, because the watcher list does not re-read on
  a watcher's Done marks nor the course list on draft lines, order lines or kitchen items, in which
  case a confirmed Delete switches the row off instead.

- **The sidebar's page search (C46, #836) — left open:** its accessibility case checks the search
  box and its message only; the sidebar's headers and current page have their own case since A306
  (`apps/dashboard/src/dashboard-app.a11y.test.ts`, "the desktop sidebar's group headers and current
  page are accessible at rest and under the pointer"). Two choices are **DECIDED (owner, 2026-09-29): keep both** — "ñ" is matched as
  "n", so "espana" finds "España"; and the box is not pinned, so it scrolls away with a long
  sidebar.

- **Hints shown as placeholders (C104, #966; C119, #967):** the owner chose on 2026-10-01 to leave as
  they are the hints cut off in their fields and the fields whose own placeholder shows instead of
  their hint.
