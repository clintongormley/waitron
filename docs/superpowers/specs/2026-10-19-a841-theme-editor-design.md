# A841 — a theme editor: design

Status: design, revised after review rounds 1 and 2 and after the owner's answer to Q1 (2026-10-19:
"A by default, with advanced access to B. Also this should be in settings rather than venue");
waiting for the owner's answers to the questions at the end. Backlog: A841 (owner, 2026-10-17).
Builds on A681 (#1842), the per-browser Light / Dark / Follow device choice. Mock-ups:
`docs/backlog/mockups/a841-theme-editor/`.

A note on words. A **token** is one of Waitron's named style settings, written `--wt-…` in the code:
`--wt-color-primary` is "the colour of main buttons", `--wt-radius-md` is "how round a normal
corner is". The dashboard's and the till's shared components paint from tokens (the guards in
section 3 hold them to it), so changing a token's value repaints everything that reads it. A
**knob** in this document is one simple choice the owner makes (a colour, "Round corners") from
which many token values are worked out. **Contrast** is how far apart two colours are in brightness,
written as a ratio such as 4.5:1; a higher number is easier to read.

## 1. What this is, and why

A venue wants Waitron to look like its own place: Bar Lucía's green rather than Waitron's blue on
the buttons, the selected tab and the sidebar, on the dashboard and on every till. The design system
already says a deployment may override tokens (`docs/developers/design-system.md:106-124`,
"Retheming a deployment"), and the server can already store an owner's theme (section 3: a
`tenant_themes` table and `/management-api/theme` routes) — but no screen applies a stored theme and
no screen edits one. A841 adds both, safely: without producing a screen staff cannot read, and
without breaking the Light / Dark / Follow device choice each browser already makes.

## 2. Goals, non-goals, anti-goals

Goals

- The owner picks a brand colour and a few other simple choices on one card, sees a preview in
  light and dark side by side, and saves.
- Both the light and the dark palette are worked out from those choices; the owner never has to
  pick a dark-mode colour.
- For the owner who wants one colour exactly, an **Advanced** section, closed until opened, lets them
  set any of 22 colours by hand, each with its own light and dark value (owner, Q1, 2026-10-19;
  section 5).
- Every saved theme passes every contrast rule Waitron's own palette is tested against, plus
  Waitron's own button rules (section 9) — colours set by hand included.
- Open dashboards and signed-in tills pick up a saved theme without a reload (section 12).
- "Use Waitron's look" gives exactly Waitron's own colours back.

Non-goals (not in A841; each could be its own item later)

- Logos, the venue's own logo, fonts, the favicon, and the till's browser-bar colour (section 8).
- Receipts, kitchen tickets and anything else a printer prints (section 8).
- The server's own pages: the trust page, the user guide pages, the recovery page.
- Setup (the first-run wizard): it runs before the venue has a theme.
- Colours that carry a meaning: red for danger, green for success, amber for warning, the table
  states on the floor plan, prep-station colours, calendar colours, Google's sign-in button, and the
  search highlight — the yellow behind a matched word (`--wt-color-highlight` and
  `--wt-color-on-highlight`, `packages/ui-core/src/tokens/colors.css:121-122`, painting `<mark>` at
  `packages/venue-service/src/dashboard/routing-grid.ts:152-155`).
- Product and category colours: those are the venue's own data, already chosen per product.

Anti-goals (things this must never do)

- Let a saved theme make a button's words, a link or a focus ring unreadable.
- Delay or block the till's start-up or a sale: fetching the theme never holds the page (section 12).
- Become a second, hand-kept copy of Waitron's default colours: a venue's theme stores only the
  owner's choices — the three main choices and any colour they set by hand — and everything else is
  worked out from the current release's defaults (section 11).

## 3. What Waitron does today (receipts)

Every sentence here names the file and line, or the command, it rests on.

**The tokens.** Colour tokens live in `packages/ui-core/src/tokens/colors.css` in four blocks: the
default (light) block at lines 1-123, a dark block inside `@media (prefers-color-scheme: dark)` at
lines 125-241, a forced-light block for `data-theme="light"` at 243-357 and a forced-dark block for
`data-theme="dark"` at 359-473. Counting declarations with
`sed -n <range>p colors.css | /usr/bin/grep -cE '^\s*--wt-'` printed 112 for each of the four
blocks. In the light block they are: 30 prep-station fills and dots, 29 "on-…" text colours, 16
calendar palette colours (`sed -n 41,80p colors.css | /usr/bin/grep -c -E '^\s*--wt-color-palette-'`
printed 16), 5 table-state fills, 5 field colours, 4 surfaces, 4 primary, 3 danger, 3 Google
button, 2 text, 2 day colours, and one each of warning, track, success, stepper, scrim, highlight,
focus, border and background. `diff -w` of lines 126-240 against 359-473 printed only the selector
line (plain `diff` prints 232 lines, all indentation), so the two dark blocks hold the same values.
The non-colour tokens are in `packages/ui-core/src/tokens/structure.css`: 57 declarations (same
count command), among them six spacings (lines 2-7), four corner radii (9-15), three font families
and four font sizes (17-24), the 44 px tap minimum (29), two shadows (111-112) and the focus and
selected rings, which read `--wt-color-focus` and `--wt-color-primary` (114, 120).

