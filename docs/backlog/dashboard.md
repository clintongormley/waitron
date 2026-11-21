# Users, sign-in and the dashboard shell — detail

The open entries are listed in [the backlog](../backlog.md), under "Users, sign-in and the dashboard shell". This file holds
their full text.

## Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
  (1) tables inside a dialog or picker offer no chooser, by choice; (2) the servers list
  (`apps/dashboard/src/screens/servers-screen.ts`) offers no chooser, its one column beside the
  buttons holding several facts together — **DECIDED (owner, 2026-09-29): leave it**, unsplit and
  with no chooser;
  (5) the read-only tables a few screens draw as plain HTML tables rather than `wt-data-table`s have
  no chooser: planned against actual (`apps/dashboard/src/screens/planned-actual-screen.ts`), the
  four report tables on the sales screen
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts`), the overdue table on the overview
  (`apps/dashboard/src/screens/dashboard-overview-screen.ts`) and the top-sellers table both of
  those screens show (`apps/dashboard/src/widgets/top-sellers-table.ts`); (7) the
  Departments and zones list (`packages/venue-service/src/dashboard/departments-list.ts`) offers no
  chooser — **DECIDED (owner, 2026-10-15, A718): no chooser**.

## Every login failure is one answer (C95, #930, owner decision 2026-09-30)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — the rule is in
  CLAUDE.md §3 and `docs/developers/conventions-ui.md`. Kept on purpose, each reachable only after a
  credential was proved: `totp.required` (asking for the authenticator code, after a right password),
  `google.second_factor_required` (after a valid Google sign-in), `authorization.not_permitted`
  (right credentials, a role without the permission) and the adjustment approver's
  `adjustment.approval_required` for a right PIN whose role is too low; a signed-in person's
  re-check of their OWN password or code (`profile.ts`) still names the field. Still open:
  - After a refused login the setup wizard's Connect form leaves the cursor where it was (an
    existing test pins that), while Reset and the dashboard sign-in move it to the password; the
    owner's rule covers marking fields, not the cursor, so whether Connect should match is the
    owner's call (left by A153, #952).
  - The PIN back-off
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

## Password-manager autofill in the confirmation window (C98, #934) — still open:

The browser and account address for the owner’s empty-field observation in the confirmation window remain unknown. The payments screen's manager-PIN prompts
  say `autocomplete="off"` (owner, 2026-09-30, C110 #940). Measured on 2026-11-21 in Playwright's
  Chromium 158, with one saved login for the dashboard's address in a throwaway profile, on the
  SumUp key field in the Modules dialog (a `wt-input` password field, as the PIN prompts are): with
  no `autocomplete`, one click put the saved email into the Modules search and filled the key
  field; with `off`, and with `new-password`, nothing was filled, and pressing the down
  arrow and Enter afterwards filled nothing either. Not checked: the PIN prompts themselves, other
  browsers, a password-manager extension, and the window the owner saw.

## A new passkey is listed under the person's email, with their name as its display name (C99, #939) — still open:

The result has not yet been seen in a password manager, including whether it shows new names after a Profile change.

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
  measured. A passkey sign-in challenge more than five minutes old answers
  `passkey.challenge_expired` while its row remains; a missing or swept challenge answers
  `passkey.verification_failed`. A1308 pp2 extends that sweep from later sign-in starts to
  any ceremony insert.

## Shared database-backed table paging, search and sorting

- **Measure Print Queue before moving it to shared table requests.** Measure the current response
  on a busy queue, including unfinished jobs and the two capped recent histories. Adopt the same
  50-row server pages, search, sort and passive refresh used by Users, Orders and returned invoices
  if the measurement shows a worthwhile reduction. Preserve the current history limits and
  search across that same set of jobs. Large datasets keep SQL sorting unless a measurement
  justifies sorting matching keys in memory.
- Products stays on its current read. The nested extras editor uses the whole catalogue for its
  picker and for saved items. Folder counts, move selections and archive warnings also use
  products beyond the rows on screen. Moving Products to server pages needs its own plan.
- Find a bill retains its existing request state until its own adoption.

## Typed values are only partly checked — a generic phone-format check landed, a country-specific one has not.

`isValidTelephone` in `@waitron/shared` runs on both the browser forms and the
  server write paths (`person.telephone_invalid`), and a number is kept exactly as typed. Still open:
  the country-pack seat (`CountryPack.telephone`, filled by `validateSpanishPhone`) is still not
  called, so a Spanish mobile that fails the national rule but passes the generic one is still
  accepted; other typed fields (email aside) are still unchecked; the tax identifier stays fiscal.
  Confirm with owner: an existing malformed number now blocks an otherwise-unrelated edit, because
  both forms re-validate the telephone field on every submit.

## The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25)

Safari was not tried, so what it draws with no colour chosen, and whether the ring and the
  rim-free fill hold there, is unknown; and whether choosing black in the browser's picker from the
  no-colour state registers was not run. With a palette colour chosen, the Custom square shows that
  colour too, beside the ringed swatch (pinned in `apps/dashboard/src/widgets/color-field.test.ts`,
  "fills the Custom square right up to its border while a palette colour is chosen"). **Next action:** try
  the first in Safari or Playwright's WebKit, and the second by hand in Chromium.

## A form's Save stays quiet and disabled until something changes (A331, owner 2026-10-07)

Left open by the completed A331 batches:

### Password managers

- a password manager filling the profile's current-password field: the owner tried Chrome's
    password manager on 2026-10-08 and reported that it works well; other password managers are
    untried.

### Hardware forms

The demo venue has no card provider connected
  (connecting one takes an API key), and no device asking to pair was made on the shared venue, so
  "Add a card reader" (four readers), Rename reader and the pairing dialog were looked at mounted
  with test data instead; "Add a card reader" now shows a blue Add on every row, as the printers'
  discovered rows do. Not looked at, left to their tests: the Bluetooth Pair dialog (the laptop's
  print agent has no `bluetoothctl`) and the bill attestation (the demo venue showed no payment to
  attest).

### Retained preparation screens

The review left detached `readOnly` changes and a retained table's scroll/sort unverified;
  no defect was reproduced for either. Before changing screen caching, exercise those transitions.

### Menu ResizeObserver warning

The historical menu-only warning was not reproduced.

## Text size after A179 (#988)

Open: setup headings and the excluded fiscal-verifactu, staff and staff-role
screens still need checking against the Typography roles in `docs/developers/design-system.md`.
The floor-plan editor's modal heading keeps the LG role. Left alone on purpose, sized in `rem`: the till's enrolment number and setup's
cloud-recovery code.

## Bundle: One session with real phones and password managers

13 entries, size M. Real-device checks remain open.

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
- **Password-manager autofill in the confirmation window (C98, #934) — still open:**
  [Detail](dashboard.md#password-manager-autofill-in-the-confirmation-window-c98-934--still-open)
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
- **Check field focus on a real iPhone and finish the remaining typography-role audit.**
  [Detail](dashboard.md#text-size-after-a179-988)

## Bundle: Wt dialog lifecycle

- **Covered-dialog reinsertion and the department and zone wrappers.** Putting a lower dialog
  back can blur the upper field and close its choices. The source trace found no screen that
  puts back a retained lower editor under an open upper editor. After the lower window was raised
  alone, Escape closed it or did nothing. See
  `~/waitron-campaign-d/receipts/dash-dialog-lifecycle/native-escape-main.log`.
  Keep the wrappers' current behavior until a screen can demonstrate and verify a fix.

## Bundle: Form implementation leftovers

Retiring the summary once its last consumer moves away remains open.

- **Loose ends left by C47 (#838/#839/#840/#841).**
  [Detail](dashboard.md#loose-ends-left-by-c47-838839840841)

## Contrast-theme styles for the remaining primitives

The remaining contrast-theme work is `wt-floor-map` and the floor plan's overdue and forgotten
rings (`packages/ui/src/floor-ring.ts`), whose backgrounds and shadows can lose their marks,
read from their CSS, not run. The rule and how to test it
are in [design-system.md](../developers/design-system.md#forced-colours-windows-contrast-themes).
Size M.

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

## Decisions and deliberate limits

- **Dashboard empty-value fallbacks (D-DASHBOARD-TEST-LOOSE-ENDS, 2026-11-17):** keep the
  remaining `?? []` and `?? null` in `dashboard-app.ts`, `login-screen.ts`, `extra-list-form.ts`
  and `option-list-form.ts` as deliberate defensive code. The watcher extended that decision
  on 2026-11-19 to `printers-screen.ts`, `payments-screen.ts`, `backup-screen.ts`,
  `devices-screen.ts` and `device-profiles-screen.ts`.

- **Dialog Home and End keys (2026-11-19):** keep native keys and vertical containment.
  In the November 9 Chromium control, End scrolled the body and left the text selected.
  The underlying page moved from 800 to 4156 without containment and stayed at 800 with it.
  The November 19 repeat reported FAILURE because it measured 800 in both settings. The
  decision rests on the November 9 comparison.

- **Password-throttle saturation:** during an address spray, an address sharing a counter with
  sprayed addresses can inherit their failed-password count if it has no cache entry or live
  named counter. It then loses its three free typos. Each wrong password opens a wait of up to a
  minute; a correct password still gets in once the current wait ends. Shared history expires
  after 15 minutes without a contribution, including inherited history carried back by an evicted
  address. Someone who has inherited it keeps their own count until they sign in or stop trying
  for 15 minutes, so typos can renew waits after the spray stops. Success keeps a zero-count entry
  in the bounded cache and never clears shared protection; after eviction it can inherit shared
  history again. The watcher cleared the design and success relief on 2026-11-16 at 09:40 and
  retained the behavior with this longer availability description at 10:02.

- **Deployment colour overrides:** set each related hover, text and disabled token explicitly so stylesheet authors choose a complete colour family. Semantic danger colours stay outside generated venue themes (watcher, 2026-11-16).

- **Text roles and typed fields.** A179's 12/14/18/22px scale was accepted on 1 October 2026 as
  “yes for now, then we can revisit later”. The owner's 15 November “Both now” choice keeps those
  normal-browser role sizes, uses rem for browser text preferences, and gives shared typing
  controls a 16px minimum. See [Structure](../developers/design-system.md#structure).

- **Database-backed tables** (owner, 2026-09-12): 50 rows per page with a server-enforced maximum;
  search/sort over the whole dataset, debounced typing, reset on filter change, ignored superseded
  replies and passive live refresh. Users is the first adopter. The watcher cleared its server-key
  sort on 2026-11-15 at 17:59; larger tables sort in SQL or measure first. See
  [the shared table contract](../developers/design-system.md#remembered-searchable-filterable-tables).


### The form plumbing is hand-written per form

2026-11-15 (watcher): the standalone cleanup sweep is retired; future adoption follows [Forms](../developers/design-system.md#forms).

- **New credential hashes stay inside their existing write transactions** (watcher, 2026-11-14
  17:30, Lane K questions.md). Their derivation now yields the event loop; other writes still wait
  for that transaction. Existing secret checks retain their treatment before the write lock.
  Setup-only parsing/reset proof, startup dummy hashes and offline commands retain synchronous
  hashing. See [the cleared plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-kdf-off-main-thread.md).

- **An unreadable authenticator secret is a sign-in refusal (C95, #930).**
  `manager-login.ts` reports an authenticator secret it cannot decrypt as a failed login
  (`password.invalid`, logged with the reason `unreadable_secret` since C95), like a wrong code.

- **Reorder row paint (watcher, 2026-11-12 09:54, Lane D questions.md).** The scrolling
  wrapper clips the held last row's bottom shadow in shared reorder lists and the variant table.
  Keep that cosmetic clipping: the tested gutter added a permanent 32px blank band at rest,
  including inside the Voids and comps card. In the inspected captures, cell seams appeared only
  when the test runner scaled the page, not at native size; no seam fix is included. Local receipts:
  `~/waitron-campaign-d/receipts/d-reorder-contrast/paint-unscaled-pixel-samples.txt`,
  `paint-images/`, `d-rest-*` captures and `paint-review-{1,2}.md` in that folder.
  The canvas editor's tile drag stays as it is (owner choice, 2026-10-01); A182 plans to retire it.

- Dropdown and browser table labels use the app language. Server-sorted display lists, including
  delete-refusal names and role holders, keep the runtime's default comparison; the watcher
  confirmed these are outside the dropdown/table work (2026-11-10 18:27, Lane D questions).

- **Theme choice and certificate help (watcher, 2026-11-10 17:19).** The saved choice remains
  local to its scheme, host and port. A plain-HTTP landing page can therefore follow the device
  while the HTTPS app uses a saved choice; no choice is carried between origins. See the
  [theme contract](../developers/design-system.md#themes).
- **A681 chooser tidy-up (watcher, 2026-11-10 17:19).** Keep the current chooser show/close
  steps: sharing their listener and focus calls would add methods while each chooser still owns
  its open state, and the language chooser still owns pending-load cancellation.

- **A1247 (watcher, 2026-11-10):** Keep Availability without a guide link and leave the table,
  tabs and menu-row wrapper APIs unchanged; no user was named for a wrapper link.
- **W79 (watcher, 2026-11-10):** Keep the Add-menu default and the documented Menus, Staff and Units
  text-button exceptions.

### Forms refusal placement exclusions (watcher, 2026-11-10)

The backup saved-key acknowledgement stays a prerequisite. Request refusals keep retry available;
a marked field still uses the shared bottom correction sentence. Purchase-line refusals carry no
line number, so they stay at the bottom. Menu and venue generic wording stays where no more
specific existing sentence applies.

The smaller Forms plan accepts the malformed-value exclusions: Boolean and enum controls, setup's
matching series pairs and derived geography, and configuration export's matching passphrase
minimum. Their source references are [in the approved plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-10-forms-refusal-placement.md), read, not run. Provider forms keep their existing credential,
merchant and Reader ID handling.


- **A1400 save/read limit (watcher, 2026-11-07 23:12; retained 2026-11-10).** A venue-model or
  theme-list read after a save commits but before its reply can be replaced by that reply if the
  follow-up reads fail, including Appearance's bounded retries. The save returns the stored
  department model and refreshes the theme list; neither answer has a comparable server revision.
  No revision storage is included. See the [approved save-snapshot plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-07-a1400-save-snapshots.md).

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
The approved scope is preserved in the [implementation plan](https://github.com/clintongormley/waitron/blob/ebd0cc11d3bb50e77f2ace2b2ed8cb764b65375f/docs/superpowers/plans/2026-10-15-a727-page-search.md#approved-scope).
Seasons and Periods are module-contributed pages under Venue operations, alongside Calendar;
page search finds them directly. The Week is
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

### Roles the admin can edit (A7)

The [11 November redesign](../superpowers/specs/2026-11-11-a1002-roles-redesign-design.md)
supersedes the earlier build split. `fiscal.remedy` is Admin by default and assignable
(owner, 2026-11-09). Access roles hold permissions; job roles grant none.

### Review every permission: fewer, coarser, and consistently named

The owner asked for fewer, coarser and consistently named permissions on 2026-09-26,
and restated on 2026-10-02: "review all permissions and the roles they're assigned to".
The review covers both permissions and their default holders. Machine permissions use `node.*`,
not `mirror.*` (owner preference).

The [earlier review](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md#2-one-permission-review-before-role-storage)
records the inventory and discussion. **2026-11-14:** the
[11 November redesign](../superpowers/specs/2026-11-11-a1002-roles-redesign-design.md)
supersedes its build split; that permission and role build is no longer open.

### Roles are something an admin can add and edit; the four built-ins are only defaults

The owner decided editable roles on 2026-09-12 and restated it on 2026-09-28.
**2026-10-28 qualification:** all four built-ins can never be renamed or deleted; Staff, Supervisor
and Manager retain editable privileges. Admin retains every current/future grant and its protected
usable active human anchor. The 2026-10-22 ~12:05 protection answer originally allowed Admin rename;
the new names answer supersedes that allowance only.

**2026-11-08:** the [approved design](../superpowers/specs/2026-10-22-a1002-custom-roles-design.md)
and [reviewed plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-08-a1002-custom-roles.md) retain every role name.
**2026-11-14:** the [roles redesign](../superpowers/specs/2026-11-11-a1002-roles-redesign-design.md) supersedes that build split; its access roles grant permissions, while job roles grant none.

- **The device editor keeps Approved profiles as a ninth field, one past the eight the owner first set (owner, 2026-11-15 05:25, A1534: "Allow nine").**

## What C38 left as it was (a generated display name is the first given name and first surname, #827, owner decision 2026-09-28).

The two staff forms turn the refusal into a field message inside the form, where other dashboard
forms receive field messages from their parent screen.


## Loose ends left by C47 (#838/#839/#840/#841).

- `wt-form-error-summary` is deleted once nothing uses it. Besides its own files and exports in
    `packages/ui-core` and `packages/ui`, the `packages/ui` workbench demo
    (`packages/ui/demo/main.ts`) and the consumer test page `packages/ui-core/test/consumer/main.ts`,
    which `packages/ui-core/test/package-consumer.test.mjs` loads, still use it. Waitron Cloud's portal
    also uses it (`waitron-cloud/apps/portal/src/screens.ts:14,68`, `app.ts:227`; watcher checked
    2026-11-10, read, not run), pinned at ui-core 0.2.1. Keep its published export while that
    consumer remains.



## Still open from #298/#305/#317, device checks before deployment

- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials (now part of A646);
  native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.
