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
  The `management_session.required` throw in `profile.ts`'s `ownSession`, as it stands since #554,
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

**A1002, proposed design revised 2026-10-28; full approval, plan and build remain open.**
The [custom-role design](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md) incorporates
the owner's accepted catalog/defaults, attendance self-approval, restrictive context lists,
several roles per person and removal-only custom-role deletion. All four built-ins keep fixed
translated names and cannot be deleted. Staff, Supervisor and Manager keep editable grants;
Admin retains every current/future privilege, immutable identity and a usable active human anchor.
ONE `person.admin` and the rule against granting unheld privileges remain settled.

The driver's union-of-grants and any-held-role list matching are proposed interpretations, not
owner quotations. Policy matching and action privileges are independent gates; a copied/new role
joins no device/reason list. Deletion removes memberships and all live device/reason/bill-limit
references with one confirmation, no replacements, and never turns an empty list into all roles.
**Only open sub-decision:** a sole-role holder becomes roleless or receives Staff. Recommend no
role to avoid unchosen grants. Publish that question first, then request complete revised design
approval separately; do not ask both at once.

The historical source audit remains pinned and reading-only, with bounded current-source additions
for the existing `personal_data.export` and whole-person consumers. Storage, live authority,
membership/proof revisions, import remapping and UI mechanics remain proposed, not runtime-verified.
A1113 supersedes the old mirror dashboard/viewer proposal; retirement is blocked, not claimed built.
The dated permission discussion below remains historical; current accepted catalog choices are in
the revised design. The three sale privileges stay separate, with no fiscal merge queued.

## A keydown guard that cancels Escape while a save runs did not keep one dialog open

