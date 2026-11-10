# Users, sign-in and the dashboard shell — detail

The open entries are listed in [the backlog](../backlog.md), under "Users, sign-in and the dashboard shell". This file holds
their full text.

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
one OUTSIDE the uniqueness check, which is worse than the defect. The provisioning admin insert (`packages/provisioning/src/venue-apply.ts`) calls the exported
`foldForUniqueness`. **What is left
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

**A1002 design approved 2026-11-07, with the 2026-11-08 watcher corrections.**
The [design](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md) and
[reviewed plan](../superpowers/plans/2026-11-08-a1002-custom-roles.md) keep two working cuts:
the approved same-default permission names, then the complete roles transition. The roles cut
needs A1308's shared activity writer and functional outgoing-mail sender.
The general history screen is a follow-up. Before cut 2 builds, the owner must decide whether the
existing Admin-default `fiscal.remedy` may be assigned to another role; its behavior stays unchanged.
Implementation remains open.

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

The booking form still puts bare buttons in the footer and keeps its refusal in the body
(`packages/bookings/src/dashboard/booking-form.ts`). Add products now passes its request refusal
into its sticky `wt-form-actions` row; supervisor approval hands its refusal to the dialog's footer
row. The booking row remains part of the Forms refusal placement bundle.

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

## Passkey name column after A760

A403 removes the typed passkey name. Under the A1308 schema hold, the stored name column remains;
new registrations fill it with the detected password manager's name, or null for an unknown manager.
After A760, decide whether to remove the redundant column and read the provider directly.

## Review every permission: fewer, coarser, and consistently named