**How a page gets them.** `applyTokens(root)` marks `root` with `data-wt-theme-root` and adds one
shared stylesheet holding both files to the `adoptedStyleSheets` of `root`'s document, or of its
shadow root when `root` sits inside one (`packages/ui-core/src/tokens/index.ts:6-25`). The
dashboard, the till and setup each call it on `document.documentElement` and then call
`startThemeChoice` (`apps/dashboard/src/main.ts:17-18`, `apps/till/src/main.ts:16-17`,
`apps/setup/src/main.ts:6-7`). Every rule in the token layer is wrapped in `:where(…)`
(`colors.css:1,126,243,359`), which adds no specificity, so any ordinary selector in another
stylesheet wins over it (`design-system.md:89-104`; pinned by "deployment rules override the token
layer's defaults even when data-theme is set", `packages/ui-core/src/tokens/structure.test.ts:272`).

**How A681 switches light and dark.** The choice is saved in the browser under the key
`waitron-theme` (`packages/ui/src/theme-choice.ts:6`). Light and Dark set `data-theme` on the root;
Follow device removes it (`theme-choice.ts:27-30`), which leaves the operating system's setting in
charge through the media-query block. A choice made in one tab reaches the browser's other tabs
through the `storage` event (`theme-choice.ts:49-60`). Each block of the token layer also sets the
CSS `color-scheme` property (`colors.css:5,127`) so the browser draws its own controls to match.

**A stored theme already exists, and nothing applies it.**

- Table `tenant_themes`, one row pinned to `id = 1`, holding one JSON document `theme` and
  `updated_at` (`packages/db/src/schema/tenant-themes.ts:9-17`); classified `state`
  (`packages/db/src/classification.ts:146`); copied with a venue's configuration
  (`packages/db/src/configuration-transfer.ts:77`). Every core table but `change_log` and
  `node_sealed_state` is a live-update source (`classification.ts:256-259`), so it already is one.
- The document is `{ tokens: Record<string, string> }`, checked by `validateThemeOverride`
  against a seven-name allowlist `THEMEABLE_TOKENS` — primary, on-primary, surface, text, danger,
  `--wt-radius-md`, `--wt-font-family` — and a value pattern that excludes `; { } : < > " ' \`
  (`packages/layouts/src/theme.ts:3-52`). Its refusals are `theme.invalid` with `reason`
  (`not_object`, `bad_tokens`, `unknown_token`, `bad_value`, `too_long`) and, for the last two,
  `token` (`theme.ts:32-47`; the code is registered at `packages/layouts/src/errors.ts:45`).
- `getTenantTheme` / `putTenantTheme` (`packages/layouts/src/theme-store.ts:13-35`) behind
  `GET` and `PUT /management-api/theme`, both gated by `layout.configure`
  (`apps/server/src/management-api.ts:1275-1306`, `theme-store.ts:23-26`), pinned by
  `apps/server/src/management-api.canvas-retirement.test.ts:146-229` (six cases: a missing theme
  reads `null`, a round trip, an unknown token, a missing body field, a staff session refused, no
  session refused).
- The till declares its own copy of the document's type, `ThemeOverride`
  (`apps/till/src/layout.ts:58-60`); `grep -rn ThemeOverride apps packages` found no till code that
  uses it.
- `design-system.md:189-208` says a tenant theme cannot set `--wt-color-primary-text`, the hover or
  the disabled colours, and that "no screen applies a stored tenant theme yet". Backlog entries on
  it: the `--wt-color-primary-text` entry (`docs/backlog.md:4487-4493`, detail
  `docs/backlog/dashboard.md:1227-1236`) and "`tenant_themes`: decide the remaining DELETE
  restriction (A805 follow-up)" (`docs/backlog.md:6238-6240`).

**Surfaces that do not use the token layer, or copy from it.** The trust page inlines four token
pairs by hand and says so (`apps/server/src/trust-page.ts:106-111`). The user guide pages carry their
own copy of a few tokens as light/dark pairs (`apps/server/src/guide-pages.ts:16-35`), compared to
the real files by `scripts/guide-page-tokens.test.ts` (named at `guide-pages.ts:16`). The dashboard's
printable recovery sheet copies twelve tokens by name from the page into its own window with
`getPropertyValue(name)` — among them `--wt-color-text`, `--wt-color-bg`, `--wt-color-border` and
`--wt-radius-md` — and when printed forces text and background to the system's plain colours
(`apps/dashboard/src/screens/node-recovery-print.ts:11-27,41-42`). The equipment label copies four
font tokens only (`apps/dashboard/src/widgets/equipment-label.ts:52-59`). Receipts and kitchen
tickets are printer commands, not web pages: `apps/server/src/receipt-ticket.ts:1-14` imports the
ESC/POS builder `esc` from `@waitron/printing`, and `packages/printing/src/escpos.test.ts:10-13`
tests it as byte sequences. `ls apps` printed `dashboard print-agent server setup till`: there is no
customer-facing web app today. The kitchen and station screens are screens of the till app
(`apps/till/src/screens/till-station-screen.ts`, `till-expo-screen.ts`). The till's browser-bar
colour is fixed at Waitron's blue in `apps/till/index.html:10` (`<meta name="theme-color"
content="#1f6feb" />`) and in the installed app's manifest (`apps/till/src/manifest.ts:11`).

**Colours a theme would not reach.** Till product tiles are painted from the product's own stored
colour, with black or white text chosen by `readableTextColor`
(`apps/till/src/widgets/menu-browser.ts:83`, `packages/ui/src/category-color.ts:15-20`). The
dashboard banner shows Waitron's own logo, picking its light or dark drawing from the theme choice
(`apps/dashboard/src/dashboard-app.ts:189,1738`).

**Script reads of tokens by a literal name.** `grep` for `getPropertyValue("--wt-` outside test
files and test helpers (`apps/dashboard/src/widgets/test-helpers.ts:252` also matches) found nine
lines, all of spacing, tap size or a duration (`product-appearance.ts:114`,
`wt-floor-plan-canvas.ts:542,545,546`, `wt-tabs.ts:221`, `drag-edge-scroll.ts:49`,
`opening-hours-week.ts:134,532`, `departments-zones-drag.ts:329`). That grep cannot see a read
through a variable name, such as the recovery sheet's above.

**Text painted in the button colour.** `git ls-files 'apps/*.ts' 'packages/*.ts'` filtered to
non-test files and searched for `color: var(--wt-color-primary)` found 15 lines in 15 files, among
them `apps/dashboard/src/screens/login-screen.ts:188`, `packages/ui/src/components/wt-data-table.ts:748`
and `packages/ui/src/components/wt-number-stepper.ts:96`; `apps/dashboard/src/screens/printers-screen.ts:218`
instead sets `--wt-color-text: var(--wt-color-primary)`. Waitron's own light `#1f6feb` reads 4.33:1
on its light page `#f7f7f8` (derive.mjs `ratio`, below), under the 4.5:1 text rule; the comment at
`colors.test.ts:252` says the same ("4.32:1"), which is why `--wt-color-primary-text` exists.

**Existing colour tools to reuse.** The dashboard's `colorField`
(`apps/dashboard/src/widgets/color-field.ts:156`) offers the 24 `CATEGORY_PALETTE` swatches
(`packages/ui/src/category-color.ts:29-54`) plus a custom colour from the browser's own picker
(`color-field.ts:94-108`); stored colours are checked as `#rrggbb` by `isStoredColor`
(`packages/catalogue/src/color-inheritance.ts:2-4`). A contrast calculation already exists in
product code, `luminance` in `category-color.ts:1-9`, and in `colors.test.ts:13-24`. Both use WCAG's
0.03928 cut-off; WCAG 2.2 now writes 0.04045 and says the older figure "has no practical effect on
the calculations in the context of these guidelines" (<https://www.w3.org/TR/WCAG22/>, definition of
relative luminance).

**The contrast rules Waitron's palette is tested against** (`packages/ui-core/src/tokens/colors.test.ts`):
the lifted surface stands 1.1:1 from the page and both surfaces, with text, muted text and danger at
4.5:1 on it (134-150); text on the sunken surface 4.5:1 (152-157); the bar track 1.4:1 from the page
and surface, text 4.5:1 on it (171-177); a field's line 3:1 on the fill, the surface and the page,
`--wt-color-primary` 3:1 on the fill, label, hint, value, text and error 4.5:1 on the fill, muted
text 4.5:1 on the disabled fill (199-229); primary text 4.5:1 on the page, both surfaces and the
lifted surface (251-265); the highlight's text (277-285); hover fills keep their button's text at
4.5:1 and stand 1.2:1 from rest (301-320); in dark, the primary and the danger disabled fills within 1.5:1 of
the surface and the raised surface (339-348), and their text 4.5:1 (351); the Google button's line 3:1 on its fill and three surfaces (403-417);
table fills, and the success and danger dots 3:1 on the surface (482-498); station fills, dots 3:1
on the surface and each fill, and the focus colour 3:1 on every station fill and the lifted surface
(531-576). No test holds a button's fill against the page, or the text on a button: those are
Waitron's own rules in section 9.

**Pages a person could call "Settings" today** (re-read for the Q1 answer, 2026-10-19, on main
ade4b3a3c):

- **The side menu's Settings section.** The sidebar's last group, id `configuration`, drawn with a
  gear icon and headed "Settings" ("Ajustes" in Spanish)
  (`apps/dashboard/src/dashboard-app.ts:274-293`, `apps/dashboard/src/i18n/strings.ts:947,3961`).
  It is a heading over nine pages, not a page of its own: Content languages, Devices, Printers, Card
  payments, Device profiles, Diagnostics, Backups, Servers and Cloud services
  (`dashboard-app.ts:279-291`). The user guide already sends people there by that name: "open
  **Settings**, then **Content languages**" (`apps/server/src/guide/en/content-and-images.md:17`).
  `grep -rn 'group: "' packages/*/src` found no module adding a page to it (modules add to
  `reports`, `service`, `menu`, `team` and `operations`).
- **Account settings**, in the person menu at the top right (`dashboard-app.ts:1798-1815`,
  `strings.ts:840`), opens one person's own details: "Your name, display name, email, phone and
  language; your password, PIN and passkeys; …" (`strings.ts:778-779`). The same menu holds the
  Light / Dark / Follow device choice, called "Theme" (`dashboard-app.ts:1817-1821`,
  `strings.ts:792-793`).
- **Venue settings**, which the owner ruled out, sits in the side menu's "Venue operations" group
  (`dashboard-app.ts:252-257`). It has four tabs, Venue details, Tables, Adjustment reasons and
  Kitchen (`apps/dashboard/src/screens/venue-settings-screen.ts:11-24`), each holding cards. Its
  Defaults card needs `venue.view` to be seen and `venue.configure` to be edited
  (`dashboard-app.ts:321-330,1916`), and saves through `PUT /management-api/venue-defaults`, gated
  the same way (`apps/server/src/location-settings-api.ts:297-327`).
- Pages whose own words say "settings" but which are about one thing: mail ("Retry loading mail
  settings", `strings.ts:997`, an unlisted screen, `dashboard-app.ts:299`) and Backups ("Change
  backup settings", `strings.ts:1730`).

**Permissions on those pages.** A sidebar item is shown only when the person holds its
`requiresPermission` (and is a manager or admin where it says `requiresManager`)
(`dashboard-app.ts:1902-1909`). In the Settings section, Devices, Printers and Device profiles name
no permission (`dashboard-app.ts:284-287`), so supervisors see the section. Device profiles are read
and saved under `layout.configure` (`apps/server/src/management-api.ts:1310-1318`,
`packages/layouts/src/device-profile-store.ts:179-182`), the permission the stored theme's routes
already use (`theme-store.ts:23-26`). Managers and admins hold `layout.configure`,
`venue.configure` and `system.manage`; supervisors hold `venue.view` and none of those three
(`packages/identity/src/permissions.ts:46-83`).

**A folding section already exists.** `wt-disclosure` is a shared section with a heading that
opens and closes it, a `summary` line shown while it is closed, and `has-error`, which forces it
open while it holds a validation error (`docs/developers/design-system.md:708`).

**How settings reach an open dashboard.** A dashboard read names the tables it depends on
(`apps/dashboard/src/api/live-queries.ts:523`, `getVenueDefaults: ["locations",
"catalogue_settings"]`), and the server's change feed is built from each migration set's change
sources at start (`apps/server/src/boot.ts:1459-1466`).

**How settings reach an open till.** `GET /api/till` is unauthenticated (`apps/server/src/
till-api.ts:1382-1395`). It answers `readTillSetup` (`apps/server/src/till-setup.ts:17-110`), plus
`setupRevision`, a hash of `readTillSetup`'s answer (`till-setup.ts:115-117`), plus `servers`, added
outside that hash (`till-api.ts:1390-1394`). `/api/menu-state` repeats the revision
(`till-api.ts:1518`). A signed-in till polls menu state every 15 s
(`apps/till/src/state/menu-state-poll.ts:3-4`); the poll starts at sign-in (`till-app.ts:4011`) and
stops at sign-out (`till-app.ts:1785`). When the revision moves the till reads `/api/till` again
(`apps/till/src/till-app.ts:8105-8121`). A new field reaches an open till only once
`#applyVenueSetup` handles it, and a kitchen screen in device mode runs no poll at all
(`docs/developers/conventions-ui.md:1423-1467`).

**How the apps' pages are served.** The server sends each app's built `index.html` as a file
(`apps/server/src/spa-api.ts:61-76`); `apps/dashboard/index.html:11-26` styles the page from
`--wt-color-bg` and `--wt-color-text` before any script has applied the tokens.

**The guards.** `packages/ui/src/no-hardcoded-chrome.test.ts:6-56` reads the static `styles` of
every component in `packages/ui/src/components/` and refuses a literal colour or a px size above
1 px; it never reads styles built while a component runs. `scripts/style-token-names.test.ts:6-35`
checks that every `--wt-*` name read with `var(…)` is declared somewhere in tracked files; by its own
header it reads text, does not see a name declared from script or as a quoted object key, and
compares names across the whole tree. `packages/layouts/src/theme-registry.test.ts` checks that
each `THEMEABLE_TOKENS` name is declared in the token files (`theme.ts:8-10` says so).

## 4. What the owner sees and does

The mock-ups show Bar Lucía (`BAR LUCÍA S.L.`), whose owner picks a dark green, `#1e5b3a`, a tinted
background and round corners.

1. **Where it lives** (owner, Q1: "this should be in settings rather than venue"). The side menu's
   **Settings** section gains a page, **Appearance**, first in the section, above Content languages
   (my call on the place: it is the section's one page about what everybody sees). I read the
   owner's "settings" as that section: it is the only place in the dashboard called plain
   "Settings", it sits beside "Venue settings" in the same menu, and the user guide already calls it
   that (section 3). Account settings is one person's own details, so a look for the whole business
   does not fit there; the question file says this reading in one line so the owner can correct it.
   The page holds one card, **Look** (my call: not "Theme", which the person menu already uses for
   Light / Dark / Follow device). Read-only, the card lists Brand colour (a swatch and the value),
   Background, Corners and "Colours set by hand" ("None", or the names, such as "Page (light)"),
   with one line under them: "Applies to the dashboard and every till. Each browser still chooses
   Light, Dark or Follow device." Mock-up `01-appearance-card-{light,dark}.png`.
2. **Edit** opens the card in place, like the Defaults card. Left: the three main choices, and under
   them the closed **Advanced: set colours by hand** section, whose closed line says "None set by
   hand. Waitron works out every colour." or names the ones that are (`wt-disclosure`'s `summary`,
   section 3). Right: **Preview**, one Light and one Dark panel side by side, each showing a sidebar
   item, a field with focus, Save and Cancel buttons, a switch, a link and a two-way choice, painted
   with the draft. Mock-up `02-editor-{light,dark}.png`; at phone width the preview goes below the
   choices, Light above Dark (`03-editor-phone-light.png`).
3. **Advanced, opened**, lists the 22 colours of section 5 in plain words ("Page", "Cards",
   "Secondary text", "Main buttons", "Focus ring" …), one row each, with a Light and a Dark value.
   Each value shows its colour and its six-digit code. A worked-out value says "Worked out"; a value
   set by hand is drawn in bold with a **Set by hand** tag and a **Use worked-out colour** link that
   puts it back. Changing a value (a colour picker or the code) sets it by hand. Light and dark are
   separate: setting the light page leaves the dark page worked out. **Reset all to worked-out**
   at the end of the section puts every one back. Mock-up `12-advanced-{light,dark}.png`, Bar
   Lucía's light page set by hand to cream `#f8f1e1`; at phone width each row stacks its name, its
   Light value and its Dark value (`13-advanced-phone-light.png`). The section stays closed each
   time the editor opens (my call: the closed line already says what is set by hand), except that
   it opens itself while one of its values holds an error (`has-error`, section 3).
4. Every change repaints the preview at once. The rest of the dashboard keeps the saved look until
   Save (my call: a preview of the whole dashboard before saving would need a way back on every
   screen, and the side-by-side panels show both modes at once, which the real dashboard cannot).
5. If a colour has to be moved to stay readable, a note under it says so, with both swatches:
   "Darkened to #9f8b18 on light screens, so buttons stand out." (Q2; mock-up
   `04-adjusted-light.png`). For a colour set by hand the note sits under its row (section 9). The
   note shows the adjustment as the current release works it out (section 11).
6. **Changing a main choice keeps the colours set by hand** (my recommendation; it is the extra
   question before Q2, section 19). When any are set, a note under Brand colour says so after a
   change: "You set 1 colour by hand, and it is kept: Page (light). Advanced shows it." (mock-up
   `14-q-hand-kept-or-put-back-light.png`, left).
7. **Save** stores the choices. The dashboard that saved repaints at once; other open dashboards and
   signed-in tills follow (section 12). **Cancel** drops the draft.
8. **Use Waitron's look** sets the draft back to Waitron's choices — the brand colour "Waitron's",
   Neutral, Standard — **and puts every colour set by hand back to worked out**, since a look with a
   hand-set colour is not Waitron's; Save then removes the venue's row, so every screen shows exactly
   Waitron's own token values. It does not save by itself, so Cancel still undoes it (my call: one
   way of saving on the card).

The form follows the shared form rules (`design-system.md:2222-2300`): Save is quiet and disabled
until the draft changes (`draftScopeFor`, `saveActionState`), a bad custom value is explained under
the colour (or under its row in Advanced) and once at the bottom ("Correct the highlighted fields to
continue."), a refusal from the server never disables Save by itself, and the card has a
`*.unsaved.test.ts`. The brand colour field reuses `colorField`'s 24 swatches and custom colour, but
drops its "no colour" and "inherit" choices and adds "Waitron's" in their place (my call). A value in
Advanced is a colour picker (the `<input type="color">` of `colorField`'s custom choice) plus a
code field from the shared input primitive, without the 24 swatches (my call: 44 swatch grids would
bury the list); each has a semantic `name`, such as `handSet.light.bg`.

Product text, English (Spanish to be written with the strings):

| Where | Text |
| --- | --- |
| Side menu, Settings section | Appearance |
| Page heading | Appearance |
| Card | Look |
| Knobs | Brand colour · Background: Neutral, Tinted · Corners: Square, Standard, Round |
| Saved card row | Colours set by hand: None / {names} |
| Advanced heading | Advanced: set colours by hand |
| Advanced, closed | None set by hand. Waitron works out every colour. / {n} set by hand: {names} |
| Advanced, opened | A colour you set here stays as you set it when you change the brand colour, background or corners. Waitron still checks it can be read. |
| Advanced columns | Colour · Light screens · Dark screens |
| A value | Worked out · Set by hand · Use worked-out colour |
| Advanced, end | Reset all to worked-out |
| After a main choice changes (one) | You set 1 colour by hand, and it is kept: {name}. Advanced shows it. |
| After a main choice changes (several) | You set {n} colours by hand, and they are kept: {names}. Advanced shows them. |
| Colour choices | Waitron's · Custom |
| Preview | Preview · Light · Dark |
| Reset | Use Waitron's look |
| Note | Applies to the dashboard and every till. Each browser still chooses Light, Dark or Follow device. |
| Brand colour adjusted (Q2 A) | Darkened to {colour} on light screens, so buttons stand out. / Lightened to {colour} on dark screens, so buttons stand out. |
| Brand colour refused (Q2 B) | Too pale for buttons on light screens. Pick a darker colour. / Too dark for buttons on dark screens. Pick a lighter colour, or set the dark Main buttons colour by hand. |
| Hand-set colour adjusted (Q2 A), under its row | {Light screens / Dark screens}: {darkened / lightened} to {colour} so it can be read {on / with} {names}. |
| Hand-set colour refused (Q2 B), under its row | {Light screens / Dark screens}: too close to {names} to read. Pick a {darker / lighter} colour. |
| Hand-set colour refused, no shade passes (either answer) | {Light screens / Dark screens}: no shade of this colour can be read {on / with} {names}. Pick another colour. |
| Bad custom value | Enter a colour as # and six digits or letters a–f. |

In the hand-set rows, {names} are the plain names (section 5) of the other colours in the rules the
value failed; "darker" or "lighter" is the way Q2 A moved it, or would have; "on" is used when the
hand-set colour is drawn on the others (a text), "with" when the others are drawn on it (a
background). The round-3 reviewer's sweep (`/tmp/a841r3/i.mjs`) found hand-set values moved lighter
as well as darker (a light page set to `#ff00ff` went to `#ffbdfb`), so every sentence has both
forms.

## 5. What is editable

Thinking wide, four levels were possible:

1. **One brand colour**, nothing else.
2. **A few knobs** — brand colour, background, corners — from which every affected token, light and
   dark, is worked out.
3. **Knobs plus colours by hand** — the knobs, and a list you open of the colour tokens that carry
   no meaning, each with a light and a dark value (mock-up `08-q1-knobs-or-every-colour-light.png`,
   right). The meaning colours stay out, as section 2 rules out.
4. **Raw editing only** — every token, typed in. This is roughly what today's seven-token
   `tenant_themes` document allows, without a dark value (section 3).

**Chosen: level 2 by default, with level 3 behind Advanced** (owner, Q1, 2026-10-19: "A by default,
with advanced access to B"). The design recommended level 2 alone; the owner kept it as the default
and added the hand-set list behind an opening.

**The colours that can be set by hand.** Recounted on this tree (main ade4b3a3c):
`sed -n 1,123p packages/ui-core/src/tokens/colors.css | grep -oE '^\s*--wt-color-[a-z0-9-]+' | sed
's/^ *--wt-color-//' | grep -vE '^(on-)?(station-|palette-|table-|day-|danger|success|warning|google-|highlight)'
| wc -l` printed 23, and the same command over the other three blocks (lines 125-241, 243-357,
359-473) printed 23 each. No colour token is declared in `packages/ui` itself (a search for
`--wt-color-…:` declarations under `packages/ui/src` found none). The 23 are: `bg`, `surface`,
`surface-raised`, `surface-lifted`, `surface-sunken`, `track`, `text`, `text-muted`, `primary`,
`primary-hover`, `on-primary`, `primary-text`, `primary-disabled`, `on-primary-disabled`, `border`,
`focus`, `scrim`, `field-fill`, `field-line`, `field-label-focus`, `field-fill-disabled`,
`field-value`, `stepper-button`. **Advanced offers 22: all but `scrim`.** I left the scrim out
because it is the shade laid over the page behind an open dialog, and it is see-through: `rgb(0 0 0
/ 0.4)` in every block (`colors.css:30,152,269,385`), read by
`packages/ui/src/components/wt-dialog.ts:72`, `packages/staffing/src/dashboard/rota-popup.ts:61` and
`apps/dashboard/src/dashboard-app.ts:727`. Every other hand-set value is a six-digit `#rrggbb` code,
which has no see-through part, so the same field would black out (or white out) the page behind
every dialog. A see-through value is possible — CSS takes eight digits, `#rrggbbaa`, and a
"darkness" choice beside a colour would do it — but the shade is not a brand colour, so it did not
seem worth a field of its own. If the owner wants it, it can come back as a darkness choice. The
owner was told "23"; the question file says why it is 22 and offers it.

The plain names Advanced shows, in its order: Page (`bg`), Cards (`surface`), Menus and dialogs
(`surface-raised`), Selected item (`surface-lifted`), Sunken areas (`surface-sunken`), Bar tracks
(`track`), Lines and borders (`border`), Text (`text`), Secondary text (`text-muted`), Main buttons
(`primary`), Main buttons, pointed at (`primary-hover`), Text on main buttons (`on-primary`), Main
buttons, switched off (`primary-disabled`), Text on switched-off buttons (`on-primary-disabled`),
Links and accent text (`primary-text`), Focus ring (`focus`), Field background (`field-fill`), Field
underline (`field-line`), Field label while typing (`field-label-focus`), Field text
(`field-value`), Switched-off field background (`field-fill-disabled`), + and − buttons
(`stepper-button`). The plan checks each name against what the token actually paints.

The main choices:

- **Brand colour.** "Waitron's", one of the 24 swatches, or a custom colour. It sets the main button
  colour, its hover and disabled forms, the text on it, link and accent text, the focus ring, a
  focused field's label, the selected-item ring (which reads `--wt-color-primary`,
  `structure.css:120`), the lifted surface behind a selected sidebar item or row, and the stepper
  button tint.
- **Background: Neutral or Tinted.** Tinted gives the page, the sunken surface, borders, the bar
  track and field fills a faint cast of the brand colour's hue; Neutral keeps Waitron's greys.
- **Corners: Square, Standard or Round.** Sets `--wt-radius-sm`, `-md` and `-lg` (Square 0/2/4 px,
  Standard Waitron's 4/8/16 px from `structure.css:9-11`, Round 8/14/24 px — my call on the
  numbers). `--wt-radius-full` (circles and pills) never changes.

Not offered, each my call:

- **An accent colour.** Waitron has no second brand role among its tokens: the colour list in
  section 3 holds one primary family, and the other colours mean something (danger, success,
  warning, table states). A second colour would have nothing to paint.
- **Text size.** The font-size tokens are fixed pixel values (`structure.css:21-24`) that many
  layouts were measured against; it is Q4.
- **Spacing, tap size, fonts.** Spacing and the tap minimum are read from script by the components
  listed in section 3, and the tap minimum is an accessibility floor. Today's allowlist includes
  `--wt-font-family`; the knobs drop it (section 11).

## 6. How the knobs become colours

All my call; the plan pins the exact numbers.

- One pure function, `deriveTheme(choices) → { light, dark, adjusted, tintStrength }`, used by the
  editor's preview and by the server. Browser-safe and free of Lit, so the server can import it. It
  takes Waitron's default values from `colors.css` itself, never from a hand-kept copy (the trust
  page and guide pages show what a copy costs: section 3).
- "Waitron's" brand colour is stored as `brandColor: null`, and keeps Waitron's own primary family
  in each mode: the theme writes none of the brand-colour tokens, unless Main buttons is set by hand
  (below). With Neutral and Standard as well, and nothing set by hand, it is no theme at all: no
  row, Waitron's exact tokens. With Tinted, the tint takes the hue of
  Waitron's own primary. The prototype, run for `brandColor: null`, wrote 0 tokens for Neutral in
  both modes, and 6 (light) and 8 (dark) background tokens for Tinted with the tint at full
  strength, every rule passing. A custom colour typed as Waitron's own `#1f6feb` is a theme like any
  other and does not reproduce Waitron's dark set: the prototype gives a dark button of `#1f6feb`
  with white text and link text `#67a0fd`, where Waitron's own dark set has `#4c8dff`, `#06101f` and
  `#78a9ff` (`colors.css:136-139`).
- It always writes **the same list of tokens** — the 22 colours Advanced offers (section 5) and the
  three corner radii — filling Waitron's own value where a knob sits at its default and nothing is
  set by hand, so every theme has the same shape and the list doubles as the allowlist (section 14).
  Every colour the knobs work out is among the 22, so the list covers both.
- It works in OKLCH, a colour model where "lightness" matches what the eye sees, so it can move a
  colour's lightness and keep its hue. Light: the brand colour is the button colour if it stands
  3:1 from the page, both surfaces and the field fill; otherwise it is darkened step by step until it
  does. Dark: it is lightened until it does. The text on the button is white (light) or a near-black
  of the same hue (dark), falling back to plain black or white. Link text is the brand colour moved
  until it reads at 4.5:1 on the page, both surfaces, the field fill and the lifted surface. Hover is
  moved away from the button's text until it stands 1.2:1 from rest with the text still at 4.5:1.
- **The tint gives way, never the owner.** With Tinted, if any rule fails, the tint is weakened in
  steps of a tenth, down to none, until every rule passes; it never refuses for the tint. No note is
  shown when the tint is weakened (my call: the tint is faint decoration, the preview shows the
  result, and a note about it would be noise).
- A run of every 8-bit sRGB colour (16,777,216 of them) through the contrast formula, black against
  white text, printed `lowest best-of-black-or-white ratio … 4.583 at [ 207, 13, 204 ]`: every
  colour has black or white text at 4.5:1 or better, so text on a button can always be made
  readable without moving the button's colour. What can need moving is the fill itself, on a pale
  colour.
- **Worked examples**, from a prototype of this function
  (`/Users/clintongormley/waitron-campaign/a841-mockups-src/derive.mjs`, outside the repository;
  `node build.mjs` there prints them). The prototype checks 67 rules in light and 72 in dark: every
  rule of `colors.test.ts` listed in section 3 that reads a token the theme writes, plus Waitron's
  own button rules of section 9.
  - Bar Lucía, `#1e5b3a`, tinted: light buttons keep `#1e5b3a` with white text at 8.04:1; dark
    buttons are lightened to `#417c59`, white text at 4.94:1; the light page becomes `#f0f9f3`. All
    rules passed in both modes, with the tint at full strength.
  - Café Limón, lemon `#f2d300`: on white it stands 1.49:1, so light buttons are darkened to
    `#9f8b18` (3.40:1 on white, 3.17:1 on the page, black text on it 6.18:1); dark mode keeps the
    lemon itself. All rules passed. Kept unmoved, the light set failed three: the button colour on
    the field fill at 1.32:1, on the page at 1.39:1 and on the surface at 1.49:1.
- **Sweep** (`node sweep.mjs` in the same folder, run again after the dark rule count rose to 72
  with the danger-disabled rule): 216 brand colours (every combination of 0, 51,
  102, 153, 204 and 255 per channel) × Neutral and Tinted × light and dark, 864 cases, printed
  `failing 0, tint weakened in 0 tinted cases`. The first run of the sweep, with a darker light tint,
  had the tint weakened in every light case (the bar track fell to 1.38:1 on the page) and 44 cases
  failing on black and near-black brands; the light tint and the lightness search were changed
  until the run above. The build's guard test repeats this sweep (section 15).

### Colours set by hand

Added for the owner's Q1 answer, revised after review round 3. My calls, except where a rule depends
on Q2 or on the extra question before it (section 19).

- **Stored as a choice.** A hand-set value is one of the owner's choices, like the brand colour:
  the stored document holds it as typed, keyed by mode and colour (section 11). Nothing worked out
  is stored.
- **Fixed while the rest is worked out.** `deriveTheme` takes the hand-set values as fixed, and
  works the other colours out around them: the button's and the links' search for 3:1 and 4.5:1
  runs against a hand-set page, cards or field background.
- **A hand-set Main buttons colour leads its family.** When Main buttons is set by hand, the rest of
  the brand colour's family — pointed at, text on it, switched off and its text, links and accent
  text, focus ring, field label while typing, selected item, + and − buttons — is worked out from
  that colour, as if it were the brand colour, unless one of them is set by hand too. This holds
  even with "Waitron's" brand colour, which otherwise writes none of them: a burgundy main button
  must not turn Waitron's blue when pointed at. Prototype (`/tmp/a841r3/f.mjs`, the round-3
  reviewer's script, re-run after the change): brand "Waitron's", Neutral, light Main buttons set to
  `#7a1f2b` gave pointed at `#67081c`, links and focus `#7a1f2b`, selected item `#fee2e2`, every rule
  passing; with the dark value set to the same burgundy, Q2 A lightened it to `#9e4048` and the
  family followed (pointed at `#8a2e38`), every rule passing.
- **When a rule fails**, it is settled in this order:
  1. **the tint gives way, but only for failing rules between colours Waitron works out**, at least
     one of them tinted. A rule with a hand-set colour in it is left to steps 2 and 3, so one bad
     hand-set colour cannot strip the tint from everything else;
  2. **a worked-out colour named in the failing rule moves**, if moving it alone makes the rule pass
     (no note, as for the tint: the preview shows it). The main button colour is not moved here;
     the brand colour's own adjustment is Q2's;
  3. **otherwise the hand-set value is what makes the rule fail, and Q2's answer decides.**
     - With **Q2 A** it is moved, keeping its hue, to the nearest lightness at which every rule
       passes after steps 1 and 2, with a note under its row. When both colours in a failing rule
       are hand-set, the one drawn on top (text, line or button) is moved first. Meaning colours
       (danger, success, station dots, Google's button line, the search highlight) never move, so a
       hand-set background that fails against one of them is the one moved. It is refused only when
       no lightness of its hue, from black to white, passes every rule.
     - With **Q2 B** it is refused under its row and Save stays off. The refused set is computed
       this way: settle with steps 1 and 2 only, nothing hand-set moving; every hand-set value named
       by a rule still failing is refused, and no other. So under B a hand-set value is refused
       exactly when A would have had to move it.
  4. **What guarantees that nothing unreadable is saved is the server's final check of the finished
     set (section 9)**, not the settling steps: a save whose finished set still fails a rule is
     refused, naming the hand-set values in the failing rules.
- **Changing a main choice later keeps hand-set values** (recommended; the extra question in
  section 19). Each stays exactly as set, marked "Set by hand", with **Use worked-out colour** on
  its row and **Reset all to worked-out** at the end of the section. After a change, a note under
  Brand colour names what was kept. The trade-off: a colour chosen to go with the old brand (a pale
  green selected-item background, say) stays when the brand turns burgundy, and can clash; the note
  and the preview show it, and one tap puts it back. The other way — a change of brand colour or
  background puts every hand-set value back — always gives a matching set, but throws away
  deliberate work without asking, and a manager who set the cream page has to set it again after
  every brand change. Corners touch no colour, so they never affect a hand-set value either way.
- **Use Waitron's look** puts every hand-set value back as well (section 4).

**Worked example — Bar Lucía** (prototype: `deriveHand` in `a841-mockups-src/derive.mjs`, run by
`node build.mjs` there and by `node examples-hand.mjs`, outside the repository):

1. Lucía's look is brand `#1e5b3a`, Tinted, Round. Her light page is worked out as `#f0f9f3`.
2. She opens Advanced and sets the light page to the bar's cream, `#f8f1e1`. The page is that cream
   exactly. Around it: buttons stay `#1e5b3a` (7.14:1 on the cream), link text 7.14:1, text 15.78:1,
   the bar track 1.42:1 (its rule asks 1.4:1). The selected-item background moved from `#d8f1e0` to
   `#d3ecdb`, a worked-out colour moved to stand 1.1:1 from the cream (step 2: no note). Her dark
   set is untouched: with only a light value set by hand, the prototype's dark tokens were identical
   to those with nothing set by hand (dark page `#0b110d`). All rules passed in both modes. Mock-up
   `12-advanced-{light,dark}.png`.
3. Later she changes the brand colour to burgundy, `#7a1f2b`. The cream page is kept and marked;
   the note under Brand colour says so. Everything else is worked out again from burgundy: light
   buttons `#7a1f2b` with white text at 10.20:1 (9.07:1 on the cream), the selected item `#fce0e0`,
   sunken areas `#e2d6d6`, field background `#f7eeed`. All rules passed in both modes. Without the
   hand-set page, her light page would have been `#fff3f3`; **Use worked-out colour** on the page row
   gives exactly that. Mock-up `14-q-hand-kept-or-put-back-light.png`, left.
4. Back on green, with the cream page, she sets Secondary text (light) to a pale sage, `#8fa898`.
   The rules for secondary text ask 4.5:1 on the selected item, the field background and the
   switched-off field background; the sage reads 2.04:1, 2.24:1 and 2.38:1. No worked-out colour
   can move far enough from it (even white reaches only 2.55:1), so the sage is at fault (step 3).
   With Q2 A the prototype darkens it to `#526a5b`, which reads 4.70:1, 5.17:1 and 5.49:1, every rule
   passing; its row says "Darkened to #526a5b so it can be read on Selected item, Field background
   and Switched-off field background."; the stored choice stays `#8fa898`. With Q2 B the refused set
   is the sage alone — the cream page is named by no failing rule, and the tint stays at full
   strength (the round-3 reviewer's `/tmp/a841r3/e.mjs`, re-run: `tint 1 field-fill #ebf2ed`, only
   the three secondary-text rules failing) — and its row says "Too close to Selected item, Field
   background and Switched-off field background to read. Pick a darker colour." Mock-up
   `15-q2-hand-set-adjust-or-refuse-light.png`.

**Extreme picks** (`node sweep-hand.mjs a light`, `… a dark`, `… b light`, `… b dark` in the same
folder: Bar Lucía, Tinted, each of the 22 colours set by hand in turn to each of the eight corner
colours of the colour cube — black, white, red, green, blue, cyan, magenta, yellow — 176 cases per
mode). Under Q2 A they printed `Q2 A light: cases 176, passing as typed 87, moved lighter 32, moved
darker 57, refused 0, saved failing 0` and `Q2 A dark: cases 176, passing as typed 79, moved lighter
31, moved darker 66, refused 0, saved failing 0`: no case was refused, so I have no example of a
hand-set colour that no lightness of its hue can make readable, and give none. An example of a
move: pure blue cards in light mode fail all fifteen station dots and more; Q2 A lightens them,
keeping the hue, to `#e2ecff`, where every rule passes (the round-3 reviewer's `/tmp/a841r3/g.mjs`
found the same hue passing from lightness 0.94). Under Q2 B, light mode printed `refused 89, saved
failing 0` — the 89 that A moved, and no others. Dark mode under Q2 B printed `refused 100, saved
failing 70`: there Bar Lucía's own green, no longer adjusted, failed a dark button rule in every
case except the six where Main buttons itself was set by hand to a light enough colour (a
follow-up run listed exactly `primary=` green, cyan, red, magenta, yellow and white as passing), so
under B the brand colour itself would be refused (section 9). The prototype's settling is still
simple — step 2 moves one worked-out colour at a time and only when that lowers the number of
failing rules, and step 3 tries lightness in steps of a hundredth — so the plan decides how the real
one searches; the final check (step 4) covers whatever it misses.

## 7. Light, Dark and Follow device

The venue's theme supplies colours; each browser's A681 choice still decides which of the two sets
it shows. The theme stylesheet repeats the token layer's three cases, so nothing in
`theme-choice.ts` changes:

```css
@media screen {
  [data-wt-theme-root] { /* light values */ }
  @media (prefers-color-scheme: dark) {
    [data-wt-theme-root]:not([data-theme="light"]) { /* dark values */ }
  }
  [data-wt-theme-root][data-theme="dark"] { /* dark values */ }
}
```

Experiment (`a841-mockups-src/probe.mjs`, Playwright's Chromium 156.0.8078.4): the real
`colors.css` adopted the way `applyTokens` does, plus a sheet like the one above setting
`--wt-color-primary` to `#111111` (light) and `#222222` (dark). For the operating system set to light
and to dark, crossed with Light, Dark and Follow device, the computed value was `#111111` exactly
when the light set should show and `#222222` exactly when the dark set should, six cases out of six.
The control without the sheet printed Waitron's `#1f6feb` and `#4c8dff` in the same cases, so the
probe tells the two apart. With print media emulated it printed `#1f6feb`: printing the page itself
uses Waitron's colours. That wrapper does not cover a window that copies token values from the page
while it is on screen, as the recovery sheet does (section 8).

I chose three blocks over CSS `light-dark()` (which the guide pages use, `guide-pages.ts:93`)
because the blocks ask nothing new of a till's browser; whether every till's browser supports
`light-dark()` I did not check.

## 8. Where the theme shows, and where it does not

| Surface | Theme? | Why |
| --- | --- | --- |
| Dashboard, signed in and signed out | Yes | The owner's main surface. |
| Till: counter, tables, bills, kitchen and station screens, handhelds | Yes | Same app (`apps/till`). When each follows a change: section 12. |
| Setup wizard | No | Runs before a theme exists; my call. |
| Trust page, user guide, server recovery page | No | Server-built pages with hand-copied tokens (section 3); my call, could follow later. |
| Dashboard recovery sheet | Partly | It copies tokens from the page (section 3), so on screen it shows the theme; printed, its text and background are forced plain, and its border colour and corner radius stay the theme's. My call: leave it, since the printed words and page are plain. |
| Equipment label | No | It copies font tokens only (section 3). |
| Waitron logo, favicon, till browser-bar colour | No | Waitron's own frame (section 3). My call: the browser-bar colour and the manifest stay Waitron's blue, like the favicon; an installed app reads its manifest at install, not per venue change. |
| Product tiles, categories | No | Painted from the product's stored colour (section 3). |
| Floor-plan table states, stations, calendars, danger/success/warning | No | Their colours carry meaning and are tested apart from each other (`colors.test.ts:446-576`). |
| Receipts, kitchen tickets | No | Printer commands, not web pages (section 3). |

## 9. Readability protection

Two sets of rules, run on the worked-out set in light and dark.

**Every `colors.test.ts` rule that reads a token the theme writes** — the list in section 3. To keep
one list, the plan moves those rules out of `colors.test.ts` into a shared check that both the test
(for Waitron's palette) and `deriveTheme` (for a venue's) call — my call. They rest on WCAG 2.2
(<https://www.w3.org/TR/WCAG22/>):

- 1.4.3 Contrast (Minimum): "The visual presentation of text and images of text has a contrast ratio
  of at least 4.5:1".
- 1.4.11 Non-text Contrast: "The visual presentation of the following have a contrast ratio of at
  least 3:1 against adjacent color(s): User Interface Components Visual information required to
  identify user interface components and states, except for inactive components …".
- Contrast ratio: "(L1 + 0.05) / (L2 + 0.05), where L1 is the relative luminance of the lighter of
  the colors, and L2 is the relative luminance of the darker of the colors."

**Waitron's own button rules** (no test holds them today; Waitron's palette passes them: section
3 and the `#1f6feb` figures below): text on a button at 4.5:1 (WCAG 1.4.3), and the button's fill,
and the focus ring, at 3:1 against the page and the card surface. The fill rule is **Waitron's,
stricter than WCAG**: WCAG's own explanation of 1.4.11 says "If a control has visible content (such
as text or a sufficiently contrasting icon), which helps users identify the presence of the control,
then a border or other indication of the overall boundary of the hit area is not required"
(<https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>, "Boundaries"). Waitron keeps
it because some controls show their state by fill alone — the pressed Theme button is "filled with
`--wt-color-primary`" (`design-system.md:3272-3274`) — and a switch's track is the same colour.
Waitron's light blue stands 4.33:1 on the page and 4.63:1 on the surface, with white text on it at
4.63:1 (derive.mjs `ratio`).

**Text in the button colour.** The 15 places that paint text in `--wt-color-primary` (section 3) are
outside these rules, and Waitron's own blue already reads under 4.5:1 on its page. My call: the build
moves each one that is text to `--wt-color-primary-text` (an icon or line may stay, under the 3:1
fill rule), and adds a guard refusing `color: var(--wt-color-primary)` outside an allowlist of the
graphic uses (slice 4). Two of the 15 are in `apps/setup` (`form-styles.ts:49`,
`screens/provisioning-screen.ts:41`), which the theme does not reach (section 8): moving them is
optional. The guard is weaker than its name: it reads `color:` declarations as text, so it misses a
redeclared token (`printers-screen.ts:218`, `--wt-color-text: var(--wt-color-primary)`), a `fill:` or
`stroke:` (`apps/setup/src/setup-app.ts:472`, `packages/ui/src/components/wt-floor-map.ts:319`), and a
read from script; the plan lists those by hand.

**On a bad choice** (Q2): recommended, Waitron moves the colour just enough and says so beside the
field; Save stays enabled. The alternative refuses the colour with the form's usual field message
and keeps Save disabled until the owner picks another (`05-refused-light.png`). **Whichever Q2
answer comes back applies to colours set by hand too**, under their own rows (section 6, "Colours
set by hand", step 3). Under A a hand-set colour is moved, keeping its hue, until every rule
passes, and refused only when no lightness of its hue passes. The same rules check hand-set and
worked-out colours alike; a hand-set colour gets no exemption for having been typed exactly.
Under B, Bar Lucía's own green would be refused for dark screens: unmoved, `#1e5b3a` stands
2.33:1 on Waitron's dark page and 2.12:1 on its dark cards, where buttons need 3:1 (`derive.mjs`,
`derive({ brand: "#1e5b3a", background: "neutral" }, "dark", { adjust: false })`). She could keep
it for light screens only by setting the dark Main buttons colour by hand.

**Every way in is checked.** The server derives and checks on every save, hand-set values included,
so a request that skips the screen cannot store an unreadable theme; it answers `theme.invalid` for
choices that are not valid, or that leave a rule failing (section 11). A configuration import is
the second way to write `tenant_themes` (`configuration-transfer.ts:77`), and
`validateCoreConfiguration` checks no theme row today (`configuration-transfer.ts:5-24`): the build
adds the same choice check there. The stylesheet is built only from the derived values — `#rrggbb`
colours and pixel radii the function itself writes, and hand-set values only after they pass the
same `#rrggbb` check — never from an unchecked stored string, so nothing stored can break out of a
declaration.

## 10. Preview, saving and reset

- The preview's two panels sit inside the Look card's shadow root. A probe by the round-1 reviewer
  (`/tmp/a841-review/probe6.mjs`, re-run: "dark panel inside a shadow root, token sheet adopted in
  shadow=false: {"primary":"#111111","bg":"#f7f7f8","scheme":"light"}" and "… adopted in
  shadow=true: {"primary":"#4c8dff","bg":"#101216","scheme":"dark"}") shows that a panel in a shadow
  root takes the page's resolved values unless the token layer is adopted inside that shadow root.
  So each panel is passed to `applyTokens(panel)`, which adopts the token layer into the card's
  shadow root (`index.ts:20-23`), gets `data-theme="light"` or `"dark"`, and takes the draft through
  a stylesheet in the same shadow root. The venue's saved sheet sits on the document and does not
  reach inside the shadow root, so it cannot leak into the preview. A nested theme root is not new:
  the equipment label marks its print frame as one (`equipment-label.ts:44`), and
  `colors.test.ts:118` checks that a nested root takes its own `color-scheme`; `design-system.md:87`
  ("nothing nests a theme root today") is updated by the build.
- Save sends the choices only — the three main choices and the hand-set values. The server checks
  them, stores them and answers the stored choices with the worked-out values and any notes (which
  colour was moved, to what). Reset is Save with Waitron's choices and no hand-set values, which
  deletes the row.
- **Use worked-out colour** and **Reset all to worked-out** change the draft only, like every other
  control on the card; Save stores the result and Cancel undoes them.

## 11. Storage

My call: **reuse and reshape what exists** rather than adding a parallel table.

- **Table:** `tenant_themes` stays, one row for the business. Scope: the whole business, not one
  location — a brand belongs to the business, one database holds one business
  (`design-system.md:3256-3261`, the banner shows "the deployment tenant's legal name, not a
  location name"), and a single row needs no location key. Its `theme` document changes from
  `{ tokens }` to the owner's **choices only**: `{ brandColor, background, corners, handSet }`
  (`brandColor` is `#rrggbb`, or `null` for Waitron's; `background` and `corners` from fixed lists;
  `handSet` is `{ light: {…}, dark: {…} }`, each mapping one of the 22 names of section 5, written
  without `--wt-color-`, to a `#rrggbb` value, and empty when nothing is set by hand). For example,
  Bar Lucía after step 3 of section 6's worked example: `{ "brandColor": "#7a1f2b", "background":
  "tinted", "corners": "round", "handSet": { "light": { "bg": "#f8f1e1" }, "dark": {} } }`. A
  hand-set value is stored as typed, never as moved (section 6). No worked-out values are stored, so
  a release that improves Waitron's defaults reaches a themed venue too; the cost is that a release
  changing the defaults or the formula can shift a venue's worked-out colours slightly, which the
  editor shows as it works them out now. A release never changes a hand-set value as stored, but it
  can change how one is served: one Q2 A moves may be moved differently, and one that no longer
  passes is served as worked out (section 17).
- **No migration is needed:** the table and its JSON column stay; the document's shape is checked in
  code. Before go-live any installation may be reset (CLAUDE.md §3), so an old `{ tokens }` row is
  not carried forward: the server reads one as no theme (my call).
- **Routes:** `GET` and `PUT /management-api/theme` stay and take the new document; `GET` answers
  the choices and the worked-out values for the editor. Gates: section 13.
- **Error code:** `theme.invalid` stays. It carries `field` (`brandColor`, `background`, `corners`,
  or a hand-set value as `handSet.light.bg`, the same string as that input's `name`) and `reason`
  (among them `unknown_colour` for a name outside the 22, `bad_value`, and `unreadable` for section
  6's step 3 — under Q2 B, or under A when no lightness of the colour's hue passes — and for step
  4), replacing `token`, so the card can put the sentence under the field or row (CLAUDE.md §3: "A
  screen puts a refusal beside a field by what the error CARRIES"); renaming params is free before
  go-live.
- **Retired:** `THEMEABLE_TOKENS` and `MAX_THEME_VALUE_LENGTH` (`theme.ts:12-22`) and
  `validateThemeOverride`, with their exports (`packages/layouts/src/index.ts:28-29`) and the case
  that checks one (`packages/layouts/src/index.test.ts:7`), replaced by the choice check and the derived token list; the till's unused
  `ThemeOverride` copy (`apps/till/src/layout.ts:58-60`); the `--wt-font-family` override (no knob
  for it).
- **Backlog this closes or changes:** the `--wt-color-primary-text` entry (`backlog.md:4487-4493`,
  detail `backlog/dashboard.md:1227-1236`) closes — the theme writes primary text, hover and
  disabled colours; the `tenant_themes` DELETE restriction (`backlog.md:6238-6240`) is answered —
  Reset deletes the row, so DELETE is an intended path; `design-system.md:189-208` is rewritten.
- **Configuration copy:** the theme already travels (`configuration-transfer.ts:77`); the build adds
  its check to `validateCoreConfiguration` (section 9).

## 12. Delivery and refresh

Revised after round 1: a stylesheet linked in `<head>` holds the page until it answers. The reviewer's
`/tmp/a841-review/probe3.mjs`, re-run, printed for a 1.5 s answer no paint until `first-paint@1648`;
for a refused answer `first-paint@12`; and for an answer that never comes no paint and no script run
in 3.2 s of samples. So the theme is **applied from script, from a copy kept in the browser, and
fetched without holding anything** (B4: I chose the stored copy).

- **The answer.** `GET /api/theme` with no session (the colours are not secret, and the signed-out
  dashboard and the till's start screen need them) answers `{ hash, css }`: the section-7 sheet built
  from the stored choices by the current release, or an empty `css` with no row, and `hash`, a
  SHA-256 of `css` (like `setupRevisionOf`, `till-setup.ts:115-117`). A content hash, not a row
  counter, because Reset deletes the row and a later save could repeat a counter. The server keeps
  the last answer in memory keyed by the stored document, so serving it reads one row and derives
  nothing new; it never waits on anything but that read.
- **Applied at start-up, in the same step as the token layer.** Each app's `main.ts`, right after
  `applyTokens`, adopts a second sheet holding the copy stored in the browser under
  `waitron-venue-theme` (if any), then fetches `/api/theme` with a time limit; a newer answer
  replaces the sheet's text and the stored copy. Nothing waits on the fetch.
- **Experiment** (`a841-mockups-src/probe7.mjs`, Chromium 156.0.8078.4): a one-file page shaped
  like that (`index.html` styled from `--wt-color-bg`, a module script applying the tokens and the
  stored copy, then fetching with a 2 s limit). In every case the browser may paint an empty page
  before the script runs: the tokens are not applied yet, so it is blank, as today. The round-2
  reviewer's `/tmp/a841-r2/prepaint.mjs`, re-run with the module delayed 1.5 s, printed
  `first-paint@12` with the body background `rgba(0, 0, 0, 0)`. The first frame after the script ran
  showed the stored theme `rgb(237, 246, 240)` with a stored copy and the server never answering, and
  Waitron's `rgb(247, 247, 248)` without one (`/tmp/a841-r2/probe7-rep.mjs`, re-run and
  counted: 16 stored-copy runs, all `rgb(237, 246, 240)`; both no-copy runs `rgb(247, 247, 248)`). With no stored
  copy and the server answering after 500 ms, the theme's colour showed 1.5 s later — the one flash,
  on a browser's first visit or the first load after a change. The probe's millisecond timings come
  from a one-file script, the stored-copy case after a warm-up visit (`/tmp/a841-r2/probe7-warm.mjs`,
  re-run: warmed with no stored copy, module at 5-6 ms and first paint at 8 ms), and say nothing
  about the real apps' bundles. WebKit was not measured: Playwright 1.64.1's WebKit is not installed
  here (`Executable doesn't exist at …/ms-playwright/webkit-2370/pw_run.sh`). Slice 3 measures both
  engines in the real apps (B4).
- The round-1 finding that Vite rewrites `<link href="/api/theme.css">` to `/manage/…` in the
  dashboard's development server no longer applies: there is no link. (The reviewer's
  `/tmp/a841-review/run.mjs`, re-run with its fixture carrying `vite-ignore`, printed
  `href="/api/theme.css"` for development and build at both bases; I did not re-run it without
  `vite-ignore`.)
- **Open dashboards** watch a theme read that depends on `tenant_themes`, already a change source
  (section 3). It is passive (house rule: automatic reads do not keep a session alive) and open to
  every signed-in person, with no permission; on a new hash the shell replaces the sheet's text.
- **Signed-in tills** get a `themeHash` field in `readTillSetup`, which moves `setupRevision`;
  `#applyVenueSetup` fetches `/api/theme` and replaces the sheet. A signed-in till therefore follows
  within one menu-state poll (15 s).
- **Signed-out tills** run no poll (section 3): they follow at their next start-up, or at the next
  sign-in, whose first poll carries the new revision.
- **Fixed until reload:** a kitchen screen in device mode, which runs no poll (backlog A785); it is
  added to that list in `docs/developers/conventions-ui.md`.

## 13. Permissions

My call:

Revised for the move to the Settings section. The rule stays: supervisors see the look; managers
and administrators change it.

- Reading: `GET /management-api/theme` moves from `layout.configure`
  (`apps/server/src/management-api.ts:1278-1282`) to `venue.view`, like
  `GET /management-api/venue-defaults` (`apps/server/src/location-settings-api.ts:297-302`); a
  supervisor holds `venue.view` but not `layout.configure` (`permissions.ts:46-55`), so the
  read-only card would otherwise be refused.
- Editing: **stays `layout.configure`**, the permission `PUT /management-api/theme` already checks
  (`packages/layouts/src/theme-store.ts:23-26`). The earlier draft moved it to `venue.configure`
  only because the card sat on Venue settings, whose cards edit under that permission
  (`dashboard-app.ts:1916`). On the Settings section the nearest page is Device profiles, read and
  saved under `layout.configure` (section 3), and receipt layouts use it too
  (`packages/layouts/src/receipt-store.ts:171`). Only managers and admins hold it, and supervisors
  do not (`permissions.ts:46-83`), so nobody gains or loses the right, and the `PUT` gate does not
  change at all.
- Seeing the page: the Appearance item in the side menu names `requiresPermission: "venue.view"`
  (supervisors and up), so a supervisor sees the read-only card; the card offers Edit only to a
  person holding `layout.configure`, as Venue settings offers it by `venue.configure`
  (`dashboard-app.ts:1916`). Staff cannot open the page: a staff session is sent to Orders or My
  schedule whatever it asks for (`dashboard-app.ts:1930`).
- Applying the look: `/api/theme` needs no session; the dashboard's live read needs a session but no
  permission (section 12).

## 14. What the guards need

- `style-token-names.test.ts`: the theme writes only names already declared in `colors.css` and
  `structure.css`, so no read becomes undeclared. A theme that wrote a name declared nowhere would
  do nothing, and this guard would not see it (its header: it does not see a name written from
  script or as a quoted key). `theme-registry.test.ts` changes from `THEMEABLE_TOKENS` to the list
  `deriveTheme` writes: every name declared in the token files, and the list the same for every
  choice. The 22 hand-settable names are that list's colours, so the same guard covers them; a test
  pins that `scrim` and every meaning colour are outside it.
- `no-hardcoded-chrome.test.ts`: the editor lives in `apps/dashboard`, outside what it scans, and
  its draft colours are built at run time, which it never reads. The preview panels and the swatches
  still read tokens in their static styles.
- `scripts/native-form-fields.test.ts`: the custom colour reuses `colorField`'s
  `<input type="color">`, a type the guard lists as not a text field
  (`scripts/native-form-fields.test.ts:20-31`). Each hand-set value's code field comes from the
  shared input primitive, not a native text `<input>`.
- New: the shared contrast check (section 9), the sweep (section 15), and a guard refusing text in
  `--wt-color-primary` (section 9).

## 15. Testing

- `deriveTheme`: the section-6 sweep as a test — brand colours on a grid × Neutral and Tinted ×
  light and dark, every rule passing (corners do not touch colour, so they are left out of the
  colour sweep and tested on their own). The same choices give the same values; the written token
  list never changes. Proof by deletion: remove the darkening step and the lemon case must fail at
  1.39:1 on the page.
- Hand-set values: section 6's worked example as cases (the cream page kept exactly and every rule
  passing; the brand change keeping it; Use worked-out colour giving `#fff3f3`; the sage moved under
  Q2 A, refused under Q2 B, with the cream page not named); a hand-set Main buttons colour with
  "Waitron's" brand colour writing its whole family; a sweep of hand-set values in which every case
  either passes every rule or is refused naming a hand-set value — never saved failing; and, under
  Q2 A, an extreme hand-set colour (pure blue cards) moved, keeping its hue, until every rule passes,
  or refused only when no lightness of its hue passes.
- Server: `PUT` refuses invalid choices with `theme.invalid` naming the field (a hand-set value as
  `handSet.light.bg`); refuses without `layout.configure`; a supervisor's `GET` is answered and its
  `PUT` refused; a configuration import with a bad theme row is refused; `/api/theme` answers
  empty with no row and the three blocks with one, and the hash changes after Reset then a new save;
  the till's revision moves when the theme changes. The six existing cases in
  `management-api.canvas-retirement.test.ts:146-229` are rewritten for the new document, keeping
  their refusal cases.
- Browser (real Chromium, and WebKit for the start-up probe): the section-7 probe as a test against
  the real token files; probe7's three cases against the real dashboard and till; the dashboard and
  a signed-in till repaint after a save without a reload; the editor's form, `*.unsaved.test.ts` and
  axe tests in both themes.

## 16. Build slices (each one pull request)

1. **The derivation and the shared checks.** `deriveTheme`, the contrast rules moved out of
   `colors.test.ts`, the sweep, the token-list guard. No screen. Hand-set values may be their own
   slice (1b) if this one grows past one implementer: fixed inputs, the settling steps of section 6,
   the hand-set sweep.
2. **The stored document and the server.** `tenant_themes`'s new document, the routes' new body and
   read permission (a supervisor reads, and is refused a save), `theme.invalid` with `field`, the
   import check, `/api/theme`, the till's `themeHash`; retire `THEMEABLE_TOKENS`,
   `validateThemeOverride` and the till's copy.
3. **Delivery.** The stored copy and the fetch in the dashboard's and till's `main.ts`, the
   dashboard's live read, the till's `#applyVenueSetup` swap, the start-up probes in Chromium and
   WebKit, the fixed-until-reload entry.
4. **Primary-coloured text.** Move the text uses of `--wt-color-primary` to `--wt-color-primary-text`
   and add the guard.
5. **The editor.** The Appearance page in the side menu's Settings section, the Look card,
   preview, adjusted note, Spanish strings, and the design-system rewrite of
   `design-system.md:189-208` beside "Retheming a deployment"; the user guide gains the page.
6. **Advanced.** The closed section and its summary, the 22 rows with picker and code field, Set by
   hand marks, Use worked-out colour, Reset all to worked-out, the kept-colours note, notes and
   refusals under rows, and their `*.unsaved.test.ts` and axe cases.

### If an answer comes back B

- **Q1** is answered (both, A by default and B behind Advanced); this design already holds it.
- **The extra question, B (a brand or background change puts hand-set colours back):** the editor
  clears `handSet` in the draft when Brand colour or Background changes, with the note "Changing the
  brand colour put back the {n} colour(s) you set by hand: {names}."; Cancel still restores them.
  Nothing else changes.
- **Q2 B (refuse):** `deriveTheme` stops adjusting the button colour and the hand-set values, and
  reports the failing rules; the server answers `theme.invalid` with `field: "brandColor"` or the
  hand-set value's field, `reason: "unreadable"`; the tint, and worked-out colours fitted around a
  hand-set one (section 6, step 2), still give way.
- **Q3 B (per device profile):** `tenant_themes` holds several named documents; device profiles gain
  a theme choice; `/api/theme` answers per device, and the till's `themeHash` follows its profile; a
  migration is needed. Each named look carries its own three choices and its own hand-set colours,
  so the Advanced list, its checks and its refusals repeat per look (two looks: up to 88 hand-set
  values instead of 44).
- **Q4 B (text size):** a fourth knob scaling the four font-size tokens; every layout test that
  measures text in pixels is re-run at Large, and the slices gain one for the screens that break.

## 17. Risks

- **First visit.** A browser's first load, and the first load after a change, shows Waitron's
  colours until the fetch answers (probe7). On every later start the stored copy shows the theme
  from the app's first frame.
- **WebKit not yet measured** (section 12); slice 3 measures it.
- **Old till browsers.** The sheet uses nothing newer than `:not()`, media queries and constructed
  stylesheets (which `applyTokens` already uses); which browsers venues' tills run I do not know.
- **The checks are not every pair.** They cover the rules of section 9; a component that puts the
  brand colour on an unusual background (a coloured tile, an alert) is not checked. Mitigation: the
  brand colour never paints a meaning colour or a product tile.
- **Releases move colours.** Deriving at serve time means a release can shift a venue's colours
  slightly (section 11); every shift still passes the rules, because the server checks what it
  serves.
- **A release can make a saved hand-set colour fail.** A hand-set value passed when saved, but a
  later release can add a rule or change what is worked out around it, and the server cannot refuse
  at serve time. My call: when it serves, a hand-set value that leaves a rule failing that settling
  cannot fix is served as worked out instead, and the editor shows that value with a note ("No
  longer readable with this version of Waitron; showing the worked-out colour.") until the owner
  changes or resets it. The stored choice is untouched.
- **Recovery sheet.** It keeps the theme's border colour and corner radius on paper (section 8).
- **A stale design-system sentence** (`design-system.md:108-110`), backlog A899, narrowed in round 1:
  a bare `[data-wt-theme-root]` selector wins over the token layer in all six cases of probe.mjs's
  third variant; a bare `[data-theme]` selector matches nothing under Follow device, which removes
  the attribute (`theme-choice.ts:28`), so the advice against that one has a real reason, just not
  the written one.

## 18. Mock-ups

In `docs/backlog/mockups/a841-theme-editor/`, built from the real token files with Playwright's
Chromium (sources and the prototype outside the repository, in
`/Users/clintongormley/waitron-campaign/a841-mockups-src/`; `node build.mjs` there re-renders every
picture except 08, which it leaves as the owner saw it). The side menu is the one a manager sees on
that page: every group starts folded and the open page's group unfolds
(`apps/dashboard/src/dashboard-app.ts:863-867`), and the Settings group lists the eight pages a
manager may open — all of `dashboard-app.ts:280-291` but Servers, which needs `mirror.create`, an
admin's permission (`permissions.ts:56-83`). In the editor pictures only the preview shows the draft;
the dashboard around the card, the card included, keeps the saved look (section 4, step 4):

| File | Shows |
| --- | --- |
| `01-appearance-card-{light,dark}.png` | The Appearance page in the side menu's Settings section: the saved Look card, with Bar Lucía's look applied to the dashboard |
| `02-editor-{light,dark}.png` | The editor with its Light and Dark preview, Advanced closed |
| `03-editor-phone-light.png` | The editor at 390 px |
| `04-adjusted-light.png` | Café Limón's lemon, darkened with a note (Q2 A) |
| `05-refused-light.png` | The same colour refused (Q2 B) |
| `06-till-{light,dark}.png` | A till counter screen in Bar Lucía's look; product tiles keep their own colours |
| `07-dashboard-{light,dark}.png` | The Products screen in Bar Lucía's look |
| `08-q1-knobs-or-every-colour-light.png` | Q1 options side by side, kept unchanged as the record of what the owner saw when they answered (2026-10-19). Superseded by 02 and 12: its B side says 23 colours and has no Set by hand marks |
| `09-q2-adjust-or-refuse-light.png` | Q2 options side by side |
| `10-q3-one-theme-or-per-device-light.png` | Q3 options side by side |
| `11-q4-text-size-light.png` | Q4 options side by side |
| `12-advanced-{light,dark}.png` | Advanced opened: Bar Lucía's light page set by hand to cream in the draft, marked, beside worked-out colours; her dark page still worked out. The saved look around the card has no cream |
| `13-advanced-phone-light.png` | Advanced opened at 390 px: each row stacks its Light and Dark values |
| `14-q-hand-kept-or-put-back-light.png` | The extra question: with the cream page saved, the brand changed to burgundy in the draft; the cream page kept (A) or put back (B) |
| `15-q2-hand-set-adjust-or-refuse-light.png` | Q2's hand-set half: the sage secondary text darkened under its row (A) or refused (B); under B the green itself is refused for dark screens too (section 9) |

## 19. Questions for the owner

**Q1 of 4 — How much can the owner change? ANSWERED 2026-10-19:** "A by default, with advanced
access to B. Also this should be in settings rather than venue". Folded in: the three choices are
the default, and an Advanced section, closed until opened, offers 22 colours by hand (the 23 less the
see-through shade behind dialogs; section 5); the card moves to a new Appearance page in the side
menu's Settings section (section 4). It raised one extra question, asked before Q2:

**Extra question (from the Q1 answer) — When the brand colour changes, what happens to colours set
by hand?** Bar Lucía's manager has set the light page to the bar's cream by hand. Later she changes
the brand colour from green to burgundy. With A, the cream page stays, still marked "Set by hand",
and a note under the brand colour says "You set 1 colour by hand, and it is kept: Page (light).
Advanced shows it."; one tap ("Use worked-out colour") gives her the burgundy-tinted page instead.
With B, changing the brand colour (or the background) puts every colour set by hand back to worked
out, and a note says which; Cancel still brings them back. Pictures:
`14-q-hand-kept-or-put-back-light.png` (and `12-advanced-light.png`).

- **A (recommended):** colours set by hand are kept until she puts them back herself.
- **B:** changing the brand colour or background puts them all back.

**Q2 of 4 — What happens when a chosen colour would be hard to see?**
Café Limón's owner picks lemon yellow. On a white page a lemon button is almost invisible: 1.5 to 1,
where Waitron's own rule for buttons asks for 3 to 1. With A, Waitron darkens it to a mustard for
light screens only, keeps the lemon on dark screens, and shows "Darkened to #9f8b18 on light
screens, so buttons stand out." With B, Waitron refuses: the colour is marked "Too pale for buttons
on light screens. Pick a darker colour." and Save stays off until she picks another. B also
refuses Bar Lucía's own dark green for dark screens (2.33 to 1 on the dark page), unless she sets
the dark Main buttons colour by hand. The answer applies to colours set by hand in Advanced too: at
Bar Lucía, a pale sage typed for "Secondary text" reads about 2 to 1 on the selected item and the
field backgrounds, where text needs 4.5 to 1; with A Waitron darkens it to #526a5b and says so under
its row, with B it is refused under its row. Under A, Waitron moves a hand-set colour lighter or
darker, keeping its hue, until every rule passes, and refuses it only when no shade of it would
pass. Pictures: `09-q2-adjust-or-refuse-light.png` (and `04-adjusted-light.png`,
`05-refused-light.png`), and `15-q2-hand-set-adjust-or-refuse-light.png` for the hand-set colour.

- **A (recommended):** Waitron adjusts the colour just enough and says so.
- **B:** Waitron refuses the colour until another is picked.

**Q3 of 4 — One look for the whole business, or one per kind of device?**
Bar Lucía has bar tills and terrace handhelds. With A there is one look, and every till and dashboard
shows it. With B the owner can save several looks ("Bar" in green, "Terrace" in blue) and each
device profile picks one, so the terrace handhelds look different from the bar tills. Each look
then has its own colours set by hand too, so with two looks there are two Advanced lists to keep.
Pictures: `10-q3-one-theme-or-per-device-light.png`.

- **A (recommended):** one look for the whole business.
- **B:** several named looks, each device profile chooses one.

**Q4 of 4 — Should the look also make text bigger?**
A waiter at Bar Lucía finds the till's text small. With A, the look changes colours and corners
only, and bigger text becomes a separate item that can be tested screen by screen. With B, the card
gains "Text size: Standard / Large", and Large makes all text on every till and dashboard about 30%
bigger at once, so longer names wrap (in the picture "Tinto de verano" takes two lines). Pictures:
`11-q4-text-size-light.png`.

- **A (recommended):** no text size in the look; bigger text is its own later item.
- **B:** a Text size choice on the card, Standard or Large.
