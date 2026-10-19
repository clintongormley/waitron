# A841 — a theme editor: design

Status: design, waiting for the owner's answers to the four questions at the end. Backlog: A841
(owner, 2026-10-17). Builds on A681 (#1842), the per-browser Light / Dark / Follow device choice.
Mock-ups: `docs/backlog/mockups/a841-theme-editor/`.

A note on words. A **token** is one of Waitron's named style settings, written `--wt-…` in the code:
`--wt-color-primary` is "the colour of main buttons", `--wt-radius-md` is "how round a normal
corner is". The dashboard's and the till's shared components paint from tokens (the guards in
section 3 hold them to it), so changing a token's value repaints everything that reads it. A **knob** in this document is one simple choice the owner makes (a colour,
"Round corners") from which many token values are worked out. **Contrast** is how far apart two
colours are in brightness, written as a ratio such as 4.5:1; a higher number is easier to read.

## 1. What this is, and why

A venue wants Waitron to look like its own place: Bar Lucía's green rather than Waitron's blue on
the buttons, the selected tab and the sidebar, on the dashboard and on every till. Waitron already
paints every screen from tokens, and the design system already says a deployment may override them
(`docs/developers/design-system.md:106-124`, "Retheming a deployment"). I found no setting for it
today: doing it means editing a stylesheet in the source. A841 lets the owner do it from the dashboard, safely:
without producing a screen staff cannot read, and without breaking the Light / Dark / Follow device
choice each browser already makes.

## 2. Goals, non-goals, anti-goals

Goals

- The owner picks a brand colour and a few other simple choices on one card, sees a preview in
  light and dark side by side, and saves.
- Both the light and the dark palette are worked out from those choices; the owner never has to
  pick a dark-mode colour.
- Every saved theme keeps text and controls readable: the same contrast rules Waitron's own palette
  is tested against (section 9).
- Open dashboards and tills pick up a saved theme without a reload, except where Waitron already
  documents a value as fixed until reload (section 12).
- "Use Waitron's look" puts everything back.

Non-goals (not in A841; each could be its own item later)

- Logos, the venue's own logo, fonts, or the favicon.
- Receipts, kitchen tickets and anything else a printer prints (section 8).
- The server's own pages: the trust page, the user guide pages, the recovery page.
- Setup (the first-run wizard): it runs before the venue has a theme.
- Colours that carry a meaning: red for danger, green for success, amber for warning, the table
  states on the floor plan, prep-station colours, calendar colours, Google's sign-in button.
- Product and category colours: those are the venue's own data, already chosen per product.

Anti-goals (things this must never do)

- Let a saved theme make a button's words, a link or a focus ring unreadable.
- Delay or block a sale: the theme is a stylesheet a page asks for; if the request fails, the page
  draws in Waitron's colours and works as before.
- Become a second, hand-kept copy of Waitron's default colours.

## 3. What Waitron does today (receipts)

Every sentence here names the file and line, or the command, it rests on.

**The tokens.** Colour tokens live in `packages/ui-core/src/tokens/colors.css` in four blocks: the
default (light) block at lines 1-123, a dark block inside `@media (prefers-color-scheme: dark)` at
lines 125-241, a forced-light block for `data-theme="light"` at 243-357 and a forced-dark block for
`data-theme="dark"` at 359-473. Counting declarations with
`sed -n <range>p colors.css | /usr/bin/grep -cE '^\s*--wt-'` printed 112 for each of the four
blocks. Grouping the light block's names by prefix printed: 30 prep-station fills and dots, 29
"on-…" text colours, 17 calendar palette colours, 5 table-state fills, 5 field colours, 4 surfaces,
4 primary, 3 danger, 3 Google button, 2 text, 2 day colours, and one each of warning, track,
success, stepper, scrim, highlight, focus, border and background. Comparing the media-query dark
block with the forced-dark block (`diff` of lines 126-240 against 359-473) printed only the selector
line, so the two dark blocks hold the same values. The non-colour tokens are in
`packages/ui-core/src/tokens/structure.css`: 57 declarations (same count command), among them six
spacings (lines 2-7), four corner radii (9-15), the font family and four font sizes (17-24), the
44 px tap minimum (29), two shadows (111-112) and the focus and selected rings, which read
`--wt-color-focus` and `--wt-color-primary` (114, 120).

