# UI review — the polished-product walkthrough tracker

The authoritative state of the walkthrough in **Track A — UI and application** of [backlog.md](backlog.md).

We walk every chunk of functionality in **customer-journey order**: Claude boots the app and shows
the owner how each area works today (screenshots + plain English), the owner then plays with it and
corrects what is wrong or unintuitive, and the fixes land. This file records where we are so the
walkthrough survives a context clear.

**Run path:** `pnpm dev:setup && pnpm dev` — till <http://localhost:5190>, dashboard
<http://localhost:5191>, setup <http://localhost:5192>. The server on `:8080` uses HTTP without a
development box leaf and HTTPS when one is present; each Vite proxy selects the same protocol. The till enrols itself on first load in dev
mode — no code, no approval step. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**.

**Running the stack from a worktree.** Start it with `wa-wt demo <worktree-name>` or
`wa-wt onboarding <worktree-name>`
(`~/workspace/tools/wa-wt`, since 2026-09-06), never with a bare `pnpm dev*`. **The dev database is
one for every checkout**, and what makes it one is a shared STATE DIRECTORY rather than a container:
`wa-wt` runs every worktree's `pnpm dev` and `pnpm dev:setup` with `WAITRON_STATE_DIR` set to the
same `$HOME/workspace/.waitron-dev/box`, and the venue directory — two SQLite files on the host — is
derived from it by `defaultDevVenueDir` (`apps/server/scripts/dev-setup.ts`). `apps/server/.env` is
a per-DATABASE artefact (venue ids + the credentials key), not a per-checkout one, so a fresh
worktree has none and `worktree.py new` does not copy it; `wa-wt` copies the current target's `.env`
to the other checkouts and follows the log.

`docker-compose.yml` declares one service, `mailpit` — the practice email inbox. No container holds
any part of the dev venue, so Compose has nothing a reset could clear. The reason to keep using
`wa-wt` for it is unchanged: an unqualified `docker compose up` from a worktree names the compose
project after the directory and starts a SECOND copy of that service, fighting for the fixed 1025
and 8025 ports. The same collision, back when this file declared a Postgres service with a named
volume, is what left the stray `waitron-feat-onboarding-slice1b-setup-mode-boot_waitron-dev-db`
volume behind. `wa-wt` brings it up under the fixed project `waitron`.

Changing between demo and onboarding REMOVES the venue directory, preserves the shared development
CA (`wa-wt` clears everything under the shared state directory except `tls`, then `dev:reset`
`rm -rf`s the venue directory — `resetVenueDir` in `apps/server/scripts/dev-setup.ts`), and rebuilds
the selected target. Use `wa-wt reset demo [name]` or `wa-wt reset onboarding [name]` to rebuild
without changing target. In demo mode the till re-enrols itself on first load after that — no code,
no approval step.

The print agent starts with the stack and connects to the local server on port 8080. It waits for
the server to listen, then uses HTTP or HTTPS to match the development box. With HTTPS, it reads
the public CA from the shared box state, so you do not need a working port 80 listener. Its token
and configuration live in the box state's `print-agent/` directory; switching worktrees retains
them, while resetting the target clears them with the database. Once the box is provisioned as
the primary, the agent enrols automatically. You can check its status at <http://localhost:9110>.

`/health` reports `ok:false` on the dev venue because the fiscal drain has no AEAT credentials; the
till and API serve normally regardless.

**Gotcha (cost ~an hour on 2026-09-01):** if the till shows a blank/error screen after login and
`/api/products` returns 500, the `:8080` server is a **stale orphan** from a previous session that no
longer matches the (re)seeded DB — it is not a `main` bug (the demo proves products serves fine).
Restart it: `kill` the `:8080` node PID, then `pnpm --filter @waitron/server dev` (or restart the whole
stack). The front-end vite servers can stay up.

**Status legend:**

- ⬜ **not examined** — not yet looked at
- 🔍 **shown** — Claude has walked it; awaiting the owner's hands-on pass
- 👤 **reviewing** — owner is playing with it / feeding back
- 🔧 **corrections logged** — issues captured below, fixes not yet landed
- ✅ **done** — reviewed, and any corrections have landed