On
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
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`); (7) the
  Departments and zones list (`packages/venue-service/src/dashboard/departments-list.ts`) offers no
  chooser — **DECIDED (owner, 2026-10-15, A718): no chooser**.

The Devices table still uses `viewKey="devices"`
(`apps/dashboard/src/screens/devices-screen.ts:1936`, read during A988 review). Next: rename its
preference key before go-live, following the prefixed table keys. This is separate from A988's
printer keys.

## A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left open

Three dialogs still draw their own refusal because none has a `wt-form-actions` row in its
  footer to hand it to: the menus screen's add-products window has its row inside the
  `section-add-products` component, and `packages/bookings/src/dashboard/booking-form.ts` and
  `apps/till/src/widgets/supervisor-override-dialog.ts` put bare `wt-button`s in the footer slot. A
  `wt-form-actions` wrapped in another element inside a dialog's footer would keep its message in
  the footer; none does today. Not looked at on screen after #961's review fixes.

## A form in a modal stops at `--wt-form-max-width` (C105, #965) — left open

A
  `wt-disclosure`'s heading row (the product editor's Kitchen, Descriptors and Nutrition sections,
  among others) and a screen's own paragraphs still run the modal's full width; and forms built in
  `wt-dialog` rather than `wt-modal` (the ingredient form, the till's party name dialog, among
  others) are held only by the dialog's own 768px limit — whether they should follow the modal's
  form width is the owner's call.

## The form plumbing is hand-written per form

  (4) the form plumbing is hand-written per form: assembling the bottom message, waiting for the
  render and then calling `focusFirstInvalid`, and the state that remembers the first press and
  which refusals the person has since changed, in several different shapes across `apps/dashboard`,
  the image library, the Stripe and SumUp forms, the Voids and comps page (`packages/adjustments`),
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

  Found during C47 part 2 and not fixed: (a) `wt-switch` cannot be marked invalid, so a server refusal of an adjustment reason's
  note-required switch would show its message but move focus nowhere — though the server refuses
  `noteRequired` only when it is not a true/false value (`requireFlag`,
  `packages/adjustments/src/routes.ts`) and the screen always sends one from its switch, so the
  refusal is not expected from this screen; (b) in a screenshot of a `wt-modal` editor after a
  refusal that names no field, a blue line runs along the top of the footer, which looks like the
  modal's scrolling body showing a focus ring — not traced, and not checked against `main`; an
  observation from the implementer's session.

## Request refusals that still land in the bottom message, or under a field in generic words — OPEN (left by C54, #853).

In the forms C54 surveyed (the dashboard, the setup wizard, and the
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

The sign-in page keeps its three inline copies of the hidden username field
  (`apps/dashboard/src/screens/login-screen.ts`); moving them onto the `autofillUsername` helper
  (`apps/dashboard/src/widgets/autofill-username.ts`) needs at least a `name` parameter (the
  sign-in page's tests pin `email`; the profile's field is named `username`), the
  `data-autofill-username` hook those tests find the field by, and a decision about an empty email,
  for which the helper renders nothing while the sign-in copies always render. Also unknown: which
  browser and address the owner saw the empty field in. The payments screen's manager-PIN prompt
  now says `autocomplete="off"` (owner, 2026-09-30, C110 #940); nobody checked in a real browser
  whether it then stops offering the dashboard password there.

## A new passkey is listed under the person's email, with their name as its display name (C99, #939) — still open:

The result has not yet been seen in a password manager. The dashboard calls
  `PublicKeyCredential.signalCurrentUserDetails`, where the browser has it, after every sign-in and
  after a passkey is added or removed (C101), but not after the email or display name is changed on
  the Profile screen; nobody has yet seen whether a real password manager then shows the new names.

## The passkey list says when each passkey was last used and which password manager holds it (C100, #945) — known limits:

Neither the "Last used" behaviour after a passkey is deleted in the
  password manager nor the password-manager naming was tried with a real browser (the tests stand in
  for the WebAuthn library). A browser following the older WebAuthn Level 2 rules zeroes the
  authenticator identifier under `@simplewebauthn/server`'s default "none" attestation preference,
  which Waitron does not override, and the passkey then shows no password manager. The names are a
  snapshot of the community list at github.com/passkeydeveloper/passkey-authenticator-aaguids
  (commit `3ff200d`, fetched 2026-09-30), names only; that repository states no licence, which is
  recorded at the top of `packages/identity/src/passkey-providers.ts`. Nothing refreshes it, and
  security keys such as a YubiKey show no name, because the FIDO Alliance's metadata was not copied.

## The browser's password manager is told which passkeys Waitron still accepts (C101, #948) — still open:

Not observed in a real password manager — the tests replace the browser's methods,
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

**A1002 revision, 2026-10-28:** the
[design's permission inventory](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md#2-one-permission-review-before-role-storage)
now records the owner's accepted non-fiscal merges and ordinary default sets. Keep `sale.void`,
`sale.refund` and `sale.rectify` as three identifiers; no fiscal merge/gate is queued.
`workforce.self_approve` is Admin by default and requires `workforce.correct`, independently of
`person.admin`. A980 S2c's `personal_data.export` already exists and remains the one privacy-export
entry. Admin's every-current-and-future-grant rule stays accepted.

This supersedes the earlier current-status claims that those catalog/default choices still awaited
answers. Their implementation remains open and precedes enabling editable roles. The complete design
remains PROPOSED: sole-role deletion outcome first, then separate full approval under §11.
Preserve the dated discussion below as the background to this now-answered catalog review.

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
  roles would name their permissions, so a rename after that has to rewrite those rows as well.
  The roles design was not written when this review was requested; A1002 now proposes those rows
  in the design linked above, still awaiting approval and implementation.
  **Restated by the owner 2026-10-02: "review all permissions and the roles they're assigned to"** —
  the review covers BOTH halves: every permission, and which of the built-in roles holds each. Two
  role questions from that morning's dashboard Orders screen answers (B27s, lane C questions.md
  2026-10-02 ~09:40 and ~09:50) belong in it: the staff role holds no `report.view`, so the Orders
  screen gave staff a narrower view of their own (unfinished bills plus today's finished ones) rather
  than the permission deciding; and `print.resend`, held only by managers and admins, was the name
  that first came up for the dashboard's DUPLICADO copy until it was settled that the copy uses the
  till copy's own permission — two permissions for one kind of print is a merge candidate.

## Roles are something an admin can add and edit; the four built-ins are only defaults

The owner decided editable roles on 2026-09-12 and restated it on 2026-09-28.
**2026-10-28 qualification:** all four built-ins can never be renamed or deleted; Staff, Supervisor
and Manager retain editable privileges. Admin retains every current/future grant and its protected
usable active human anchor. The 2026-10-22 ~12:05 protection answer originally allowed Admin rename;
the new names answer supersedes that allowance only.

A person may hold several roles. The [revised proposed design](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md)
proposes the union of their grants and any-held-role matching against explicit policy restrictions.
These mechanics remain driver inferences pending full approval. Built-in names always translate;
custom names are literal. Copying any preset produces an ordinary custom role without preset
identity, future grants or context-list entries. Deleting a custom role removes it from everyone
and every live policy list, with one impact confirmation and no reassignment workflow.

The only open owner sub-decision is the sole-role holder's outcome: no role (recommended), or Staff.
After that answer is incorporated, seek complete revised design approval separately. No plan/build
is authorized. The audit and consumer replacements cover storage, sessions, proofs, domain policies,
imports, clients and whole-person consumers; A1113 owns mirror dashboard/viewer retirement.
See [A7](#roles-the-admin-can-edit-a7) and §11 of the design for the approval order.

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

`isValidTelephone` in `@waitron/shared` runs on both the browser forms and the
  server write paths (`person.telephone_invalid`), and a number is kept exactly as typed. Still open:
  the country-pack seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) is still not
  called, so a Spanish mobile that fails the national rule but passes the generic one is still
  accepted; other typed fields (email aside) are still unchecked; the tax identifier stays fiscal.
  Confirm with owner: an existing malformed number now blocks an otherwise-unrelated edit, because
  both forms re-validate the telephone field on every submit.

## Secret checks and the write lock: the PIN, manager-login and profile checks moved — DONE (W1, #1117); two blocking derivations and one stale-answer window remain OPEN

Nothing makes a NEW route
derive its key before the transaction opens or take turns (`docs/developers/conventions-data.md`).
**Still open:** `hashSecret` derives with `scryptSync` (`packages/identity/src/secret-hash.ts`), so minting a token or setting a PIN or
password stops the event loop. The `deriveKey` callers are tracked under
[The box](box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives). Left by #912's review: the two join-status
readers answer from a hash read just before the key is derived, so a request denied or revoked in
that window can get one stale `pending` or `approved` (both routes return only `{ status }` and issue
no credential; the till and print-agent clients were not traced); and `verifySecretAsync` could be
renamed `verifySecret` (optional).

## Ongoing — the dashboard UI overhaul, screen by screen

Every screen is being brought onto one
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
   `kitchen-screen.ts`, `service-status-screen.ts`. **2026-10-19:** A757 slice 2 deleted
   `service-status-screen.ts`. **2026-10-24:** A756 PR 7 deleted `kitchen-screen.ts`.
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

## The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25)

Safari was not tried, so what it draws with no colour chosen, and whether the ring and the
  rim-free fill hold there, is unknown; and whether choosing black in the browser's picker from the
  no-colour state registers was not run. With a palette colour chosen, the Custom square shows that
  colour too, beside the ringed swatch (pinned in `apps/dashboard/src/widgets/color-field.test.ts`,
  "fills the Custom square right up to its border while a palette colour is chosen"). **Next action:** try
  the first in Safari or Playwright's WebKit, and the second by hand in Chromium.

## Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03 while checking lane A's W18) — OPEN

While its read is failing, Payments still says "No card
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
Seen again 2026-10-20 in A757 slice 2's look pictures
(`docs/backlog/mockups/a757-table-states/built-2/venue-settings-*-dark.png`).

## A form's Save stays quiet and disabled until something changes (A331, owner 2026-10-07)

Left open by the completed A331 batches:

### Reconnecting catalogue forms

Still untried: the ingredient form, the options list and its option window, the extras list,
  Add to menus, Add products, Schedule and Change time.

### Password managers and form-button checks

- a password manager filling the profile's current-password field: the owner tried Chrome's
    password manager on 2026-10-08 and reported that it works well; other password managers are
    untried;
- other purchases-screen and staff-screen tests still send made-up create and
    update events (`create-purchase`, `update-purchase`, `create-person`, `save-person`) instead of pressing the form's button; they pass, but never prove the button
    works.

### Hardware forms

The demo venue has no card provider connected
  (connecting one takes an API key), and no device asking to pair was made on the shared venue, so
  "Add a card reader" (four readers), Rename reader and the pairing dialog were looked at mounted
  with test data instead; "Add a card reader" now shows a blue Add on every row, as the printers'
  discovered rows do. Not looked at, left to their tests: the Bluetooth Pair dialog (the laptop's
  print agent has no `bluetoothctl`) and the bill attestation (the demo venue showed no payment to
  attest). Seen and not changed, because this batch does not touch them: the canvas Create and
  Duplicate dialogs have no Cancel, and Duplicate's name field is too narrow to show "A331 look
  canvas (copy)" whole; the printer name dialog is titled "Add a printer" when its button says
  Enable.

### Retained preparation screens

The review left detached `readOnly` changes and a retained table's scroll/sort unverified;
  no defect was reproduced for either. Before changing screen caching, exercise those transitions.

### Station dialog width

The station dialog widens or narrows with the chosen station's name, so its
  buttons shift a little as a station is picked (it did so before this batch).

### Purchase dialog focus

Also seen in the purchase form's tests, not changed and not
  tried by hand: once put back with an edit, keyboard focus is outside the dialog, and Escape
  neither asks nor closes until focus is back on a field inside the dialog (the tests put it there
  with `focus()`; a click was not tried). Measured (`~/waitron-campaign-c/item-a397-measurements.md`,
  A397.2): after a put-back, focus is on the page body and the dialog is no longer modal; the
  measurements attribute this to how `wt-dialog` handles being put back.

### Catalogue ResizeObserver warning

The historical catalogue-only warning was not reproduced.

## Text size after A179 (#988)

The scale is 12 / 14 / 18 / 22px (sm / md / lg / xl) in the
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

A lifted row in a
reorder list (`ReorderController`, `packages/ui/src/reorder-table.ts`) shows a faint line at
each cell boundary, most visible in the dark theme, and a row lifted at the bottom of its list
has its shadow cut off where the table ends. Whether A180's lifting (`position: relative`,
`z-index: 1`) contributes is not known; the likely cause, not checked, is the sideways-scroll
wrapper each list puts round its table (`.table-wrap`, or `.wrap` in the variant table;
`overflow-x: auto`). The canvas editor's tile drag stays as it is (owner choice, 2026-10-01); A182
plans to retire the editor.

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

  **2026-10-19, A738:** the modifier picker's combined-edit reconnect cases reproduced loss of
  `:modal` in all three close paths, including native Escape. That picker now recreates its modal
  while retaining its draft; the shared primitive remains unchanged. Run
  `pnpm --filter @waitron/till exec vitest run src/widgets/modifier-picker.unsaved.test.ts -t "combined line edits"`.

## Decisions and deliberate limits

- The owner's answer to Q41 (B): signed in, the language choices are in the account menu after
  Theme, and the banner's controls add no height to it.

- **A human account keeps its email (owner, 2026-10-21).** Keep the existing rule:
  there is no remove-email action.

- **Long top-seller names on the overview (A829, owner, 2026-10-17).** Wrap between words;
  truncate a word wider than its column with an ellipsis and show the full name on hover through
  `title`, as A784 does for a day's name in the Calendar.

**Page search (owner, 2026-10-15, A727).** Search finds named tabs, windows and views inside
readable pages, showing their name and containing page. Page matches precede inner results.
The approved scope is preserved in the [implementation plan](../superpowers/plans/2026-10-15-a727-page-search.md#approved-scope).
Periods and Seasons are registered as `venue-service:periods` and `venue-service:seasons`, windows in the Calendar (the Periods window from A719, the Seasons window from A721). The Week is
registered as `venue-service:week`, and the others register theirs when they exist.

- **A form's bottom message in a full-height dialog goes in the footer, on its own line just above
  the buttons, so it is always visible (owner, 2026-10-17).** Found by A507's look: a short form in
  a full-height `wt-modal` left about 150 px between the message and the buttons (the Prep stations
  station editor). Built for every `wt-dialog`, and so every `wt-modal`, not only full-height ones
  (`packages/ui/src/components/wt-dialog.ts`); design-system.md → Forms states it (A849).

- **The two dropdown explanations on venue service's Kitchen panel stay as hints (owner,
  2026-10-17).** "Applies to new kitchen tickets and to reprints." and the release reminder's are
  each dropdown's `hint` since A178 (#1010 to #1019); a field that always holds a value never shows
  its hint, so only screen readers read them, while the switches beside them keep visible lines.
  **2026-10-23 (A756 PR 4):** the reminder's dropdown, with its hint, moved to the department
  dialog's Service tab, under Courses and the kitchen; it is still a hint. Its placeholder is
  "Off", drawn before the hint (`packages/ui/src/components/wt-combobox.ts:1102`), so the hint is
  never on screen; reopen only if this decision changes (A756 PR 4's look). **2026-10-23 (A756
  PR 6):** the ticket-grouping dropdown, with its hint, moved to each station's editor as
  "Identical dishes on a kitchen ticket"; it is still a hint, and a station always has a grouping.

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
  Supervisors can read Tables and Kitchen, while writes remain manager-only. (2026-10-19: the Tables
  tab was retired by A757 slice 2; 2026-10-24: the Kitchen tab went with A756 PR 8. Its last
  setting, Changes after sending, moved to the station editor, which needs `venue_service.manage`,
  so a supervisor no longer sees it.)

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

### Save follows changes (A331)

"open a form with the Save button transparent (and disabled?). but as soon as you make a change,
make the Save button active/blue",
then "this should be global". A form that saves opens with its main action (Save, Add…)
disabled and drawn in the same quiet style as Cancel; the first real change turns it blue and
pressable, and undoing the change turns it quiet and disabled again. "Changed" is what the form's
unsaved-changes tracking (W69) already says, not a comparison written per screen. The rule, and
how a screen adopts it: [design-system.md](../developers/design-system.md) → Forms. The plan, one pull
request per batch: [plan](../superpowers/plans/2026-10-07-a331-save-follows-changes.md).

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

Opening already savable: the printers'
  name dialog, the calibration wizard when an add opened it (the campaign runner's ruling of
  2026-10-08, for the owner to confirm: a freshly added printer's wizard opens with a blue Save),
  the device pairing dialog, each row of "Add a card reader", the canvas Duplicate dialog, and a new
  canvas's editor.

The owner confirmed #1415's Bluetooth Pair dialog and bill attestation rulings: both
  are gated like a save and open with every required field empty.

The owner reversed the disabled-zone ruling on 2026-10-08.
  A device profile with no active allowed zone shows its field errors and bottom correction
  message on open. Save stays quiet while unchanged, and a name or reader edit cannot save until
  an active zone is chosen.

**2026-10-11:** A435 step 6 prevents public hierarchy Delete from emptying ordering access.
  Existing invalid stored-scope validation still applies; this earlier A396 receipt remains historical.

The per-form classifications remain in the [A331 plan](../superpowers/plans/2026-10-07-a331-save-follows-changes.md).

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
- **Documentation.** Three user guides, Products, Modifiers and Languages and photos, are in
  `apps/server/src/guide/en/` with Spanish twins in `apps/server/src/guide/es/`, and the box serves
  them at `/help/<en|es>/<page>`. Where they live and how they are served:
  [conventions-ui.md](../developers/conventions-ui.md), "The user guides".
- **Design (2026-10-18):** [2026-10-18-a582-help-mode-design.md](../superpowers/specs/2026-10-18-a582-help-mode-design.md),
  pictures in [mockups/a582-help-mode/](mockups/a582-help-mode/). It settles the open points above.
  The owner approved it on 2026-10-18 with one change: on a till or handheld there is no Help row
  in More, because the "?" stays in the bar at the top right at every width. With help on, an open
  menu shows a blue "?" beside each option that has help.
- [Help badge plan](../superpowers/plans/2026-10-18-a582-1-help-badge.md).
- [Dashboard help plan](../superpowers/plans/2026-10-18-a582-2-dashboard-help.md).
- **Left open by 2a:** `wt-help-tooltip` is not in `packages/ui/src/tap-target-and-focus.test.ts`'s
  interactive set; a throwaway check in #1848's review showed it would fail that guard's focus
  check, because focus on the element does not pass to its inner button. Decide whether it should
  delegate focus, then add it to the set.
- [Guide pages plan](../superpowers/plans/2026-10-18-a582-3-guide-pages.md).
- **Left open by 3:**
  - `apps/server/src/guide-markdown.ts` renders the small subset
    they use, refuses the other shapes it checks for, and lets the rest through unrefused.
  - A `wt-data-table` column badge, a `wt-tabs` item's badge and a `wt-menu-row` badge cannot carry a
    guide link.
  - Products' VAT and Availability badges have no guide link.
  - `apps/server/src/guide-markdown.ts` takes `escapeHtml` from `recovery-surface.ts`, so the
    renderer loads that module's imports too (Hono, `@waitron/db`, the login locale). Moving
    `escapeHtml` to a file of its own would end that; a reviewer called it optional.
  - The failed-start recovery page (started from `apps/server/src/node-entry.ts`, outside
    `bootServer`) does not serve the guides.
- [Till help plan](../superpowers/plans/2026-10-20-a582-4-till-help.md).
- **Left open by 4a:** on a till at phone width the "?" leaves the tab strip 8 px wide at 320 px
  with a long name; whether the person's name should give room is the owner's question, A921.
- **Left open by 4b:** help on Counter's payment buttons waits for A739, which is redesigning the
  payment window (plan, decision 11); once A739 lands, add it there.
- **Left open by 4b:** `till-shell` does not clear its guide when it is removed; the sheet closes on
  lock only because a lock draws a new shell.
- **Remaining slice** (design §8): **5** kitchen screens and monitors — the corner switch, off after
  two minutes without a touch.
- **Left open by 2b:**
  - Help on a link option in a menu: `wt-menu-row` supports a `wt-button` option only; a link
    inside it would lose the look `wt-row-actions` gives a link (`::slotted(a[href])` styles only a
    direct child). No menu needs it yet.
  - Help on the dashboard's other screens, added as each is next touched; Products is the only
    screen with it.
- **Relation to A237.** The standing rule (owner 2026-10-03) makes a short explanation the field's
  hint, never a "?" button. Help mode fits beside it: hints stay where they are, and help mode is the
  place for the longer explanation. Decided with the design (owner, 2026-10-18; design §7): the
  dashboard's remaining "?" buttons become help-mode badges, and the setup wizard keeps its own.


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

`managerPinToCheck` (`apps/server/src/payments-api.ts`) returns no
  credential when its read refuses; `pinGated` then opens the transaction without a turn. If the
  permission changes to allowed between those reads, a text PIN may derive under the write lock
  outside the attempt queue. The same fallback is present at base `c704ac0dc`; no race was run.
  **Next action:** reproduce the permission-grant window through a real attestation route, then
  decide whether the refused early read must still join a person-specific turn.

## A deployment that overrides `--wt-color-primary` or `--wt-color-danger` by hand keeps Waitron's default hover, text and disabled colours

- **A deployment that overrides `--wt-color-primary` or `--wt-color-danger` by hand keeps
  Waitron's default hover, text and disabled colours** — left open by A218 (#1082), A306 and A535.
  Since A841 slice 2 (#1932) a custom theme works out `--wt-color-primary-text`,
  `--wt-color-primary-hover`, `--wt-color-primary-disabled` and `--wt-color-on-primary-disabled`
  from its own button colour (`THEME_COLOURS`, `packages/ui-core/src/theme/tokens.ts`). Two gaps
  stay: a deployment that sets
  `--wt-color-primary` or `--wt-color-danger` by hand (design-system.md, "Retheming a deployment")
  still gets Waitron's default blue or red on a hovered or disabled primary or danger `wt-button`;
  and no theme writes `--wt-color-danger-hover`, `--wt-color-danger-disabled` or
  `--wt-color-on-danger-disabled`.

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


## A901. The shared reorder announcement misreads an item name holding `$&` or `{index}` (found in A757 slice 7's review, 2026-10-19).

`ReorderController.#announce` (`packages/ui/src/reorder-table.ts:307-310`) fills `{item}`,
  `{index}` and `{total}` with chained `String.replace`, so on every list that reorders through it
  a name holding `$&` is read back with the placeholder in its place
  (`"{item} is now".replace("{item}", "Mains $& x")` prints `Mains {item} x is now`), and a name
  holding `{index}` takes the position number itself, leaving the announcement's own `{index}`
  unfilled (`Table 3 is now {index} of 5.`). `git blame` puts these lines in
  524dbadd5 (2026-09-16) and 5b725d672 (2026-10-01), so I believe it predates A757 slice 7. Fix with
  a single-pass formatter like `format()` in `packages/venue-service/src/dashboard/hours-view.ts:5`.