**How a page gets them.** `applyTokens(root)` marks `root` with `data-wt-theme-root` and adds one
shared stylesheet holding both files to the page's `adoptedStyleSheets`
(`packages/ui-core/src/tokens/index.ts:6-25`). The dashboard, the till and setup each call it on
`document.documentElement` and then call `startThemeChoice` (`apps/dashboard/src/main.ts:17-18`,
`apps/till/src/main.ts:16-17`, `apps/setup/src/main.ts:6-7`). Every rule in the token layer is
wrapped in `:where(…)` (`colors.css:1,126,243,359`), which adds no specificity, so any ordinary
selector in another stylesheet wins over it (`design-system.md:89-104`; pinned by "deployment rules
override the token layer's defaults even when data-theme is set",
`packages/ui-core/src/tokens/structure.test.ts:272`).

**How A681 switches light and dark.** The choice is saved in the browser under the key
`waitron-theme` (`packages/ui/src/theme-choice.ts:6`). Light and Dark set `data-theme` on the root;
Follow device removes it (`theme-choice.ts:27-30`), which leaves the operating system's setting in
charge through the media-query block. A choice made in one tab reaches the browser's other tabs
through the `storage` event (`theme-choice.ts:49-60`). Each block of the token layer also sets the
CSS `color-scheme` property (`colors.css:5,127`) so the browser draws its own controls to match.

**Surfaces that do not use the token layer.** The trust page inlines four token pairs by hand and
says so (`apps/server/src/trust-page.ts:106-111`). The user guide pages carry their own copy of a
few tokens as light/dark pairs (`apps/server/src/guide-pages.ts:16-35`), compared to the real files
by `scripts/guide-page-tokens.test.ts` (named at `guide-pages.ts:16`). Receipts and kitchen tickets
are printer commands, not web pages: `apps/server/src/receipt-ticket.ts:1-14` imports the ESC/POS
builder `esc` from `@waitron/printing`, and `packages/printing/src/escpos.test.ts:10-13` tests it as
byte sequences. `ls apps` printed `dashboard print-agent server setup till`: there is no
customer-facing web app today. The kitchen and station screens are screens of the till app
(`apps/till/src/screens/till-station-screen.ts`, `till-expo-screen.ts`).

**Colours a theme would not reach.** Till product tiles are painted from the product's own stored
colour, with black or white text chosen by `readableTextColor`
(`apps/till/src/widgets/menu-browser.ts:83`, `packages/ui/src/category-color.ts:15-20`). The
dashboard banner shows Waitron's own logo, picking its light or dark drawing from the theme choice
(`apps/dashboard/src/dashboard-app.ts:189,1738`).

**Script reads of tokens.** `grep` for `getPropertyValue("--wt-` outside tests found eight reads, all
of spacing, tap size or a duration (`product-appearance.ts:114`, `wt-floor-plan-canvas.ts:542-546`,
`wt-tabs.ts:221`, `drag-edge-scroll.ts:49`, `opening-hours-week.ts:134,532`,
`departments-zones-drag.ts:329`) and none of a colour or a radius.

