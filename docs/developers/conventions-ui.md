# Conventions — forms, the dashboard, UI primitives and hardware

This file holds the evidence behind the UI-facing conventions in the repo root `CLAUDE.md` section
3 — forms, the dashboard shell and its sessions, hardware and printing, and the unauthenticated
recovery page: the regressions, measurements and pointers that paid for each rule. `CLAUDE.md` keeps
the one-line version of each rule and points here for the rest. The component-level rules further
down (no hardcoded chrome, real-Chromium testing, the two tests a new primitive needs, event
discipline, and the rest) came from `.github/instructions/waitron.instructions.md`, a Copilot
review-instructions file that nothing has read since Copilot's automatic PR review was switched off
on 2026-09-06 — which is worth stating here, since a reader may never otherwise have seen them.

**Forms and the shared UI contract**

## New or changed forms use the shared UI contract in `docs/developers/design-system.md` → Forms

Required fields are visibly marked; an attempted invalid submission shows explanatory text beside
every bad field and one localized “problem with this form” summary. Every input has a semantic
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
drafts or mint recovery keys. See `docs/developers/dashboard-live-updates.md` and the
passive-session and backup-screen regressions.

## A background API client does not make POST requests passive

The request primitive marks only GETs as passive. Automatic pairing renewal uses an explicit
authenticated route that resolves the session without touching its activity time. Cost: renewing
the Add print agent dialog through the ordinary Open route moved session expiry forward by ten
minutes in the regression; the renewal route leaves it unchanged and still refuses expired sessions
(`apps/server/src/join-api.pg.test.ts`, “renews the window without extending the session”).

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

## Dashboard sign-in matches the browser's `Accept-Language` preferences

The public locale response carries a separate `loginDefault`; `venueDefault` still describes the
venue and remains the fallback for signed-in people without a saved language. Returning to login
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
active-account reset, with the same acknowledgement for every address. Owner decision:
`docs/superpowers/specs/2026-09-11-login-flow-refinements-design.md`.

**UI primitives in `packages/ui`**

## No hardcoded chrome

Every colour, spacing, radius, and font value in a `packages/ui/src/components/*.ts` component's
`static styles` must read a `--wt-*` custom property: no hex, no
`rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`/`color-mix()`, no named colours,
no `px` above `1`, no `rem`/`em` at all (including inside `min()`/`max()`/`clamp()`). `transparent`,
`currentColor`, and `inherit` are legitimate escape hatches, not chrome.

This is enforced automatically by `packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers
every component via `import.meta.glob("./components/*.ts", ...)` — a new component is covered the
moment the file exists, with nothing to register. If a needed token doesn't exist, it belongs in
`packages/ui/src/tokens/`, not inlined.

## Real Chromium only — never jsdom

`packages/ui` tests run in real Chromium via Vitest 3 browser mode (`@vitest/browser` + Playwright),
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

Custom events are named `wt-*`, carry their payload in `detail`, and are dispatched with
`bubbles: true, composed: true` so they can cross the component's own shadow boundary. Before
re-emitting, the native or internal event that triggered them must be stopped with
`event.stopPropagation()` — otherwise the native event (itself `composed: true` for things like
`input`/`change`) independently crosses the same boundary and the consumer observes the change
twice.

**Printing and hardware**

## A retained hardware registration must remain re-addable after deactivation

Discovery matches disabled records as well as active ones; the dashboard offers disabled matches as
Add again and reactivates their existing id, preserving history and routing. Only active matches
disappear from the add list. Cost: deleting a USB printer left it in the registered table and hid it
from discovery, blocking re-add. The table now defaults to Active with Disabled/All filters. Pointer:
`docs/superpowers/specs/2026-09-11-printer-followups.md`.

## The hardware transport seam is `@waitron/print-agent`, and it is database-free

It becomes a standalone LAN process that reaches a server over HTTP only, so it imports no other
package in this repo; `@waitron/printing` depends on IT, never the reverse. An empty `dependencies`
block is not the guard — `main` points at TS source with no build step, so
`../../db/src/index.js` resolves and runs while the manifest still reads dependency-free (measured:
with the zone removed that import lints clean). The guard is the `import-x/no-restricted-paths` zone
in `eslint.config.js`, alongside `packages/verifactu`'s and `packages/shared`'s. Design:
`docs/superpowers/specs/2026-09-08-print-agent-process-design.md` §2.1.

## A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`, not `/dev/usb`

A `/dev/usb` subdirectory bind goes stale when the printer is re-plugged (the node vanishes and does
not return); a hard `devices: /dev/usb/lp0` line refuses to start when no printer is attached. The
shape that survives both — measured on the real box 2026-09-10 — is the whole `/dev` mounted
read-only plus `device_cgroup_rules: ["c 180:* rwm"]` (the usblp major) and `group_add: ["7"]` (the
`lp` group's write bit); `:ro` still permits writing an existing device node but refuses `mknod`.
The cgroup rule ADDS major 180 to Docker's default device whitelist (null, zero, full, random,
tty, …); a class that is neither a Docker default nor 180 (e.g. hidraw) is what gets denied. Pinned
by `scripts/deploy-image-env.test.ts`; spec
`docs/superpowers/specs/2026-09-10-print-agent-box-wiring-design.md` §5.

**The recovery page**

## The unauthenticated recovery page renders fixed strings chosen by code, never the caught error's words

The error's own text goes to the container's stdout only, through `redactSecrets` — the installer's
channel. Exactly two values on the page come from outside the image: the error CODE and the LOG
TAIL, and the tail is the wider one, because the shared error boundary writes an `AppError`'s params
into `waitron.log`. So the convention that params never carry a secret (stated per-code in
`apps/server/src/errors.ts`) is what keeps a page anyone on the venue's LAN can open safe. A page
edit that interpolated a caught message, or a new code carrying a credential in its params, breaks a
security boundary nothing outside the design states. Pointer:
`docs/superpowers/specs/2026-09-10-boot-failure-diagnosability-design.md` §5;
`apps/server/src/recovery-surface.ts`.

The retired file's "Database tests that assert nothing" and "Workspace package boundaries" sections
mostly restated rules that already live elsewhere in `CLAUDE.md` or in
`docs/developers/conventions-data.md`. What follows is the part of those two sections that was more
specific than the general rule and would otherwise have been lost.
