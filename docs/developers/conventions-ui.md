# Conventions — forms, the dashboard, UI primitives and hardware

This file holds the evidence behind the UI-facing conventions in the repo root `CLAUDE.md` section
3 — forms, the dashboard shell and its sessions, hardware and printing, and the unauthenticated
recovery page: the regressions, measurements and pointers that paid for each rule. `CLAUDE.md` keeps
the one-line version of each rule and points here for the rest.

**Forms and the shared UI contract**

## New or changed forms use the shared UI contract in `docs/developers/design-system.md` → Forms

Required fields are visibly marked; an attempted invalid submission shows explanatory text beside
every bad field and one localized message beside the primary action, which stays disabled until
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
bottom-left. Optional field explanations use `wt-help-tooltip`, whose button closes on outside click
or Escape. Cost: the dashboard login exposed `wt-input-N` to password safes and disabled incomplete
forms without saying what was missing (`ui-login`, owner review 2026-09-09).

## A refusal reaches a field by what the error carries, not by one parameter name

The product editor binds a refused save to an editor field. `product.invalid` carries the `field` it
is about, but `content.translation_required` — the refusal the editor's own translated inputs
produce — carries only the missing `language`, and one product save can have several translated
values checked (the product's customer name and one per variant saved Active; an Inactive variant is
never checked, `setProductVariants` in `packages/catalogue/src/variants.ts`), so the language alone
does not say which. What the save path can carry is pinned where it is thrown, in
`packages/catalogue/src/product-editor.test.ts` ("names the missing language, and nothing else" and
"refuses nutrition input without naming any field"): a refusal of an allergen or a dietary
declaration names neither a field nor a language, which is why nothing maps those onto the editor's
Nutrition section.

`productEditorTranslationField` (`apps/dashboard/src/widgets/product-editor.ts`) resolves the
language onto a value by reading the body that was submitted: every checked translated value missing
that language, which skips a variant submitted Inactive, is a fault the save has to clear, so it
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
one: it is a stored position, and three columns hold parts of it, each re-numbered from the body of
whatever save writes it. `docs/developers/modifiers.md` lists all three with what writes each. So a
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
a quantity-only edit" raises the offer's price and the extra's price underneath the edit and asserts
the parent and its child keep their ids and locked prices; "keeps the line's id and locked price when
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

## A successful write followed by a failed refresh is a load failure, not a failed save

Close the editor after the write succeeds, then refresh the list separately; retaining a create form
with a save error invites a duplicate submission. The Venue operations regression resolves creation,
rejects the following load and checks the closed modal plus load error
(`packages/venue-service/src/dashboard/venue-operations-screen.test.ts`, “refreshing the list
fails”).

**The dashboard shell and its sessions**

## Automatic dashboard reads are passive session activity