**Existing colour tools to reuse.** The dashboard's `colorField` (`apps/dashboard/src/widgets/
color-field.ts:156`) offers the 24 `CATEGORY_PALETTE` swatches (`packages/ui/src/category-color.ts:
29-54`) plus a custom colour from the browser's own picker (`color-field.ts:94-108`); stored colours
are checked as `#rrggbb` by `isStoredColor` (`packages/catalogue/src/color-inheritance.ts:2-4`). A
contrast calculation already exists in product code, `luminance` in `category-color.ts:1-9`, and in
`colors.test.ts:13-24`. Both use WCAG's 0.03928 cut-off; WCAG 2.2 now writes 0.04045 and says the
older figure "has no practical effect on the calculations in the context of these guidelines"
(<https://www.w3.org/TR/WCAG22/>, definition of relative luminance, note 2).

**The contrast rules Waitron's palette already meets** (`packages/ui-core/src/tokens/colors.test.ts`):
the lifted surface stands apart and keeps text readable (line 134); primary text reads at 4.5:1 on
the page, both surfaces and a highlighted row (251-253); a hover fill keeps its button's text at
4.5:1 and stands 1.2:1 from the resting fill (301-312); in dark, disabled fills stay within 1.5:1
of the surfaces and their text reads at 4.5:1 (338-351); the focus colour stands 3:1 on every
station fill (559); the five table fills differ (489).

**Venue settings today.** The page has four tabs, Venue details, Tables, Adjustment reasons and
Kitchen (`apps/dashboard/src/screens/venue-settings-screen.ts:11-24`), each holding cards. The
Defaults card is the closest model: it needs `venue.view` to be seen and `venue.configure` to be
edited (`apps/dashboard/src/dashboard-app.ts:321-330,1915`), and it saves through
`PUT /management-api/venue-defaults`, gated the same way
(`apps/server/src/location-settings-api.ts:297-327`). Managers and admins hold `venue.configure`;
supervisors hold `venue.view` (`packages/identity/src/permissions.ts:46-83`).

**Venue settings storage.** Single-row settings tables are the pattern: `catalogue_settings`
(`packages/catalogue/src/schema/settings.ts:8-19`, id pinned to 1) and `service_settings`
(`packages/venue-service/src/schema/settings.ts:10-32`). The core set has a per-location one,
`location_business_day_settings`, keyed by `location_id` (`packages/db/src/schema/
business-day-clock.ts:6-20`), classified `state` (`packages/db/src/classification.ts:92`).

**How settings reach an open dashboard.** A dashboard read names the tables it depends on
(`apps/dashboard/src/api/live-queries.ts:523`, `getVenueDefaults: ["locations",
"catalogue_settings"]`), and the server's change feed is built from each migration set's `changes`
list at start (`apps/server/src/boot.ts:1459-1466`).

**How settings reach an open till.** `GET /api/till` is unauthenticated (`apps/server/src/
till-api.ts:1382-1395`) and answers `readTillSetup` (`apps/server/src/till-setup.ts:17-110`) plus a
`setupRevision`, a hash of the whole answer (`till-setup.ts:115-117`). `/api/menu-state` repeats the
revision (`till-api.ts:1518`); the till polls menu state every 15 s
(`apps/till/src/state/menu-state-poll.ts:4`) and reads `/api/till` again when the revision moves
(`apps/till/src/till-app.ts:8105-8121`). A new field reaches an open till only once
`#applyVenueSetup` handles it, and a kitchen screen in device mode runs no poll at all
(`docs/developers/conventions-ui.md:1423-1467`).

**How the apps' pages are served.** The server sends each app's built `index.html` as a file
(`apps/server/src/spa-api.ts:61-76`); `apps/dashboard/index.html:1-32` holds no theme. In
development the dashboard and the till forward `/api` to the server
(`apps/dashboard/vite.config.ts:16-21`, `apps/till/vite.config.ts:37-38`); the dashboard's pages
live under `/manage/` (`apps/dashboard/vite.config.ts:11`).

**The guards.** `packages/ui/src/no-hardcoded-chrome.test.ts:6-56` reads the static `styles` of
every component in `packages/ui/src/components/` and refuses a literal colour or a px size above
1 px; it never reads styles built while a component runs. `scripts/style-token-names.test.ts:6-35`
checks that every `--wt-*` name read with `var(…)` is declared somewhere in tracked files; by its own
header it reads text, does not see a name declared from script or as a quoted object key, and
compares names across the whole tree.

## 4. What the owner sees and does

The mock-ups show Bar Lucía (`BAR LUCÍA S.L.`), whose owner picks a dark green, `#1e5b3a`, a tinted
background and round corners.

1. Venue settings gains a fifth tab, **Appearance** (my call: a tab of its own, because a theme is
   about every screen, not about the venue's details). It holds one card, **Theme**. Read-only, the
   card lists Brand colour (a swatch and the value), Background and Corners, with one line under
   them: "Applies to the dashboard and every till. Each browser still chooses Light, Dark or Follow
   device." Mock-up `01-appearance-card-{light,dark}.png`.
2. **Edit** opens the card in place, like the Defaults card. Left: the knobs. Right: **Preview**,
   one Light and one Dark panel side by side, each showing a sidebar item, a field with focus, Save
   and Cancel buttons, a switch, a link and a two-way choice, painted with the draft. Mock-up
   `02-editor-{light,dark}.png`; at phone width the preview goes below the knobs, Light above Dark
   (`03-editor-phone-light.png`).
3. Every change repaints the preview at once. The rest of the dashboard keeps the saved theme until
   Save (my call: a preview of the whole dashboard before saving would need a way back on every
   screen, and the side-by-side panels show both modes at once, which the real dashboard cannot).
4. If the colour has to be moved to stay readable, a note under the colour says so, with both
   swatches: "Darkened to #a38e09 on light screens, so buttons stand out." (Q2; mock-up
   `04-adjusted-light.png`).
5. **Save** stores the theme. The dashboard that saved repaints at once; other open dashboards and
   tills follow (section 12). **Cancel** drops the draft.
6. **Use Waitron's look** sets the draft back to Waitron's own knobs; Save then removes the venue's
   theme. It does not save by itself, so Cancel still undoes it (my call: one way of saving on the
   card).

The form follows the shared form rules (`design-system.md:2222-2300`): Save is quiet and disabled
until the draft changes (`draftScopeFor`, `saveActionState`), a bad custom value is explained under
the colour and once at the bottom ("Correct the highlighted fields to continue."), a refusal from
the server never disables Save by itself, and the card has a `*.unsaved.test.ts`.

Product text, English (Spanish to be written with the strings):

| Where | Text |
| --- | --- |
| Tab | Appearance |
| Card | Theme |
| Knobs | Brand colour · Background: Neutral, Tinted · Corners: Square, Standard, Round |
| Custom colour | Custom |
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
4. **Raw editing only** — every token, typed in.

Recommendation: **level 2** (Q1). The knobs:

- **Brand colour.** The 24 swatches of `colorField` plus a custom colour. It sets the main button
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
  listed in section 3, and the tap minimum is an accessibility floor.

## 6. How the knobs become colours

All my call; the plan pins the exact numbers.

- One pure function, `deriveTheme(knobs) → { light, dark, adjusted }`, used by the editor's preview
  and by the server. Browser-safe and free of Lit, so the server can import it. It takes Waitron's
  default values from `colors.css` itself, never from a hand-kept copy (the trust page and guide
  pages show what a copy costs: section 3).
- It always writes **the same list of tokens**, filling Waitron's own value where a knob sits at its
  default. That keeps a preview from inheriting part of the saved theme (the saved theme's
  stylesheet also matches the preview's panels, section 10) and keeps every saved theme the same
  shape.
- It works in OKLCH, a colour model where "lightness" matches what the eye sees, so it can move a
  colour's lightness and keep its hue. Light: the brand colour is the button colour if it stands
  3:1 from the page and the card surface; otherwise it is darkened step by step until it does.
  Dark: it is lightened until it does. The text on the button is white (light) or a near-black of
  the same hue (dark), falling back to plain black or white. Link text is the brand colour moved
  until it reads at 4.5:1 on the page, both surfaces, the lifted surface and the highlight.
- A run of every 8-bit sRGB colour (16,777,216 of them) through the contrast formula, black against
  white text, printed `lowest best-of-black-or-white ratio … 4.583 at [ 207, 13, 204 ]`: every
  colour has black or white text at 4.5:1 or better, so text on a button can always be made
  readable without moving the button's colour. What can need moving is the fill itself, on a pale
  colour.
- **Worked examples**, from a prototype of this function
  (`/Users/clintongormley/waitron-campaign/a841-mockups-src/derive.mjs`, outside the repository;
  `node build.mjs` there prints them):
  - Bar Lucía, `#1e5b3a`, tinted: light buttons keep `#1e5b3a` with white text at 8.04:1; dark
    buttons are lightened to `#3d7855`, white text at 5.23:1; the light page becomes `#edf6f0`. Every
    check the prototype runs passed in both modes. It runs a subset of section 9: button text on the
    button and on its hover, link text on the page, both surfaces, the lifted surface and the
    highlight, the button fill and the focus ring on the page and the surface, body text on the page
    and the lifted surface, and muted text on the surface.
  - Café Limón, lemon `#f2d300`: on white it stands 1.49:1, so light buttons are darkened to
    `#a38e09` (3.27:1 on white, black text on it 6.43:1); dark mode keeps the lemon itself. Every
    check the prototype runs passed. Kept unmoved, the light set failed "button fill on page" at 1.39:1 and "button fill
    on surface" at 1.49:1 — the failing case the checks exist to catch.
  - Waitron's own blue, `#1f6feb`: every check the prototype runs passed in both modes.
- **Stored, not recomputed.** The server stores the knobs and the worked-out values. A later change
  to the formula would otherwise repaint every venue silently — the same reason
  `category-color.ts:26-28` pins its palette as literals. A release that changes the formula
  re-derives on purpose.

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
probe tells the two apart. With print media emulated it printed `#1f6feb`: the `@media screen`
wrapper leaves printing from the browser in Waitron's colours.

I chose three blocks over CSS `light-dark()` (which the guide pages use, `guide-pages.ts:93`)
because the blocks ask nothing new of a till's browser; whether every till's browser supports
`light-dark()` I did not check.

## 8. Where the theme shows, and where it does not

| Surface | Theme? | Why |
| --- | --- | --- |
| Dashboard, signed in and signed out | Yes | The owner's main surface. |
| Till: counter, tables, bills, kitchen and station screens, handhelds | Yes | Same app (`apps/till`). A kitchen screen in device mode takes it at load only (section 12). |
| Setup wizard | No | Runs before a theme exists; my call. |
| Trust page, user guide, recovery page | No | Server-built pages with hand-copied tokens (section 3); my call, could follow later. |
| Waitron logo and favicon | No | Waitron's own mark (non-goal). |
| Product tiles, categories | No | Painted from the product's stored colour (section 3). |
| Floor-plan table states, stations, calendars, danger/success/warning | No | Their colours carry meaning and are tested apart from each other (`colors.test.ts:446-576`). |
| Receipts, kitchen tickets | No | Printer commands, not web pages (section 3). |
| Anything printed from a browser (equipment label, recovery sheet) | No | The theme sheet is wrapped in `@media screen` (section 7 experiment). |

Whatever the dashboard banner paints from colour tokens follows the theme; the logo inside it stays
Waitron's.

## 9. Readability protection

The checks are the rules Waitron's own palette already passes (section 3), run on the worked-out
set, light and dark. They rest on WCAG 2.2 (<https://www.w3.org/TR/WCAG22/>):

- 1.4.3 Contrast (Minimum): "The visual presentation of text and images of text has a contrast ratio
  of at least 4.5:1".
- 1.4.11 Non-text Contrast: "The visual presentation of the following have a contrast ratio of at
  least 3:1 against adjacent color(s): User Interface Components Visual information required to
  identify user interface components and states, except for inactive components …".
- Contrast ratio: "(L1 + 0.05) / (L2 + 0.05), where L1 is the relative luminance of the lighter of
  the colors, and L2 is the relative luminance of the darker of the colors."

So: button text, link text and a focused field's label at 4.5:1 or more on what they sit on; the
button fill, the focus ring and a pressed toggle's fill at 3:1 against the page and the card
surface (a pressed Theme button is "filled with `--wt-color-primary`", `design-system.md:3272-3274`); hover
1.2:1 from rest; every station-fill and lifted-surface rule from `colors.test.ts` that reads a token
the theme writes. Disabled controls are exempt in WCAG ("except for inactive components") and keep
Waitron's own dark-mode rule (338-351).

To keep one list, the plan moves those rules out of `colors.test.ts` into a shared check that both
the test (for Waitron's palette) and `deriveTheme` (for a venue's) call — my call.

**On a bad choice** (Q2): recommended, Waitron moves the colour just enough and says so beside the
field; Save stays enabled. The alternative refuses the colour with the form's usual field message
and keeps Save disabled until the owner picks another (`05-refused-light.png`). Either way the
server runs the same checks on save, so a request that skips the screen cannot store an unreadable
theme; it answers `theme.invalid` with the field, for a value that is not a colour.

## 10. Preview, saving and reset

- The preview's two panels are theme roots of their own, `data-theme="light"` and `"dark"`, inside
  the card. The draft goes on them through a style element built while the card runs, with a
  selector more specific than the saved theme's (for example
  `.preview[data-wt-theme-root][data-theme]`), because the saved theme's sheet also matches any
  `[data-wt-theme-root]`. This is the first nested theme root in a shipped screen
  (`design-system.md:87` says nothing nests one today); `colors.test.ts:118` already checks that a
  nested root takes its own `color-scheme`.
- Save sends the knobs only. The server works out the values, runs the checks, stores both and
  answers the stored theme. Reset is Save with Waitron's knobs, which deletes the row.

## 11. Storage

My call: a new table in the core migration set, `location_themes`, one row per location, keyed by
`location_id` like `location_business_day_settings` (section 3); no row means Waitron's look.
Columns: `brand_color` (`#rrggbb`, checked like `isStoredColor`), `background` and `corners` (enum
columns from the column vocabulary), `light_tokens` and `dark_tokens` (`json`), and `revision`
(`count`), which the delivery uses (section 12). Classified `state`; not append-only.

- Why a table and not a settings row elsewhere: `catalogue_settings` and `service_settings` belong
  to modules, and a theme belongs to no module; `locations` is read by many queries, and a column
  change with a CHECK can make drizzle rebuild a table, whose `DROP TABLE` deletes cascading
  children (CLAUDE.md §3). A table of its own touches nothing else.
- Why the core set: every app shell reads the theme, and no module owns how Waitron looks. That is
  the reason CLAUDE.md asks a new core table's commit to state.
- **A migration is needed**: one drizzle generation adding the table. No data migration: before
  go-live a venue may be reset (CLAUDE.md §3), and a missing row already means Waitron's look.
- The table joins the core set's `changes` list so dashboard reads can depend on it.
- Whether the theme travels when a venue's configuration is copied (catalogue's settings do,
  `packages/catalogue/src/configuration-transfer.ts:132-136`) I did not trace for core tables; the
  plan decides, and my call is yes.

## 12. Delivery and refresh

- **One stylesheet address**, `GET /api/theme.css`, served with no session: the colours are not
  secret, and the signed-out dashboard and the till's start screen need them. It answers the
  section-7 sheet built from the stored values, or an empty sheet with no row, with
  `Cache-Control: no-cache` and an `ETag` of the revision so a reload costs a 304. `/api` is
  already forwarded in development by both apps (section 3); the dashboard's `/manage/` base does
  not affect an absolute address.
- **Loaded before the page draws.** The dashboard's and the till's `index.html` gain
  `<link rel="stylesheet" href="/api/theme.css">` in `<head>`. I believe a stylesheet linked in
  `<head>` holds the first paint until it arrives, which avoids a flash of Waitron's blue; the
  first slice proves it with a probe whose failing case would show `#1f6feb` in the first frame. If
  the request fails, the page draws in Waitron's colours.
- **Open dashboards** watch a theme read that depends on `location_themes`; when it changes, the
  shell points the link at `/api/theme.css?r=<revision>` and the browser repaints.
- **Open tills** get a `themeRevision` field in `readTillSetup`, which moves `setupRevision` because
  that hashes the whole answer (`till-setup.ts:115-117`); `#applyVenueSetup` points the link at the
  new address. The till therefore follows within one menu-state poll (15 s).
- **Fixed until reload:** a kitchen screen in device mode, which runs no poll (backlog A785); it is
  added to that list in `docs/developers/conventions-ui.md`.

## 13. Permissions

My call, matching the Defaults card: `venue.configure` edits (managers and admins), `venue.view`
sees the card read-only (supervisors), and the stylesheet needs nothing.

## 14. What the guards need

- `style-token-names.test.ts`: the theme writes only names already declared in `colors.css` and
  `structure.css`, so no read becomes undeclared. A theme that wrote a name declared nowhere would
  do nothing, and this guard would not see it (its header: it does not see a name written from
  script or as a quoted key). New guard: a test that every name `deriveTheme` can write is declared
  in the token files, and that the derived list is the same for every knob setting.
- `no-hardcoded-chrome.test.ts`: the editor lives in `apps/dashboard`, outside what it scans, and
  its draft colours are built at run time, which it never reads. The preview panels and the swatches
  still read tokens in their static styles.
- `scripts/native-form-fields.test.ts`: the custom colour reuses `colorField`'s
  `<input type="color">`, a type the guard lists as not a text field
  (`scripts/native-form-fields.test.ts:20-31`).
- Shared rules, new: the contrast rules move to one shared check (section 9) so the palette's test
  and the venue's checks cannot drift.

## 15. Testing

- `deriveTheme`: every knob combination over a spread of brand colours chosen to be the hard ones
  (pale yellow, near-white, near-black, pure red, a mid grey) passes the shared checks in both modes;
  the same knobs give the same values; the written token list never changes. Proof by deletion:
  remove the darkening step and the lemon case must fail at 1.39:1.
- Server: `PUT` refuses a value that is not a colour with `theme.invalid` and the field; refuses
  without `venue.configure`; stores and answers the worked-out values; `/api/theme.css` answers
  empty with no row and the three blocks with one; the till's revision moves when the theme
  changes.
- Browser (real Chromium): the section-7 probe as a test, against the real token files; the
  no-flash probe; the dashboard and the till repaint after a save without a reload; the editor's
  form, `*.unsaved.test.ts` and axe tests in both themes.

## 16. Build slices (each one pull request)

1. **The derivation and the shared checks.** `deriveTheme`, the contrast rules moved out of
   `colors.test.ts`, the guards of section 14. No screen.
2. **Storage and the server.** The table and its migration, `GET`/`PUT /management-api/theme`, the
   public `/api/theme.css`, the dashboard read's dependency, the till's `themeRevision`.
3. **Delivery.** The `<link>` in the dashboard and till pages, the dashboard's live swap, the till's
   `#applyVenueSetup` swap, the no-flash probe, the fixed-until-reload entry.
4. **The editor.** The Appearance tab, the Theme card, preview, adjusted note, Spanish strings, a
   design-system section "A venue's theme" beside "Retheming a deployment".

Slices 2 and 3 can swap if the plan prefers to see the stylesheet served before the table exists.

## 17. Risks

- **First paint.** If the linked sheet does not hold the first paint on some till browser, staff see
  Waitron's blue for a moment at every load. Slice 3's probe measures it; the fall-back is caching
  the last theme in the browser, as A681 caches the choice. The other side of the same property: a
  slow answer holds the page's first paint. The sheet comes from the server that sends the page
  itself (section 12), and the answer is a 304 when nothing changed, so I expect it to be no slower
  than the page; the probe times it.
- **Old till browsers.** The design uses nothing newer than `:not()` and media queries, but which
  browsers venues' tills run I do not know.
- **The checks are not every pair.** They cover the tokens the theme writes against the ones they
  sit on; a component that puts brand colour on an unusual background (a coloured tile, an alert)
  is not checked. Mitigation: the brand colour never paints a meaning colour or a product tile.
- **Formula changes.** Stored values keep a venue stable; a formula change needs a deliberate
  re-derive.
- **A tinted background beside the station colours.** Station dots must stand 3:1 from the surface
  (`colors.test.ts:547`); tinting the dark surface moves it, so that rule is in the shared checks.
- **A stale design-system sentence** says a bare `[data-wt-theme-root]` selector "only matches the
  token layer's own specificity" (`design-system.md:108-110`); the section-7 probe's third case
  shows a bare selector winning over the token layer in all six cases. Backlog A899.

## 18. Mock-ups

In `docs/backlog/mockups/a841-theme-editor/`, built from the real token files with Playwright's
Chromium (sources and the prototype outside the repository, in
`/Users/clintongormley/waitron-campaign/a841-mockups-src/`):

| File | Shows |
| --- | --- |
| `01-appearance-card-{light,dark}.png` | The saved Theme card, with Bar Lucía's theme applied to the dashboard |
| `02-editor-{light,dark}.png` | The editor with its Light and Dark preview |
| `03-editor-phone-light.png` | The editor at 390 px |
| `04-adjusted-light.png` | Café Limón's lemon, darkened with a note (Q2 A) |
| `05-refused-light.png` | The same colour refused (Q2 B) |
| `06-till-{light,dark}.png` | A till counter screen in Bar Lucía's theme; product tiles keep their own colours |
| `07-dashboard-{light,dark}.png` | The Products screen in Bar Lucía's theme |
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
Café Limón's owner picks lemon yellow. On a white page a lemon button is almost invisible (1.5 to 1,
where 3 to 1 is the usual minimum). With A, Waitron darkens it to a mustard for light screens only,
keeps the lemon on dark screens, and shows "Darkened to #a38e09 on light screens, so buttons stand
out." With B, Waitron refuses: the colour is marked "Too pale for buttons on light screens. Pick a
darker colour." and Save stays off until she picks another. Pictures:
`09-q2-adjust-or-refuse-light.png` (and `04-adjusted-light.png`, `05-refused-light.png`).

- **A (recommended):** Waitron adjusts the colour just enough and says so.
- **B:** Waitron refuses the colour until a darker one is picked.

**Q3 of 4 — One look for the whole venue, or one per kind of device?**
Bar Lucía has bar tills and terrace handhelds. With A there is one theme, and every till and
dashboard shows it. With B the owner can save several themes ("Bar" in green, "Terrace" in blue) and
each device profile picks one, so the terrace handhelds look different from the bar tills. Pictures:
`10-q3-one-theme-or-per-device-light.png`.

- **A (recommended):** one theme for the whole venue.
- **B:** several named themes, each device profile chooses one.

**Q4 of 4 — Should the theme also make text bigger?**
A waiter at Bar Lucía finds the till's text small. With A, the theme changes colours and corners
only, and bigger text becomes a separate item that can be tested screen by screen. With B, the theme
gains "Text size: Standard / Large", and Large makes all text on every till and dashboard about a
30% bigger at once, so longer names wrap (in the picture "Tinto de verano" takes two lines).
Pictures: `11-q4-text-size-light.png`.

- **A (recommended):** no text size in the theme; bigger text is its own later item.
- **B:** a Text size choice in the theme, Standard or Large.