**Sequencing (revised 2026-09-12, from `backlog.md` → *What to work on next*):** the goal is a
standalone on-prem primary, so the setup wizard (area 1) is no longer parked — its corrections are
listed under the backlog's Track A item A2. Walk areas 2–20 at the real box; area 19 (device
management) carries the register-versus-device decision
(`superpowers/specs/2026-09-05-register-and-device-model-decision.md`: keep both — register = the
drawer, device = the screen; the no-migration half landed #269). A correction that needs a new table
needs CLAUDE.md §3's classification line and nothing else.

## Walkthrough order & status

| # | Area | App | Status | Corrections logged |
| --- | --- | --- | --- | --- |
| 1 | First-run setup & onboarding wizard | setup | 🔧 | B1 connection flow implemented on its feature branch. Walked on the real box 2026-09-13; what that walk found is specced in [onboarding flow corrections](superpowers/specs/2026-09-13-onboarding-flow-corrections-design.md) and fixed on the `onboarding` branch — the wizard is a centred modal instead of a full-width page, it asks your name before your display name, tooltips stay on screen, the province question comes before the answer derived from it, your account is created in your browser's language, and a first sign-in offers you a passkey. Not merged at the time of writing. Still open: the device trust walkthrough, and the A2 wizard items — chiefly that the wizard's own text is English only, with no language chooser |
| 2 | Till login & shift start (PIN) | till | 🔍 | shown 2026-09-01 — see candidates below, awaiting owner |
| 3 | Counter / walk-up sales — menu, basket, modifiers, notes, park/retrieve, pay, receipt | till | 🔍 | shown 2026-09-01 — candidates below, awaiting owner |
| 4 | Tables & tabs — floor view, open / move / join / merge / transfer / split | till | ⬜ | |
| 5 | Coursing & rounds — build, hold/fire, course move, recall/cancel | till | ⬜ | |
| 6 | Handheld tableside ordering & cash-at-table | till (handheld) | ⬜ | |
| 7 | KDS — stations, tickets, courses/fire, expo, printing, timing alerts | till (KDS) | ⬜ | |
| 8 | Payments — cash, manual card, integrated reader, tips | till | ⬜ | |
| 9 | Dashboard home — business overview | dashboard | ⬜ | |
| 10 | Menu management — products, recipes, images, allergens, dietary, modifiers, membership | dashboard | ⬜ | |
| 11 | Floor plan editor (spatial canvas) | dashboard | ⬜ | |
| 12 | Table & service status config | dashboard | ⬜ | |
| 13 | Stations, routing & printers (Impresoras) config | dashboard | ⬜ | |
| 14 | Reporting — daily close, cierre Z, VAT, modelo 303, purchase invoices | dashboard | ⬜ | |
| 15 | Staff / users / roles / login methods | dashboard | ⬜ | |
| 16 | Workforce — registro de jornada, scheduling, roster, requests | dashboard | ⬜ | |
| 17 | Bookings — reservations day-list | dashboard | ⬜ | |
| 18 | Diagnostics & logs viewer | dashboard | ⬜ | |
| 19 | Device management — enrol / revoke | dashboard | ⬜ | |
| 20 | Locations / venue config — invoice locales, printing, cash-drawer policy | dashboard | ⬜ | |

## Corrections log

As the owner finds issues they land here as a checklist per area, then become fixes. Keep each item
one line; the fix's detail belongs in its PR/commit, not here.

### General UI corrections — 2026-09-06

Owner scope: **all UI**. Landed as #249. Plan: [UI navigation and controls](superpowers/plans/2026-09-06-ui-navigation-and-controls.md).

- Keep the selected navigation tab in the URL so Back, Forward and refresh restore it. Includes
  dashboard sections, till canvas tabs, Schedule, Kitchen/station selection, Pass, Allergens, floor
  views/zones and saved canvas editor tabs.
  A requested destination still needs the current session's permissions and device canvas.
  Paths use `/manage/<section>` and `/tabs/<key>`, with nested selections as path segments.
- Keep unsaved canvas tabs out of URL writes, including when you reselect them. Embedded station
  pickers keep their selection local; an enrolled kitchen display keeps its bound station.
- Keep history for meaningful navigation. Payment and modifier steps do not add entries; menu choice
  stays in browser session storage as the last menu viewed across new and parked orders. Every new
  login resets it to the default, including the PIN login required after refresh.
- Remember vegan, vegetarian, no-meat and no-fish filters throughout the login, shared by counter and
  table ordering. New and parked orders retain the selection; a new login clears it. Filter changes
  add no browser history entries and leave the basket intact.
- Enter submits an ordinary form through its existing action and validation. Multiline fields,
  selectors, file pickers and focused keypad buttons keep their normal keyboard behavior.
- Show **English** or **Español** immediately, including before the language menu is opened.
- Keep the language chooser at the bottom right, including PIN entry, pairing and kitchen displays.
  Its menu opens upwards. Kitchen displays change language locally because no staff member is signed in.

The setup wizard receives the form behavior. It has no translated UI or language chooser, and wizard
steps are not tabs; this change does not persist setup credentials or unfinished form contents.

### 2 — Till login & shift start

Candidates from the first look (awaiting owner confirmation — not yet fixes):

- [ ] Layout is sparse and top-left-aligned with a large empty area — reads more like a debug form
      than a polished POS lock screen (no centring, no branding, no "tap to begin").
- [ ] "Choose your name" (who you are) sits directly above "Set up as kitchen display / waiter
      handheld" (what this device is) — two different concepts stacked with no separation; a staff
      member could tap a device-mode button by mistake.
- [ ] The admin user shows as **"Administradora"** (Spanish) among otherwise English staff names with
      an `en-GB` locale — likely a seed-data naming choice; confirm whether the admin should have a
      real person name.
- [x] Language label and placement decided 2026-09-06: **English**, bottom right throughout the UI.
      Implementation is covered by the general corrections above.

### 3 — Counter / walk-up sales

Much more polished than the login screen (proper top bar, product grid, basket column). Candidates
(awaiting owner confirmation):

- [ ] **Held order "#4 · 0 · €0.00"** — a held order with zero items / €0.00 in the Held orders list;
      looks like an empty basket got held (seed artifact or a real "can hold nothing" gap). Confirm.
- [ ] **"Pay" vs "Card" as two big buttons** — relationship is unclear (is Pay = cash, Card = card?);
      the tender each triggers should read plainly.
- [ ] **Top bar mixes navigation, actions and identity** — Allergens / Floor / Kitchen / Pass / My
      schedule / Marta Ruiz / Log out sit in one undifferentiated row; consider grouping
      (navigate vs act vs who-am-I).
- [ ] **Per-kg deli items** (e.g. White tuna belly €54.00/kg) — confirm the add-to-basket weight-entry
      flow is intuitive when tapped (not yet exercised).
- [ ] **Menu tab labels** — "Casa Delgado" (the venue name?) vs "Menú del Día"; confirm the à-la-carte
      tab should carry the venue name.
- [x] The counter uses the same language-name and bottom-right placement decision as login.
      Implementation is covered by the general corrections above.


### B1 — certificate installation and recovery, 2026-09-12

Implementation: `feat/box-trust-onboarding`. **This receipt is dated: it was taken on 2026-09-12,
against pages both of which were restructured on 2026-09-13** — the guide gained four numbered steps
and lost a section, and the wizard's first screen was rewritten. Treat it as covering the earlier
pages, not the current ones; the 2026-09-13 branch rendered the guide in headless Chromium in both
themes at 390px and ran the wizard's own browser suite, but did not repeat the Firefox and WebKit
passes. The original run: the guide and built wizard were exercised in Chromium, Firefox and WebKit
on macOS, including HTTP/HTTPS certificate downloads, keyboard disclosure and 390/1280-pixel
layouts. Those runs used isolated profiles with the fixture certificate error ignored;
they verify rendering and navigation, not system trust. Setup accessibility checks cover light and
dark themes. [Design and source boundaries](superpowers/specs/2026-09-12-box-trust-onboarding-design.md).

For each row, install the box's current certificate through the displayed settings, close/reopen the
browser without a warning, complete the setup connection check, then repeat after a re-image using
the old-certificate recovery instructions. Record the actual OS and browser versions when run.

| Device | Browsers to walk | First trust installation | Replacement after re-image |
| --- | --- | --- | --- |
| macOS | Safari, Chrome, Edge, Firefox | Pending | Pending |
| Windows | Edge, Chrome, Firefox | Pending | Pending |
| Linux | Chrome/Chromium, Edge, Firefox | Pending | Pending |
| ChromeOS | Chrome | Pending | Pending |
| Android | Chrome, Edge, Firefox, Samsung Internet | Pending | Pending |
| iPhone/iPad | Safari, Chrome, Edge, Firefox | Pending | Pending |

**Owner reported the device walkthrough done on 2026-09-14.** The table was not filled in per row, so
the versions walked are not recorded, and whether the HTTPS-only row below was walked is not stated.

Also walk a browser with HTTPS-only navigation enabled. **The guide no longer documents a way
through this** — the section carrying the browser's HTTP exception and the transfer-from-another-device
route was deleted on 2026-09-13 (see *The guide restructured* in
[the design](superpowers/specs/2026-09-12-box-trust-onboarding-design.md)). So this row is now
walking an UNANSWERED case: record what the operator is actually left with, because that is the
finding. `deploy/README.md` still carries the advice for whoever installed the box, and neither ever
claimed an HTTP link overrides browser or administrator policy.