**2026-11-08:** A1002's [approved inventory](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md#2-one-permission-review-before-role-storage)
is the target. The [reviewed plan](../superpowers/plans/2026-11-08-a1002-custom-roles.md) incorporates
WATCHER 2026-11-08 03:57: same-default renames form cut 1, with new authority/storage in cut 2.
The same-default names use `payment.take`, `hardware.manage`, `venue.configure`,
`schedule.manage`, `system.manage` and `catalogue.manage`. Changes to authority and role storage
remain in cut 2; its shared-service gates are recorded at [A7](#roles-the-admin-can-edit-a7). The dated discussion below is historical;
its pending-approval wording is superseded by the 2026-11-07 full approval recorded in design §11.

- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). Since
  A494 (2026-10-11), `catalogue.manage` (manager and above, the roles that hold `person.manage`)
  gates the catalogue, units and content languages; the "VAT class for new products" default is set
  under `venue.configure` (owner, 2026-10-16, A755). Input
  since C128 (#1031): every till payment route checks the permission held by every role, staff
  included. A1002 cut 1 names it `payment.take` and keeps those holders. The list in
  `packages/identity/src/permissions.ts` has grown one permission per action, and the owner finds it
  too fine-grained: one permission such as `node.manage` might cover what `mirror.create` and
  `node.promote` split today (adding a machine, promoting a standby and, since #708, removing a
  standby that never finished joining all use one or the other). Machine permissions are to be named
  `node.*`, not `mirror.*` — the owner's preference. The review should propose the whole list: which
  permissions to merge, the names, and which role holds each, and then rename the call sites in one
  change. **Renaming is allowed now:** A1002 cut 1 removes the obsolete permanent-name header.
  A search (2026-09-26, reading, not running) found them stored nowhere — the database
  stores a person's ROLE (`packages/db/src/schema/identity/persons.ts`), and the names appear only in
  code the box itself serves — and the pre-production rule (CLAUDE.md §3, no
  backwards-compatibility code until a venue is live) covers the rest. The review should confirm that
  by running it, then drop or narrow that header sentence. **Do it before the editable-roles item
  below** (owner, 2026-09-26): once an admin can make roles and give them permissions, the stored
  roles would name their permissions, so a rename after that has to rewrite those rows as well.
  The roles design was not written when this review was requested; the approved A1002 design
  linked above proposes those rows in the still-unbuilt roles cut.
  **2026-11-08 pointer:** that approval status is historical; design §11 records full approval,
  and the [reviewed plan](../superpowers/plans/2026-11-08-a1002-custom-roles.md) records corrections
  and the remaining build blockers. Implementation is still open.
  **Restated by the owner 2026-10-02: "review all permissions and the roles they're assigned to"** —
  the review covers BOTH halves: every permission, and which of the built-in roles holds each. Two
  role questions from that morning's dashboard Orders screen answers (B27s, lane C questions.md
  2026-10-02 ~09:40 and ~09:50) belong in it: the staff role holds no `report.view`, so the Orders
  screen gave staff a narrower view of their own (unfinished bills plus today's finished ones) rather
  than the permission deciding. Dashboard resends now use `hardware.manage`, held only by managers
  and admins; the copy follows the till copy's permission. The approved permission merges are
  implemented in cut 1; role storage and changed authority stay in cut 2.

## Roles are something an admin can add and edit; the four built-ins are only defaults

The owner decided editable roles on 2026-09-12 and restated it on 2026-09-28.
**2026-10-28 qualification:** all four built-ins can never be renamed or deleted; Staff, Supervisor
and Manager retain editable privileges. Admin retains every current/future grant and its protected
usable active human anchor. The 2026-10-22 ~12:05 protection answer originally allowed Admin rename;
the new names answer supersedes that allowance only.

**2026-11-08:** the [approved design](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md)
and [reviewed plan](../superpowers/plans/2026-11-08-a1002-custom-roles.md) retain every role name.
See [A7](#roles-the-admin-can-edit-a7) for the two implementation cuts and their remaining gates.

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

## Secret checks and the write lock: the PIN, manager-login and profile checks moved — DONE (W1, #1117); two blocking derivations remain OPEN

Nothing makes a NEW route
derive its key before the transaction opens or take turns (`docs/developers/conventions-data.md`).
**Still open:** `hashSecret` derives with `scryptSync` (`packages/identity/src/secret-hash.ts`), so setting a PIN or password, or
minting the break-glass secret or first-setup key, stops the event loop; device and print-agent tokens are hashed with
`hashDeviceToken` instead. The `deriveKey` callers are tracked under
[The box](box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives). Left by #912's review: `verifySecretAsync` could be
renamed `verifySecret` (optional).

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

## A form's Save stays quiet and disabled until something changes (A331, owner 2026-10-07)

Left open by the completed A331 batches:

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

## Bundle: One session with real phones and password managers

13 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Android certificate trust needs real-device checks.** A September receipt records one phone
  accepting a matching-name, outside-CA-subtree leaf, without captured device versions. It did not
  measure the recovery leaf's hostname boundary. Actual Android controls, an iOS device and the
  service-worker/PWA/WebAuthn trust cases remain unmeasured. [Detail](box.md#box-image-constraints-b3)
- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. [Detail](setup.md#androidios-on-device-install-and-trust-rows)
- **Loose ends left by #334.**
  [Detail](setup.md#loose-ends-left-by-334)
- **The till's "This device hasn't trusted the till yet" page has never been seen on a real
  device.**
  [Detail](setup.md#the-tills-this-device-hasnt-trusted-the-till-yet-page-has-never-been-seen-on-a-real-device)
- **Check paying at the table on the OnePlus 13 at the box's address** (left open by A796). A
  reader card, a QR scan and an NFC tap from the pay sheet, and the NFC button's permission ask;
  the browser tests use fakes for all four.
- **Loose ends left by W102 (NFC and equipment labels).**
  [Detail](payments.md#loose-ends-left-by-w102-nfc-and-equipment-labels)
- **The dashboard shell restyle (#333) has not been checked on hardware.** It was only ever checked
  in screenshots on a desktop browser; nobody has walked it on the real box or a phone, so the
  narrow-viewport banner and drawer are unverified. That walk belongs with the display walkthrough
  in [ui-review.md](../ui-review.md).
- **The profile's "Current password" fills the signed-in person's saved password (C98, #934) — still
  open:**
  [Detail](dashboard.md#the-profiles-current-password-fills-the-signed-in-persons-saved-password-c98-934--still-open)
- **A new passkey is listed under the person's email, with their name as its display name (C99,
  #939) — still open:** the result has not yet been seen in a password manager.
  [Detail](dashboard.md#a-new-passkey-is-listed-under-the-persons-email-with-their-name-as-its-display-name-c99-939--still-open)
- **The passkey list says when each passkey was last used and which password manager holds it (C100,
  #945) — known limits:**
  [Detail](dashboard.md#the-passkey-list-says-when-each-passkey-was-last-used-and-which-password-manager-holds-it-c100-945--known-limits)
- **The browser's password manager is told which passkeys Waitron still accepts (C101, #948) — still
  open:** not observed in a real password manager — the tests replace the browser's methods.
  [Detail](dashboard.md#the-browsers-password-manager-is-told-which-passkeys-waitron-still-accepts-c101-948--still-open)
- Still open from #298/#305/#317, device checks before deployment
  [Detail](dashboard.md#still-open-from-298305317-device-checks-before-deployment)
- **Text size after A179 (#988).**
  [Detail](dashboard.md#text-size-after-a179-988)

## Bundle: Slow key derivation off the main thread

5 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Bound certificate password-derivation work before opening a file.** PKCS#12 files choose their
  own derivation cost; setup and certificate renewal currently pass it to the synchronous opener.
  Scope a shared limit or an isolated opener with a deadline. Raised by A852's review.
- **Loose ends left by secret checks and the write lock (W1, #1117; #912's review).**
  [Detail](dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-remain-open)
- **A refused early dashboard payment authorization may become allowed before the PIN transaction —
  UNVERIFIED (A530 review).** `managerPinToCheck` (`apps/server/src/payments-api.ts`) returns no
  credential when its read refuses; `pinGated` then opens the transaction without a turn.
  [Detail](dashboard.md#a-refused-early-dashboard-payment-authorization-may-become-allowed-before-the-pin-transaction--unverified-a530-review)
- **Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).**
  Every synchronous `deriveKey` caller still blocks the event loop while it derives.
  [Detail](box.md#loose-ends-left-by-sqlite-slice-2-task-5-569-waitronstream)
- **A restore from a backup file derives the archive's key at least three times**, each an N=2^17
  scrypt: at least once at each of preview, staging and the next start. Deriving it once would save CPU on the box;
  it is a behaviour change on the restore path and needs its own tests. Left open by A938.
  [Detail](box.md#a-restore-from-a-backup-file-derives-the-archives-key-at-least-three-times)

## A keydown guard that cancels Escape while a save runs did not keep one dialog open

Five standalone dashboard forms still close on the second real Escape while busy:
`option-label-form`, `add-to-menus`, `section-details-form`, `category-color-form` and
`include-folder-form`, under `apps/dashboard/src/widgets/`. On 2026-11-09, the focused native
control kept each dialog open after Escape one and closed it after Escape two. The same probe
on base `5e61e90deb` gave the same results; a busy variant-form stayed open twice and a nonbusy
option-label-form dismissed normally. These controls focus the modal body before making the
form busy, and await native close delivery after each key. Command:
`pnpm --filter @waitron/dashboard exec vitest run src/widgets/wt-dialog-sibling-control.test.ts --maxWorkers=1`
in the disposable review checkout: 5 failing behavior assertions, 2 passing controls. Probe
source and both logs remain in Lane D's `wt-dialog-sibling-*-20261109` receipts.

The three approved option-list, extras-list and Add content language fixes do not settle these
siblings. Next: add each modal's busy `dismissible` binding test-first. The menu/modifier delete
flows and media save/delete flows still need the same repeated-key check; their earlier single-key
probes do not settle it. This stays inside the existing bundle rather than becoming new items.

## Bundle: Wt dialog lifecycle

- **Dashboard leftovers from the coverage branch**: the login-purpose check and unreachable
  fallbacks remain outside the dialog work.
  [Detail](dashboard.md#dashboard-leftovers-from-the-coverage-branch)
- **Five sibling busy forms still close on a second Escape.**
  [Detail](dashboard.md#a-keydown-guard-that-cancels-escape-while-a-save-runs-did-not-keep-one-dialog-open)
- **Home/End caret behavior remains unresolved.** In macOS Chromium, End in an overflowing dialog
  left text selected and scrolled the body. Removing vertical containment let short-body tests
  pass but introduced underlying-page scrolling. In the 390×844 compact-modal control, End kept
  selection `[0,6]` and moved page scrollTop `800→4156` without containment, versus `800→800` with
  it. The earlier touch-emulation control kept the page at 800 past both body ends with no
  overscroll events, so that touch result did not cover the keyboard path. Receipts:
  `wt-dialog-key-page-control-20261109.log`, `wt-dialog-touch-probe-20261109.log`, and the
  634-second run-it review (which measured a 4104px page movement in its own viewport).
  Watcher 2026-11-09 19:15 kept containment and deferred this partial fix. Next: establish the
  intended native key behavior and a discriminating long-form/page-scroll check before changing it.
- **The till's modifier picker still recreates its modal when put back.** A738 added that because
  `wt-dialog` lost modality there. Check whether the recreation is still needed after lane C's
  #2642 lands; preserve the picker's draft and dismissal protections.
- **The department and zone edit dialogs still close on removal and reopen on return**, so they
  come back on top with focus as at opening. Their wrappers stay unchanged until the shared
  covered-dialog case below can be fixed without breaking Escape.
- **Putting a lower dialog back blurs the upper field and closes its open choices.** The focused
  Chromium probes reproduced both effects. No production reinsertion trigger was found during
  the 2026-11-09 source trace; that is not proof that none exists. Deferring the lower native
  modal preserves focus and geometry, but changes native Escape order. The bare controls
  `wt-dialog-native-close-control-20261109.log` and
  `wt-dialog-native-close-before-control-20261109.log` in Lane D's receipts observed: with
  `closedby=closerequest`, Escape closes the reattached lower dialog; `none`, `auto`, or no
  attribute swallow Escape for the upper dialog and a native popover opened before reinsertion.
  A popover opened after reinsertion still closes in that controlled setup. The fix needs explicit
  Escape routing for the upper dialog and its open popovers; watcher 2026-11-09 18:51 deferred that mechanism.
  Next: name a production trigger and obtain approval for that routing before changing restoration.

## Bundle: Forms refusal placement

3 entries remain after shared button spacing and the Add products/supervisor rows. The image,
profile, purchase, import, backup and booking work is the second approved slice.

- **A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left
  open:** the booking form still needs its footer row.
  [Detail](dashboard.md#a-forms-refusal-message-sits-at-the-bottom-of-the-form-above-the-buttons-c97-961--left-open)
- **Loose ends left by C47 (#838/#839/#840/#841).**
  [Detail](dashboard.md#loose-ends-left-by-c47-838839840841)
- **Request refusals that still land in the bottom message, or under a field in generic words — OPEN
  (left by C54, #853).**
  [Detail](dashboard.md#request-refusals-that-still-land-in-the-bottom-message-or-under-a-field-in-generic-words--open-left-by-c54-853)

## Bundle: Contrast pass

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **An off `wt-switch` is hard to see, worst in a dark dialog (seen in A757 slice 1's look,
  2026-10-19).**
  [Detail](dashboard.md#an-off-wt-switch-is-hard-to-see-worst-in-a-dark-dialog-seen-in-a757-slice-1s-look-2026-10-19)
- **On a hovered Products row in the dark theme, status and allergen badge borders appear to
  disappear into the row** — the earlier screenshot-only observation remains open. Contrast for those
  borders and the prep stations screen remains unmeasured. Left open by
  A319 (hover contrast after A306, #1347).

## Bundle: Quantity display

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Quantity-display follow-ups found while tracing A313, OPEN, unqueued:** the Top sellers table
  renders its quantity strings directly (`apps/dashboard/src/widgets/top-sellers-table.ts`), and the
  till's `trimQuantity` removes trailing zeros without localising a fraction's decimal mark. These
  are readings, not browser reproductions; reproduce them before changing their displays.
- **At 1280 px and 130% the Overview's Top sellers card cuts "Octopus" and "Croquetas" short with
  "…"** (a 66 px box; they need 73 and 90 px); they fit at 100% and at 390 px. The ellipsis for long
  words is A829's rule; the column is what gets too narrow. Left open by A841 slice 10b.

## Bundle: Design system doc truth

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by W79 (#1186, the Menus list).**
  [Detail](dashboard.md#loose-ends-left-by-w79-1186-the-menus-list)
- **A904. Correct the list of users in `--wt-cell-name-max-width`'s comment
  (`packages/ui-core/src/tokens/structure.css`) (left open by A827, #1889).**
  [Detail](dashboard.md#a904-correct-the-list-of-users-in---wt-cell-name-max-widths-comment-packagesui-coresrctokensstructurecss-left-open-by-a827-1889)
- **Open, and it bites this work first: two documents state the component rules and they have
  drifted**
  [Detail](dashboard.md#open-and-it-bites-this-work-first-two-documents-state-the-component-rules-and-they-have-drifted)
- **`--wt-cell-name-max-width` is used in three different directions, and is named for one.** Some
  consumers CAP a name cell with it, others use it as a `min-width` FLOOR, and one uses it as a FLEX
  BASIS on a combobox. **Next action (design decision):** a second token for the floor, or one
  shared sizing value used three ways.

## Bundle: Other browser check

4 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25).**
  [Detail](dashboard.md#the-colour-fields-custom-square-appsdashboardsrcwidgetscolor-fieldts-left-by-c25)
- **That saved-password visual check remains unverified** — an isolated Chromium profile accepted
  a saved test password through `navigator.credentials.store`, but did not autofill it after a
  reload or restart under automation; that saved-password visual check remains unverified. Left
  open by A190 (a field the browser fills in keeps the field's own look, #1047).
- **The "Continue with Google" button was checked in Chromium only** (the vitest browser suites and
  screenshots); Firefox and Safari not looked at. Left open by A228 (#1078).
- **A password manager filling the profile's current-password field** — the owner tried Chrome's
  password manager on 2026-10-08 and reported that it works well; other password managers are
  untried. Left open by A331 batch 3a (#1401).

## Bundle: Reorder controller

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A901. The shared reorder announcement misreads an item name holding `$&` or `{index}` (found in
  A757 slice 7's review, 2026-10-19).**
  [Detail](dashboard.md#a901-the-shared-reorder-announcement-misreads-an-item-name-holding--or-index-found-in-a757-slice-7s-review-2026-10-19)
- **One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the
  bottom**
  [Detail](dashboard.md#one-earlier-spanish-dark-theme-390-px-demo-probe-reached-its-12-second-deadline-before-the-bottom)
- **Dragging a row (A180, #994 and #1003) — two things seen, left as they were.**
  [Detail](dashboard.md#dragging-a-row-a180-994-and-1003--two-things-seen-left-as-they-were)

## Bundle: Theme logo

2 entries, size M.

- **The box's trust page still follows the device's setting, not the Theme choice (left open by
  A681).**
  [Detail](dashboard.md#the-boxs-trust-page-still-follows-the-devices-setting-not-the-theme-choice-left-open-by-a681)
- **Four tidy-ups A681's review left for later (#1842, 2026-10-17).**
  [Detail](dashboard.md#four-tidy-ups-a681s-review-left-for-later-1842-2026-10-17)

## Bundle: Dashboard i18n odds

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- The dashboard's `es-ES` module default still needs the flip the till got in #170.
- **Three older dashboard screens name languages with their own code rather than
  `languageDisplayName` (`packages/shared`)** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.
- **The dashboard's locale lookup reads inherited properties.**
  [Detail](languages.md#the-dashboards-locale-lookup-reads-inherited-properties)

## Bundle: Help tooltip primitive

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1244. `wt-help-tooltip` is not in the tap-target and focus guard's set (left open by A582
  slice 2a, #1848).** A throwaway check showed it would fail the guard's focus check
  (`packages/ui/src/tap-target-and-focus.test.ts`), because focus on the element does not pass to
  its inner button. Decide whether it should delegate focus, then add it to the set.
- **A1247. Help badges that cannot link to the guide (left open by A582 slice 3, #1871).** A
  `wt-data-table` column badge, a `wt-tabs` item's badge and a `wt-menu-row` badge cannot carry a
  guide link, and Products' Availability badge has none.

## Bundle: Box reset tab

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by signing a dashboard tab out when its box has been reset (A485, #1545).**
  [Detail](dashboard.md#loose-ends-left-by-signing-a-dashboard-tab-out-when-its-box-has-been-reset-a485-1545)
- **Loose ends left by A501 (#1552).**
  [Detail](dashboard.md#loose-ends-left-by-a501-1552)

## Bundle: Read failure display

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Left as it was** (#1142's run-it review, which found the same on `main`): **on Device profiles,
  a failed one-off reload's message can stay after fresh data arrives.** Left open by A224 (dashboard
  reads have no time limit, #1125, #1135, #1142).
- **Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03
  while checking lane A's W18) — OPEN.** It is the kind of empty-state text W18 removed from
  Roster and Planned vs actual.
  [Detail](dashboard.md#empty-state-text-shows-beside-a-failed-read-on-payments-and-cloud-services-a252-seen-2026-10-03-while-checking-lane-as-w18--open)

## Decisions and deliberate limits

- **A1400 save/read limit (watcher, 2026-11-07 23:12; retained 2026-11-10).** A venue-model or
  theme-list read after a save commits but before its reply can be replaced by that reply if the
  follow-up reads fail, including Appearance's bounded retries. The save returns the stored
  department model and refreshes the theme list; neither answer has a comparable server revision.
  No revision storage is included. See the [approved save-snapshot plan](../superpowers/plans/2026-11-07-a1400-save-snapshots.md).

- **Cancel discards without asking (A657, owner, 2026-10-14).** An explicit Cancel, including
  page Cancel, restores and leaves its drafts. Escape, an existing backdrop action, the close
  cross and other navigation still ask. See the shared [draft contract](../developers/design-system.md#protect-an-edited-dialog-before-closing-it).

- **Help mode beside hints (A582 and A237, owner, 2026-10-18; A582 design §7).** A short
  explanation stays the field's hint, never a "?" button (owner, 2026-10-03); help mode holds the
  longer explanation. The dashboard's remaining "?" buttons became help-mode badges, and the setup
  wizard keeps its own.

- **Each screen gains help when a change touches it (A582 design §8).** After help mode's five
  slices, a screen without help gets its badges in the change that next touches it.

- **Dashboard document lifecycle (A1229, 2026-10-30).** Suspend live streams and cached reads
  when the document leaves; preserve mounted observers for Back/Forward restoration and retain
  updates after a cancelled navigation. Error recovery waits one task so pagehide can cancel it.
  [Lifecycle contract and regression tests](../developers/dashboard-live-updates.md).


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
    test, connection and provisioning — keep their refusal paragraph.
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
  setting, Changes after sending, moved to the station editor, which needs `venue.configure`,
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

## A901. The shared reorder announcement misreads an item name holding `$&` or `{index}` (found in A757 slice 7's review, 2026-10-19).

`ReorderController.#announce` (`packages/ui/src/reorder-table.ts:307-310`) fills `{item}`,
  `{index}` and `{total}` with chained `String.replace`, so on every list that reorders through it
  a name holding `$&` is read back with the placeholder in its place
  (`"{item} is now".replace("{item}", "Mains $& x")` prints `Mains {item} x is now`), and a name
  holding `{index}` takes the position number itself, leaving the announcement's own `{index}`
  unfilled (`Table 3 is now {index} of 5.`). `git blame` puts these lines in
  524dbadd5 (2026-09-16) and 5b725d672 (2026-10-01), so I believe it predates A757 slice 7. Fix with
  a single-pass formatter like `format()` in `packages/venue-service/src/dashboard/hours-view.ts:5`.


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


## The box's trust page still follows the device's setting, not the Theme choice (left open by A681).

The trust page (`apps/server/src/trust-page.ts`, its logo in
  `trust-page-logo.ts`) is rendered by the server with no script, so it never reads the choice
  saved in the browser; it is the only server-rendered page under `apps/server/src` that reads the
  device's setting at all. Open.


## Four tidy-ups A681's review left for later (#1842, 2026-10-17).

None is a defect; each
  reshapes working code. (1) One shared "redraw when this changes" helper
  for the theme and the language. (2) Move more of the two choosers' repeated open and close steps
  into `packages/ui/src/menu-popover.ts`. (3) Rename the till's `language-chooser-styles.ts`, which
  now places the Theme menu too. (4) Handle a theme pick with a plain handler in each app instead
  of `ThemeChoiceController`'s `applies` option. Take them when next working in those files.


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


## Loose ends left by W83's review (#1193), not started.

- The table's Customise columns button is icon-only beside Filters and Select but has neither
    their look nor a tooltip.
  - The icon button and its tooltip are a stylesheet and a handler each caller wires by hand, not
    a `wt-icon-button` component — the Products table's Select is a native `<button>` because
    `wt-button` does not pass `aria-pressed` through, and the Structure tab's Reorder and Select
    toggles are hand-built icon buttons for the same reason.
  [Detail](catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)


## A904. Correct the list of users in `--wt-cell-name-max-width`'s comment (`packages/ui-core/src/tokens/structure.css`) (left open by A827, #1889).

It names "the modifier
  form's choices" as a cap and "the options list form" as a floor, but on main `c11e3572c` no
  modifier form and not `option-list-form.ts` read the token (`grep -rln wt-cell-name-max-width apps
  packages`), while `orders-screen.ts`, `page-printers-panel.ts` (folded into `printers-screen.ts` by A405) and venue-service's
  `periods-list.ts`, `routing-grid.ts` and `departments-list.ts` do and are not named. Read each
  user's rule, then rewrite the list from what they do, or describe the directions without naming
  users.


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
    which `packages/ui-core/test/package-consumer.test.mjs` loads, still use it. Waitron Cloud's portal
    also uses it (`waitron-cloud/apps/portal/src/screens.ts:14,68`, `app.ts:227`; watcher checked
    2026-11-10, read, not run), pinned at ui-core 0.2.1. Keep its published export while that
    consumer remains.
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
  start, and check other screens that watch after an awaited read the same way. A1308 removes both
  tables, which ends the Catalogue's case; the check of other screens stays.

## A1315. Bring every help bubble down to orientation, one area per PR

The remaining help work is in English and Spanish. The rule is in
[conventions-ui.md](../developers/conventions-ui.md#a-help-bubble-orients): read the code a bubble
describes first, move each dropped fact into its linked guide section, and list every changed text
before and after.

- **The till's Transfers help** (`help.more.transfers`): its last sentence, on the order counts, is
  more than orientation, but `apps/till/src/i18n/help-strings.test.ts` (A757 slice 6) pins it word
  for word, so shortening it is a choice for the owner.
- **No guide section to link yet:** the guide has no section on a device's profile, equipment,
  department transfers or Fix my hours, nor on a zone's Reset.
