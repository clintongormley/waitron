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
- Guards no test can reach, left uncovered rather than deleted: several `?? []` and `?? null` fallbacks in the printers, payments,
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

## A827. Check that row menus in plain `<table>`s stay on screen at 390 px

- **A827. Check that row menus in plain `<table>`s stay on screen at 390 px (owner,
  2026-10-17).** `variant-table.ts` and `option-list-form.ts` (`apps/dashboard/src/widgets/`) put a
  `wt-row-actions` in a plain table, not `wt-data-table`, so `pinned` does not reach them;
  `product-editor.ts` also contains both a `<table>` and a row menu (found by grep, not read). At
  390 px the variant table's menus are held on screen through the product editor
  (`product-editor.test.ts`, "keeps every variant row's menu on screen at phone width"); the option
  list form's table and the product editor's attached extras/options table have 390 px cases that
  check where a row's menu sits, not that it stays on screen. Done when each of those two has a
  390 px case holding every row menu's right edge to the screen's.

## A keydown guard that cancels Escape while a save runs did not keep one dialog open

- **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** On
  Task 1's reasons screen (`packages/adjustments/src/dashboard/reasons-screen.ts`) a real Escape
  during a save closed the editor although its keydown handler called `preventDefault()` and
  `stopPropagation()`; the screen now sets `wt-modal`'s `dismissible` to false while busy, and
  `wt-dialog` sets `closedby="none"` while `dismissible` is off. Why that screen behaved
  differently has not been established. The same keydown guard is on other dashboard forms:
  those whose tests press a real Escape during a save also ignore a close while busy in their
  `wt-close` handler. Slice 6's department and zone dialogs now set `dismissible` to false
  while busy and refuse a close through their guard; their real-Escape cases are in
  `packages/venue-service/src/dashboard/department-dialogs.test.ts`. The rest were tried only with a hand-built
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

## Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
  (1) tables inside a dialog or picker offer no chooser, by choice; (2) the servers list
  (`apps/dashboard/src/screens/servers-screen.ts`) offers no chooser, its one column beside the
  buttons holding several facts together — **DECIDED (owner, 2026-09-29): leave it**, unsplit and
  with no chooser; (3) nothing checks that a NEW dashboard table offers the chooser; (4) where a
  screen keeps its search and filters outside the table (staff, card readers) or the table has none
  (alerts), the Customise icon button sits alone on a row above the table rather than
  beside those controls — moving a screen's own controls into the table's toolbar would fix it;
  (5) the read-only tables a few screens draw as plain HTML tables rather than `wt-data-table`s have
  no chooser: planned against actual (`apps/dashboard/src/screens/planned-actual-screen.ts`), the
  four report tables on the sales screen
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), the overdue table on the overview
  (`apps/dashboard/src/screens/dashboard-overview-screen.ts`) and the top-sellers table both of
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`); (6) the printers screen's
  view keys (`printers:agents`, `printers:table`, `printers:jobs`) are the only dashboard view keys
  that use a colon and lack the `waitron.` prefix — cheap to rename until a venue is live; (7) the
  Departments and zones list (`packages/venue-service/src/dashboard/departments-list.ts`) offers no
  chooser — **DECIDED (owner, 2026-10-15, A718): no chooser**.

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

## The form plumbing is hand-written per form

  (4) the form plumbing is hand-written per form: assembling the bottom message, waiting for the
  render and then calling `focusFirstInvalid`, and the state that remembers the first press and
  which refusals the person has since changed, in several different shapes across `apps/dashboard`,
  the image library, the Stripe and SumUp forms, adjustment reasons in Venue settings,
  Departments and zones, and the till's forms. A dashboard-only helper could live in
  `apps/dashboard/src/widgets/form-fields.ts`, but `packages/media` cannot import from
  `apps/dashboard` (it would be a dependency loop), so a helper meant to cover the module screens
  and the image library too would have to live in a package they can all reach, such as
  `@waitron/ui`;

## The image picker's error message is not read to a screen reader

  (5) the image picker's error message is not read to a screen reader:
  `apps/dashboard/src/widgets/section-details-form.ts` puts `aria-describedby="section-image-error"`
  on the `dashboard-image-upload` host, and an id outside a shadow root describes nothing inside it
  (`docs/developers/design-system.md` → Forms); the Choose image button inside it carries
  `aria-invalid` and takes focus, so a screen reader hears "invalid" with no reason. Since A200 the
  product editor's photo button (`apps/dashboard/src/widgets/product-editor.ts`) has the same
  defect: it carries `aria-invalid` and takes focus, while the reason is a `data-test="image-error"`
  line in the editor's own shadow root that nothing points to;

## What C47 part 2 found and did not fix

  Found during C47 part 2 and not fixed: (a) a refused save of a venue service setting that saves at once shows twice,
  beside the control and at the top of the panel (`render`,
  `packages/venue-service/src/dashboard/service-settings-panel.ts`), and the cases in
  `packages/venue-service/src/dashboard/service-settings-panel.test.ts` pin both;
  (b) `wt-switch` cannot be marked invalid, so a server refusal of an adjustment reason's
  note-required switch would show its message but move focus nowhere — though the server refuses
  `noteRequired` only when it is not a true/false value (`requireFlag`,
  `packages/adjustments/src/routes.ts`) and the screen always sends one from its switch, so the
  refusal is not expected from this screen; (c) in a screenshot of a `wt-modal` editor after a
  refusal that names no field, a blue line runs along the top of the footer, which looks like the
  modal's scrolling body showing a focus ring — not traced, and not checked against `main`; an
  observation from the implementer's session.

## Request refusals that still land in the bottom message, or under a field in generic words — OPEN (left by C54, #853).

- **Request refusals that still land in the bottom message, or under a field in generic words —
  OPEN (left by C54, #853).** In the forms C54 surveyed (the dashboard, the setup wizard, and the
  adjustments, venue-service and media module screens) it kept the action working after a request's
  refusal and put a refusal naming a shown field under that field. What it left:
  (1) the product editor and the venue operations editors put a refused field's message under it in
  their generic words (`editor.field_rejected` in `apps/dashboard/src/screens/catalogue-screen.ts`
  `#rejectedField`; `venue.field_refused` in
  `packages/venue-service/src/dashboard/venue-operations-screen.ts`), not the refusal's own
  sentence;
  (2) controls with no place for an error keep their refusal in the bottom message — `wt-switch`
  (`active` on the ingredient, extras and options forms; `available` on the product
  editor), the allergen and dietary-origin pickers on the ingredient form, and the purchase form's
  VAT regime select;
  (3) refusals naming two fields or a row the refusal does not number stay at the bottom:
  `purchase.duplicate` (supplier tax id and invoice number), a purchase line's rate, base, tax or
  type,
  `provisioning.duplicate_series_code` and `territory_country_mismatch` on the setup venue screen;
  (4) on the backup screen, read and not run: a refusal other than `backup.request_invalid` that
  `#onApplyRefused` (`apps/dashboard/src/screens/backup-screen.ts`) neither puts under a field nor
  lists in `FORM_REFUSALS` still shows in the page banner; Turn on backups stays disabled before the first
  press until the key is saved — the same shape as (7) (seen by running, in the Codex run-it review
  of C63); the saved-it tick and the weekday ticks carry no `name`; Enter submits from the folder and
  bucket fields but not from the pasted key, the backup time or the retention boxes
  (`submitOnEnter`, which design-system.md → "Submit ordinary forms with Enter" asks for and
  `stream-settings-panel.ts` binds on its whole form); and no test covers only the second box being invalid, or where
  focus lands after a failed check on the Save form;
  (5) FIXED (A310): the closed phone drawer no longer shows in the page's 24 px margin;
  (6) the setup live-source screen's refusals go through a catch-all in
  `#onConfigurationRequested` that drops the code, so a wrong passphrase cannot be placed under its
  field;
  (7) the profile screen opens with Save disabled when required details are missing — the form's
  own check, before any press (also point (3) of the entry above);
  (8) on the add-person and edit-person forms `profile.invalid` reads "Check your profile details",
  which is about someone else's details there;
  (9) after a refusal under a field the bottom message still reads "Correct the highlighted fields to
  continue" while the action works — kept as it was;
  (10) the bookings form was not in C54's survey (read, not run): a save refusal becomes the
  screen's `errorKey` (`packages/bookings/src/dashboard/bookings-screen.ts` `#onCreate`/`#onUpdate`)
  and shows as a paragraph on the screen outside the dialog, never under a field — including those
  naming one, `management.request_invalid` with a `field`, `booking.invalid` with `partySize`, and
  `table.not_found` with `tableId` for an inactive table (`table.inactive` comes only from
  seating); the form's Save is disabled only while a save is in flight (`busy`), so no refusal
  disables it, and its own check shows one paragraph in the dialog rather than a message under the
  field; and the payment-provider forms were not in C54's survey either (read, not run): the
  connect and add-reader forms in `packages/payments-stripe` and `packages/payments-sumup`
  (`stripe-connect-form.ts`, `stripe-add-reader.ts`, `sumup-connect-form.ts`, `sumup-add-reader.ts`)
  put a refused request's message in the bottom message, except that Stripe's add-reader dialog
  puts `reader.reference_unknown` under its Reader ID field (A519) and SumUp's connect form answers
  a key spanning several merchants by showing a merchant picker; none of them disables its action
  on a refusal;
  (11) the backup screen's configuration export drops the refusal's code in a catch-all
  (`apps/dashboard/src/screens/backup-screen.ts` `#exportConfiguration`), so a
  `management.request_invalid` naming `passphrase` would read only "The configuration export could
  not be created." at the bottom — read, not run, as unreachable from this form, because the client
  refuses a passphrase shorter than 12 (`MIN_KEY_LENGTH`) before sending and the server's check is
  the same `length < 12` (`apps/server/src/configuration-export-api.ts`).
  **Next action:** the owner says which of these are worth doing.

