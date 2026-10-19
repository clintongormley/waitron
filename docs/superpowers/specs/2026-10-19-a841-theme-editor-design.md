# A841 — a theme editor: design

Status: design, revised after review round 1; waiting for the owner's answers to the four questions
at the end. Backlog: A841 (owner, 2026-10-17). Builds on A681 (#1842), the per-browser Light / Dark /
Follow device choice. Mock-ups: `docs/backlog/mockups/a841-theme-editor/`.

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
- Every saved theme passes every contrast rule Waitron's own palette is tested against, plus
  Waitron's own button rules (section 9).
- Open dashboards and signed-in tills pick up a saved theme without a reload (section 12).
- "Use Waitron's look" gives exactly Waitron's own colours back.

Non-goals (not in A841; each could be its own item later)

- Logos, the venue's own logo, fonts, the favicon, and the till's browser-bar colour (section 8).
- Receipts, kitchen tickets and anything else a printer prints (section 8).
- The server's own pages: the trust page, the user guide pages, the recovery page.
- Setup (the first-run wizard): it runs before the venue has a theme.
- Colours that carry a meaning: red for danger, green for success, amber for warning, the table
  states on the floor plan, prep-station colours, calendar colours, Google's sign-in button.
- Product and category colours: those are the venue's own data, already chosen per product.

Anti-goals (things this must never do)

- Let a saved theme make a button's words, a link or a focus ring unreadable.
- Delay or block the till's start-up or a sale: fetching the theme never holds the page (section 12).
- Become a second, hand-kept copy of Waitron's default colours: a venue's theme stores only the
  owner's choices, and is worked out from the current release's defaults (section 11).

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
  it: the `--wt-color-primary-text` entry (`docs/backlog.md:4379-4385`, detail
  `docs/backlog/dashboard.md:1239-1246`) and "`tenant_themes`: decide the remaining DELETE
  restriction (A805 follow-up)" (`docs/backlog.md:6123-6125`).

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

**Script reads of tokens by a literal name.** `grep` for `getPropertyValue("--wt-` outside tests
found nine lines, all of spacing, tap size or a duration (`product-appearance.ts:114`,
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
4.5:1 and stand 1.2:1 from rest (301-320); in dark, disabled fills within 1.5:1 of the surfaces and
their text 4.5:1 (338-351); the Google button's line 3:1 on its fill and three surfaces (403-417);
table fills, and the success and danger dots 3:1 on the surface (482-498); station fills, dots 3:1
on the surface and each fill, and the focus colour 3:1 on every station fill and the lifted surface
(531-576). No test holds a button's fill against the page, or the text on a button: those are
Waitron's own rules in section 9.

**Venue settings today.** The page has four tabs, Venue details, Tables, Adjustment reasons and
Kitchen (`apps/dashboard/src/screens/venue-settings-screen.ts:11-24`), each holding cards. The
Defaults card is the closest model: it needs `venue.view` to be seen and `venue.configure` to be
edited (`apps/dashboard/src/dashboard-app.ts:321-330,1915`), and it saves through
`PUT /management-api/venue-defaults`, gated the same way
(`apps/server/src/location-settings-api.ts:297-327`). Managers and admins hold `layout.configure`,
`venue.configure` and `system.manage`; supervisors hold `venue.view`
(`packages/identity/src/permissions.ts:46-83`). The account menu already uses the word "Theme" for
the Light / Dark / Follow device choice (`apps/dashboard/src/i18n/strings.ts:792-793`).

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

1. Venue settings gains a fifth tab, **Appearance** (my call: a tab of its own, because the look is
   about every screen, not about the venue's details). It holds one card, **Look** (my call: not
   "Theme", which the account menu already uses for Light / Dark / Follow device). Read-only, the
   card lists Brand colour (a swatch and the value), Background and Corners, with one line under
   them: "Applies to the dashboard and every till. Each browser still chooses Light, Dark or Follow
   device." Mock-up `01-appearance-card-{light,dark}.png`.
2. **Edit** opens the card in place, like the Defaults card. Left: the knobs. Right: **Preview**,
   one Light and one Dark panel side by side, each showing a sidebar item, a field with focus, Save
   and Cancel buttons, a switch, a link and a two-way choice, painted with the draft. Mock-up
   `02-editor-{light,dark}.png`; at phone width the preview goes below the knobs, Light above Dark
   (`03-editor-phone-light.png`).
3. Every change repaints the preview at once. The rest of the dashboard keeps the saved look until
   Save (my call: a preview of the whole dashboard before saving would need a way back on every
   screen, and the side-by-side panels show both modes at once, which the real dashboard cannot).
4. If the colour has to be moved to stay readable, a note under the colour says so, with both
   swatches: "Darkened to #9f8b18 on light screens, so buttons stand out." (Q2; mock-up
   `04-adjusted-light.png`). The note shows the adjustment as the current release works it out
   (section 11).
5. **Save** stores the choices. The dashboard that saved repaints at once; other open dashboards and
   signed-in tills follow (section 12). **Cancel** drops the draft.
6. **Use Waitron's look** sets the draft back to Waitron's choices — the brand colour "Waitron's",
   Neutral, Standard; Save then removes the venue's row, so every screen shows exactly Waitron's
   own token values. It does not save by itself, so Cancel still undoes it (my call: one way of
   saving on the card).

The form follows the shared form rules (`design-system.md:2222-2300`): Save is quiet and disabled
until the draft changes (`draftScopeFor`, `saveActionState`), a bad custom value is explained under
the colour and once at the bottom ("Correct the highlighted fields to continue."), a refusal from
the server never disables Save by itself, and the card has a `*.unsaved.test.ts`. The colour field
reuses `colorField`'s 24 swatches and custom colour, but drops its "no colour" and "inherit"
choices and adds "Waitron's" in their place (my call).

Product text, English (Spanish to be written with the strings):

| Where | Text |
| --- | --- |
| Tab | Appearance |
| Card | Look |
| Knobs | Brand colour · Background: Neutral, Tinted · Corners: Square, Standard, Round |
| Colour choices | Waitron's · Custom |
| Preview | Preview · Light · Dark |
| Reset | Use Waitron's look |
| Note | Applies to the dashboard and every till. Each browser still chooses Light, Dark or Follow device. |
| Adjusted (Q2 A) | Darkened to {colour} on light screens, so buttons stand out. |
| Refused (Q2 B) | Too pale for buttons on light screens. Pick a darker colour. |
| Bad custom value | Enter a colour as # and six digits or letters a–f. |

## 5. What is editable

Thinking wide, four levels were possible:

1. **One brand colour**, nothing else.
2. **A few knobs** — brand colour, background, corners — from which every affected token, light and
   dark, is worked out.
3. **Knobs plus every colour by hand** — the knobs, and a folded list of all 112 colour tokens with a
   light and a dark value each (mock-up `08-q1-knobs-or-every-colour-light.png`, right).
4. **Raw editing only** — every token, typed in. This is roughly what today's seven-token
   `tenant_themes` document allows, without a dark value (section 3).

Recommendation: **level 2** (Q1). The knobs:

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
- "Waitron's" brand colour with Neutral and Standard is no theme at all: no row, no derived values,
  Waitron's exact tokens. A custom colour typed as Waitron's own `#1f6feb` is a theme like any
  other and does not reproduce Waitron's dark set: the prototype gives a dark button of `#1f6feb`
  with white text and link text `#67a0fd`, where Waitron's own dark set has `#4c8dff`, `#06101f` and
  `#78a9ff` (`colors.css:136-139`).
- It always writes **the same list of tokens**, filling Waitron's own value where a knob sits at its
  default, so every theme has the same shape and the list doubles as the allowlist (section 14).
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
  `node build.mjs` there prints them). The prototype checks 67 rules in light and 70 in dark: every
  rule of `colors.test.ts` listed in section 3 that reads a token the theme writes, plus Waitron's
  own button rules of section 9.
  - Bar Lucía, `#1e5b3a`, tinted: light buttons keep `#1e5b3a` with white text at 8.04:1; dark
    buttons are lightened to `#417c59`, white text at 4.94:1; the light page becomes `#f0f9f3`. All
    rules passed in both modes, with the tint at full strength.
  - Café Limón, lemon `#f2d300`: on white it stands 1.49:1, so light buttons are darkened to
    `#9f8b18` (3.40:1 on white, 3.17:1 on the page, black text on it 6.18:1); dark mode keeps the
    lemon itself. All rules passed. Kept unmoved, the light set failed three: the button colour on
    the field fill at 1.32:1, on the page at 1.39:1 and on the surface at 1.49:1.
- **Sweep** (`node sweep.mjs` in the same folder): 216 brand colours (every combination of 0, 51,
  102, 153, 204 and 255 per channel) × Neutral and Tinted × light and dark, 864 cases, printed
  `failing 0, tint weakened in 0 tinted cases`. The first run of the sweep, with a darker light tint,
  had the tint weakened in every light case (the bar track fell to 1.38:1 on the page) and 44 cases
  failing on black and near-black brands; the light tint and the lightness search were changed
  until the run above. The build's guard test repeats this sweep (section 15).

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
graphic uses (slice 4).

**On a bad choice** (Q2): recommended, Waitron moves the colour just enough and says so beside the
field; Save stays enabled. The alternative refuses the colour with the form's usual field message
and keeps Save disabled until the owner picks another (`05-refused-light.png`).

**Every way in is checked.** The server derives and checks on every save, so a request that skips
the screen cannot store an unreadable theme; it answers `theme.invalid` for choices that are not
valid (section 11). A configuration import is the second way to write `tenant_themes`
(`configuration-transfer.ts:77`), and `validateCoreConfiguration` checks no theme row today
(`configuration-transfer.ts:5-24`): the build adds the same choice check there. The stylesheet is
built only from the derived values — `#rrggbb` colours and pixel radii the function itself writes —
never from a stored string, so nothing stored can break out of a declaration.

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
- Save sends the choices only. The server checks them, stores them and answers the stored choices
  with the worked-out values. Reset is Save with Waitron's choices, which deletes the row.

## 11. Storage

My call: **reuse and reshape what exists** rather than adding a parallel table.

- **Table:** `tenant_themes` stays, one row for the business. Scope: the whole business, not one
  location — a brand belongs to the business, one database holds one business
  (`design-system.md:3256-3261`, the banner shows "the deployment tenant's legal name, not a
  location name"), and a single row needs no location key. Its `theme` document changes from
  `{ tokens }` to the owner's **choices only**: `{ brandColor, background, corners }`
  (`brandColor` `#rrggbb`, the other two from fixed lists). No worked-out values are stored, so a
  release that improves Waitron's defaults reaches a themed venue too; the cost is that a release
  changing the defaults or the formula can shift a venue's colours slightly, which the editor shows
  as it works them out now. If Q1 comes back B, the document also holds the hand-typed values.
- **No migration is needed:** the table and its JSON column stay; the document's shape is checked in
  code. Before go-live any installation may be reset (CLAUDE.md §3), so an old `{ tokens }` row is
  not carried forward: the server reads one as no theme (my call).
- **Routes:** `GET` and `PUT /management-api/theme` stay and take the new document; `GET` answers
  the choices and the worked-out values for the editor.
- **Error code:** `theme.invalid` stays. It carries `field` (`brandColor`, `background`, `corners`)
  and `reason`, replacing `token`, so the card can put the sentence under the field (CLAUDE.md §3:
  "A screen puts a refusal beside a field by what the error CARRIES"); renaming params is free
  before go-live.
- **Retired:** `THEMEABLE_TOKENS` and `MAX_THEME_VALUE_LENGTH` (`theme.ts:12-22`) and
  `validateThemeOverride`, replaced by the choice check and the derived token list; the till's unused
  `ThemeOverride` copy (`apps/till/src/layout.ts:58-60`); the `--wt-font-family` override (no knob
  for it).
- **Backlog this closes or changes:** the `--wt-color-primary-text` entry (`backlog.md:4379-4385`,
  detail `backlog/dashboard.md:1239-1246`) closes — the theme writes primary text, hover and
  disabled colours; the `tenant_themes` DELETE restriction (`backlog.md:6123-6125`) is answered —
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
- **Experiment** (`a841-mockups-src/probe7.mjs`, Chromium 156.0.8078.4): a page shaped like that
  (`index.html` styled from `--wt-color-bg`, a module script applying the tokens and the stored copy,
  then fetching with a 2 s limit). Stored copy present, server never answers: the module ran at
  6 ms, first paint at 8 ms, the first frame and the frame 1.5 s later both showed the stored theme's
  page colour `rgb(237, 246, 240)`. No stored copy, server never answers: first paint at 8 ms in
  Waitron's `rgb(247, 247, 248)`, staying so. No stored copy, server answering after 500 ms: Waitron's
  colour first, the theme's 1.5 s later — the one flash, on a browser's first visit or the first
  load after a change. In that case the first paint (40 ms) came before the module ran (50 ms); I
  believe today's apps already have such a frame, since `index.html` reads `--wt-color-bg` before
  `main.ts` applies tokens (section 3), but I did not measure the real apps. WebKit was not measured:
  Playwright 1.64.1's WebKit is not installed here (`Executable doesn't exist at
  …/ms-playwright/webkit-2370/pw_run.sh`). Slice 3 measures both engines in the real apps (B4).
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

- Editing: `venue.configure`, replacing `layout.configure` on `PUT /management-api/theme`. The card
  sits on Venue settings, whose other cards edit under `venue.configure`
  (`dashboard-app.ts:1915`), and one page should not ask for two editing permissions. Both are held
  by exactly managers and admins today (`permissions.ts:56-83`), so nobody gains or loses the right.
- Seeing the card: `venue.view` (supervisors and up), like the Defaults card.
- Applying the look: `/api/theme` needs no session; the dashboard's live read needs a session but no
  permission (section 12).

## 14. What the guards need

- `style-token-names.test.ts`: the theme writes only names already declared in `colors.css` and
  `structure.css`, so no read becomes undeclared. A theme that wrote a name declared nowhere would
  do nothing, and this guard would not see it (its header: it does not see a name written from
  script or as a quoted key). `theme-registry.test.ts` changes from `THEMEABLE_TOKENS` to the list
  `deriveTheme` writes: every name declared in the token files, and the list the same for every
  choice.
- `no-hardcoded-chrome.test.ts`: the editor lives in `apps/dashboard`, outside what it scans, and
  its draft colours are built at run time, which it never reads. The preview panels and the swatches
  still read tokens in their static styles.
- `scripts/native-form-fields.test.ts`: the custom colour reuses `colorField`'s
  `<input type="color">`, a type the guard lists as not a text field
  (`scripts/native-form-fields.test.ts:20-31`).
- New: the shared contrast check (section 9), the sweep (section 15), and a guard refusing text in
  `--wt-color-primary` (section 9).

## 15. Testing

- `deriveTheme`: the section-6 sweep as a test — brand colours on a grid × Neutral and Tinted ×
  light and dark, every rule passing (corners do not touch colour, so they are left out of the
  colour sweep and tested on their own). The same choices give the same values; the written token
  list never changes. Proof by deletion: remove the darkening step and the lemon case must fail at
  1.39:1 on the page.
- Server: `PUT` refuses invalid choices with `theme.invalid` naming the field; refuses without
  `venue.configure`; a configuration import with a bad theme row is refused; `/api/theme` answers
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
   `colors.test.ts`, the sweep, the token-list guard. No screen.
2. **The stored document and the server.** `tenant_themes`'s new document, the routes' new body and
   permission, `theme.invalid` with `field`, the import check, `/api/theme`, the till's `themeHash`;
   retire `THEMEABLE_TOKENS`, `validateThemeOverride` and the till's copy.
3. **Delivery.** The stored copy and the fetch in the dashboard's and till's `main.ts`, the
   dashboard's live read, the till's `#applyVenueSetup` swap, the start-up probes in Chromium and
   WebKit, the fixed-until-reload entry.
4. **Primary-coloured text.** Move the text uses of `--wt-color-primary` to `--wt-color-primary-text`
   and add the guard.
5. **The editor.** The Appearance tab, the Look card, preview, adjusted note, Spanish strings, and
   the design-system rewrite of `design-system.md:189-208` beside "Retheming a deployment".

### If an answer comes back B

- **Q1 B (every colour by hand):** the document also holds hand-typed light and dark values; the
  editor gains a folded list; each typed value goes through the same checks, and a failing one is
  refused under its row (the formula cannot adjust a value the owner typed exactly).
- **Q2 B (refuse):** `deriveTheme` stops adjusting the button colour and reports the failing rules;
  the server answers `theme.invalid` with `field: "brandColor"`, `reason: "unreadable"`; the tint
  still weakens itself.
- **Q3 B (per device profile):** `tenant_themes` holds several named documents; device profiles gain
  a theme choice; `/api/theme` answers per device, and the till's `themeHash` follows its profile; a
  migration is needed.
- **Q4 B (text size):** a fourth knob scaling the four font-size tokens; every layout test that
  measures text in pixels is re-run at Large, and the slices gain one for the screens that break.

## 17. Risks

- **First visit.** A browser's first load, and the first load after a change, shows Waitron's
  colours until the fetch answers (probe7). The stored copy makes every later start immediate.
- **WebKit not yet measured** (section 12); slice 3 measures it.
- **Old till browsers.** The sheet uses nothing newer than `:not()`, media queries and constructed
  stylesheets (which `applyTokens` already uses); which browsers venues' tills run I do not know.
- **The checks are not every pair.** They cover the rules of section 9; a component that puts the
  brand colour on an unusual background (a coloured tile, an alert) is not checked. Mitigation: the
  brand colour never paints a meaning colour or a product tile.
- **Releases move colours.** Deriving at serve time means a release can shift a venue's colours
  slightly (section 11); every shift still passes the rules, because the server checks what it
  serves.
- **Recovery sheet.** It keeps the theme's border colour and corner radius on paper (section 8).
- **A stale design-system sentence** (`design-system.md:108-110`), backlog A899, narrowed in round 1:
  a bare `[data-wt-theme-root]` selector wins over the token layer in all six cases of probe.mjs's
  third variant; a bare `[data-theme]` selector matches nothing under Follow device, which removes
  the attribute (`theme-choice.ts:28`), so the advice against that one has a real reason, just not
  the written one.

## 18. Mock-ups

In `docs/backlog/mockups/a841-theme-editor/`, built from the real token files with Playwright's
Chromium (sources and the prototype outside the repository, in
`/Users/clintongormley/waitron-campaign/a841-mockups-src/`):

| File | Shows |
| --- | --- |
| `01-appearance-card-{light,dark}.png` | The saved Look card, with Bar Lucía's look applied to the dashboard |
| `02-editor-{light,dark}.png` | The editor with its Light and Dark preview |
| `03-editor-phone-light.png` | The editor at 390 px |
| `04-adjusted-light.png` | Café Limón's lemon, darkened with a note (Q2 A) |
| `05-refused-light.png` | The same colour refused (Q2 B) |
| `06-till-{light,dark}.png` | A till counter screen in Bar Lucía's look; product tiles keep their own colours |
| `07-dashboard-{light,dark}.png` | The Products screen in Bar Lucía's look |
| `08-q1-knobs-or-every-colour-light.png` | Q1 options side by side |
| `09-q2-adjust-or-refuse-light.png` | Q2 options side by side |
| `10-q3-one-theme-or-per-device-light.png` | Q3 options side by side |
| `11-q4-text-size-light.png` | Q4 options side by side |

## 19. Questions for the owner

**Q1 of 4 — How much can the owner change?**
Bar Lucía's owner wants the dashboard and tills in the bar's dark green. With A, she picks the green,
"Tinted" and "Round", and Waitron works out every light and dark colour from them; the preview shows
both. With B she gets the same three choices, plus a folded list of all 112 colours, each with a
light and a dark value she can type, for the odd colour she wants exactly. Pictures:
`08-q1-knobs-or-every-colour-light.png`.

- **A (recommended):** three choices — brand colour, background, corners — and Waitron works out the rest.
- **B:** the same three choices, plus every colour editable by hand.

**Q2 of 4 — What happens when a chosen colour would be hard to see?**
Café Limón's owner picks lemon yellow. On a white page a lemon button is almost invisible: 1.5 to 1,
where Waitron's own rule for buttons asks for 3 to 1. With A, Waitron darkens it to a mustard for
light screens only, keeps the lemon on dark screens, and shows "Darkened to #9f8b18 on light
screens, so buttons stand out." With B, Waitron refuses: the colour is marked "Too pale for buttons
on light screens. Pick a darker colour." and Save stays off until she picks another. Pictures:
`09-q2-adjust-or-refuse-light.png` (and `04-adjusted-light.png`, `05-refused-light.png`).

- **A (recommended):** Waitron adjusts the colour just enough and says so.
- **B:** Waitron refuses the colour until a darker one is picked.

**Q3 of 4 — One look for the whole business, or one per kind of device?**
Bar Lucía has bar tills and terrace handhelds. With A there is one look, and every till and dashboard
shows it. With B the owner can save several looks ("Bar" in green, "Terrace" in blue) and each
device profile picks one, so the terrace handhelds look different from the bar tills. Pictures:
`10-q3-one-theme-or-per-device-light.png`.

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