Use the shared query controller or the request primitive's `passive` option for event refreshes and
timers. A normal GET touches the management session, so polling it would keep an unattended
dashboard signed in. Observer callbacks assign snapshots; they do not rerun loaders that reset
drafts. On the Backups screen a refresh never replaces a recovery key the screen made, because the
operator may be copying it and the box would then store a key nobody saved. Its status watcher asks
for a key only while the screen has made none, and at most once — a failed mint is not retried on
every refresh, because the mint is a POST and a POST is never passive — so a first status read that
failed, or a held key a later read finds too short, still gets a key. A key request already in
flight is shared, so Apply, Rotate and the watcher never race to set the shown key. A failed
status read's alert clears when a later status read succeeds or when Apply, Rotate or Save
settings starts; an alert from anything else — an action, showing the old key, or a failed mint —
stays until the screen is reopened or a key or settings action clears it. See
`docs/developers/dashboard-live-updates.md` and the passive-session and backup-screen regressions
(`apps/dashboard/src/screens/backup-screen.test.ts`, "the status watcher's key requests and read
alerts").

## A background API client does not make POST requests passive

The request primitive marks only GETs as passive. Automatic pairing renewal uses an explicit
authenticated route that resolves the session without touching its activity time. Cost: renewing
the Add print agent dialog through the ordinary Open route moved session expiry forward by ten
minutes in the regression; the renewal route leaves it unchanged and still refuses expired sessions
(`apps/server/src/join-api.db.test.ts`, “renews the window without extending the session”).

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

## The dashboard matches the browser's `Accept-Language` for anyone with no saved language

The public locale response carries a separate `loginDefault`, and `venueDefault` still describes the
venue. A signed-in person with no saved language gets `sessionDefault` from
`GET /management-api/session/me`: that request's own browser match, floored at the venue locale when
the browser asks for nothing Waitron ships. It is derived per request and never stored, and a saved
language still wins. The till and account emails have no browser to ask, so a person with no saved
language gets the venue default there. Returning to login
after logout or session expiry uses the last browser match, or the venue default until that match is
available. Guard late locale responses so they cannot overwrite a newly authenticated person's
language or an explicit choice on sign-in (`apps/dashboard/src/dashboard-app.test.ts`).

## Dashboard login offers methods without revealing account enrolment

Offer passive browser passkey autofill on email entry, then open the password form after Continue
unless an opted-in local preference selects another method. A modal passkey prompt requires an
explicit action; navigation, refresh, logout and session expiry never open one. Do not query account
status or passkey enrolment to choose the public screen. Save the authenticated email and successful
method only with Remember selected, never in tab storage. The change-account icon clears the saved
shortcut and current attempt. Recovery uses one public entry for pending-account setup and
active-account reset, with the same acknowledgement for every address. Owner decision, built in
#317.

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

## A `<select>` over rendered options marks the chosen option, not only the select's `.value`

In a Lit template, a `.value=${…}` binding on a `<select>` whose `<option>`s come from a `${…}`
expression does not show the chosen value on the first render. A throwaway probe run on 2026-09-14
in `packages/ui`'s real-Chromium Vitest rendered `<select .value=${"b"}>` holding a static
`<option value="">` followed by two options from `${options.map(…)}`. An element directive on the
same `<select>` recorded 1 option when the select's own bindings ran and 3 once the render finished,
and `select.value` was `""`. Rendering the same template again with the same value left it `""`,
because Lit does not set a property binding again when its value is unchanged. Two controls went the
other way: the same `.value` binding over three static options gave `"b"` (3 options when the
bindings ran), and `.selected=${…}` on each mapped option, with no `.value`, gave `"b"`.

Cost: `wt-data-table` restored a remembered filter and narrowed the rows while its dropdown read the
"all" option. The fix, commit `4ca816b2`, moved the choice onto each option's `.selected` and added
the test `a restored filter's dropdown shows the restored choice` in
`packages/ui/src/components/wt-data-table.test.ts`. Putting the lone `.value` binding back on the
2026-09-14 tree fails that test with `expected '' to be 'off'`.

The siblings that already avoid it: `apps/dashboard/src/screens/device-profiles-screen.ts`
`#renderCanvasOptions` and its form-factor dropdown put `?selected` on each option (an attribute
binding, which the probe above did not test), and every mapped `<select>` in
`apps/dashboard/src/widgets/product-editor.ts` — the tax, unit, station and course dropdowns — marks
its options `.selected` and binds no `.value` on the `<select>` at all, which is the shape this rule
recommends. Nothing guards
the rule; the dropdowns a text scan found still binding `.value` alone over mapped options are listed in `docs/backlog.md`.

**Printing and hardware**

## A retained hardware registration must remain re-addable after deactivation

Discovery matches disabled records as well as active ones; the dashboard offers disabled matches as
Add again and reactivates their existing id, preserving history and routing. Only active matches
disappear from the add list. Cost: deleting a USB printer left it in the registered table and hid it
from discovery, blocking re-add. The table now defaults to Active with Disabled/All filters. Built in
#321.

## Native centring starts inside the configured paper width

Set the ESC/POS left margin to zero and the print area to the configured safe width before selecting
native centre alignment. The owner's 17:40:44 photograph on 2026-09-26 showed the body and QR shifted
right and clipped on a 58mm roll; that payload carried no print-area commands. Whether the printer's
own width setting also contributed was not tested. `apps/server/src/receipt-ticket.test.ts` pins the
360-dot and 504-dot print areas before the centre command;
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

A printed document never hard-codes a paper width, a QR size or a text encoding: it reads them from
the printer it is printing to (`paperWidth`, `resolution`, `characterSet` on `printers`). Text is
passed through `prepareText` before it is measured, and through `wrapText`/`labelAmountLines` before
it is printed, so a string is never counted in one character set and printed in another. The fiscal
QR is a raster image, its dot size chosen per receipt by `chooseQrDots` for the largest fitting size
at most 40mm, reaching 30mm where the grid and paper allow it, including its blank border when checking the paper width —
never the printer's own built-in QR command, which cannot be sized this way. A test reads a payload's
printed text with `printedLines` (`apps/server/src/testing/decode-ticket.ts`), which fails the test
on an unsupported byte instead of silently stopping partway and hiding the rest of the ticket. Built
in #367; the QR size rule and the calibration wizard in #689.

The character-table finder initialises the printer (`ESC @`, then `FS .`) before every candidate
line, not once per page (`formatCharacterTableTest`, `apps/server/src/character-table-test.ts`).
On the owner's NETUM NT-806 on 2026-09-26, table 6 printed its sample correctly until table 2 had
been selected; selecting table 6 again then kept printing table-2 glyphs, and initialising first
restored it (#689).

## Resolve live content and receipt snapshots separately

Live catalogue text uses enabled content languages and their configured default. Stored order and
sale descriptions contain receipt-language keys, so that filter can hide every recorded name when
receipt and content languages differ. Snapshot displays may fall back to a stored nonblank value;
they never rewrite the record. Regression: `packages/shared/src/content-languages.test.ts`,
“keeps a receipt-only name visible when the content default is absent”.