## Every login failure is one answer (C95, #930, owner decision 2026-09-30)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — the rule is in
  CLAUDE.md §3 and `docs/developers/conventions-ui.md`. Kept on purpose, each reachable only after a
  credential was proved: `totp.required` (the dashboard's code step, after a right password),
  `google.second_factor_required` (after a valid Google sign-in), `authorization.not_permitted`
  (right credentials, a role without the permission) and the adjustment approver's
  `adjustment.approval_required` for a right PIN whose role is too low; a signed-in person's
  re-check of their OWN password or code (`profile.ts`) still names the field. Still open:
  - The membership route, the adjustment approver, the refund override and the manual-refund
    confirmer have no one-answer test case of their own.
  - Refusals thrown in `apps/server` itself (a malformed id or PIN) carry no `reason`.
  - After a refused login the setup wizard's Connect form leaves the cursor where it was (an
    existing test pins that), while Reset and the dashboard sign-in move it to the password; the
    owner's rule covers marking fields, not the cursor, so whether Connect should match is the
    owner's call (left by A153, #952).
  - The password throttle (A154, #977): a real address with 4 wrong tries, once forgotten, comes
    back with a fresh count if a made-up address with 5 wrong tries lands on its counter (measured
    by simulation; the figures are in #977's description). The PIN back-off
    (`packages/identity/src/pin-throttle.ts`) still refuses every new person for 60 seconds while
    one of its slots is full, fed by paired tills and signed-in routes rather than strangers.
  - Password-reset timing (A147, #942; A159, #986): the real mail-server conversation, which only a
    known address starts, was not measured, and no way to match it was tried. Nothing pins that the
    unknown-address decoy (`writeAndRemoveDecoyAction`, `packages/identity/src/account-action.ts`)
    runs the same statements as a known address: its read, its dead-link delete and its retire
    change no row, so deleting any one of them left the suites green; only a timing script (not in
    the tree) shows them. A copy of the database is not unchanged by a decoy: with `secure_delete`
    at 0 a reviewer found the decoy's random person id and token hash still in the file's bytes
    after commit and checkpoint. It follows, though it was not separately measured, that a copy can
    show that, and when, an unknown-address request happened — not for which address, since the
    row's values are taken from no part of the address (read from the code, not measured).

## The profile's "Current password" fills the signed-in person's saved password (C98, #934) — still open:

- **The profile's "Current password" fills the signed-in person's saved password (C98, #934) —
  still open:** the sign-in page keeps its three inline copies of the hidden username field
  (`apps/dashboard/src/screens/login-screen.ts`); moving them onto the `autofillUsername` helper
  (`apps/dashboard/src/widgets/autofill-username.ts`) needs at least a `name` parameter (the
  sign-in page's tests pin `email`; the profile's field is named `username`), the
  `data-autofill-username` hook those tests find the field by, and a decision about an empty email,
  for which the helper renders nothing while the sign-in copies always render. Also unknown: which
  browser and address the owner saw the empty field in. The payments screen's manager-PIN prompt
  now says `autocomplete="off"` (owner, 2026-09-30, C110 #940); nobody checked in a real browser
  whether it then stops offering the dashboard password there.

## A new passkey is listed under the person's email, with their name as its display name (C99, #939) — still open:

- **A new passkey is listed under the person's email, with their name as its display name (C99,
  #939) — still open:** the result has not yet been seen in a password manager. The dashboard calls
  `PublicKeyCredential.signalCurrentUserDetails`, where the browser has it, after every sign-in and
  after a passkey is added or removed (C101), but not after the email or display name is changed on
  the Profile screen; nobody has yet seen whether a real password manager then shows the new names.

## The passkey list says when each passkey was last used and which password manager holds it (C100, #945) — known limits:

- **The passkey list says when each passkey was last used and which password manager holds it
  (C100, #945) — known limits:** neither the "Last used" behaviour after a passkey is deleted in the
  password manager nor the password-manager naming was tried with a real browser (the tests stand in
  for the WebAuthn library). A browser following the older WebAuthn Level 2 rules zeroes the
  authenticator identifier under `@simplewebauthn/server`'s default "none" attestation preference,
  which Waitron does not override, and the passkey then shows no password manager. The names are a
  snapshot of the community list at github.com/passkeydeveloper/passkey-authenticator-aaguids
  (commit `3ff200d`, fetched 2026-09-30), names only; that repository states no licence, which is
  recorded at the top of `packages/identity/src/passkey-providers.ts`. Nothing refreshes it, and
  security keys such as a YubiKey show no name, because the FIDO Alliance's metadata was not copied.

## The browser's password manager is told which passkeys Waitron still accepts (C101, #948) — still open:

- **The browser's password manager is told which passkeys Waitron still accepts (C101, #948) —
  still open:** not observed in a real password manager — the tests replace the browser's methods,
  and Chrome's feature entry says it acts "Initially ... only for Google Password Manager (GPM)
  credentials", which a test browser does not hold. The browser's own methods are called directly
  rather than through `@simplewebauthn/browser`'s `sendSignal()`, which adds only renamed errors and
  throws where a method is missing. Left open from the review, both predating C101: a suspended or
  pending person's passkey is refused before the signature check and an active person's bad
  signature after it, so the two do different work — whether that can be timed from outside was not
  measured; and an expired sign-in challenge answers its own `passkey.challenge_expired`. Not taken:
  after a passkey is added or removed, the Profile screen makes one request more than it needs (the
  signals read beside the profile reload); folding the signal data into the profile response would
  remove it.

## A403 — sign-in and passkey fixes (owner, 2026-10-08; open; low priority; not queued — owner 2026-10-08: take it from here when a lane has room):

- **A403 — sign-in and passkey fixes (owner, 2026-10-08; open; low priority; not queued — owner 2026-10-08: take it from here when a lane has room):**
  1. **Remove the passkey name field.** Each passkey already shows which password manager holds it
     (C100, #945), so a name typed by the person is no longer needed. The field is in two places:
     the Add passkey dialog on the Profile screen (`apps/dashboard/src/screens/profile-screen.ts`)
     and the one-time passkey offer after a password sign-in
     (`apps/dashboard/src/screens/login-screen.ts`). Both go, with the 80-character check in
     `finishPasskeyRegistration` (`packages/identity/src/passkey.ts`). When nothing is typed, the
     server already stores the password manager's name as the passkey's name
     (`passkeyProviderName`), and the list falls back to "Passkey N" only for a password manager it
     does not know. Whether the stored name column stays, holding that password manager name, or
     goes is the implementer's call; nothing is live, so no existing names need carrying forward.

  Added by the owner, 2026-10-14, from screenshots of Profile → Security:

  2. **Add passkey belongs to the Passkeys row.** Today it is a solid blue button at the end of the
     tab bar, beside "Your details" and "Security". Move it onto the Passkeys heading line, on the
     right where Change and Set up sit on their rows, and draw it quiet (outlined) like them. It
     stays on the heading line when passkeys are listed, with the list below it.
  3. **The Passkeys row has no space under it.** With no passkeys, the divider sits directly under
     "You haven't added a passkey yet."; every other row has padding above and below its text.
  4. **Say what the passkey's date is.** A listed passkey reads "Google Password Manager ·
     14/10/2026" over "Never used": the second line is labelled and the date is not. Label it as
     the date the passkey was added.
  5. **The Add passkey dialog's button says "Save"; make it "Add".**
  6. **A message box was cut off at the top-right edge of the window** in the same screenshot —
     only its first letters showed. Not yet known whether it is a notification placed partly
     off-screen or only a narrow window; reproduce before fixing.

## Review every permission: fewer, coarser, and consistently named

- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). Since
  A494 (2026-10-11), `catalogue.manage` (manager and above, the roles that hold `person.manage`)
  gates the catalogue, units and content languages; the "VAT class for new products" default is set
  under `venue.configure` (owner, 2026-10-16, A755). Input
  since C128 (#1031): `sale.take_payment` gates every till payment route and is held by every role,
  staff included, chosen so nobody lost the ability to take payment; the review decides who keeps
  it, and whether to rename it — it is the only permission whose action is two words (a reviewer
  suggested e.g. `payment.take`). The list in
  `packages/identity/src/permissions.ts` has grown one permission per action, and the owner finds it
  too fine-grained: one permission such as `node.manage` might cover what `mirror.create` and
  `node.promote` split today (adding a machine, promoting a standby and, since #708, removing a
  standby that never finished joining all use one or the other). Machine permissions are to be named
  `node.*`, not `mirror.*` — the owner's preference. The review should propose the whole list: which
  permissions to merge, the names, and which role holds each, and then rename the call sites in one
  change. **Renaming is allowed now:** the file's header says permission ids are "never renamed once
  shipped", but a search (2026-09-26, reading, not running) found them stored nowhere — the database
  stores a person's ROLE (`packages/identity/src/schema/persons.ts`), and the names appear only in
  code the box itself serves — and the pre-production rule (CLAUDE.md §3, no
  backwards-compatibility code until a venue is live) covers the rest. The review should confirm that
  by running it, then drop or narrow that header sentence. **Do it before the editable-roles item
  below** (owner, 2026-09-26): once an admin can make roles and give them permissions, the stored
  roles would name their permissions (the roles design is not written yet), so a rename after that
  has to rewrite those rows as well.
  **Restated by the owner 2026-10-02: "review all permissions and the roles they're assigned to"** —
  the review covers BOTH halves: every permission, and which of the built-in roles holds each. Two
  role questions from that morning's dashboard Orders screen answers (B27s, lane C questions.md
  2026-10-02 ~09:40 and ~09:50) belong in it: the staff role holds no `report.view`, so the Orders
  screen gave staff a narrower view of their own (unfinished bills plus today's finished ones) rather
  than the permission deciding; and `print.resend`, held only by managers and admins, was the name
  that first came up for the dashboard's DUPLICADO copy until it was settled that the copy uses the
  till copy's own permission — two permissions for one kind of print is a merge candidate.

## Roles are something an admin can add and edit; the four built-ins are only defaults

- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, restated 2026-09-28: "especially because I want roles to be definable by the
  customer"; design not written). Detail under
  [Roles the admin can edit](../backlog/dashboard.md#roles-the-admin-can-edit-a7): the ladder question decides the
  schema. The dashboard's role lists (the add-person and edit-person forms and the Staff screen's
  role filter) sort by the displayed name in the current language (`rolesByName`,
  `apps/dashboard/src/i18n/domain.ts`), so a custom role's name would take its place among them; the
  adjustments module's reasons screen sorts its two role dropdowns the same way with its own copy of
  the `Intl.Collator` options. Its client-side seniority check keeps a separate ordering; the roles
  design still needs to decide where custom roles belong in that check.

## Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order says so

- **Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order
  says so** (owner decision 2026-09-12). **`wt-select` is retired** (owner, 2026-10-02): `wt-combobox`
  is the one dropdown (A178b–f). Still open:
  `wt-combobox` does not sort its options, and `compareLabels`
  (`packages/shared/src/compare-labels.ts`, used by `wt-data-table`) builds its `Intl.Collator`
  with no language, so it sorts in the default language of whatever runs it — in `wt-data-table`,
  the browser's. It should sort in the signed-in person's chosen language (owner, 2026-10-17): the
  order differs, since Node's `Intl.Collator` puts "Ñoquis" between "Nísperos" and "Nuez" in
  English, and after "Nuez", before "Olivas", in Spanish.

## Shared database-backed table paging, search and sorting

- **Shared database-backed table paging, search and sorting** (owner decision 2026-09-12; users
  first). 50 per page with a server-enforced maximum; search and sort over the whole dataset; debounce,
  reset on filter change, ignore superseded responses, keep passive live refreshes.
  Since A737 Part 1 (#1778), `wt-data-table` takes `serverPaging` and emits `wt-query-change`
  (search text, sort and filters) and `wt-page-change`; only the till's find-bill screen
  (`apps/till/src/screens/till-find-bill-screen.ts`) uses them, and no dashboard table does yet.

## Typed values are only partly checked — a generic phone-format check landed, a country-specific one has not.

- **Typed values are only partly checked — a generic phone-format check landed, a country-specific
  one has not.** `isValidTelephone` in `@waitron/shared` runs on both the browser forms and the
  server write paths (`person.telephone_invalid`), and a number is kept exactly as typed. Still open:
  the country-pack seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) is still not
  called, so a Spanish mobile that fails the national rule but passes the generic one is still
  accepted; other typed fields (email aside) are still unchecked; the tax identifier stays fiscal.
  Confirm with owner: an existing malformed number now blocks an otherwise-unrelated edit, because
  both forms re-validate the telephone field on every submit.

## Secret checks and the write lock: the PIN, manager-login and profile checks moved — DONE (W1, #1117); two blocking derivations and one stale-answer window remain OPEN

**Secret checks and the write lock: the PIN, manager-login and profile checks moved — DONE (W1, #1117);
two blocking derivations and one stale-answer window remain OPEN.** Nothing makes a NEW route
derive its key before the transaction opens or take turns (`docs/developers/conventions-data.md`).
**Still open:** `hashSecret` derives with `scryptSync` (`packages/identity/src/secret-hash.ts`), so minting a token or setting a PIN or
password stops the event loop. The `deriveKey` callers are tracked under
[The box](box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives). Left by #912's review: the two join-status
readers answer from a hash read just before the key is derived, so a request denied or revoked in
that window can get one stale `pending` or `approved` (both routes return only `{ status }` and issue
no credential; the till and print-agent clients were not traced); and `verifySecretAsync` could be
renamed `verifySecret` (optional).

## Ongoing — the dashboard UI overhaul, screen by screen

**Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
shared look, and the rules for it live in [design-system.md](../developers/design-system.md). That
document is the contract, and it grows as we go: each screen tends to raise a question the rules do
not answer yet, and the answer is written down there in the same change rather than left in the
screen. It is screenshot-driven iteration with the owner looking at each step, not a
write-a-plan-and-dispatch job.

Still to do, roughly in the order a venue meets them. As each one lands, add the rule it taught to
`design-system.md`:

1. **Overview and Sales** — `dashboard-overview-screen.ts`, `dashboard-sales-screen.ts`.
2. **Catalogue and product depth** — `catalogue-screen.ts` and `purchases-screen.ts`. The
   owner-requested Products overhaul has landed ([operator guidance](../../apps/server/src/guide/en/products.md)). One question
   hangs over it: the existing zero-rate class is shown as **No tax (0%)**, and asesor Q20 asks
   whether any intended case legally needs N1 or N2 instead — to be answered before the first live
   filing (the #345 entry below).
3. **Printing** — `printers-screen.ts` with its agent tabs, Prep stations' station editor, Add
   station dialog, and department/zone Receipt cells. A261 step 8 retired Printing rules; review the surviving
   screens against the rules before changing them.
4. **Payments** — `payments-screen.ts` and the provider panels in `packages/payments-stripe` and
   `packages/payments-sumup`. #333 changed only their row menus.
5. **Devices and displays** — `devices-screen.ts`, `device-profiles-screen.ts`, `floor-screen.ts`,
   `kitchen-screen.ts`, `service-status-screen.ts`.
7. **Workforce** — `my-schedule-screen.ts`, `planned-actual-screen.ts`,
   `approvals-screen.ts`.
8. **Venue operations and bookings** — `packages/venue-service/src/dashboard/` and
   `packages/bookings/src/dashboard/`. #333 touched only the venue-operations row menu.
9. **Operator utilities** — `backup-screen.ts`, `diagnostics-screen.ts`, `email-screen.ts`.
10. **Login** — `login-screen.ts`, which already carries the owner's own review from 2026-09-09
    (CLAUDE.md §3, the `ui-login` findings). Fold those corrections in rather than restyle it twice.
    A191 (#1074, 2026-10-03) put every sign-in step in a card; the email, password, passkey and Google
    steps put their own way in outside the action row (design-system.md, login section). Since A228
    the Google step's is Google's own button, not a primary one.

The till (`apps/till`) and the setup wizard (`apps/setup`) are separate apps drawing on the same
shared components. Whether they follow in this pass or later is open — decide it before the
component rules harden around the dashboard alone.

## Open, and it bites this work first: two documents state the component rules and they have drifted

**Open, and it bites this work first: two documents state the component rules and they have
drifted** (found by the #337 review). `design-system.md` binds the token rule to "any component or
view" and its forbidden-colour list omits `color()`; [conventions-ui.md](../developers/conventions-ui.md)
records what the guard mechanically enforces, which is narrower —
`packages/ui/src/no-hardcoded-chrome.test.ts` globs `packages/ui/src/components/*.ts` only — and
its list does include `color()`. **Next action:** decide whether the token rule binds views as well
as components, then make the guard and both documents agree. Whoever picks up the next screen should
settle this first, because every screen after it inherits the answer.

## Also open, and product-wide: the primary blue fails the accessibility contrast bar as text on the page background, in the light theme

**Also open, and product-wide: the primary blue fails the accessibility contrast bar as text on the
page background, in the light theme.** Light `--wt-color-primary` (`#1f6feb`) on `--wt-color-bg`
(`#f7f7f8`) is 4.33 to 1, under the 4.5 to 1 WCAG AA minimum for normal text
(`packages/ui-core/src/tokens/colors.css`). The dark theme is fine (`#4c8dff` on `#101216`, 5.86 to
1), and so is the same blue on a card or modal surface (4.63 to 1 on white). The `*.a11y.test.ts`
suites run axe's full default ruleset, but axe only sees a pairing some mounted component paints;
nothing enumerates the tokens against each other. **Next action:** an owner colour call — darken the
light theme's primary until it clears 4.5 to 1 as text, or rule that the token is never text on the
page background and add a check that says so.

## The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25)

- **The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25).**
  Safari was not tried, so what it draws with no colour chosen, and whether the ring and the
  rim-free fill hold there, is unknown; and whether choosing black in the browser's picker from the
  no-colour state registers was not run. With a palette colour chosen, the Custom square shows that
  colour too, beside the ringed swatch (pinned in `apps/dashboard/src/widgets/color-field.test.ts`,
  "fills the Custom square right up to its border while a palette colour is chosen"). **Next action:** try
  the first in Safari or Playwright's WebKit, and the second by hand in Chromium.

## Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03 while checking lane A's W18) — OPEN

**Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03
while checking lane A's W18) — OPEN.** While its read is failing, Payments still says "No card
readers yet." under an empty table, and Cloud services says "Checking Cloud connection…" under the
failure message; the same on `main` before W18. It is the kind of empty-state text W18 removed from
Roster and Planned vs actual.

## The dashboard's dark wordmark looked nearly black (A253 observation, 2026-10-09)

The final live A435-1 catalogue captures at
`a68dc2188`, with the dashboard forced to the dark theme, showed a nearly black wordmark.
The browser's `prefers-color-scheme` was not measured, so the cause is **UNVERIFIED**.
**Next action:** measure the browser's media preference and the selected `<picture>` source
against `data-wt-theme` in the live dashboard before deciding a fix.
A366-4B's 2026-10-09 sidebar captures also show a dark wordmark with the root and fixture host
set to the dark theme. The media preference and selected source were not measured there either.

## A form's Save stays quiet and disabled until something changes (A331, owner 2026-10-07)

**A form's Save stays quiet and disabled until something changes (A331, owner 2026-10-07) — BUILT: batch 1 in #1391; batch 3a in #1401; batch 3b in #1415; batch 4a module forms; batch 4c (two
venue-service forms and the till's profile dialog) in #1418; batch 5 (the till) in #1414; batch 6 audited with no
stored-setting editors; batch 7 unreserved forms audited; batch 2a landed as #1422; batch 2b
(the menus screen) landed as #1424; batch 4d (preparation stations) in #1426;
batch 7b's re-run inventories done; batch 4b (Departments and zones) built; the re-check after A366
slice 7 found no form missed (A487d, 2026-10-11).** The owner:
"open a form with the Save button transparent (and disabled?). but as soon as you make a change,
make the Save button active/blue",
then "this should be global". A form that saves opens with its main action (Save, Add…)
disabled and drawn in the same quiet style as Cancel; the first real change turns it blue and
pressable, and undoing the change turns it quiet and disabled again. "Changed" is what the form's
unsaved-changes tracking (W69) already says, not a comparison written per screen. The rule, and
how a screen adopts it: [design-system.md](../developers/design-system.md) → Forms. The plan, one pull
request per batch: [plan](../superpowers/plans/2026-10-07-a331-save-follows-changes.md).

- **Batch 1 — the shared mechanism, the product editor and the variant form.** `draftScopeFor` and
  `saveActionState` in `@waitron/ui`. Enable on a disabled product saved at once: pressing
  it was the change. (2026-10-09, A435-1: products archive permanently and Enable is removed.) No batch-1 form opens already savable. Looked at on 2026-10-08 in 35
  screenshots of the two forms mounted with test data (English and Spanish, light and dark,
  1280px and 390px wide, unchanged and after one edit, plus a changed form refused by its own
  checks and a disabled product), kept outside the repository in `~/waitron-campaign-b/a331-shots/`:
  no defect found. In the same mount, the first screen frame after `closeSaved` (what the
  Products screen calls once a save succeeds) already has the product editor closed, so its Save
  is not seen turning quiet as the dialog goes.
- **Batch 2a — LANDED as #1422 (A331-2a, 2026-10-08).** The catalogue and menus forms
  that lane D's menus Preview work does not touch: the "VAT class for new products" default on
  Venue settings, the recipe editor and the ingredient form, the unit form (new and existing), the
  options list and its option window, the extras list, Add to menus after a product is created, a
  section's Add products, and a menu's Schedule and Change time on its Preview tab (list:
  [design-system.md](../developers/design-system.md) → Forms). None of them opens already savable,
  except the option window when it opens showing a refusal (A410, below).
  Rulings put to the owner, with the answers:
  - the Units screen's Change unit (in the "unit in use" dialog), the Products browser's Move and
    Delete dialog and the image picker are not saves, so they are not gated. Change unit already
    stays disabled until products and a new unit are chosen; Move already stays disabled until a
    destination is chosen, and kept its blue look while it was disabled (owner, 2026-10-08: "Fix
    it" — A409 draws it quiet while it waits, see design-system.md → Forms); Delete is pressed with its
    default choice of what happens to the contents; the image picker acts the moment an image is
    chosen or removed. Gating Change unit would change only how it looks. **Left open by A409
    (#1433), for the owner — decided:** other buttons that are not saves still kept their colour
    while disabled and waiting — the Products browser's toolbar Delete, the options/extras Delete
    confirmation, Add and Edit on the options screen until languages load, Print on an equipment
    label and on a reprint, and two on the till. Owner, 2026-10-08: "b", draw them all quiet the
    same way. A416 did the dashboard ones, and also the profile window's Edit and the backup key's
    Change the key. **Landed as #1440.** A417 did the till's: eight buttons, listed in design-system.md → Forms. **Landed as #1496.** **Left open by
    A416, for the owner — decided:** buttons disabled because their row's own state rules them out
    still kept their colour — Disable on an already-disabled printer and on an inactive service
    status, Publish on a menu's Preview while it has clashes, and the product editor's modifier
    Remove while a window opened from it is still open. Owner, 2026-10-08: "a", draw them grey too;
    A427 does those four, and Remove keeps its red while the editor's own save is being sent.
    **Landed as #1446.** Delete on a canvas's last tab is left as it is, because canvases are
    being deleted (A182, owner 2026-10-08);
  - when the server refuses an options list's save because of one option, opening that option's
    window afterwards shows the refusal. Owner, 2026-10-08: "Keep Save active" — A410 opens that
    window with Save active, and pressing it untouched gives the option back to the list, which
    clears that option's refusal; the window opened any other way still opens quiet. **Landed as
    #1434.** Left as built, for the owner: Save turns active only for a refusal the window holds
    when it OPENS — one handed to it while it is already open leaves Save as it was (believed
    unreachable, from reading only: the list's own Save sits behind the open window) — and it stays active
    for the whole time that window is open, even once the refused field is edited back;

  Looked at on 2026-10-08 against the demo venue in Chromium (English, 1280px, light, each form
  unchanged and after one edit; the catalogue default also after a save; the extras list, the
  options list with its option window, and the catalogue default also at 390px, dark, Spanish);
  screenshots in `~/waitron-campaign-b/a331-2a-shots/`. The recipe editor, the ingredient form, Add
  to menus (including after one place refused the product) and Schedule and Change time were
  looked at mounted with test data instead: the recipe screen that holds the first two is reached
  from nowhere in the dashboard, Add to menus only opens after creating a product, and no demo menu
  had unpublished changes to schedule. Every form opened quiet and disabled and turned blue on the
  first edit, and the unit form, the option window, the options and extras lists and Add products
  went quiet again when the edit was undone: no defect found. The look changed the demo venue's
  "VAT class for new products" and set it back to Reduced, and switched the demo owner's language
  to English and back to Spanish; it saved nothing else. Left open: an edit typed BEFORE one of
  these forms is taken out of the page and put back stays on screen but no longer counts as
  unsaved: measured 2026-10-08 on the unit form, the same before and after this batch's fix; the
  other forms were not tried, and the recipe editor clears its choice on removal by design. It
  matters only if a screen ever moves an open form. DONE for the unit form in A397 part 2 (#1439): its
  edit-first case in `catalogue-forms.unsaved.test.ts` failed before the fix and passes after.
  Still untried: the ingredient form, the options list and its option window, the extras list,
  Add to menus, Add products, Schedule and Change time.
- **Batch 2b — LANDED in #1424 (A331-2b, 2026-10-08).** The menus screen: the menu details
  form (new and rename) and the section form (new and edit), which are one form mounted twice, and
  an include's Edit dialog. Each opens quiet, turns blue on the first edit, goes quiet again when
  the opened values are typed back or a save is committed with it still open, and sends nothing
  when an untouched Save is pressed. Not a save, so not gated: Include a menu, the
  home display's slider and radios and the menu price fields write at once; Delete section and
  Publish confirm an operation; the rest open a form or only show (list:
  [the Batch 2b table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-2b--the-menus-screen-and-the-preview-bundles-files-lane-c-a331-2b)).
  The Add products window and the publication schedule do save; they are batch 2a's. The Home
  page tab's shortcut window also saves: its Add follows the rule since A336.
  Test checks that pressed or asserted on an untouched form now edit first or expect Save
  disabled; each is listed in its commit message. Looked at on 2026-10-08 in 33 screenshots of the forms mounted with
  test data (each unchanged, after one edit, and changed but blocked — an emptied required name
  for the details form, busy for the include — at 1280px light English and 390px dark Spanish,
  plus an Edit section refused, fixed and saved), kept outside the repository in
  `~/waitron-campaign-c/a331-2b-shots/`: no defect found. Left open: both forms keep their fields
  when taken out of the page and put back, and take what they then hold as the new starting point.
  Run on the branch on 2026-10-08 (a throwaway case: edit, remove, re-add): the edit was still in
  the field, Save was quiet, and Cancel closed the form without asking; main was not run. Related
  to, but not the same as, the watcher form's point in batch 4c, where the edit was replaced when
  the form was put back (fixed in #1429). It matters only if the menus screen ever moves an open
  form. DONE for both forms in A397 part 2 (#1439): each one's edit-first case
  (`section-details-form.unsaved.test.ts`, `include-folder-form.unsaved.test.ts`) failed before the
  fix (not counted as unsaved) and passes after.
- **Batch 3a — LANDED in #1401.** The venue settings, service and people forms: the
  floor plan's table rows and Add table, the service-status rows and Create, the kitchen's late
  flags, the venue details editor, My schedule's cover and time-off requests, the receipts page,
  the backup turn-on form and settings editor, the bucket copy form, your profile's details and
  credential dialogs, the edit-person and new-person dialogs, the purchase form and the shift
  dialog (list: [design-system.md](../developers/design-system.md) → Forms). The backup settings
  editor opens already savable when the stored schedule is one the form cannot show, or no
  retention is stored. Looked at on 2026-10-08 against the demo venue in Chromium (English, 1280px, light, each form unchanged and
  after one edit; the floor, edit-person and backup forms also at 390px, in dark and in Spanish),
  plus the backup settings editor mounted with test data, because the demo venue has backups off;
  screenshots in `~/waitron-campaign-b/a331-3a-shots/`. Every form opened quiet and disabled (the
  backup editor over an interval schedule opened blue, as intended) and turned blue on the first
  edit; where a required field was still empty (the time-off dates, a cover request with no shift
  to offer, a shift's end time, the turn-on form's "I have saved this key" box) it stayed blue and
  disabled until filled. The action's size and horizontal position were the same before and after
  the edit in every pair measured; Add table was compared by eye. Left open:
  - a password manager filling the profile's current-password field: the owner tried Chrome's
    password manager on 2026-10-08 and reported that it works well; other password managers are
    untried;
  - other purchases-screen and staff-screen tests still send made-up create and
    update events (`create-purchase`, `update-purchase`, `create-person`, `save-person`) instead of pressing the form's button; they pass, but never prove the button
    works.
- **Batch 3b — LANDED in #1415.** Printers, devices, device profiles, payments,
  canvases: the print agent's Edit dialog, a printer page's name and connection editors, the
  calibration wizard, the Bluetooth printer Pair dialog, the Edit device dialog, the device profile
  editor, the card reader's Rename dialog, the bill attestation and the canvas editor (list:
  [design-system.md](../developers/design-system.md) → Forms). Opening already savable: the printers'
  name dialog, the calibration wizard when an add opened it (the campaign runner's ruling of
  2026-10-08, for the owner to confirm: a freshly added printer's wizard opens with a blue Save),
  the device pairing dialog, each row of "Add a card reader", the canvas Duplicate dialog, and a new
  canvas's editor. Looked at on 2026-10-08 against the demo venue in Chromium (English, 1280px,
  light, each form unchanged and after one edit; a printer's name editor, the calibration wizard and
  Edit device also at 390px, dark, Spanish); screenshots in `~/waitron-campaign-b/a331-3b-shots/`.
  Every form reached opened quiet and disabled and turned blue on the first edit; the connection
  editor, Edit device and the profile editor went quiet again when the stored value was typed back;
  the savable ones (the name dialog as Add and as Enable, the wizard after a fresh add and after a
  re-add, Duplicate, a new canvas) opened blue. The demo venue has no card provider connected
  (connecting one takes an API key), and no device asking to pair was made on the shared venue, so
  "Add a card reader" (four readers), Rename reader and the pairing dialog were looked at mounted
  with test data instead; "Add a card reader" now shows a blue Add on every row, as the printers'
  discovered rows do. Not looked at, left to their tests: the Bluetooth Pair dialog (the laptop's
  print agent has no `bluetoothctl`) and the bill attestation (the demo venue showed no payment to
  attest). Seen and not changed, because this batch does not touch them: the canvas Create and
  Duplicate dialogs have no Cancel, and Duplicate's name field is too narrow to show "A331 look
  canvas (copy)" whole; the printer name dialog is titled "Add a printer" when its button says
  Enable. The owner confirmed #1415's Bluetooth Pair dialog and bill attestation rulings: both
  are gated like a save and open with every required field empty. **A396 — DONE (#1428, 2026-10-08).**
  The owner reversed the disabled-zone ruling on 2026-10-08.
  A device profile with no active allowed zone shows its field errors and bottom correction
  message on open. Save stays quiet while unchanged, and a name or reader edit cannot save until
  an active zone is chosen. Focused Chromium checks: 226 pass; fiscal golden and inmutabilidad: 20 unchanged pass.
  EN/ES, light/dark, 390/1280 views inspected; Claude review found no bugs. Current-head
  dashboard CI passed 9,544 tests with coverage above its required thresholds; root guards,
  types, licence and CodeQL passed. The merge's own CI is recorded in the lane ledger for
  follow-up. The look left a switched-off printer
  named "A331 look Epson" (the owner's Epson at 192.168.10.81) in the shared demo venue.
- **Batch 4a — DONE (A331-4a, 2026-10-08).** Adjustment reason create/edit and bill-discount limit,
  booking create/edit, and image upload/names edit use the shared Save gate. Stripe Connect/Add
  and SumUp Connect/Pair/Try again remain provider operations;
  [classification and call paths](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4a--module-forms-lane-e-a331-4a).
- **Batch 4b — Departments and zones.** Audited after A366 slice 1 (#1460): Station hours and the
  Opening hours forms already follow the rule, and the menu timetable screen is gone. Departments
  and zones did not: its editor window (Add and Edit department, Add zone, Configure zone,
  Transfers) and its three inline name editors now open quiet and turn blue on the first edit; the
  inline Save and Cancel became `wt-button`s. Looked at on 2026-10-08 with the screen mounted with
  test data (English light 1280px; Spanish dark 390px with long names), screenshots in
  `~/waitron-campaign-b/a331-4b-shots/`: no defect found. A366 slice 6A replaces these inline editors
  with Rename dialogs, plus department Settings and zone settings, with Cancel before Save.
  Native keyboard-order checks are in
  `packages/venue-service/src/dashboard/department-dialogs.test.ts`; reconnect checks live in
  each replacement form's sibling `*.unsaved.test.ts`.
- **Re-check after A366 slice 7 — DONE (A487d, 2026-10-11), no form missed.** On main b1f76fdcc,
  every Save in `packages/venue-service/src/dashboard/` binds `saveActionState`: the department
  dialogs, department Settings, zone settings, named-day editor and copy, the opening hours day,
  week and zone-week Saves (whole week and one date), the period editor, the range dialog, the
  routing cell editor, the station editor, and the Prep stations Settings and New station forms.
  The other buttons there open a form, move between weeks or months, delete, enable or expand,
  and Service settings saves on each change with no Save. Each of those 16 Saves was made
  `primary` and enabled while unchanged, one at a time, and its own test files run in Chromium:
  15 failed. The station editor's did not, because its own check that nothing can be sent
  (`nothingToSend`) keeps Save quiet and disabled whenever the draft is unchanged; deleting that
  check as well failed 7 of its 38 tests. Deleting only the unchanged early return in the range
  dialog's and department Settings' save handlers failed 1 and 4 tests.
- **2026-10-10, A366 slice 4 Part B:** the fallback editor and its checks below are retired;
  Settings retains rest-of-order and timing editors. The batch 4d account records its earlier scope.
  (2026-10-11: A507 part 1 removed the Settings tab; a station's three timings are edited in the
  station editor.)
- **Batch 4d — LANDED in #1426 (A331-4d, 2026-10-08).** Preparation stations' New/Rename, station printer
  choices, watcher Rename/follows/zones/pass/printer choices, and Settings rest/fallback/minutes
  use the shared Save state. An untouched fallback stays open without a confirmation or write;
  changing it keeps the two-press confirmation. Routing and station service operations remain
  immediate actions. After an invalid New station attempt, field messages and the bottom summary
  remain until corrected and return if a field breaks again. Retained Add/Rename drafts keep their
  saved baseline through reconnect. The delegated watcher form was already covered by batch 4c.
  [Batch 4d's scope and checks](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4d--prep-stations-lane-e-a331-4d).
  The review left detached `readOnly` changes and a retained table's scroll/sort unverified;
  no defect was reproduced for either. Before changing screen caching, exercise those transitions.
  The validation-message finding was reproduced and fixed before landing.
  (2026-10-10: A366 slice 4 Part A replaced the station's Rename, its printer choices and
  Settings' rest-of-order choice with the station editor; A366 slice 5 Part B removed the watcher
  editors with the Watchers tab.)
- **Batch 4c — LANDED in #1418 (A331-4c, 2026-10-08).** The local holiday Add and Edit and the watcher form
  (New and Edit) in `packages/venue-service`, and the till's profile dialog, whose Switch now waits
  until another profile is chosen — this closes the profile-dialog point left open by batch 5. A
  Switch with the current profile still chosen never reached the server before either: the app
  closed the dialog. Holiday Remove and Forget stay red confirmations and the holiday area saves on
  choice; [the Batch 4c table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4c--the-venue-service-forms-nobody-else-is-changing-and-the-tills-profile-dialog-lane-c-a331-4c)
  gives the call path for each. Looked at on 2026-10-08 in 13 screenshots of the forms mounted with
  test data in Chromium (the holiday Add and Edit, the watcher form's Edit and the profile dialog,
  each unchanged and after one edit at 1280px, light, English, plus the holiday Remove confirmation;
  the watcher Edit and the profile dialog also at 390px, dark, Spanish; the watcher form's New was
  not captured), kept outside the repository in
  `~/waitron-campaign-c/a331-4c-shots/`: no defect found. Left open from #1418's review, read but
  not run: if the watcher form is taken out of the page and put back, an edit typed BEFORE it left
  may be replaced by the stored watcher without a question (its `disconnectedCallback` forgets the
  draft's identity, so the next `willUpdate` starts it again); the till dialogs keep such an edit.
  The reviewer believes main behaved the same before #1418, which nobody ran either. It matters only
  if the prep stations screen ever moves the open form. DONE in #1429 (2026-10-08): the edit-first case failed on main (the edit was
  replaced) and passes with the fix; the form now keeps the record it opened and the value it last
  saved across removal.
- **Batch 5 — LANDED in #1414 (A331-5).** The till's five forms that save an edit: the party name dialog,
  the schedule's cover and time-off requests, the full invoice recipient dialog, the extras picker
  when it edits a line, and the station dialog's Make at. Adding a dish never waits for a change
  (the extras picker passes `savableAtOpen` when it adds), and the station dialog's Move keeps its
  own rule. Every other till dialog that tracks unsaved changes takes an action and is unchanged;
  the decision for each is in
  [the Batch 5 table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-5--the-till-app-lane-c-a331-5);
  the till's other forms wait for Batch 7's follow-up audit below.
  Looked at on 2026-10-08 in 24 screenshots of the forms mounted with test data in Chromium (each
  unchanged and after one edit at 1280px, light, English; the party name and the extras picker
  also at 390px, dark, Spanish; the invoice dialog pressed while incomplete), kept outside the
  repository in `~/waitron-campaign-c/a331-5-shots/`: no defect found. The extras picker's add
  mode and the station dialog's Move were byte-identical to screenshots of the code before the
  batch. Left open: the station dialog widens or narrows with the chosen station's name, so its
  buttons shift a little as a station is picked (it did so before this batch). Also left open from
  #1414's review: (1) the till's profile dialog — done in batch 4c; (2) the four batch 5 dialogs had to stop registering their draft while out of the page, or a
  reattached dialog stopped asking before discarding; design-system.md → Forms named seven
  dashboard forms that still registered that way, untested for the same fault. DONE for six of
  them in #1429 (2026-10-08): the staff edit and new person,
  variant, purchase and shift forms and the bookings form. Each one failed both cases on main (an
  edit made after the form is put back, and one made before it was taken out) and passes with the
  fix; the purchase and shift forms and the bookings form also replaced an edit made before
  removal with the stored values. DONE for the seventh in A397 part 2 (#1439): the product editor failed
  both cases before its fix (`product-editor.unsaved.test.ts`) and passes after. The same branch
  closed the unit form's edit-first point under batch 2a. Also seen in the purchase form's tests, not changed and not
  tried by hand: once put back with an edit, keyboard focus is outside the dialog, and Escape
  neither asks nor closes until focus is back on a field inside the dialog (the tests put it there
  with `focus()`; a click was not tried). Measured (`~/waitron-campaign-c/item-a397-measurements.md`,
  A397.2): after a put-back, focus is on the page body and the dialog is no longer modal; the
  measurements attribute this to how `wt-dialog` handles being put back.
- **Batch 6 — AUDITED (A331-6, 2026-10-08).** No setup screen edits already stored settings.
  Admin, venue and certificate Next buttons contribute to the provisioning draft; Connect adopts
  with credentials; Import stages configuration; reset, file/bucket/Cloud restore and provisioning
  confirmation/retry are operations. The other setup controls navigate, check status/readiness or
  open links. Existing actions keep their validation and refusal behavior. Per-screen call paths
  and the execution checklist: [Batch 6 audit](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-6--setup-stored-setting-editors-lane-e-a331-6).
  A future setup editor for stored settings must use the shared helper.
- **Batch 7 — AUDITED (A331-7, 2026-10-08).** No unreserved no-scope Save editor was found.
  Content-language/category-colour choices and course/category inline names save immediately;
  Add/Edit controls open forms or stage their parent's draft. Server recovery Retry and print-agent
  Save perform operations; the latter clears the token and restarts enrolment even with the same
  saved address. Existing behavior remains unchanged. The
  [audit and call paths](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-7--remaining-forms-and-string-pages-lane-e-a331-7)
  list each classification. **Batch 7b follow-up (A331-7b, 2026-10-08)** reran both
  inventories on the landed hardware, till, menu/home/Preview and invoice-foundation paths.
  No additional staged Save editor was found; existing Save gates, immediate price/display
  writes and the agent's unchanged-address enrolment retry remain as built. Canvas Create
  opens an editor before saving; Duplicate confirms its prefilled copy. The
  [dated follow-up and source receipts](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-7b--revisit-the-landed-reservations-lane-e-a331-7b)
  distinguish source inspection from the unchanged focused tests. The browser run also logged
  the ResizeObserver message. A407 (#1432) fixes the measured currency-field notifications;
  the historical catalogue-only warning was not reproduced.
  A396's disabled-zone profile ruling is
  done in #1428; A231q built the invoice screens separately (2026-10-12).
  **2026-10-11:** A435 step 6 prevents public hierarchy Delete from emptying ordering access.
  Existing invalid stored-scope validation still applies; this earlier A396 receipt remains historical.

## Service-status colour-field labels are clipped (found during W69, 2026-10-06)

**Service-status colour-field labels are clipped (found during W69, 2026-10-06) — OPEN.**
The native status colour fields show an ellipsis instead of the full label in the inspected
EN/ES service-status captures at 390 and 1280 px, both themes. The minimal-shell receipts are
`~/waitron-campaign-e/receipts/w69-status-rows-20261006/look/`; runtime reproduction on main is
unverified. W69 changes no field sizing. Next action: reproduce in Venue settings → Tables and
adjust the colour-field width using the shared field contract without changing status colour data.

## Text size after A179 (#988)

**Text size after A179 (#988).** The scale is 12 / 14 / 18 / 22px (sm / md / lg / xl) in the
system font, for the dashboard, setup and the till (owner: _"yes for now, then we can revisit
later"_). Open: page headings follow the Typography roles table in
`docs/developers/design-system.md` (a page title at `--wt-font-size-xl`) only in part — setup's and
some dashboard screens' headings (the content languages screen's, for one) take the browser's own
`<h1>` size, 28px; approvals and email set theirs to `--wt-font-size-lg`; menus and modifiers to
`--wt-font-size-xl`. Left alone on purpose, sized in `rem`: the till's enrolment number and setup's
cloud-recovery code. **Phone check, the
owner's to do (2026-10-01: "i'll test phones later on"):** Safari on iPhone is widely reported to
zoom the page in when a field whose text is under 16px is focused — not yet tried here. If it does,
the usual remedy is to keep field text at 16px on small screens only.

## Dragging a row (A180, #994 and #1003) — two things seen, left as they were

**Dragging a row (A180, #994 and #1003) — two things seen, left as they were.** A lifted row in a
reorder list (`ReorderController`, `packages/ui/src/reorder-table.ts`) shows a faint line at
each cell boundary, most visible in the dark theme, and a row lifted at the bottom of its list
has its shadow cut off where the table ends. Whether A180's lifting (`position: relative`,
`z-index: 1`) contributes is not known; the likely cause, not checked, is the sideways-scroll
wrapper each list puts round its table (`.table-wrap`, or `.wrap` in the variant table;
`overflow-x: auto`). The canvas editor's tile drag stays as it is (owner choice, 2026-10-01); A182
plans to retire the editor.

## A829. Cut a long one-word name in the overview's top-sellers table with "…"

From **Variants as products (#511–#556) — what is left open.** How the model works is in
[products.md](../developers/products.md), under _Variants_.

- **A829. Cut a long one-word name in the overview's top-sellers table with "…".** Today the table
  can reach into its card's padding at desktop width when a variant has a long one-word name and
  the figures run to five digits (12px into the 17px padding, measured 2026-09-24 at 1280px). Owner,
  2026-10-17: no mid-word break; cut the name with "…" and show the whole name on hover, as A784
  (#1840) does for a day's name in the Calendar (the whole name in its `title`). Done when a test at
  1280px holds the table inside the card's padding with such a name and checks the "…" and the
  `title`.

## A541. A `wt-disclosure` reopened after an animated close snaps open with no animation

- **A541. A `wt-disclosure` reopened after an animated close snaps open with no animation** — OPEN,
  found by A539's mutation tests, not fixed. The transition-end handler sets `body.hidden = true`
  directly, so Lit's recorded `?hidden` stays false; on reopen Lit leaves the body hidden while
  `updated()` measures it, reads 0 → 0 and unhides it at once. Repro:
  `<wt-disclosure heading="Kitchen" open><div style="height: 200px">body</div></wt-disclosure>`,
  click the header, let the close finish, click again — no height transition starts.
  (`packages/ui/src/components/wt-disclosure.ts`.)

## A542. An open `wt-dialog` moved in the page stays open but is no longer modal

- **A542. An open `wt-dialog` moved in the page stays open but is no longer modal** — OPEN, found
  by A539's mutation tests, not fixed. A probe read `[open, :modal]` as `[true, true]` before
  removing and re-attaching it and `[true, false]` after, with `el.open` still true; out of modal
  the window no longer bounds its height, so a long body grows past the screen. Likely Chromium
  closing modality on removal; the fix would re-show it modally on reconnect.
  (`packages/ui/src/components/wt-dialog.ts`.)

## Decisions and deliberate limits

**Page search (owner, 2026-10-15, A727).** Search finds named tabs, windows and views inside
readable pages, showing their name and containing page. Page matches precede inner results.
The approved scope is preserved in the [implementation plan](../superpowers/plans/2026-10-15-a727-page-search.md#approved-scope).
Periods and Seasons are registered as `venue-service:periods` and `venue-service:seasons`, windows in the Calendar (the Periods window from A719, the Seasons window from A721). The Week is
registered as `venue-service:week`, and the others register theirs when they exist.

- **A form's bottom message in a full-height dialog goes in the footer, on its own line just above
  the buttons, so it is always visible (owner, 2026-10-17).** Found by A507's look: a short form in
  a full-height `wt-modal` left about 150 px between the message and the buttons (the Prep stations
  station editor). Not built yet: `wt-dialog` still puts the message at the end of the body
  (`packages/ui/src/components/wt-dialog.ts`), and design-system.md → Forms still says "in a
  dialog, at the end of the dialog's body" (A849).

- **The two dropdown explanations on venue service's Kitchen panel stay as hints (owner,
  2026-10-17).** "Applies to new kitchen tickets and to reprints." and the release reminder's are
  each dropdown's `hint` since A178 (#1010 to #1019); a field that always holds a value never shows
  its hint, so only screen readers read them, while the switches beside them keep visible lines.

- **A dialog's height is chosen separately from its width (A734, owner 2026-10-15).** `wt-modal`'s
  shorter height is a fixed medium one, not one that follows its content, so a dialog given it does
  not change size as rows are added or removed. How it works: `docs/developers/design-system.md` →
  "Use `wt-modal` for an add or edit form".

- **Which dialogs take the medium height (A735, owner 2026-10-15).** These short dialogs open at
  `wt-modal`'s `height="medium"`: Add department and Add zone (Add to department shares that
  dialog), the floor plan's Add tables and Add joined table, the Edit dialog of a menu included in
  another, the Prep stations route-change notice, the printers' Add agent and Calibrate, Pair device
  (Enable shares that dialog), and only the password step of setting up an authenticator app on the
  profile. The Units and Modifiers Delete dialogs do not: depending on the data they show a table or
  nothing, and a fixed height could squeeze the table.

- **The sidebar folds to a strip of icons (A654, owner 2026-10-15).** Every sidebar icon draws in
  the text colour, never the primary colour, and the current section is marked by its highlight
  alone; the folded choice is kept per browser, and with no choice kept, a window wider than 48rem
  and at most 64rem opens folded. How it works: `docs/developers/design-system.md` → "Dashboard
  sidebar navigation".

- **An open tab offers to reload after a box update (A491, owner 2026-10-11).** How it works:
  `docs/developers/conventions-ui.md` → "An open page notices a box update from one response
  header". Limits kept on purpose: a signed-out dashboard tab that makes no automatic read sees the
  update only on its next request; a page that first hears from the box after the update takes the
  new build as its own and never shows the bar; a till with nobody signed in reloads even while
  someone is typing a PIN (typed digits are not a draft); a signed-in till with nothing open shows
  the bar rather than signing its operator out; once the till shows the bar it reloads only when
  Reload is pressed (a press waiting for a request still out is the operator's reload); an idle
  till whose bill payment or refund kept its send for a resend that must reuse its id shows the bar
  rather than reloading. Every response from the main listener after
  `/health` names the box's build to whoever can reach it, signed in or not. The failed-start
  recovery page and the plain-HTTP landing listener send no build header (read, not tested). The
  setup wizard does not watch the build.

- **Sign-in screens never ask about unsaved changes (owner, 2026-10-11, A499).** The dashboard's
  sign-in screen, every step of it, and the account set-up and password-reset form an emailed link opens there, and the
  till's PIN sign-in, take no part in the leave check. The till's enrol screen and the supervisor's
  PIN dialog still ask; they are not sign-in screens.

- **Change time at a repeated local time (A331 batch 2a, owner 2026-10-08).**
  On the autumn clock-change day, the Change time form can no longer move a scheduled menu
  version to the other copy of the same repeated local time (the other 02:30) in one step. The
  form opens on the stored date and time, so an untouched press now does nothing, where it used
  to bring up the server's "which 02:30" choice, and typing another time and then the stored one
  back is no change. After a real edit to a repeated time the choice still appears, so the other
  02:30 is reached only by two moves through another time. Owner, 2026-10-08: keep it as built.

- Left open by the owner's choice (W110, #1255, "One word for 'switched off, kept for the record'
  across the dashboard"): a Delete label can be stale, because the course list does not re-read on
  draft lines, order lines or kitchen items, in which
  case a confirmed Delete switches the row off instead.
  **2026-10-10 update:** A435 step 5 replaces the conditional label with permanent Delete and
  a fresh impact read. The dated W110 decision above describes the earlier behavior.

- **The sidebar's page search (C46, #836) — left open:** its accessibility case checks the search
  box and its message only; the sidebar's headers and current page have their own case since A306
  (`apps/dashboard/src/dashboard-app.a11y.test.ts`, "the desktop sidebar's group headers and current
  page are accessible at rest and under the pointer"). Two choices are **DECIDED (owner, 2026-09-29): keep both** — "ñ" is matched as
  "n", so "espana" finds "España"; and the box is not pinned, so it scrolls away with a long
  sidebar.

- **Hints shown as placeholders (C104, #966; C119, #967):** the owner chose on 2026-10-01 to leave as
  they are the hints cut off in their fields and the fields whose own placeholder shows instead of
  their hint.

- **Forms explain a failed submission under each field and once at the bottom (C47, #838/#839/#840/
  #841; C48, #892; C54, #853; owner rule 2026-09-28, restated 2026-09-29).**
  `docs/developers/design-system.md` → Forms states the rule. Decided and kept:
  - **DECIDED (owner, 2026-09-29): leave** the image library's bottom message as "The image could
    not be saved." followed by the refusal's own sentence (`image.save_error`), where the design
    guide asks for the refusal's sentence alone.
  - **DECIDED (owner, 2026-09-29): leave Connect working** after a refused card-provider key
    (`payment.provider_credential_rejected`), because the code carries only the provider's id.
  - Deliberate exceptions in `apps/dashboard`: the add-to-menus dialog
    (`apps/dashboard/src/widgets/add-to-menus.ts`) keeps its list of places that failed, and its
    menu-load error, at the top of the dialog; the backups panel's refusal paragraph
    (`apps/dashboard/src/screens/stream-settings-panel.ts`) stays directly under the form's
    buttons, because it also reports a refused Turn off, when no form is open; the cloud services
    screen (`apps/dashboard/src/screens/cloud-services-screen.ts`) has no form, only buttons, and
    shows a refusal as a plain alert. The setup wizard's screens with no fields — review, fiscal
    test, connection and provisioning — keep their refusal paragraph, and in Demo the venue screen's
    "Demo invoice settings have not loaded yet." alert stays above the form, as a load failure
    rather than a refusal.
  - The till's split step keeps its Split button disabled before any press until a dish is picked,
    on purpose, because it counts a selection rather than checking a field; the transfer step's
    confirm button does the same.

- **`wt-combobox`** (#351): a searchable dropdown in `packages/ui` — pick one option or several
  (`multiple`), and optionally offer to add what was typed when nothing matches. Left out on
  purpose, per its design: searching on the server, disabling single options, taking part in a
  native `<form>`, and showing chosen options as chips (it shows a count instead).
- **Venue settings' Tables and Kitchen tabs (A261 step 1, #1166; owner amendment, 2026-10-04).**
  Supervisors can read Tables and Kitchen, while writes remain manager-only.

- **One fixed "nothing matches" sentence; a specific "nothing yet" sentence per screen (A177,
  #1037).** Kept as they were, because they answer a question rather than say nothing was made: the
  Alerts screen's two, the adjustment report's, a printer scan's, the Servers screen's and a list's
  "No products use this list.".

- **The "Continue with Google" button follows Google's branding rules (A228, #1078).** Kept
  from the house rather than Google's drawing: the 44px tap height (Google's drawing is 40px; its
  text allows scaling), the full card width and `wt-button`'s corner radius.

From A342 (#1366, several values in one table filter):

- Not changed, single-choice dropdowns outside `wt-data-table`: the Add products dialog's
  Category, the Staff screen's Role and the Orders screen's Status (a server query). Each could
  take several values later if wanted.

From W69 (#1325, warn before discarding unsaved changes):

- Activated desktop Chromium checks cover reload, external navigation and closing with the
  Schedule owner; the implementation does not promise prompts on every browser or after mobile
  process termination. Rendered-link tests use actual dispatched elements with synthetic APIs;
  they do not establish physical reachability beneath an unrelated modal or live server writes.

From A334 (#1416, held reorder drags scroll at the list edge):

- Floor and grid placement editors remain outside this change.

From A176 (an empty table shows a proper empty box, with the screen's Add button, #1033):

- **The Payments screen's readers table gets no button** (kept as deliberate, owner, 2026-10-17),
  because "Add reader" sits beside each
  connected provider (none, one or several), so there is no single Add to put there, and the list
  is pre-filtered by status; and the menu prices table on a menu's Price overrides tab gets none
  either, because its rows come from "Add products" on the Structure tab.

## A582. Help mode: a "?" in the top bar marks everything that has help (owner 2026-10-13)

The owner's words (2026-10-13, watcher session): "I want a help interface so that there is a
question mark with a circle around it up in the top nav bar. And when you click it, it highlights
lots of things on the page with the circle with a question mark inside. And then if you click any of
those, it gives you help or it takes you to a page on the documentation. So it's essentially a help
mode that you can turn on and off. It doesn't obscure the page during the normal use, but you can get
help about anything you want very quickly."

- **Where.** The dashboard AND the devices: tills and handhelds, and probably the kitchen screens and
  monitors too (owner, 2026-10-13: "This for the dashboard and the devices, handhelds and tills. And
  probably the screens, monitors as well."). A monitor is view-only, so its help explains what it
  shows.
- **The switch.** A circled "?" in the top bar (on the dashboard, in the banner beside the account
  menu; on a device, in its own top bar) turns help mode on and off. It shows clearly when it is on.
- **While on.** Each part of the page that has help — a field, a button, a column, a section, a tab —
  shows a small circled "?" beside it. Clicking one shows a short help text in a popover, or opens
  the matching documentation page when the help is longer.
- **While off.** Nothing is added to the page; normal use is unobstructed.
- **Open points for the plan:** where the help texts live and how they are translated (EN/ES, like
  the screens' strings); how a screen declares which of its parts have help, so a shared `wt-*`
  primitive can carry it rather than every screen drawing its own marker; whether the mode stays on across pages and sessions; keyboard and screen-reader use.
- **Documentation.** Three user guides, Products, Modifiers and Languages and photos, are in
  `apps/server/src/guide/en/` with Spanish twins in `apps/server/src/guide/es/`, and the box serves
  them at `/help/<en|es>/<page>`. Where they live and how they are served:
  [conventions-ui.md](../developers/conventions-ui.md), "The user guides".
- **Design (2026-10-18):** [2026-10-18-a582-help-mode-design.md](../superpowers/specs/2026-10-18-a582-help-mode-design.md),
  pictures in [mockups/a582-help-mode/](mockups/a582-help-mode/). It settles the open points above.
  The owner approved it on 2026-10-18 with one change: on a till or handheld there is no Help row
  in More, because the "?" stays in the bar at the top right at every width. With help on, an open
  menu shows a blue "?" beside each option that has help.
- **Slice 1 landed (#1846, 2026-10-18).** `packages/ui` has the help switch's state
  (`packages/ui/src/help-mode.ts`), `wt-help-tooltip`'s `mode="help-mode"` badge (hidden while help
  is off, hanging over its box's top trailing corner while on), and `help` slots on
  `wt-price-input`, `wt-number-stepper`, `wt-file-input`, `wt-disclosure`, `wt-dialog` and
  `wt-modal`. Plan: [2026-10-18-a582-1-help-badge.md](../superpowers/plans/2026-10-18-a582-1-help-badge.md).
- **Slice 2a landed (#1848, 2026-10-18).** `packages/ui` has `wt-menu-row` (a menu option with its
  help badge in its own tap-sized square beside it), `wt-help-switch` (the "?" button that turns
  help on and off, pressed while on), `help` on `wt-data-table` columns (the badge over the
  heading's label) and on `wt-tabs` items (drawn outside the tab strip; hidden, with its box
  closed, while its tab is scrolled out of view). `wt-row-actions` keeps its menu open for a
  `data-keep-open` element inside a slotted element's shadow root, and places an open menu again
  when its size changes. Plan:
  [2026-10-18-a582-2-dashboard-help.md](../superpowers/plans/2026-10-18-a582-2-dashboard-help.md)
  (PR 2a is Tasks 1–6).
- **Left open by 2a:** `wt-help-tooltip` is not in `packages/ui/src/tap-target-and-focus.test.ts`'s
  interactive set; a throwaway check in #1848's review showed it would fail that guard's focus
  check, because focus on the element does not pass to its inner button. Decide whether it should
  delegate focus, then add it to the set.
- **Slice 2b landed (#1851, 2026-10-18).** Signed in, the dashboard banner has a "?" switch
  between the alerts bell and the account menu; help stays on across screens and goes off whenever
  the dashboard returns to the sign-in screen. The five existing "?" (two in a device profile's
  editor, one each on the staff screen, the unit form and SumUp's affiliate fields, SumUp's in a
  positioned box of its own) show only while help is on,
  and `scripts/help-tooltip-mode.test.ts` keeps every new one outside `apps/setup` in help mode.
  Products has help on the price, VAT, default course, the Variants section and the list's
  Availability column; the account menu's Account settings and a variant's Keep carry a badge.
  The owner's answer to Q41 (B): signed in, the language choices are in the account menu after
  Theme, and the banner's controls add no height to it. Slice 2 is complete: 2a #1848, 2b #1851.
- **Slice 3 landed (#NNNN, NNNN-NN-NN).** The guides moved from `docs/` to
  `apps/server/src/guide/en/`, with a `{#id}` on every section, and gained Spanish twins of all
  three in `apps/server/src/guide/es/`. `apps/server/src/guide-markdown.ts` renders the small subset
  they use, refuses the other shapes it checks for, and lets the rest through unrefused; `apps/server/src/guide-catalogue.ts` lists the
  languages and pages; the route `apps/server/src/guide-pages.ts` is mounted in every `bootServer`
  branch. The image carries `dist/guide` as `/app/guide`, and image smoke fetches a Spanish page.
  Root guards: `scripts/guide-page-tokens.test.ts` (the page's token copies) and
  `scripts/guide-links.test.ts` (the dashboard's links). `wt-help-tooltip` has `guide-href` and
  `guide-label` for a "Read more in the guide" link; `apps/dashboard/src/help-guide.ts` builds the
  dashboard's links; Products' price, default course and Variants badges link to their sections;
  and the dashboard's Vite server sends `/help` to the server. The guides' move from the design's
  docs/guide/ is explained in [conventions-ui.md](../developers/conventions-ui.md), "Why they are not
  under `docs/`". Plan: [2026-10-18-a582-3-guide-pages.md](../superpowers/plans/2026-10-18-a582-3-guide-pages.md).
- **Left open by 3:**
  - A `wt-data-table` column badge and a `wt-menu-row` badge cannot carry a guide link.
  - The till's `/help` proxy and the guide sheet belong to slice 4. A guide link opens a new tab;
    a till needs a hook to open its sheet instead, such as a cancelable `wt-*` event on the link's
    click.
  - Products' VAT and Availability badges have no guide link.
  - The failed-start recovery page (started from `apps/server/src/node-entry.ts`, outside
    `bootServer`) does not serve the guides.
  - A guide file that exists but cannot be read (any error other than "not found") reaches Hono's
    default error answer, not the guide's own 500 page: `readGuide` is called outside the route's
    `try` in `apps/server/src/guide-pages.ts`.
  - The first half of the Languages and photos guide, before "Add a photograph once", has not been
    checked against the code, because A682 rewrites it. A682 updates
    `apps/server/src/guide/en/content-and-images.md` and `es/content-and-images.md`, and the lines
    about translations in `en/modifiers.md` and `es/modifiers.md`.
- **Remaining slices** (design §8): **4** tills and handhelds — the bar switch that never leaves the bar (at phone
  width the language chooser leaves first), the till's More and person menus, badges on Counter,
  Floor and Order, the guide sheet, off on lock or a change of person; **5** kitchen screens and
  monitors — the corner switch, off after two minutes without a touch.
- **Left open by 2b:**
  - Help on a link option in a menu: `wt-menu-row` supports a `wt-button` option only; a link
    inside it would lose the look `wt-row-actions` gives a link (`::slotted(a[href])` styles only a
    direct child). No menu needs it yet.
  - Help on the dashboard's other screens, added as each is next touched; Products is the only
    screen with it.
- **Slice 4 must also:** fit the till's 32 px badge target, which hangs 16 px past its box — that
  overflows `wt-modal`'s 12 px side padding at phone width (the body scrolls sideways: the 390 px
  case in `packages/ui/src/components/wt-help-tooltip.slots.test.ts` shows it with the 32 px
  control) and reaches 4 px above `wt-disclosure`'s 12 px top padding.
- **Relation to A237.** The standing rule (owner 2026-10-03) makes a short explanation the field's
  hint, never a "?" button. Help mode fits beside it: hints stay where they are, and help mode is the
  place for the longer explanation. Decided with the design (owner, 2026-10-18; design §7): the
  dashboard's remaining "?" buttons become help-mode badges, and the setup wizard keeps its own.
- **The till's floor (A504, spec §11).** Help mode should explain the Update layout banner and what
  "Needs moving", Leave it here and Mark moved mean.


## A653 — every long dashboard table scrolls the same way, with less above it

Owner, 2026-10-14, from two screenshots of the Santet venue at desktop width
([mockups/a653-table-scrolling/](mockups/a653-table-scrolling/)): "the products table scrolls
independently of the page, but the menu table doesn't. these (and other similar tables) should be
consistent. the problem is the amount of space that is used above the table which needs to be
minimised, especially for use on mobiles".

- **Today.** Products (`apps/dashboard/src/widgets/product-list.ts`, through `catalogue-screen.ts`
  and `catalogue-browser.ts`) sets `wt-data-table`'s `stickyHeader`: the toolbar and column
  headings stay at the top of the table's box and only the rows scroll
  (`docs/developers/design-system.md`, `stickyHeader`). No other screen sets it, so a menu's
  Structure tab (`widgets/menu-structure-table.ts`) and the other long tables (Orders, Staff,
  Payments and the rest) scroll with the content column. A screen that opts in has to give the
  table a bounded height, as Products does.
- **Which way.** The owner's note reads as Products' way being the one to keep, with its cost —
  the height above the table — being what to fix; confirm that at the plan before converting
  screens. Settle which tables count as "long" (a tree such as Structure, a list that grows with the
  venue's data) and which stay page-scrolled.
- **The height to win back.** Above a menu's Structure rows, in order: the dashboard banner, the
  Menus breadcrumb, the menu's name with its "Live: version …" status line, the tab strip
  (Structure, Price overrides, Home page, Preview), the toolbar row (Filters, Select, search box),
  and the column headings. Products has no breadcrumb or tabs but the same toolbar. Phones first;
  measure the row area at 375×667 and 390×844 before and after.
- **W80's open points, now part of this item** (detail: [catalogue.md, W80](catalogue.md#products-table-toolbar-and-headings-stay-in-view-w80-1187-left-open)).
  At 375×667 Products' box held the All products row and one whole product row after W83, which
  the item that built it called short of "enough rows to remain usable"; Select and move mode
  overflowed there, and A303 changed that layout without the measurement being retaken.
- **Phone side margins and the demo link strip** (owner, 2026-10-14, from a phone screenshot of the
  Routes tab, [3-phone-side-margins-and-demo-bar.jpg](mockups/a653-table-scrolling/3-phone-side-margins-and-demo-bar.jpg)):
  "the mobile view still has a lot of margin on the sides which narrows the page width
  considerably". The page body keeps `padding: var(--wt-space-5)` at every width
  (`apps/dashboard/index.html`), drawing a frame round the whole shell, and each screen pads its
  content again inside. On a phone both shrink to a narrow gutter or none. The Demo and Preparation
  link strip (`wt-demo-bar`, `packages/ui/src/components/wt-demo-bar.ts`) wraps to two rows there;
  keep it to one, for example a row that scrolls sideways. Live mode draws no strip, but a venue
  uses Preparation while being set up.

## A657 — Cancel leaves without asking

Owner, 2026-10-14: "when you click cancel you shouldn't get the 'discard changes' warning. just
when you click escape or click outside the form". Asked about the rest the same day: a dialog's ✕
still asks, and a full page's own Cancel leaves without asking too.

- **Today.** design-system.md → "Protect an edited dialog before closing it" says to route "Cancel,
  close controls and an existing backdrop action through `requestClose(reason)`", and the
  coordinator asks whatever the reason (`LeaveReason` in `packages/ui-core/src/unsaved-changes.ts`:
  `cancel`, `escape`, `backdrop`, `navigation`, `signout`). `requestClose("cancel")` is by far the
  most common call in the tree; if those calls are the Cancel buttons, the rule can live where the
  reason is read rather than in each screen. Which of them are Cancel buttons was not checked.
- **The ✕.** It must still ask. Check what each dialog's close cross passes before keying the
  change on `"cancel"`: a ✕ that passes `"cancel"` today needs a reason of its own (not checked).
- **Full pages.** A page's own Cancel (the floor plan editor's Cancel link is the one named in
  design-system.md; find the others) is a route change the shell guards, so that link has to tell
  the shell it is a deliberate discard. Every other way off the page still asks.
- **Scope.** The dashboard, till and setup shells share the controller, so all three follow.
  Update the rule's paragraph and the unsaved-changes tests that pin a question on Cancel; a test
  that asserts Cancel asks is now asserting the old rule.

## A refused early dashboard payment authorization may become allowed before the PIN transaction — UNVERIFIED (A530 review)

- **A refused early dashboard payment authorization may become allowed before the PIN transaction —
  UNVERIFIED (A530 review).** `managerPinToCheck` (`apps/server/src/payments-api.ts`) returns no
  credential when its read refuses; `pinGated` then opens the transaction without a turn. If the
  permission changes to allowed between those reads, a text PIN may derive under the write lock
  outside the attempt queue. The same fallback is present at base `c704ac0dc`; no race was run.
  **Next action:** reproduce the permission-grant window through a real attestation route, then
  decide whether the refused early read must still join a person-specific turn.

## `--wt-color-primary-text` has fixed light and dark values that do not follow `--wt-color-primary`, and a tenant theme cannot set it

- **`--wt-color-primary-text` has fixed light and dark values that do not follow
  `--wt-color-primary`, and a tenant theme cannot set it** — left open by A218 (#1082):
  (`THEMEABLE_TOKENS`, `packages/layouts/src/theme.ts`) — no screen applies a stored tenant theme
  yet. The same holds for `--wt-color-primary-hover` and `--wt-color-danger-hover` (A306), and the
  disabled colours `--wt-color-primary-disabled`, `--wt-color-on-primary-disabled`,
  `--wt-color-danger-disabled` and `--wt-color-on-danger-disabled` (A535), which
  do not follow `--wt-color-primary` and `--wt-color-danger`, so a tenant or deployment that sets
  only `--wt-color-primary` or `--wt-color-danger` gets Waitron's default blue or red on a hovered or
  disabled primary or danger `wt-button`.

## One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the bottom

- **One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the
  bottom** — left open by A334 (#1416, held reorder drags scroll at the list edge): a later
  instrumented eight-case matrix reached the bottom in every case. A 2026-10-09 venue-service
  browser run also missed the Prep stations drag test's 1500 ms bound at
  `prep-stations-screen.test.ts:6556`: scrollTop was 266, against a required value above 317.
  An isolated run of the complete file on the branch's earlier head passed. The cause remains
  unverified. Capture the current scroll/limit, pointer position, drag state and visible box
  before attributing it to the scroll helper.

## Once put back with an edit, keyboard focus is outside the dialog, and Escape neither asks nor closes

- **Once put back with an edit, keyboard focus is outside the dialog, and Escape neither asks nor
  closes until focus is back on a field inside the dialog** — seen in the purchase form's
  tests, not changed and not tried by hand (the tests put it there with `focus()`; a click was not
  tried). Measured (`~/waitron-campaign-c/item-a397-measurements.md`, A397.2): after a put-back, focus
  is on the page body and the dialog is no longer modal; the measurements attribute this to how
  `wt-dialog` handles being put back. Left open by A397 part 1 (#1429), under A331 batch 5.

## `wt-combobox` without a search box never exposes `aria-required`

Found by A506-6's review: with `required` set, a combobox without a search box put `aria-required`
on nothing; one with a search box put it on the search input. The closed trigger is a `<button>`
that opens a list, and `aria-required` is not an attribute of the button role (axe-core 4.14.0's
role table in `axe.js` allows `button` only `aria-expanded` and `aria-pressed`, and lists
`aria-required` among `combobox`'s allowed attributes, with `aria-expanded` and `aria-controls`
required).

One way to fix it (A775, 2026-10-16): move the trigger to the WAI-ARIA Authoring Practices'
select-only combobox, `role="combobox"` on the trigger, which can carry `aria-required`. The APG
marks the button-and-list pattern `wt-combobox` follows as deprecated ("Collapsible Dropdown
Listbox": _"This pattern has been deprecated … The select-only combobox should be used as an
alternative"_, <https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-collapsible/>,
read 2026-10-17). A775 did not make the move. Tried in a throwaway worktree on 2026-10-16,
`role="combobox"` on the trigger alone gave 44 `aria-required-attr` failures in
`wt-combobox.a11y.test.ts`, all on the trigger (the role requires `aria-controls`, which the
trigger does not carry); the move also changes the role every test and screen reader meets,
and a combobox with a search box would then hold two comboboxes, the trigger and its search input.
A775 kept the button and named it by its label and its chosen value instead (design-system.md,
"Accessible names").
