# Conventions — forms, the dashboard, UI primitives and hardware

This file holds the evidence behind the UI-facing conventions in the repo root `CLAUDE.md` section
3 — forms, the dashboard shell and its sessions, hardware and printing, and the unauthenticated
recovery page: the regressions, measurements and pointers that paid for each rule. `CLAUDE.md` keeps
the one-line version of each rule and points here for the rest.

**Forms and the shared UI contract**

## New or changed forms use the shared UI contract in `docs/developers/design-system.md` → Forms

Required fields are visibly marked; an attempted invalid submission shows explanatory text beside
every bad field and one localized message at the bottom of the form, on its own line above the
buttons (in a dialog, at the end of its body; owner, 2026-09-30, C97), and the action stays disabled until
the form's own checks pass — no summary at the top (owner, 2026-09-28). An error from a request
never disables the action by itself (owner, 2026-09-29: "Fields with errors should explain the problem";
"if there is a form validation error leave it disabled; if the error comes from a request leave it
enabled"); when handling a refusal empties or reveals a required field, that field's own check holds
the action until the field is filled. Cost: before C54, many forms outside the till — the login and
profile screens and the catalogue editors among them — disabled their action after a server refusal
naming a field, until that field changed. Every input has a semantic
`name` (plus the standard `autocomplete` purpose when one exists), never a generated widget id as
its identity. Password reveal buttons use the input's `end` slot and an action-specific accessible
label. An inline confirmation embedded IN a form suspends that form's Save and implicit Enter
submission until resolved — no current form embeds one (person-edit.ts's own confirmation moved out
to the row's kebab menu as a separate `wt-dialog`, outside any form, on `ui-overhaul`), so there is
no live instance to point at, but the shape can recur the next time a confirmation lands inside a
form rather than beside one. `wt-form-actions` keeps the primary action bottom-right and Cancel/Back
bottom-left; the sign-in email, password, passkey and Google screens put their own way in
outside it, full width
(design-system.md, login section). Cost: the dashboard login exposed `wt-input-N` to password
safes and disabled incomplete forms without saying what was missing (`ui-login`, owner review
2026-09-09).

A short field explanation is the field's hint; one too long for a hint, or on a field that starts
filled in, uses `wt-help-tooltip`, whose button closes on outside click or Escape (owner,
2026-10-03).

## A screen does not draw its own form field

A `<select>`, a `<textarea>` or an `<input>` that takes text is drawn by a field primitive
(`wt-input`, `wt-textarea`, `wt-price-input`, `wt-number-stepper`, `wt-combobox`); where none fits,
add to one or add one (owner, 2026-10-01, A178). Cost: a native `<select>`'s open list is drawn by
the browser and cannot take the approved look, and fields a screen drew itself did not follow
changes to the shared ones, so A178 moved the fields screens drew in the dashboard, setup, the till and
the module screens onto the primitives (#1012, #1015, #1016, #1017). Guard:
`scripts/native-form-fields.test.ts`, weaker than its name — it reads text, and only the literals
of non-test `.ts` files under `apps/` and `packages/`, so a field made with
`document.createElement`, from markup no single literal holds (built at run time, or read from a
file or a response), or with its tag name split across a `${…}` is invisible to it;
the field primitives' own files, and `wt-data-table`'s (its search box), are not read at all, so a
second field added inside one passes; and some files are allowed by name (the hidden username
inputs for the browser's password manager, in two files, and the print agent's setup page), each
held to the number of LINES it draws a field on, so a field swapped for another, a hidden input
made visible, or a field added on a line that already has one passes. See design-system.md → Forms.

## A refusal reaches a field by what the error carries, not by one parameter name

The product editor binds a refused save to an editor field. `product.invalid` carries the `field` it
is about, but `content.translation_required` — the refusal the editor's own translated inputs
produce — carries only the missing `language`, and one product save can have several translated
values checked (the product's customer name and one per variant saved Active; a disabled variant is
never checked, `writeProductVariants` in `packages/catalogue/src/variants.ts`), so the language alone
does not say which. What the save path can carry is pinned where it is thrown, in
`packages/catalogue/src/product-editor.test.ts` ("names the missing language, and nothing else" and
"refuses nutrition input without naming any field"): a refusal of an allergen or a dietary
declaration names neither a field nor a language, which is why nothing maps those onto the editor's
Nutrition section.

`productEditorTranslationField` (`apps/dashboard/src/widgets/product-editor.ts`) resolves the
language onto a value by reading the body that was submitted: every checked translated value missing
that language, which skips a variant submitted disabled, is a fault the save has to clear, so it
points at the first one and the next save reports whatever is still missing. Focus goes to the input
for the language the SERVER named rather than the first on screen, because that is the only input
whose emptiness refused the save; a variant has no input in the product form, so its problem goes to
its table row and focus to that row's actions trigger.

Cost: an earlier fix on `feat/product-editor-rework` bound `fieldErrors` to the editor but mapped
`params.field` only. Driving the real screen with an English default and a Spanish-only customer name
left the section folded, the message behind the modal and focus on Save. Regressions:
`apps/dashboard/src/screens/catalogue-screen.test.ts`, "reports a refused translation beside the
input for the language the server named" and "marks the variant whose translation the save refused".

## Saved selections compare values

The modifiers review on 2026-09-13 reproduced a quantity-only held-order edit repricing an extra
from 1.00 to 9.00 when the request reordered JSON keys and modifier entries: the comparison was
reading how the request was written instead of what it said.

Since the extras-and-options order path (2026-09-20) that comparison lives in `updateHeldOrder`
(`apps/server/src/working-order.ts`). It rebuilds what the request's answers would freeze NOW
(`buildLineExtras`, `apps/server/src/modifier-selection.ts`) and compares that with what the stored
line holds, by value. The helper this replaces, `sameModifierSelections`, no longer exists.

**Neither side's ORDER is part of the comparison either, and the reason is worth carrying.** Both
sides are built in the order the dish OFFERS its answers, which reads as a fixed thing and is not
one: it is a stored position in `product_modifiers.sort` and `extra_list_items.sort`, re-numbered
from the body of each save. `docs/developers/modifiers.md` lists what writes each. So a
line parked before one of those saves keeps the OLD order while the rebuilt side comes back in the
new one — and a comparison pairing the two up position by position reads that as a changed answer.
That is why the pairing is order-independent (`sameOptionSelections`, and for extras
`editLineExtras`, which replaced `matchExtraChildren` with menus plan D10). Measured on 2026-09-20
for BOTH comparators, through the column a product save writes: the options half and the extras
half each re-issued every line under a new id and re-priced the dish. Since plan D10 a changed
answer no longer re-prices anything (an answer carries no price), but an order-dependent pairing
would still remove a kept extra and price it again as a new pick.

**A stored extras child records the list it came off (`working_order_lines.extra_list_id`), and a
pick pairs with it only on the same list, product and quantity.** A pick moved between two lists
offering the same product, or two picks exchanging counts between them, pairs with nothing and is a
new pick, priced now; an unchanged pick keeps its child at its own list's stored price.
`docs/developers/modifiers.md` has the detail.

What covers it, in `apps/server/src/working-order.test.ts`: "keeps extras rows and customisation on
a quantity-only edit" raises the offer's price and the extra list item's price, republishes the
menus, and asserts the parent and its child keep their ids and locked prices; "keeps the line's id and locked price when
two options lists change places" and "keeps each extras child on its own row when two extras lists
change places" do the same across a reorder; "keeps an extra's list and stored price on a quantity-only
edit when two lists offer it" pins the list pairing; "prices a pick now when it moves to another list
offering the same product: it is a new pick" and "prices both picks now when two lists offering the
same product exchange their counts: each is a new pick" pin its refusals, by the BILL rather than by
an id — two picks exchanged
between a 1.00 list and a 3.00 one cost 5.00, not the 7.00 a crossed pairing charges.

## A replay reports the original transaction facts; side effects are gated separately

Cash change was returned as zero on a retry because the receipt reader treated displaying change as
dispensing it. Persist the tendered cash and reconstruct the same ticket; keep drawer opening on the
fresh settlement path. Regression: `apps/server/src/till-api.receipt.test.ts`, “replays and reprints
the original cash handed over and change”.

A hand-keyed card opens the drawer too, for its slip (B30), on the same fresh path only. Its replay
cases, the “a replay opens nothing more” sale and collect cases in
`apps/server/src/till-api.fiscal-sale-paths.test.ts` and the “once only on a resend” case in
`apps/server/src/bill-payments-api.test.ts`, each failed when the drawer was also opened on a replay
(2026-10-01).

## A device opens the drawer when its profile allows it; a handheld does what a till does

The owner, 2026-10-01: _"A handheld should be able to do pretty much anything a till can do, it just
depends on the permissions of the person using the handheld."_ A handheld places, collects and
cancels like a till; the operator's permissions decide. Placing, and cancelling an order with no
invoice, check no permission, only a signed-in operator; cancelling an order whose invoice was
issued needs `sale.rectify` (C126), which staff do not hold, from the operator or from someone
holding it who enters their PIN, as an unpaid departure, a bill refund and opening the drawer accept (B33);
collecting, like every route that takes
a payment, needs `sale.take_payment` (C128), which every role holds. Guard:
`apps/server/src/take-payment-permission.test.ts`, weaker than its name — it covers only the four
routes it names, so a fifth payment route that does not ask for the permission is seen by nothing;
and since every role holds the permission, it makes the refusal by wrapping `authorize`, so no real
role is ever refused.

Since A238 (owner, 2026-10-03; `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md` §2
and §4), what a device may do with cash and the drawer is set on its device profile, never on the
device, by its form factor, or per till. The per-till "Opens the cash drawer" switch of 2026-10-02
(B29) is gone with the `tills` table; a till that must not open a drawer it shares with another
till gets a profile of its own.

- **Opening the drawer by itself.** A cash sale, a hand-keyed card's slip, a collect, a bill payment
  and a bill refund each open a drawer only through `drawerPrinter`
  (`apps/server/src/receipt-print.ts`), which returns the requesting device's current receipt
  printer only when that printer is active and has a drawer and the device's profile allows
  `open-cash-drawer` ("Open cash drawer" in the profile editor; `profileAllows`,
  `packages/layouts/src/device-profile.ts`). A handheld whose profile has it opens the drawer like a
  till; a till whose profile lacks it opens none, and so does a kitchen display, whatever its
  stored list names.
- **The Open drawer button** (`POST /api/drawer/open`, `apps/server/src/till-api.ts`) needs a
  signed-in session, and a session always belongs to a device. Disabling a device ends its
  sessions, so they answer `session.required`; a session left open on a device turned off outside
  the Disable route answers `device.unauthorized` (`requireSession`,
  `apps/server/src/till-session.ts`). A profile without
  `open-cash-drawer` is refused `device.forbidden_action` (`assertDeviceCapability`,
  `apps/server/src/device-session.ts`); the operator always needs
  `cash.drawer` or the PIN of someone holding it; then the device's current receipt printer must
  exist (`drawer.no_printer`) and have a drawer (`drawer.not_attached`).
- **Taking cash.** A cash sale (`POST /api/sales`), a cash collection
  (`POST /api/working-orders/:id/collect`) and a cash bill payment
  (`POST /api/working-orders/:id/payments`, `apps/server/src/bill-payments-api.ts`) from a device
  whose profile lacks `take-cash` ("Takes cash") are refused `device.cash_not_allowed`
  (`assertTakesCash`, `apps/server/src/device-session.ts`), and the till app offers no cash choice
  there. A bill refund is checked by how its payment was taken (`refundTender`,
  `apps/server/src/bill-refunds.ts`): a cash one the same way.

Regressions: the drawer cases in `apps/server/src/receipt-print.test.ts` (among them "every device
whose profile allows the drawer opens its receipt printer's drawer"),
`apps/server/src/till-api.receipt.test.ts` ("opens a handheld's drawer on a cash sale when its
profile allows the drawer"), `apps/server/src/till-api.fiscal-sale-paths.test.ts` and
`apps/server/src/bill-payments-api.test.ts`; and the `device.cash_not_allowed` cases in
`till-api.test.ts`, `till-api.fiscal-sale-paths.test.ts` and `bill-payments-api.test.ts`, and the
cash refund case in `till-api.profile-actions.test.ts`. Weaker
than the rule: each holds only the routes it names, so a new route that queues a `drawer` job
without `drawerPrinter`, or takes cash without `assertTakesCash`, is seen by nothing.

One path is outside the rule: the dashboard's "Test open drawer" calibration,
`POST /management-api/printers/:id/test-drawer` (`apps/server/src/print-api.ts`), opens any
active printer's drawer for a manager holding both `printer.manage` and `cash.drawer`, with no
device behind it: its audit row names the printer and the manager and no device. The owner chose to
leave it as it is (2026-10-02, B29).

## A device's profile and the signed-in person must both allow what the device does

Since W97 (spec `docs/superpowers/specs/2026-10-04-devices-menus-and-service-zones-design.md`) a
device profile decides where its devices serve, who may sign in on them and what they may do, and
the server checks each at the route, never trusting the till's copy:

- **Actions are checked at the route, beside the person's permission.** A till route that orders,
  takes a payment, prepares, hands over, prints or opens the drawer checks the profile's action
  (`assertProfileAction` or `assertDeviceCapability`, `apps/server/src/device-session.ts`) as well
  as any permission it already asked of the person, except the routes the action map named below
  lists as left unchecked by decision. Showing or hiding a screen (`show-*`) decides only what the
  till draws; a hidden screen's route is still refused by its action. Which route
  needs which action, and the case that fails without each check, is the map at the top of
  `apps/server/src/till-api.profile-actions.test.ts`; the zone each route acts in is the map at the
  top of `apps/server/src/till-api.profile-zones.test.ts`. A new till route adds a row to each and a
  refusing case. Weaker than that sounds: both maps are comments, and nothing fails when a new
  route has no row.
- **A kitchen display may only prepare.** A `kds` profile is a shared display with nobody signed
  in: `profileAllows` refuses it every action but `prepare-orders`, even one its stored list
  names, and with nobody signed in a till route that needs a session answers `session.required`.
  Ordering, payment and the drawer always need a named person.
- **Where a profile serves.** A profile that takes orders has one department, a set of that
  department's zones or all of them (`allowedZoneIds: null`, read as the department's zones still
  switched on), and a starting zone. A new order with no zone named starts in the starting zone,
  or, when that zone is switched off or has left the department, in the first of the profile's
  usable zones by position; with none it is refused `device_profile.no_service_zone`
  (`readProfileZones`, `packages/venue-service/src/profile-access.ts`). A zone outside the profile
  is refused `service_zone.not_allowed`, and lists show only the profile's zones and their orders.
  A profile with no department row keeps the venue's counter-default zone.
- **A kitchen display's station and watcher lists are its manager's choices, not its routing.** The
  manager gives each device on the profile one station or watcher from those lists (Devices →
  edit); what reaches that station still comes from the venue's routing. Taking an entry off a list
  while a device shows it is refused, naming the device (`device_profile.station_in_use`,
  `device_profile.watcher_in_use`).
- **Who may sign in.** `GET /api/staff` with a device lists only the people its profile admits
  (`listStaffAdmittedTo`, `@waitron/identity`); a list of colleagues that is not a sign-in list,
  such as the schedule's, asks with `everyone=true`. A switch to another approved profile checks
  the person's admission again; that switch, and a manager moving the device onto another profile
  (Devices → edit), end the sessions the new profile does not admit, and a move onto a kitchen
  screen's profile ends every session on the device, whatever that profile's admission list says,
  since nobody signs in on one (`endSessionsNotAdmitted`, `apps/server/src/device.ts`).

## A successful write followed by a failed refresh is a load failure, not a failed save

Close the editor after the write succeeds, then refresh the list separately; retaining a create form
with a save error invites a duplicate submission. The Departments and zones screen's regression resolves creation,
rejects the following load and checks the closed modal plus load error
(`packages/venue-service/src/dashboard/venue-operations-screen.test.ts`, “refreshing the list
fails”).

**The dashboard shell and its sessions**

## Automatic dashboard reads are passive session activity

Use the shared query controller or the request primitive's `passive` option for event refreshes and
timers. A normal GET touches the management session, so polling it would keep an unattended
dashboard signed in. Observer callbacks assign snapshots; they do not rerun loaders that reset
drafts. A screen may rerun the unfinished part of its most recent load from the query controller's
`recovered` callback, and only if that load did not complete; the same callback is where a screen
can clear a read error once the failed reads recover — on a screen that shares the field with
actions, only a read's message ([dashboard-live-updates.md](dashboard-live-updates.md)). On the
Backups screen a refresh never replaces a recovery key the screen made, because the operator may be
copying it and the box would then store a key nobody saved. Its status watcher asks for a key only
while the screen has made none, and at most once — a failed mint is not retried on every refresh,
because the mint is a POST and a POST is never passive — so a first status read that failed, or a
held key a later read finds too short, still gets a key. A key request already in flight is shared,
so Apply, Rotate and the watcher never race to set the shown key. A failed status read's alert
clears when a later status read succeeds or when Apply, Rotate or Save settings starts; an alert
from anything else — an action, showing the old key, or a failed mint — stays until the screen is
reopened or a key or settings action clears it. See `docs/developers/dashboard-live-updates.md` and
the passive-session and backup-screen regressions
(`apps/dashboard/src/screens/backup-screen.test.ts`, "the status watcher's key requests and read
alerts").

## A background API client does not make POST requests passive

The request primitive marks only GETs as passive. Automatic renewal of a pairing hold uses an
explicit authenticated route that resolves the session without touching its activity time. Cost:
renewing the Add print agent dialog through the route that opened the window moved session expiry
forward by ten minutes in the regression. Today's routes are in `apps/server/src/join-api.ts`:
taking a hold (`POST /management-api/pairing-mode/holds`) extends the session, and renewing one
(`POST /management-api/pairing-mode/holds/:holdId/renew`) leaves it unchanged and still refuses
expired sessions (`apps/server/src/join-api.db.test.ts`, “renews a hold without extending the
session, while taking a hold extends it” and “refuses renewal after the management session
expires, and the hold is not renewed”).

## Dashboard subscription names travel with their server sources

Core and contributed screens export `QUERY_DEPENDENCIES`; `scripts/live-subscriptions.test.ts`
checks those names against shipped resources. A rejected subscription closes the whole tab's
stream, so a misspelled name affects other screens too. The guard catches unknown names, not missing
SQL dependencies or disabled-module combinations. Cost: the live-updates run-it review found this
unguarded coupling.

## The dashboard banner is persistent identity chrome

Put it at the very top of the page at full width, with the menu and content underneath. Show the
canonical Waitron lockup and the deployment tenant's legal name on login and every authenticated
screen. Put the account menu (a person-icon `wt-row-actions` popover holding Account settings and
Log out) at the trailing edge only when a session exists. Use the tenant name, not a location: a
deployment database has one tenant and that tenant can contain several locations
(`packages/db/src/schema/tenants.ts`).

## The dashboard and pre-login till match the browser's `Accept-Language`

The public locale response carries a separate `loginDefault`, and `venueDefault` still describes the
venue. A signed-in person with no saved language gets `sessionDefault` from
`GET /management-api/session/me`: that request's own browser match, floored at the venue locale when
the browser asks for nothing Waitron ships. It is derived per request and never stored, and a saved
language still wins. Account emails have no browser to ask, so a person with no saved language gets
the venue default there. Before till login, `GET /api/locales` uses the same browser match; after
logout the till returns to it. A till operator with no saved language still gets the venue default.
An enrolled kitchen display that skips login also stays on the venue default.
Returning to login after logout or session expiry uses the last browser match, or the venue default
until that match is available. Guard late locale responses so they cannot overwrite a newly
authenticated person's language or an explicit choice on sign-in
(`apps/dashboard/src/dashboard-app.test.ts`, `apps/till/src/till-app.test.ts`).

## Dashboard login offers methods without revealing account enrolment

Offer passive browser passkey autofill on email entry, then open the password form after Continue
unless an opted-in local preference selects another method. A modal passkey prompt requires an
explicit action; navigation, refresh, logout and session expiry never open one. Do not query account
status or passkey enrolment to choose the public screen. Save the authenticated email and successful
method only with Remember selected, never in tab storage. The change-account icon clears the saved
shortcut and current attempt. Recovery uses one public entry for pending-account setup and
active-account reset, with the same acknowledgement for every address. Owner decision, built in
#317.

## A login's refusal never says whether the account exists

The owner's rule (2026-09-30): "reasons for login shouldn't expose the existence or non existence
of a user. so any failure should just report that the login failed." Every password and PIN
sign-in answers an unknown account, a suspended or pending one, one with no credential set, a wrong
password or PIN and a wrong authenticator or recovery code with ONE code, the same params and the
same status — `password.invalid` for a password login, `pin.invalid` for a PIN — each after the
same hashing work, and a screen shows it as one sentence for every cause — "the login failed"
as the form's bottom message on the dashboard and the setup wizard's Connect, "Wrong PIN" on the till, where
the PIN is the only thing typed. A refused sign-in marks no field on any sign-in form, the setup
wizard's Reset form included (`apps/setup/src/screens/reset-screen.ts`); there a field is marked
only when its value is missing or malformed (owner, 2026-09-30, A153).
Passkey and Google sign-in keep their own codes: `passkey.verification_failed` for a passkey whose
owner is not active, a bad signature or a used-up challenge (`packages/identity/src/passkey.ts`),
`google.invalid` for a Google account linked to nobody or to a person who is not active
(`loginWithGoogle`, `packages/identity/src/google-oidc.ts`). **One exception, owner-approved
(2026-09-30, C101): a passkey Waitron holds no row for answers `passkey.not_registered`**, and the
dashboard asks the browser to forget it (`signalUnknownCredential`, `apps/dashboard/src/passkey-signals.ts`)
and says so. The answer says only whether that credential id has a row, and it is given before any
signature check, so the id plus a challenge, which anyone can fetch without signing in
(`POST /management-api/passkey/auth/options`), is enough to ask. A credential row has no status of
its own (`webauthn_credentials` in `packages/identity/src/schema/webauthn.ts`) and suspension keeps
it, so a suspended owner's passkey stays the generic answer. A manager's login reset and a reactivation do delete the person's
passkeys (`resetPersonLogin`, `reactivatePersonForInvitation`, `packages/identity/src/staff.ts`),
so after either, an old passkey answers `passkey.not_registered` like one the person removed.
Guards: the unknown, wiped-install, login-reset and suspended cases in
`packages/identity/src/passkey.test.ts` (the wiped-install case runs the same lookup as the unknown
one, since the lookup never reads the user handle), and the unknown and suspended route cases in
`apps/server/src/management-api-passkey.test.ts`.
Identity's password and PIN refusals carry the real cause for the server log only:
`new AppError(code, {}, { reason })`, whose `reason` a route using `createErrorBoundary`
(`packages/server-kit/src/error-boundary.ts`) logs as `logReason` and never answers. No reason is
carried by the refusals `apps/server` throws itself — a malformed id or body, a missing credential,
the setup Reset's proof check (`till-api.ts`, `management-api.ts`, `mirror-bundle-api.ts`,
`promote-api.ts`, `setup-api.ts`) — nor by the standby box's relayed `password.invalid`
(`mirror-bundle-fetch.ts`), nor by the passkey and Google refusals. Validation that does not depend
on the account (an empty required field, a malformed code) may still sit under its field; a
signed-in person re-checking their OWN password, PIN or code may be told which one was wrong. These
answers are reachable only after a credential was proved and stay: `totp.required` (the
dashboard's code step, after a right password), `google.second_factor_required` (after a valid
Google sign-in) and `authorization.not_permitted` (403 from standby connect, promote and
`GET /management-api/membership` when the password and code are right but the person lacks the
permission, and from the drawer, refund, unpaid-departure and cancel overrides (`authorize`,
`packages/identity/src/authorize.ts`) and the manual-refund confirmer when the PIN is right but the
person lacks the permission). The adjustment approver answers `adjustment.approval_required` for a
right PIN whose role is too low (`apps/server/src/adjustments-apply.ts`). Guards: the one-answer cases in `packages/identity/src/manager-login.test.ts` and
`packages/identity/src/login.test.ts`, and route cases in `apps/server/src/management-api.test.ts`
(the dashboard sign-in), `mirror-bundle-api.test.ts` (standby connect),
`promote-api.authenticator.test.ts`, `till-api.test.ts` (the till's sign-in) and
`till-api.receipt.test.ts` (a drawer override) — weaker than the set looks:
`GET /management-api/membership` (whose suite, `management-api.membership.test.ts`, tries a wrong
password and a wrong code), the adjustment approver (`apps/server/src/adjustments-apply.ts`, tried
in `adjustments-api.test.ts`), the refund override and the manual-refund confirmer
(`apps/server/src/bill-refunds.ts`, both tried in `bill-payments-api.test.ts`), the
unpaid-departure override (`apps/server/src/unpaid-departure.ts`) and the cancel override
(`apps/server/src/working-order.ts`) have suites that try a wrong password or PIN (and, for the
membership route, the adjustment approver and the cancel, a malformed one), not an unknown,
suspended or pending person, so for those causes they rest on identity's cases alone; and a new
sign-in route is seen by none of them. Built in C95, #930.

**UI primitives in `packages/ui`**

[design-system.md](design-system.md) is the DESIGN authority for the rules in this group and states
several of them more broadly — the token rule there binds any component or view, not only
`packages/ui`. What follows records what the GUARDS mechanically enforce, which is narrower and in
one place wider: `packages/ui/src/no-hardcoded-chrome.test.ts` scans `packages/ui/src/components/*.ts`
only, and its forbidden list includes `color()`, which design-system.md's wording omits. Where the
two differ, the guard decides what CI does and design-system.md decides what a reviewer should ask
for.
The shared package also runs `packages/ui-core/src/no-hardcoded-chrome.test.ts` and
`packages/ui-core/src/tap-target-and-focus.test.ts` directly over its own controls.

## No hardcoded chrome

Every colour, spacing, radius, and font value in a `packages/ui/src/components/*.ts` component's
`static styles` must read a `--wt-*` custom property: no hex, no
`rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`/`color-mix()`, no named colours,
no `px` above `1`, no `rem`/`em` at all (including inside `min()`/`max()`/`clamp()`). `transparent`,
`currentColor`, and `inherit` are legitimate escape hatches, not chrome.

This is enforced automatically by `packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers
every component via `import.meta.glob("./components/*.ts", ...)` — a new component is covered the
moment the file exists, with nothing to register. If a needed token doesn't exist, it belongs in
`packages/ui-core/src/tokens/`, not inlined.

A `--wt-*` name a stylesheet reads must be declared somewhere, anywhere under `apps/` or
`packages/`: CSS gives a property that reads an undeclared name with no fallback its inherited or
initial value, and one with a fallback the fallback for ever, and reports nothing, which is how the
Cloud services screen's labels rendered at the body weight (C69).
`scripts/style-token-names.test.ts` enforces it over every tracked `.ts`, `.css` and `.html` file
under `apps/` and `packages/`, as it stands in the working tree, whose name does not end
`.test.ts`, reading text; its header lists what that cannot see, and its `FALLBACK_READS` names the
till reads it excuses.

## Real Chromium only — never jsdom

`packages/ui` tests run in real Chromium via Vitest browser mode (`@vitest/browser-playwright`),
not jsdom. Token/theming tests depend on `getComputedStyle` resolving CSS custom properties and on
`adoptedStyleSheets`, neither of which jsdom implements — a jsdom-based version of these tests would
pass regardless of whether the component actually works. Never suggest introducing jsdom,
`happy-dom`, or DOM-mocking test utilities into this package, and never suggest swapping a
Playwright/Chromium test for a jsdom one "for speed."

## A new primitive needs two specific tests, not just "some tests"

A new `wt-*` primitive under `packages/ui/src/components/` is incomplete review-wise without:

1. A token-painting test — set a `--wt-*` token on the mounted host
   (`host.style.setProperty(...)`) and assert the computed style follows it. A component that
   renders correctly but ignores its tokens is not a compliant primitive.
2. An axe accessibility test in a sibling `*.a11y.test.ts` file (see
   `packages/ui/src/a11y-helpers.ts`), covering every meaningfully distinct accessibility-relevant
   state (open/closed, checked/unchecked, invalid, disabled, icon-only, ...) in both light and
   dark themes.

## Event discipline

This rule is the contract for shared `wt-*` components. Their custom events are named `wt-*`, carry
their payload in `detail`, and are dispatched with `bubbles: true, composed: true` so they can cross
the component's own shadow boundary. Before re-emitting, the native or internal event that triggered
them must be stopped with `event.stopPropagation()` — otherwise a composed native event such as
`input` independently crosses the same boundary and the consumer observes the change twice. Not every
native event is composed: measured 2026-09-28 with a standalone Playwright 1.63 script in Chromium
153, an input inside a shadow root, filled with Playwright's `fill` and then blurred by a click
outside, delivered `input` with `composed: true`, which a listener on the document saw, and `change`
with `composed: false`, which a listener inside the shadow root saw and the one on the document did
not. App screens and app-owned components may name their local action events plainly, as the till
screens do with events such as `fire-course` and `mark-collected`.

**Printing and hardware**

## A retained hardware registration must remain re-addable after deactivation

Discovery matches disabled records as well as active ones; the dashboard offers disabled matches
(printers and card readers as Enable) and reactivates their existing id, preserving
history and routing. Only active matches
disappear from the add list. Cost: deleting a USB printer left it in the registered table and hid it
from discovery, blocking re-add. The table now defaults to Active with Disabled/All filters. Built in
#321.

Devices follow the same rule, though nothing discovers them. A disabled device's browser keeps its
`waitron_device` cookie, and a knock whose cookie token verifies against a disabled row
(`provenDisabledDevice`, `apps/server/src/join-requests.ts`) takes that device's id: the pending list
marks it `returning`, with the row's name, profile and binding, and whether that profile was
retired (`profileRetired`, which the waiting list's hint reads and which starts Enable's Profile
empty), and accepting it enables the same
row. If that profile was retired since (deleted while only disabled devices held it), accepting with
it is refused `device_profile.not_found` and the request stays, so Enable needs another profile.
Outside dev mode it still needs an open Add a device dialog and the number check; in dev mode
(`config.devMode`) the knock skips both and the device is enabled at once, under the venue's
default till profile and the name the browser sent rather than its own (`apps/server/src/device-api.ts`).
The knock gives the disabled
row the new request's token, so the old cookie stops working and the same browser can knock as
itself again after a deny or a lapse. Disabling ends every shift session open on the device in the
same transaction. The till's sign-in checks the PIN before the transaction that opens the session,
so inside that transaction it checks the device again: still active, and still holding the token
hash the cookie was verified against, or it is refused `device.unauthorized` and no session opens
(`assertDeviceStillProven`, `apps/server/src/device-session.ts`). A Disable, or a Disable and then
an Enable, landing while the PIN is checked therefore leaves no session open
(`apps/server/src/join-e2e.test.ts`, "a sign-in that Disable overtook is refused, and opens no
session" and "a sign-in that Disable and then Enable both overtook is refused, and opens no
session"). The same check hands back the device as it stands at that moment, and the sign-in
refuses it `device.forbidden_action` (`action: "sign_in"`) if its profile is now a kitchen
screen's (`refuseKitchenSignIn`, `apps/server/src/till-api.ts`), so a move onto a kitchen-screen
profile while the PIN is checked opens no session (`apps/server/src/join-e2e.test.ts`, "a sign-in
overtaken by a move onto a kitchen-screen profile is refused, and opens no session"). Enabling
still ends any session open on the device, a second line for a device turned off outside the
Disable route. A
knock whose proof another knock or Pair overtook is refused `device.join_stale` with no new cookie,
so the browser keeps the one it has. Cancel and the number check name the ask by its `createdAt` as
well as its id, and a replacing knock always gets a later `createdAt`, so a dialog still showing the
replaced ask can neither discard, refuse nor claim the new one; it is answered
`join_request.not_found`, unless a number check's pairing hold has lapsed, which is answered
`device.pairing_hold_lapsed` first, a refusal that names no ask. One case is not covered: if a knock's response is lost after
the server committed it, the browser still holds the old token, which no longer matches, and its
next knock joins as a new device. The cost is a new device row; the old one stays disabled.
Guards: the "a disabled device comes back as the same device" cases in
`apps/server/src/join-e2e.test.ts`, "a dialog still showing the ask a second knock replaced" in the
same file, and "a returning disabled device" in
`apps/server/src/join-requests.test.ts`. Built in W105b.

## Native centring starts inside the configured paper width

Set the ESC/POS left margin to zero and the print area to the width the job's pictures are drawn to
before selecting native centre alignment. The owner's 17:40:44 photograph on 2026-09-26 showed the
body and QR shifted right and clipped on a 58mm roll; that payload carried no print-area commands.
Whether the printer's own width setting also contributed was not tested. Since 2026-10-01 (C107)
text lines are drawn into full-width pictures with their centring already in them. The receipt
sends a native centre command, and a return to left after it, around its QR block (caption, QR
picture, legend), around its top block (logo, names, slogan, address, phone, email, the "Duplicate"
label, `NIF`; W111, 2026-10-05) and around its footer message when it has one; a receipt with no
QR still sends the other two (`apps/server/src/receipt-ticket.ts`). The QR and the logo are drawn
only as wide as themselves, not as wide as the line, so where they land across the paper is the
printer's own centring.
`apps/server/src/receipt-ticket.test.ts` pins the print area at the start of the job, 360 dots in its
58mm case and 512 in its 80mm one, and that every line's picture is that wide;
`apps/server/src/print-job-preview.test.ts` pins only that the dashboard preview consumes both
commands rather than stopping at them. The preview does not model their width, and a corrected
physical reprint is still owed.

## The hardware transport seam is `@waitron/print-agent`, and it is database-free

It becomes a standalone LAN process that reaches a server over HTTP only, so it imports no other
package in this repo; `@waitron/printing` depends on IT, never the reverse. An empty `dependencies`
block is not the guard — `main` points at TS source with no build step, so
`../../db/src/index.js` resolves and runs while the manifest still reads dependency-free (measured:
with the zone removed that import lints clean). The guard is the `import-x/no-restricted-paths` zone
in `eslint.config.js`, alongside `packages/shared`'s. Designed and built in #289.

## A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`, not `/dev/usb`

A `/dev/usb` subdirectory bind goes stale when the printer is re-plugged (the node vanishes and does
not return); a hard `devices: /dev/usb/lp0` line refuses to start when no printer is attached. The
shape that survives both — measured on the real box 2026-09-10 — is the whole `/dev` mounted
read-only plus `device_cgroup_rules: ["c 180:* rwm"]` (the usblp major) and `group_add: ["7"]` (the
`lp` group's write bit); `:ro` still permits writing an existing device node but refuses `mknod`.
The cgroup rule ADDS major 180 to Docker's default device whitelist (null, zero, full, random,
tty, …); a class that is neither a Docker default nor 180 (e.g. hidraw) is what gets denied. Pinned
by `scripts/deploy-image-env.test.ts`; built in #308.

## The print agent runs under its own AppArmor profile, and a `bluetoothctl` call that sends a bus message the profile does not list is refused

Docker's default AppArmor profile refuses the system bus, so under it `bluetoothctl` cannot reach
BlueZ: on the owner's box (2026-09-29) the bus refused the agent's first message, `Hello`, and the
agent listed no Bluetooth printers. `deploy/apparmor/waitron-print-agent` is Moby's `docker-default`
template plus bus rules for the messages `bluetoothctl list`, `devices Paired`, `scan on`, `scan off`,
pairing with a PIN through its interactive agent, and `remove` were seen to send and receive
against a stand-in BlueZ (`scripts/fake-bluez.py`), and for the `Disconnected` signals the owner's
printer sent after its pairing (the owner's box, 2026-09-29); every other bus message is refused, `trust` and
`disconnect` among them (probe run 36585218089 on a CI runner; `trust` again in 36617716323).
`bluetoothctl info` worked under these rules: probe run 36629179144, a CI runner against the
stand-in, asked it of the stand-in's four printers at once and each exited 0 printing its class and
icon; that run stopped before its refusal check, so whether `info` drew any refusal was not read.
`waitron.sh install` loads it where AppArmor is on and only then writes
`WAITRON_PRINT_AGENT_APPARMOR` to `.env`; `deploy/compose.yml` falls back to `docker-default`
without it. The order matters because Docker refuses to start a container naming a profile the host
has not loaded — measured 2026-09-29 on a GitHub runner (Ubuntu 24.04.5, Docker 28.0.4, AppArmor
parser 4.0.1), with both `docker run` and compose. Docker Desktop 29.3.0, which has no AppArmor,
ignored the option.

So a `bluetoothctl` call that sends a bus message the profile does not list — from a new command,
or an old one that starts sending it — is refused at the bus until the profile gains a rule for it. Nothing outside
image-smoke runs the agent under the profile, and on a pull request image-smoke runs only when an
image input changed — a path under `deploy/`, or a file image-smoke runs, such as
`scripts/fake-bluez.py` or the Bluetooth sender `apps/print-agent/src/rfcomm-send.py`
(`IMAGE_SMOKE_FILES` and `isImageInputPath`, `scripts/changed-scope.mjs`; the `image` job's `if:` in
`.github/workflows/ci.yml`), so a pull request that changes only other files under `apps/print-agent`
is not checked against the profile; on a push to `main` it also runs whenever code changed. Of the agent's
own `bluetoothctl` calls, image-smoke runs only the paired listing, by waiting for
`bluetooth.available` in the agent's `/status.json`; every other command it checks is written into
its Bluetooth steps, so a new call is checked only once a step runs it too. It also runs the
Bluetooth sender, `apps/print-agent/src/rfcomm-send.py`, invoked directly rather than through the
agent's `RfcommTransport`, and only as far as creating its socket, because the runner's kernel has
no Bluetooth; it fails when the helper does not exit 1 with its `rfcomm … [Errno` line, or when
that error is errno 13 (the profile refusing the socket). It pairs through its own
driver, `scripts/bluetoothctl-pair.mjs`, not the agent's Pair code, so a bus message the agent's Pair
starts sending is checked only once the driver sends it too. It reads the kernel log with the
kernel's printk rate limit switched off and requires at least one refusal logged during the step
with `member="Set"`, which the `trust` control sends, and fails on any other refusal. With
the limit on, the same
probe run logged one AppArmor line of the nine a pairing and two removes produced, so a clean read
proved nothing.
`scripts/deploy-image-env.test.ts` reads the profile as text and checks that every rule allowing bus
messages names its interface and members literally — no `*`, `?` or `[…]`, though a `{a,b}` list is
accepted — while paths may keep their globs; it does not notice a literal list that has grown. Built
in A129; the receipts are in the profile's header.

**The recovery page**

## The unauthenticated recovery page: curated title and action, and the failed start's own lines

The title and action are fixed strings chosen by the error code, in English and Spanish, and never
suggest wiping anything. Below them the page shows why the last start failed and the tail of
`waitron.log`. Owner decision 2026-09-26: a box that failed during a migration showed `unknown` above
a tail from the previous, successful run, and the reason was only in `docker logs`, which the
operator cannot read. So every start counted as an attempt writes `server.boot_started` to
`waitron.log`, and a failed one writes `server.boot_failed` carrying its code and `detail` — the
error's name and message, the stack, each `caused by` in its cause chain up to five levels in all and an `AppError`'s params, through
`redactSecrets` (`runEntry`, `apps/server/src/node-entry.ts`). The page shows the latest start's `detail` in full,
read from the whole file so the tail's line cap cannot cut it off, and only when no later start
began; in the tail each failure's `detail` is laid out on its own lines.

Strings on the page that come from outside the image: the error CODE, `lastFailureAt`, the LOG TAIL
and the last failure's detail, all HTML-escaped. The failure count also does, read as a number, and
so does a recorded holder kind, which on the page only selects a fixed name from a closed table.
`/recovery-api/status` returns the kind itself; the read of `recovery.json` keeps it only when it is one of `VENUE_HOLDER_KINDS`. The
browser's `Accept-Language` also reaches the page, and only selects the language
`resolveLoginLocale` returns from the supported set (`apps/server/src/login-locale.ts`). The log
file's lines carry caught errors' own words and `AppError` params, and `redactSecrets` masks only a
password in a URL. So the convention that params never carry a secret (stated in the header of
`apps/server/src/errors.ts`) is what keeps a page anyone on the venue's LAN can open safe; a new code
carrying a credential in its params, or a logged message carrying one in any other form, puts it on
that page. Built in #310 and extended in #695; `apps/server/src/recovery-surface.ts`.

## Printed documents take the printer's own layout settings

A printed document never hard-codes a paper width or a QR size: it reads them from the printer it is
printing to (`paperWidth` and `resolution` on `printers`). Nothing is sent to a printer as text.
Every line is drawn on the server as a 1-bit picture 28 dots tall and sent with `GS v 0`, one picture
per line (`EscBuilder`, `packages/printing/src/escpos.ts`). Each letter is a 12-dot-wide picture from
a table derived from the font Iosevka Term Bold (`packages/printing/src/glyphs.ts`, made by
`packages/printing/scripts/build-glyph-table.mjs`; the licence ships from `deploy/third-party/iosevka/`),
so what prints does not depend on the character tables a printer holds. Outside the calibration
ruler page, a line's picture is as wide as the printer's dots across for its paper width and
resolution, 360, 384, 512 or 576 (`textGrid`, `packages/printing/src/layout.ts`, which says where
each number comes from; 576 is unmeasured), and its text sits on a grid of 30 columns on 58mm paper
and 42 on 80mm whatever the resolution, centred in the picture. Text is passed through `prepareText`
before it is measured, which turns a character the table cannot draw into a fixed replacement, the
same character without its accents, or `?`, and through `wrapText`/`labelAmountLines` before it is
printed, so one character is one column. Receipts, category sales pages and the printer test page
(`apps/server/src/printer-test-page.ts`) also set the printer's print area to the picture's width
(`printArea`, `GS L` and `GS W`). The calibration ruler page
(`apps/server/src/test-page.ts`) is the exception to both: whatever the printer, it sets a print
area of 576 dots and draws its captions 360 dots wide. Whether a job made of pictures still needs a
print area has not been measured. The fiscal QR is a raster image too, its dot size chosen per
receipt by `chooseQrDots` for the largest fitting size at most 40mm, reaching 30mm where the grid
and paper allow it, including its blank border when checking the paper width — never the printer's
own built-in QR command, which cannot be sized this way. The feed, the cut and the drawer pulse are
printer commands, not pictures.

The print preview shows the job's own pictures, and the text it reports is read back from them
(`apps/server/src/print-job-preview.ts`, through `readRasterText` in
`packages/printing/src/raster-text.ts`, which matches each 12-dot cell against the glyph table). A
test reads a payload's printed text the same way, with `printedLines`
(`apps/server/src/testing/decode-ticket.ts`), which fails the test when the preview stops at an
unsupported command or is cut short instead of hiding the rest of the ticket. Characters drawn
identically read back as one of them — a no-break space reads as a space — so a test cannot tell
those apart through the read-back. Built in #367; the QR size rule and the calibration wizard in
#689; text drawn as pictures, and the wizard's character step removed, in C107 (2026-10-01).

## Resolve live content and receipt snapshots separately

Live catalogue text uses enabled content languages and their configured default. Stored order and
sale descriptions contain receipt-language keys, so that filter can hide every recorded name when
receipt and content languages differ. Snapshot displays may fall back to a stored nonblank value;
they never rewrite the record. Regression: `packages/shared/src/content-languages.test.ts`,
“keeps a receipt-only name visible when the content default is absent”.

## Unsaved changes: shared close interception, owner-provided draft comparisons

W69's shared dialog API, confirmation and application renderers are implemented on its feature
branch. Product/Variant, Unit Add/Edit, Related Unit and explicit Product colour forms use the
shared registry; other modal/page owners remain in progress. The [backlog](../backlog.md)
records that boundary. Use `beforeClose`
with a scoped ui-core coordinator request and `requestClose(reason)`
for voluntary dismissal. Commit the exact submitted snapshot after a successful write, before
refreshing. Use `closeAfter("saved" | "security")` for success or forced teardown; forced exits
also invalidate the coordinator's pending decision and clear sensitive owner values.

The dialog tests exercise real Escape, repeated requests, reopening, disconnect/reconnect and
late native close reports. Closing and reopening twice before queued reports were delivered
produced two `wt-close` events in the new consecutive-opening test before the report-generation
check. The confirmation tests cover Keep/Discard, silent abort, keyboard focus, tokens and axe in
both themes; the integration suite exercises a retained edited field at phone and desktop widths
with EN/ES copy. Those shared-component checks do not establish protection in an unwired app form.

Each connected application shell owns one `LeaveController`; resolve its coordinator from a
contributed form with `leaveCoordinatorFor(element)` (`@waitron/ui`). A disconnected shell
releases its drafts and pending confirmation. A forced session exit calls `forceReset()` before
tearing down the session's forms; an asynchronous logout may call it after disconnect as well.
A renderer answer is tied to the question it rendered, so a removed renderer cannot answer a
later question. Behavioral cases: `packages/ui/src/leave-controller.test.ts`, and the application
renderer/security cases in each shell's suite.

The Unit form compares its trimmed translated request body, preserving translations it does not
show and invalid precision input. A Related Unit registers under its Product, and its successful
write commits the child before the Product accepts the new unit id. The Units screen commits
before its lookup refresh. Product colour compares its explicit override, including null for
inheritance; an answer for an earlier opening cannot commit a replacement Product. Behavioral
cases: `catalogue-forms.unsaved.test.ts`, `unit-owners.unsaved.test.ts` and
`menu-colour.unsaved.test.ts` under `apps/dashboard/src/`. Category colour selection submits
immediately and remains exempt.

On the W69 implementation branch, extras/options list forms register their normalized submitted
values and ordered rows. Their Product-related forms name the Product as their parent; the option
label names its list. List writes commit before a refresh or attaching a new list to the Product.
A label save commits that child before updating the list draft. Focused cases are in
`apps/dashboard/src/widgets/modifier-forms.unsaved.test.ts` and
`apps/dashboard/src/screens/modifier-owners.unsaved.test.ts`; other audited owners remain pending.

Menu and section metadata forms use that registry on the W69 branch. Their snapshots contain the
trimmed internal name and translations, image id and colour. Refusals retain the draft; successful
menu and section writes commit before closing and refreshing. The Section owns the image picker's
ancestry so a scoped leave can see staged image-name edits. Focused browser cases:
`apps/dashboard/src/widgets/section-details-form.unsaved.test.ts` and
`apps/dashboard/src/screens/menu-details.unsaved.test.ts`. Other modal owners and page navigation
remain part of the rollout.

On the W69 branch, Add-to-menus and section Add products register their selected ID sets.
Search/category filters do not author a write and stay exempt. Section additions commit before
closing and refreshing; each accepted placement is removed from its pending destinations, so a
partial refusal retains only the failed choices. Keep the placement dialog's own close event
available to its screen's focus return; nested close events cannot dismiss that owner. Cases:
`apps/dashboard/src/widgets/menu-selections.unsaved.test.ts` and the existing Catalogue/Menu
screen suites. Other audited owners remain pending.