## A905. The department dialog can take back another manager's older copy of the venue after a save (found in A757 slice 7's review, 2026-10-19).

The dialog orders the copies it receives by
  content alone (`willUpdate`, `packages/venue-service/src/dashboard/department-settings.ts`), and
  the save route answers 204. So when another manager's live change crosses this form's save, a copy
  from before the save can replace what was just saved: seen in temporary browser tests on slice 7's
  branch, the name field showed "Restaurant" again after "Restaurant revised" was saved, until the
  screen's next refresh put it right; and an older copy arriving after the save answered took a
  just-saved step "Coffee" out of the list, so a later step save would delete that row. The name
  stays wrong if that refresh fails or is thrown away, or if another field is edited before it lands; the step stays gone until a copy with
  different steps arrives. `git blame` on the branch's base puts the whole-copy replacement in
  06772ee25 (2026-10-10), so I believe the name case predates slice 7; not run on `main`. A fix
  needs the save to return what it stored (the steps' ids) or a version on the venue copy.


## An off `wt-switch` is hard to see, worst in a dark dialog (seen in A757 slice 1's look, 2026-10-19).

The off track is `--wt-color-border` (`packages/ui/src/components/wt-switch.ts:71`)
  and a dialog's background is `--wt-color-surface-raised` (`packages/ui/src/components/wt-dialog.ts:57`).
  Computed with the WCAG contrast formula from the values declared in
  `packages/ui-core/src/tokens/colors.css`: dark `#333945` on `#22262e` is 1.31:1 (1.47:1 on
  `--wt-color-surface`, `#191c22`); light `#d6d9e0` on `#ffffff` is 1.41:1. WCAG 2.1's non-text
  contrast criterion (1.4.11) asks 3:1. Not measured on a rendered page. Fix it in the primitive,
  not per screen.

- **A switched-off `wt-switch` may be too faint to see** — seen in A639's screenshots of the Backups
  screen, not fixed: its track measured roughly 1.3 to 1 against the light page and 1.6 to 1 against
  the dark one, read from pixel colours in those screenshots, where WCAG 1.4.11 asks 3 to 1 for a
  control's boundary. Not measured from the component's tokens; `wt-switch` itself was not changed
  by A639 (last changed by W97, #1311).


## A781. One shared panel-placement and arrow-key helper for the `wt-*` pop-up fields (left open by #1828).

`wt-colour-chooser` copies the panel placement (which since A783 also picks two or four
  columns) and the arrow-key handling that other `wt-*` components (`wt-combobox` among them)
  each carry their own copy of;
  `wt-language-chooser` and `wt-theme-chooser` already share theirs through
  `packages/ui/src/menu-popover.ts`. Move both into shared helpers in `packages/ui` and have every
  copy use them; each component's own tests and mutation score must hold.


## The box's trust page and the favicon still follow the device's setting, not the Theme choice (left open by A681).

The trust page (`apps/server/src/trust-page.ts`, its logo in
  `trust-page-logo.ts`) is rendered by the server with no script, so it never reads the choice
  saved in the browser; it is the only server-rendered page under `apps/server/src` that reads the
  device's setting at all. The favicon (`packages/ui/brand/public/favicon.svg`) is drawn by the
  browser from the operating system's setting. Open.


## Five tidy-ups A681's review left for later (#1842, 2026-10-17).

None is a defect; each
  reshapes working code. (1) Draw the dashboard logo as a token-coloured inline image, as setup's
  is, instead of swapping two images by `media`. (2) One shared "redraw when this changes" helper
  for the theme and the language. (3) Move more of the two choosers' repeated open and close steps
  into `packages/ui/src/menu-popover.ts`. (4) Rename the till's `language-chooser-styles.ts`, which
  now places the Theme menu too. (5) Handle a theme pick with a plain handler in each app instead
  of `ThemeChoiceController`'s `applies` option. Take them when next working in those files.


## A625. Check whether a row menu still wraps its two-word items after the window is resized to phone width (owner, 2026-10-17: keep as a check).

Seen on the Staff roles page (A585-1's look):
  after a desktop window was narrowed to 390 px, "Move up" and "Move down" broke onto two centred
  lines and the menu touched the screen's edge; loaded directly at 390 px it was one line per item,
  three times out of three. Believed to be the shared `wt-row-actions` popover, not that page; not
  yet reproduced on another screen. Done by one real-browser run of that resize on `main`: if the
  items no longer wrap, delete this entry; if they do, fix it. Screenshots kept outside the
  repository (lane C, `a585-1-shots/11a-…`, `11b-…`, `11c-…`).


## Loose ends left by signing a dashboard tab out when its box has been reset (A485, #1545).

- After a box reset, the reset page's own banner still shows the old venue's name. By reading,
    not run: `#returnToLogin` (`apps/dashboard/src/dashboard-app.ts`) never clears the `venueName`
    that `getMe` set, and the locale read meant to replace it repeats the old name once made, since
    it is kept for the page's life (`#localesPromise`, `apps/dashboard/src/api/client.ts`).
  - A dashboard tab that never meets the box in setup mode gets plain sign-in, not the "box was
    reset" notice — for example one asleep through the reset and the new venue's setup; there is
    no venue identity to compare.
  - A sign-in screen already showing when a box reset is found may already have started its passkey
    autofill, and has started its Google settings read; the switch to the reset notice stops
    neither. By reading, not run: a tab already on sign-in (sent by the shared session deadline, or
    by a failed check on coming back into view) switches to the reset notice only when a later
    request is answered `node.reset`.


## Loose ends left by A501 (#1552).

- A dashboard tab on the Backup screen learns of a box reset late. Setup mode answers only
    `/management-api/*` with `node.reset` (`mountSetup`, `apps/server/src/setup-api.ts`); the Backup
    screen and the content-languages read use `/api/...` paths, which setup mode answers with a 404
    with no code (or, without the built wizard, the placeholder page), so such a tab shows the reset
    notice only at its next management request. Measured by A501's Codex review against setup mode.
    Options: answer those dashboard `/api` paths with `node.reset` too (the boot test pins
    `/api/staff` answering the placeholder), or move the reads under `/management-api`.
  - `reportError`'s HTTP status is now unread. `apps/dashboard/src/session-signals.ts` no longer
    uses it, and the status hand-off in `packages/dashboard-kit/src/request.ts` was added only for
    the check A501 removed; a small cleanup across both packages.


## A398 — device-profile editor heading remains to align with the sub-page pattern.

The editor repeats the list title and has no parent link above the heading
  (`apps/dashboard/src/screens/device-profiles-screen.ts`, `#renderEditor`). Deferred from lane E's
  canvas-heading change because lane A's A366-5A changes that screen. Re-check its landed editor,
  then apply the parent link and one item-name `h1` while retaining the unsaved-changes check.


## Loose ends left by W79 (#1186, the Menus list).

- `docs/developers/design-system.md` still says a list's Add action goes in a menu beside the
    table heading, while Menus, Staff and Units put a text Add button at the heading row's
    trailing edge; the doc only names the exceptions, and whether the rule itself changes is the
    owner's call.
  - The row-highlight tests focus only the row's own button, so nothing tests that a row
    highlights while another control in it, such as its Actions menu, has focus.


## Loose ends left by A629 (#1684).

- The browser's "Open link in new tab" on a link marked `aria-disabled="true"` in a ⋮ menu
    (`wt-row-actions`) has not been tried. No screen marks one disabled yet; W88's busy-tree point
    would be the first.
  - A middle-click on a dashboard link marked `aria-disabled="true"` outside a ⋮ menu may still
    open it in a new tab — not tried. The dashboard cancels such a link in `#onAppLink`
    (`apps/dashboard/src/dashboard-app.ts`), which listens for `click` only; in A629's tests a
    middle-click on a ⋮ menu link opened a new page in Chromium until `auxclick` was cancelled
    too. Raised by A629's review.


## Loose ends left by W83's review (#1193), not started.

- The table's Customise columns button is icon-only beside Filters and Select but has neither
    their look nor a tooltip.
  - The icon button and its tooltip are a stylesheet and a handler each caller wires by hand, not
    a `wt-icon-button` component — the Products table's Select is a native `<button>` because
    `wt-button` does not pass `aria-pressed` through, and the Structure tab's Reorder and Select
    toggles are hand-built icon buttons for the same reason.
  [Detail](catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)


## A895. A dialog footer's long form message: the field it hides, its scroll cue and its name.

Left open by A849 (#1882), which moved a `wt-dialog` footer row's message into the footer and
  lets a message too long for the dialog scroll inside itself. Seen in its LOOK at 390×500 (scratch
  browser test): a 14-sentence message shrinks the body until the form's only field is cut off; at
  21 sentences the message scrolls, but the headless browser draws no scrollbar, so the only cue is
  a half-cut line, and its focus ring sits tight against the text. The message is a Tab stop while
  it overflows, but what a screen reader announces when it gets there was not checked. Messages
  are meant to be one sentence, so this needs a long message to show. **Next action:** decide
  whether the message should get a height cap (so the body keeps room for a field), padding inside
  its focus ring and an accessible name, then check them in a real browser.


## A903. Check that the course list's row menus stay on screen at 390 px (left open by A827).

`apps/dashboard/src/widgets/course-list.ts` also puts a `wt-row-actions` in a plain table. Its
  390 px cases in `course-list.test.ts` check only that a row's menu sits on the first line of a
  wrapping name, or level with the rename field, never where the menu ends. Done when it has a
  390 px case holding every row menu's right edge to the screen's and to the box around its
  table's.


## A904. Correct the list of users in `--wt-cell-name-max-width`'s comment (`packages/ui-core/src/tokens/structure.css`) (left open by A827, #1889).

It names "the modifier
  form's choices" as a cap and "the options list form" as a floor, but on main `c11e3572c` no
  modifier form and not `option-list-form.ts` read the token (`grep -rln wt-cell-name-max-width apps
  packages`), while `orders-screen.ts`, `page-printers-panel.ts` and venue-service's
  `periods-list.ts`, `routing-grid.ts` and `departments-list.ts` do and are not named. Read each
  user's rule, then rewrite the list from what they do, or describe the directions without naming
  users.


## The reasons screen keeps its own copy of the role list and role names

- The reasons screen keeps its own copy of the role list and role names (C51 sorts its dropdowns by
  displayed name, with a separate seniority order for validation) and of the dashboard's
  placeholder-filling `fill` (`apps/dashboard/src/i18n/t.ts`). **Next action:** move both into
  `@waitron/dashboard-kit` if a third module screen needs them. Left open by service Task 1 (#706,
  adjustment reasons).


## Left in the dashboard Orders plan and spec after #1034 landed beside C126:

Their banners still
  say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says "Task 2,
  as written" for the dropped mark; its Task 1 voided-bill case still lists `invoiceNotCredited:
  false` with no pointer to the drop; and #1034 did not write its planned test that a cancelled bill
  with an invoice shows its credit note. Left open by C126 (cancelling an order whose invoice was
  issued credits it, #1030).


## What C38 left as it was (a generated display name is the first given name and first surname, #827, owner decision 2026-09-28).

Left as they were, from #827's review: unlike the two staff
  forms, the profile screen keeps a taken-name message beside the display name when a first- or
  last-name change regenerates that name (`apps/dashboard/src/screens/profile-screen.ts` drops only
  the changed field's refusal); and the two staff forms turn the refusal into a field message
  inside the form, where other dashboard forms receive field messages from their parent screen.


## Loose ends left by C47 (#838/#839/#840/#841).

- `wt-form-error-summary` is deleted once nothing uses it. Besides its own files and exports in
    `packages/ui-core` and `packages/ui`, the `packages/ui` workbench demo
    (`packages/ui/demo/main.ts`) and the consumer test page `packages/ui-core/test/consumer/main.ts`,
    which `packages/ui-core/test/package-consumer.test.mjs` loads, still use it.
  - The profile screen, opened with required details missing, marks those fields at once, before
    any press (two existing tests pin it), unlike every other form.
  - The form plumbing is hand-written per form: assembling the bottom message, waiting for the
    render and then calling `focusFirstInvalid`, and the state that remembers the first press and
    which refusals the person has since changed, in several different shapes.
    [Detail](dashboard.md#the-form-plumbing-is-hand-written-per-form)
  - The image picker's error message is not read to a screen reader. The Choose image button inside
    it carries `aria-invalid` and takes focus, so a screen reader hears "invalid" with no reason.
    Since A200 the product editor's photo button (`apps/dashboard/src/widgets/product-editor.ts`)
    has the same defect.
    [Detail](dashboard.md#the-image-pickers-error-message-is-not-read-to-a-screen-reader)
  - Found during C47 part 2 and not fixed: `wt-switch` cannot be marked invalid — a server refusal
    of an adjustment reason's note-required switch would show its message but move focus nowhere.
    [Detail](dashboard.md#what-c47-part-2-found-and-did-not-fix)
  - Found during C47 part 2 and not fixed: a blue line along the top of a `wt-modal` editor's
    footer, in a screenshot after a refusal that names no field, which looks like the modal's
    scrolling body showing a focus ring — not traced, and not checked against `main`. A502 part 2
    saw the same line above the buttons of the floor plan editor's compact "Delete {name}?"
    question, opened by a click.


## Still open from #298/#305/#317, device checks before deployment

- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials (now part of A646);
  native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.


## Opening hours' create texts say "New …" and "+ …"

- **Opening hours' create texts say "New …" and "+ …"** — `special.new` ("New special day") and
  `season.add` ("+ Season", the Seasons window's add button) in
  `packages/venue-service/src/dashboard/strings.ts`, against design-system.md → Wording's
  "Add …". The "+" label comes from the A506 seasons spec.
  Seen by A546's review; not changed there.


## A890. A tree `wt-data-table` draws a row's activator in its first column even when that column sets `activatesRow: false`

- **A890. A tree `wt-data-table` draws a row's activator in its first column even when that column
  sets `activatesRow: false`** — OPEN, left by A813. A flat table now draws it in the first shown
  column that does not opt out; tree mode still draws it at `ci === 0`
  (`packages/ui/src/components/wt-data-table.ts`). No tree table sets the option on its first
  column today; what a click on that cell's blank space then does was not tested.


## A1227. The Catalogue screen replaces its live stream once per load when catalogues exist (left open by A1222)

- **A1227. The Catalogue screen replaces its live stream once per load when catalogues exist (left
  open by A1222).** Since A1222 the dashboard opens its first live stream after the screen is
  drawn. The Catalogue still opens a second when at least one catalogue exists:
  `catalogue-screen.ts` `#load` watches `ingredients` and `recipe_lines` only from
  `#reloadProducts`, after awaited reads, so the stream that opened with the screen's other types
  is replaced once those reads answer. Decide whether the screen should watch those types from the
  start, and check other screens that watch after an awaited read the same way.
