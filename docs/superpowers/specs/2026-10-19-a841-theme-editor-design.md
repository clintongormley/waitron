# A841 — a theme editor: design

Status: design. Revised after review rounds 1 and 2; after the owner's answer to Q1 (2026-10-19: "A
by default, with advanced access to B. Also this should be in settings rather than venue") and
review round 3; after the answer to Q2 (2026-10-19: "Don't refuse, this is easy to fix. Instead show
the warning and offer to fix automatically"); after review round 4 of that revision; and after the
owner's answers of 2026-10-20, through the watcher — Q3, one look for the whole business, and the
extra question, colours set by hand are kept — and their request the same night: "Also we should
allow uploading a new logo" (section 8a). Waiting for the owner's answers to Q4 and to the two logo
questions, Q5 and Q6 (section 19). Backlog: A841 (owner, 2026-10-17).
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
- Every colour Waitron works out passes every contrast rule Waitron's own palette is tested against,
  plus Waitron's own button rules (section 9). A colour the owner picks — the brand colour, or one
  set by hand — that fails one is never refused: it shows a warning with a one-press fix (owner, Q2,
  2026-10-19; section 9).
- The owner can upload the venue's own logo on the same card. It takes the place of Waitron's logo
  at the top of the dashboard and in the till's top bar, and shows on both sign-in screens, on light
  and dark screens alike (owner, 2026-10-20; section 8a).
- Open dashboards and signed-in tills pick up a saved theme without a reload (section 12).
- "Use Waitron's look" gives exactly Waitron's own colours and logo back.

Non-goals (not in A841; each could be its own item later)

- Fonts, the favicon, the installed till's icon and the till's browser-bar colour (sections 8 and
  8a).
- Colour on receipts, kitchen tickets and anything else a printer prints (section 8). Whether the
  venue's logo also prints on receipts is Q5 (section 8a).
- The server's own pages: the trust page, the user guide pages, the recovery page. Their colours
  and their logo stay Waitron's.
- Setup (the first-run wizard): it runs before the venue has a theme.
- Colours that carry a meaning: red for danger, green for success, amber for warning, the table
  states on the floor plan, prep-station colours, calendar colours, Google's sign-in button, and the
  search highlight — the yellow behind a matched word (`--wt-color-highlight` and
  `--wt-color-on-highlight`, `packages/ui-core/src/tokens/colors.css:121-122`, painting `<mark>` at
  `packages/venue-service/src/dashboard/routing-grid.ts:152-155`).
- Product and category colours: those are the venue's own data, already chosen per product.

Anti-goals (things this must never do)

- Let a theme become hard to read without the owner being told. Waitron's own working out never
  makes a colour hard to read; a colour the owner picks that is hard to read is shown with a warning
  and its fix in the editor, asked about once at Save, and kept on the saved card while it stays
  (section 9). Only the owner's "Save anyway" puts it on the tills.
- Delay or block the till's start-up or a sale: fetching the theme never holds the page (section 12).
- Become a second, hand-kept copy of Waitron's default colours: a venue's theme stores only the
  owner's choices — the logo, the three main choices, any fix they took and any colour they set by
  hand — and everything else is worked out from the current release's defaults (section 11).

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
  it: the `--wt-color-primary-text` entry (`docs/backlog.md:4504-4510`, detail
  `docs/backlog/dashboard.md:1227-1236`) and "`tenant_themes`: decide the remaining DELETE
  restriction (A805 follow-up)" (`docs/backlog.md:6277-6279`).

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
(`apps/dashboard/src/dashboard-app.ts:189-193,1728-1731`).

**Logos today** (read for the logo request, 2026-10-20, on main 8c3d8abed).

- **The dashboard banner** draws Waitron's lockup (the waiter and the word) as a `<picture>` that
  swaps a light and a dark drawing by the theme choice, then the tenant's legal name
  (`apps/dashboard/src/dashboard-app.ts:182-193,1712-1736`). The lockup is 128 px wide
  (`calc(var(--wt-space-6) * 4)`, `dashboard-app.ts:651-656`; `--wt-space-6` is 32 px,
  `structure.css:7`). The same banner, without the menu button, heads the signed-out sign-in page
  (`dashboard-app.ts:1562`), whose legal name comes from the unauthenticated locales read
  (`dashboard-app.ts:1079-1084`). Below 48rem the lockup and the trailing controls share the first
  row and the legal name moves to a second (`dashboard-app.ts:737-773`).
- **The till draws no logo image on its own screens.** Its top bar starts with the word "Waitron"
  in bold text, "a fixed name, never translated UI copy" (`apps/till/src/widgets/till-shell.ts:29-30,
  123-127,740`), left out at phone width and whenever the bar is short of room (`till-shell.ts:340-341,
  740`); the kiosk and kitchen-display modes draw no bar (`till-shell.ts:734-737`). The sign-in screen
  shows the device's name, or "Choose your name", above the list of people, and no logo
  (`apps/till/src/screens/till-lock-screen.ts:310-370`, `apps/till/src/i18n/strings.ts:423`).
  Pictures 06 and 11 drew "Bar Lucía" in the bar's first place; 06 is redrawn with the word
  (section 18).
- **The trust page** inlines a copy of Waitron's lockup, which "must stay one self-contained string
  with nothing to fetch" (`packages/ui/brand/README.md:40-41`; `apps/server/src/trust-page-logo.ts:12`,
  `trust-page.ts:120-124`). Setup draws the lockup inline too (`README.md:49`).
- **The favicon and the installed till's icon** are Waitron's files in `packages/ui/brand/public/`,
  served by all three apps (`README.md:16-25`). The till's manifest names `/icon-192.png` and
  `/icon-512.png` and is written when the app is built (`apps/till/src/manifest.ts:3-17`,
  `apps/till/vite.config.ts:14-20`).
- **Receipt logos belong to departments.** A department's Receipt tab
  (`packages/venue-service/src/dashboard/department-settings.ts:41`) holds a logo picked from the
  image library through `dashboard-image-upload` in its `logo` mode, which draws the box at the size
  the logo prints on 80 mm paper (`apps/dashboard/src/screens/department-receipt-editor.ts:708-720`,
  `apps/dashboard/src/widgets/image-upload.ts:39-42,111-140`). Saving it, under `layout.configure`
  (`apps/server/src/department-receipt-api.ts:42-44`), draws the printed pictures outside the
  transaction (`department-receipt-api.ts:110`, `apps/server/src/receipt-logo.ts:12-27`): the image
  flattened onto white, fitted inside 504 × 160 dots for 80 mm paper and 360 × 160 for 58 mm, in
  greyscale (`packages/media/src/logo.ts:13-30`, `packages/printing/src/layout.ts:8-20`,
  `packages/printing/src/dither.ts:1-2`), then Floyd–Steinberg dithered to dots (`dither.ts:22-26`).
  The pictures are stored with the department's receipt
  (`packages/venue-service/src/schema/department-receipts.ts:11`) and printed from there
  (`apps/server/src/receipt-print.ts:196-222`); the A4 invoice PDF draws the same dots
  (`apps/server/src/invoice-document.ts:100-125`, `invoice-page.ts:208-225`, `invoice-pdf.ts:31-40`).
  Editing the library image redraws them (`packages/media/src/routes.ts:210-228`,
  `packages/media/src/image-edits.ts:65-80`).
- **A department with no receipt logo prints none.** Both print paths pass an empty venue receipt
  to `resolveReceiptTrim` and take the logo from the department alone (`receipt-print.ts:210-211`,
  `invoice-document.ts:114-115`), although `resolveReceiptTrim` and `receiptLogoSource` were written
  to fall back to a venue logo (`packages/shared/src/receipt-text.ts:65-86`). A venue-wide receipt
  row still exists — `tenant_receipts`, one row holding a `logo` and its printed pictures
  (`packages/layouts/src/receipt-store.ts:24-50,113-188`) — but no product code reads or writes it:
  `git ls-files 'apps/*.ts' 'packages/*.ts'`, filtered to non-test files and searched for
  `tenantReceipts`, `getPrintedReceipt`, `getVenueReceiptSettings` and `putVenueReceiptSettings`,
  found them only in `packages/layouts` and `packages/db`. `git log -S"getPrintedReceipt(" -- apps`
  names #1592 (A493, 2026-10-12) as the change that removed the last callers, when receipt content
  moved into departments.
- **The image library** accepts JPEG, PNG and WebP, judged by their first bytes, and refuses anything
  else with `media.unsupported_type` (`packages/catalogue/src/media.ts:11,27-51`). An upload may be
  up to 20 MB by default and 100 million pixels (`packages/media/src/prepare.ts:14-15,42-53`,
  `load-sharp.ts:3-4`); it is stored as WebP with its longer side at most 1600 px, never enlarged
  (`prepare.ts:7-11,56-59`). A run of `prepareImage` (a throwaway case in `packages/media`, deleted
  afterwards; Vitest 4.1.11, Node 26.11.1) printed, for a 400 px PNG of a green circle on a
  see-through background, `stored .webp webp 400 400 hasAlpha true`, a corner pixel of
  `[0, 0, 0, 0]` and a centre of `[29, 91, 59, 255]`; the control, the same circle on white, stored
  `hasAlpha false`; a 64 px upload stayed 64 × 64; and an SVG was refused,
  `media.unsupported_type {}`. So a see-through background survives the library. Library images are
  served with no session from `/media/<filename>` and `/media/renditions/…`, marked unchanging for a
  year (`packages/media/src/routes.ts:252-290`); the "display" rendition keeps the image's own shape
  (`packages/media/src/renditions.ts:19-29`) and follows later edits
  (`packages/media/src/presentation.ts:49-66`). Listing, uploading and deleting need
  `image.manage` (`routes.ts:85-91`), granted from manager up (`packages/media/src/module.ts:35`).
  An image in use is refused deletion (`packages/media/src/images.ts:399-415`); the uses counted are
  products, sections, menu versions and department receipt logos, in two counters that "must stay
  in step" (`images.ts:46-50,240-250,590-600`). An edit updates `media_images`
  (`image-edits.ts:83`), a live-update source (`packages/media/src/module.ts:18-20`).

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
   Light / Dark / Follow device). Read-only, the card lists Logo ("None", or the image and how dark
   screens show it, section 8a), Brand colour (a swatch and the value),
   Background, Corners and "Colours set by hand" ("None", or the names, such as "Page (light)"),
   with one line under them: "Applies to the dashboard and every till. Each browser still chooses
   Light, Dark or Follow device." A fix the owner took shows in the Brand colour row ("Custom ·
   #1e5b3a · dark screens #417c59", the shade the fix paints; a fix is only ever stored where it
   paints, section 11), and a warning saved with "Save anyway" shows as a line under the rows (step
   7). Mock-up `01-appearance-card-{light,dark}.png`.
2. **Edit** opens the card in place, like the Defaults card. Left: the **Logo** field (section 8a),
   the three main choices, and under them the closed **Advanced: set colours by hand** section, whose closed line says "None set by
   hand. Waitron works out every colour." or names the ones that are (`wt-disclosure`'s `summary`,
   section 3). Right: **Preview**, one Light and one Dark panel side by side, each showing a strip
   like the banner (the logo, or Waitron's lockup while there is none, and the legal name), a sidebar
   item, a field with focus, Save and Cancel buttons, a switch, a link and a two-way choice, painted
   with the draft. Mock-up `02-editor-{light,dark}.png` (Bar Lucía has taken the fix for dark
   screens, so a line under Brand colour says "Buttons on dark screens: #417c59 · Undo"); at phone
   width the preview goes below the choices, Light above Dark (`03-editor-phone-light.png`).
3. **Advanced, opened**, lists the 22 colours of section 5 in plain words ("Page", "Cards",
   "Secondary text", "Main buttons", "Focus ring" …), one row each, with a Light and a Dark value.
   Each value shows its colour and its six-digit code. A worked-out value says "Worked out"; Main
   buttons says "Brand colour" where it is the brand colour as picked, and "Fixed" where the owner
   took the brand colour's fix for that kind of screen (step 5). Setting Main buttons by hand for a
   mode replaces the brand colour's fix for that mode: the fix leaves the draft, so the stored look
   never holds a fix that paints nothing, and **Use worked-out colour** on that row goes back to the
   brand colour as picked, with its warning and fix offered again (round 4). A value set by hand is
   drawn in bold with a **Set by hand** tag and a **Use worked-out colour** link that puts it back.
   Changing a value (a colour picker or the code) sets it by hand. Light and dark are separate:
   setting the light page leaves the dark page worked out. **Reset all to worked-out** at the end of
   the section puts every one back. Mock-up `12-advanced-{light,dark}.png`, Bar Lucía's light page
   set by hand to cream `#f8f1e1`; at phone width each row stacks its name, its Light value and its
   Dark value (`13-advanced-phone-light.png`). The section stays closed each time the editor opens
   (my call: the closed line already says what is set by hand), except that it opens itself while
   one of its values holds an error (`has-error`, section 3). A warning (step 5) is not an error and
   does not open it; the closed line ends with "· {n} hard to read" instead (my call).
4. Every change repaints the preview at once. The rest of the dashboard keeps the saved look until
   Save (my call: a preview of the whole dashboard before saving would need a way back on every
   screen, and the side-by-side panels show both modes at once, which the real dashboard cannot).
5. **A colour that would be hard to read is shown as picked, with a warning and a fix** (owner, Q2,
   2026-10-19: "Don't refuse, this is easy to fix. Instead show the warning and offer to fix
   automatically"). Café Limón's owner picks lemon `#f2d300`. The preview shows lemon buttons, and
   under Brand colour a warning says "Buttons in this colour are hard to see on light screens.",
   with a button **Use #9f8b18 on light screens** (mock-up `04-hard-to-read-light.png`). Pressing it
   is a draft change like any other: the light preview turns mustard, the warning becomes "Buttons
   on light screens: #9f8b18 · Undo" (`05-fixed-light.png`), and Cancel or Undo puts the lemon back.
   Dark screens keep the lemon, which reads there. For a colour set by hand, the warning and its fix
   sit under its row ("Light screens: hard to read on Selected item, Field background and
   Switched-off field background." with **Use #526a5b**); pressing it replaces the hand-set value
   with the fixed shade and shows "Light screens: fixed from #8fa898 · Undo" until the editor
   closes. When two or more warnings with a fix show, a line above the form's buttons says "2
   colours are hard to read." with **Fix all** (`15-hand-set-and-dark-warnings-light.png`). The
   colour is never refused, and a warning never disables Save (section 9 says how the fix is found,
   and what has no fix).
6. **Changing a main choice keeps the colours set by hand** (owner, the extra question, 2026-10-20:
   "A — hand-set colours are kept"; section 19). When any are set, a note under Brand colour says so after a change: "You
   set 1 colour by hand, and it is kept: Page (light). Advanced shows it." (mock-up
   `14-q-hand-kept-or-put-back-light.png`, left). A fix to the brand colour is not a colour set by
   hand: picking another brand colour drops it, because it belonged to the old colour (my call).
7. **Save** stores the choices. With no warning showing it saves at once. With a warning still
   unfixed it first asks, once, in a small dialog headed "Hard to read" that lists each warning,
   with **Back**, **Save anyway** and **Fix and save** (`16-save-hard-to-read-light.png`, left). Fix
   and save, offered only when every warning has a fix, takes them all and saves; Save anyway stores
   every colour as picked; Back saves nothing. When any warning has no fix, the dialog offers only
   Save anyway and Back, so a colour with no fix reaches the tills only by Save anyway. The
   dashboard that saved repaints at once; other open dashboards and signed-in tills follow (section
   12). A warning saved with Save anyway stays on the saved card, under its rows ("Buttons in the
   brand colour are hard to see on light screens."), for whoever opens the page next
   (`16-save-hard-to-read-light.png`, right). **Cancel** drops the draft.
8. **Use Waitron's look** sets the draft back to Waitron's choices — the brand colour "Waitron's",
   Neutral, Standard — drops any fix, **puts every colour set by hand back to worked out**, since a
   look with a hand-set colour is not Waitron's, **and removes the logo**, for the same reason
   (section 8a); Save then removes the venue's row, so every screen shows exactly Waitron's own
   token values and Waitron's own logo. It does not save by itself, so Cancel still
   undoes it (my call: one way of saving on the card).

The form follows the shared form rules (`design-system.md:2239-2808`, "Forms"): Save is quiet and
disabled until the draft changes (`draftScopeFor`, `saveActionState`; `design-system.md:2307-2308`),
so the editor opens with Save quiet even where a fix was saved earlier (pictures 02 and 03); **Use
Waitron's look** is drawn quiet only while the draft already is Waitron's look and in its own
variant whenever it can act (`design-system.md:2534-2537`); a bad custom value is explained under
the colour (or under its row in Advanced) and once at the bottom ("Correct the highlighted fields to
continue."), a refusal from the server never disables Save by itself, and the card has a
`*.unsaved.test.ts`. A readability warning is not an invalid field: it is not passed to a field's
`error`, it puts nothing in the bottom correction message and it never disables Save (the rules let
only the form's own checks do that, `design-system.md:2270-2271`). It is drawn beside a warning icon
in the warning colour, as the menu tab's "Missing: <name>" tile is (`design-system.md:427`). Asking
once before saving anyway follows the rota: "Labour warnings appear while you plan, and Publish lets
you review them before publishing anyway" (`design-system.md:4398-4399`), whose dialog offers
"Publish anyway" and "Back to the rota" (`packages/staffing/src/dashboard/strings.ts:48-49`,
`publish-dialog.ts:49`). The brand colour field reuses `colorField`'s 24 swatches and custom colour,
but drops its "no colour" and "inherit" choices and adds "Waitron's" in their place (my call). A
value in Advanced is a colour picker (the `<input type="color">` of `colorField`'s custom choice)
plus a code field from the shared input primitive, without the 24 swatches (my call: 44 swatch grids
would bury the list); each has a semantic `name`, such as `handSet.light.bg`.

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
| Brand colour warning | Buttons in this colour are hard to see on {light / dark} screens. |
| Its fix | Use {colour} on {light / dark} screens |
| After the fix | Buttons on {light / dark} screens: {colour} · Undo |
| Hand-set warning, under its row | {Light / Dark} screens: hard to read on {names}. / {Light / Dark} screens: {names} hard to read on it. |
| Its fix | Use {colour} |
| No shade passes, under its row | {Light / Dark} screens: no shade of this colour can be read on {names}. Pick another colour. / {Light / Dark} screens: no shade of this colour lets {names} be read on it. Pick another colour. |
| Two or more fixes, above the buttons | {n} colours are hard to read. · Fix all |
| Advanced, closed, with a warning | … · {n} hard to read |
| Save dialog | Hard to read · one line per warning: "Brand colour: buttons are hard to see on {light / dark} screens." / "{name} ({light / dark}): hard to read on {names}." / "{name} ({light / dark}): {names} hard to read on it." / "{name} ({light / dark}): no shade can be read." · Back · Save anyway · Fix and save |
| A hand-set fix, until the editor closes | {Light / Dark} screens: fixed from {colour} · Undo |
| Saved card, after Save anyway | Buttons in the brand colour are hard to see on {light / dark} screens. / {name} ({light / dark}) is hard to read. |
| Main buttons, in Advanced | Brand colour · Fixed |
| Bad custom value | Enter a colour as # and six digits or letters a–f. |
| Logo field | Logo · + Add a logo · Replace · Remove |
| Its hint | PNG, JPEG or WebP. A see-through background, at least 200 pixels tall, looks best. |
| Second image | For dark screens (optional) · + Add a version for dark screens |
| Its hint, while there is none | Without one, dark screens show your logo on a light plate. |
| Saved card row | Logo: None / {image} · Dark screens: own version / Dark screens: on a light plate |
| Logo refused by the server | That image is no longer in the image library. Pick another. |
| Sign-in screens, with a venue logo (Q6 A) | Powered by {Waitron's lockup} |
| Under the logo (Q5 A) | How it prints on receipts of departments with no receipt logo of their own. · This logo prints blank on receipts. |

In the hand-set rows, {names} are the plain names (section 5) of the other colours in the rules the
value fails. The first form is used when the hand-set colour is drawn on the others (a text, a
line), the second when the others are drawn on it (a background). Fix and save appears only when
every warning has a fix. The server sends keys, not these words (section 10); the browser words them
from its strings.

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

- One pure function, `deriveTheme(choices) → { light, dark, warnings, tintStrength }`, used by the
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
  colour's lightness and keep its hue. The brand colour is the button colour **as picked**, in both
  modes (owner, Q2). Where it does not stand 3:1 from the page, both surfaces and the field fill,
  that is a **warning**, and its **fix** is the brand colour darkened (light) or lightened (dark)
  step by step until it does — the adjustment the design used to apply by itself, now offered.
  Taking the fix stores only that it was taken, for that mode (`brandFix`, section 11); the shade is
  always the one this rule gives, worked out each time like any other colour, and the rest of the
  brand family is still worked out from the brand colour. A rule naming the brand colour never weakens
  the tint and never moves a worked-out colour (my call: moving the page or the cards to suit one
  button would recolour the whole dashboard); it is left to the warning. The text on the button is
  white (light) or a near-black of the same hue (dark), falling back to plain black or white. Link
  text is the brand colour moved until it reads at 4.5:1 on the page, both surfaces, the field fill
  and the lifted surface. Hover is moved away from the button's text until it stands 1.2:1 from
  rest with the text still at 4.5:1. These are Waitron's colours, so they move without a word.
- **The tint gives way, never the owner.** With Tinted, if a rule between colours Waitron works out
  fails, the tint is weakened in steps of a tenth, down to none, until every such rule passes; it
  never warns for the tint. No note is shown when the tint is weakened (my call: the tint is faint
  decoration, the preview shows the result, and a note about it would be noise).
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
  The prototype's `warn` (added for Q2) works out a set as picked and lists the warnings with their
  fixes; `checks.txt` there holds its output for every picture.
  - Bar Lucía, `#1e5b3a`, tinted: light buttons are `#1e5b3a` with white text at 8.04:1, and no
    warning; the light page becomes `#f0f9f3`. On dark screens the green as picked stands 2.37:1 on
    the page, 2.18:1 on the cards and 1.86:1 on the field background, so it warns, with the fix
    `#417c59` (white text on it 4.94:1). With that fix taken — as in her saved look in the pictures
    — every rule passes in both modes, with the tint at full strength, and the tokens are exactly
    those the earlier design worked out by itself (at the Q2 revision, pictures 06 and 07 rendered
    byte for byte the same PNGs).
  - Café Limón, lemon `#f2d300`: on white it stands 1.49:1. As picked, the light set fails three
    rules — the button colour on the field fill at 1.32:1, on the page at 1.39:1 and on the surface
    at 1.49:1 — so it warns, with the fix `#9f8b18` (3.40:1 on white, 3.17:1 on the page, black text
    on it 6.18:1). Dark screens keep the lemon with no warning. With the fix taken every rule passes.
- **Sweeps.** 216 brand colours (every combination of 0, 51, 102, 153, 204 and 255 per channel) ×
  Neutral and Tinted × light and dark, 864 cases. With every fix taken (`node sweep.mjs` in the same
  folder) it printed `failing 0, tint weakened in 0 tinted cases`. As picked (`node sweep-warn.mjs
  brand`, added for Q2) it printed `warned 360 (brand colours warning on light 111/216, on dark
  73/216), warnings with no fix 0, fix taken but still failing 0, cases with an unexplained failing
  rule 0`: every failing rule named the brand colour, every warning had a fix, and taking it left
  nothing failing. The control for that last count — the same 864 sets, counting any failing rule
  without excusing the brand colour (`/tmp/a841q2/control.mjs`) — printed 360, so the sweep does see
  failures, and all of them were the brand colour's. The first run of the sweep, with a darker light
  tint, had the tint weakened in every light case (the bar track fell to 1.38:1 on the page) and 44
  cases failing on black and near-black brands; the light tint and the lightness search were
  changed until the runs above. The build's guard test repeats these sweeps (section 15).

### Colours set by hand

Added for the owner's Q1 answer, revised after review round 3 and for the Q2 answer. My calls,
except the rule for a later change of a main choice, which is the owner's (the extra question,
answered A on 2026-10-20; section 19).

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
  must not turn Waitron's blue when pointed at. Prototype (`/tmp/a841q2/check2.mjs`): brand
  "Waitron's", Neutral, light Main buttons set to `#7a1f2b` gave pointed at `#67081c`, links and
  focus `#7a1f2b`, selected item `#fee2e2`, and no warning; with the dark value set to the same
  burgundy it warned (1.84:1 on the dark page), with the fix `#9e4048`, and with the fix taken the
  family followed (pointed at `#8a2e38`), every rule passing.
- **When a rule fails**, it is settled in this order:
  1. **the tint gives way, but only for failing rules between colours Waitron works out**, at least
     one of them tinted. A rule with a hand-set colour in it is left to steps 2 and 3, so one bad
     hand-set colour cannot strip the tint from everything else;
  2. **a worked-out colour named in the failing rule moves**, if moving it alone makes the rule pass
     (no note, as for the tint: the preview shows it). The main button colour is not moved here,
     and nothing moves for a rule naming the brand colour (above);
  3. **otherwise the hand-set value is what makes the rule fail, and it warns** (owner, Q2). Every
     hand-set value named by a rule still failing after steps 1 and 2 shows a warning under its row,
     and no other. A rule between the brand colour and a hand-set colour is the hand-set colour's
     warning, not the brand colour's: the brand colour's own fix only ever looks at colours Waitron
     works out. The **fix** offered is the value moved, keeping its hue, to the nearest lightness at
     which no rule names it, the brand colour held as picked. Meaning colours (danger, success,
     station dots, Google's button line, the search highlight) never move, so a hand-set background
     that fails against one of them is the one with the warning. When both colours in a failing rule
     are hand-set, both warn; taking the fix of the one drawn on top (text, line or button) first is
     what Fix all does, and it can clear the other's warning. Where no lightness of its hue, from
     black to white, passes, the warning says so and offers no fix ("no shade of this colour can be
     read on …"). Taking a fix replaces the hand-set value in the draft; it is still set by hand,
     now to the fixed shade, with Undo until the editor closes. Once saved, the typed colour is
     gone, while a brand colour's fix keeps its Undo after saving. That difference is wanted (my
     call): the brand colour is one choice painting both kinds of screen, so it must stay stored as
     picked beside a per-mode fix, whereas a hand-set value belongs to one mode only, and keeping
     the typed colour beside its fix would store a colour that paints nothing.
  4. **The server works out the same warnings from the finished set (section 9)**, and stores the
     choices as sent: nothing is refused for being hard to read. Every rule left failing names a
     colour the owner picked — the brand colour or a hand-set value — because Waitron's own colours
     give way first; a failing rule that named none would be a fault in the working out, which the
     sweeps below and in section 15 hold at zero.
- **Changing a main choice later keeps hand-set values** (owner, the extra question, 2026-10-20:
  "A — hand-set colours are kept"). Each stays exactly as set, marked "Set by hand", with **Use worked-out colour** on
  its row and **Reset all to worked-out** at the end of the section. After a change, a note under
  Brand colour names what was kept. The trade-off: a colour chosen to go with the old brand (a pale
  green selected-item background, say) stays when the brand turns burgundy, and can clash; the note
  and the preview show it, and one tap puts it back. The way not taken — a change of brand colour
  or background puts every hand-set value back — would always give a matching set, but throws away
  deliberate work without asking. Corners touch no colour, so they never affect a hand-set value either way.
- **Use Waitron's look** puts every hand-set value back as well (section 4).

**Worked example — Bar Lucía** (prototype: `deriveHand` in `a841-mockups-src/derive.mjs`, run by
`node build.mjs` there and by `node examples-hand.mjs`, outside the repository):

1. Lucía's look is brand `#1e5b3a`, Tinted, Round. Her light page is worked out as `#f0f9f3`. Her
   green warned for dark screens, and she took the fix, `#417c59` (section 6, worked examples).
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
   sunken areas `#e2d6d6`, field background `#f7eeed`, every light rule passing. Her dark fix belonged
   to the green and is dropped; burgundy on dark screens warns (1.88:1 on the dark page) with the fix
   `#b05157`, and with it taken every dark rule passes (`/tmp/a841q2/check3.mjs`). Without the
   hand-set page, her light page would have been `#fff3f3`; **Use worked-out colour** on the page row
   gives exactly that. Mock-up `14-q-hand-kept-or-put-back-light.png`, left.
4. Back on green, with the cream page, she sets Secondary text (light) to a pale sage, `#8fa898`.
   The rules for secondary text ask 4.5:1 on the selected item, the field background and the
   switched-off field background; the sage reads 2.04:1, 2.24:1 and 2.38:1. No worked-out colour
   can move far enough from it (even white reaches only 2.55:1), so the sage is at fault (step 3).
   The warning is on the sage alone — the cream page is named by no failing rule, and the tint stays
   at full strength (`/tmp/a841q2/check4.mjs`: tint 1, field background `#ebf2ed`, only the three
   secondary-text rules failing). Its row says "Light screens: hard to read on Selected item, Field
   background and Switched-off field background." with **Use #526a5b**; that shade reads 4.70:1,
   5.17:1 and 5.49:1, every rule passing. If she presses it, the stored choice becomes `#526a5b`; if
   she saves without it, Save asks once and Save anyway stores `#8fa898` as typed, and the light
   tills show the pale sage. Mock-up `15-hand-set-and-dark-warnings-light.png`, which also shows her
   green warning for dark screens before she took that fix, and Fix all taking both.

**Extreme picks** (`node sweep-warn.mjs hand light` and `… hand dark` in the same folder, added for
Q2: Bar Lucía, Tinted, with her dark fix `#417c59` taken, each of the 22 colours set by hand in turn
to each of the eight corner colours of the colour cube — black, white, red, green, blue, cyan,
magenta, yellow — 176 cases per mode). They printed `hand sweep light: cases 176, no warning 87,
hand-set warnings 89 (with a fix 89, no shade passes 0), brand-colour warnings 0 (no fix 0), cases
with an unexplained failing rule 0, cases still failing after Fix all 0` and, for dark, `no warning
79, hand-set warnings 97 (with a fix 97, no shade passes 0), brand-colour warnings 0 (no fix 0),
cases with an unexplained failing rule 0, cases still failing after Fix all 0`. Those are the same
counts the earlier design's automatic moves gave (87 left as typed and 89 moved in light, 79 and 97
in dark). No case lacked a fix, so I have no example of a hand-set colour that no lightness of its
hue can make readable, and give none. A first run of the sweep counted 17 light and 15 dark
brand-colour warnings, all in cases where a hand-set colour made a rule with the green fail; one was
pure blue cards, where the green's own fix found no shade while the cards' fix cleared everything.
That is why a rule between the brand colour and a hand-set colour is now the hand-set colour's
warning (step 3), and the run above is after that change. An example of a fix: pure blue cards in
light mode fail 22 rules, all fifteen station dots among them; the fix offered is the same hue
lightened to `#e2ecff`, where every rule passes (`/tmp/a841q2/check2.mjs`). The prototype's settling
is still simple — step 2 moves one worked-out colour at a time and only when that lowers the number
of failing rules, and the fix search tries lightness in steps of a hundredth — so the plan decides
how the real one searches.

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
| Trust page, user guide, server recovery page | No | Server-built pages with hand-copied tokens (section 3); my call, could follow later. Their logo stays Waitron's (section 8a). |
| Dashboard recovery sheet | Partly | It copies tokens from the page (section 3), so on screen it shows the theme; printed, its text and background are forced plain, and its border colour and corner radius stay the theme's. My call: leave it, since the printed words and page are plain. |
| Equipment label | No | It copies font tokens only (section 3). |
| Waitron's logo in the dashboard banner and the till's top bar | Replaced | By the venue's logo, when one is set (section 8a); what stays of Waitron's is Q6. |
| Favicon, installed app icon, till browser-bar colour | No | Waitron's own frame (section 3). My call: the browser-bar colour and the manifest stay Waitron's blue, like the favicon; an installed app takes a changed manifest only on the browser's own schedule, and Chrome on desktop never takes a changed icon (section 8a). |
| Product tiles, categories | No | Painted from the product's stored colour (section 3). |
| Floor-plan table states, stations, calendars, danger/success/warning | No | Their colours carry meaning and are tested apart from each other (`colors.test.ts:446-576`). |
| Receipts, kitchen tickets | No | Printer commands, not web pages (section 3). Whether the venue's logo prints on receipts is Q5 (section 8a). |

## 8a. The venue's logo

Added for the owner's request of 2026-10-20: "Also we should allow uploading a new logo". Q5 and Q6
(section 19) are the owner's to decide; every other call here is mine, with its trade-off. The
mock-ups give Bar Lucía a made-up logo: a green roundel with "BL" in cream, and "Bar Lucía" in green
beside it, on a see-through background (`a841-mockups-src/lucia-logo.svg`, outside the repository).

**What the owner does.** The Look card gains a **Logo** field, first on the card (my call: it is the
first thing most venues will set). With no logo it is one "+ Add a logo" box. Pressing it opens the
image library's picker — the one a department's receipt logo already uses (section 3) — where the
owner uploads a file or picks one already in the library. With a logo, the box shows it on the
look's light card colour, with **Replace** and **Remove** beside it. Under it, **For dark screens
(optional)** offers a second image the same way. Both are part of the draft, like a colour: the
preview shows them at once, Save stores them, Cancel drops them, and the quiet-Save rule
(section 4) counts them as changes. Mock-ups `17-logo-editor-{light,dark}.png` and
`18-logo-editor-phone-light.png`.

Worked example. Bar Lucía's manager presses "+ Add a logo" and uploads `bar-lucia.png`, 1200 × 400
pixels with a see-through background. The Light preview's banner strip shows it; the Dark one shows
it on a plate of her light card colour, since she has given no dark version. She presses Save. Her
own dashboard shows it at once, other open dashboards follow through their live read, and every
signed-in till within one menu-state poll, 15 s (section 12). Picture `20-logo-banner-{light,dark}.png`
shows the saved card and the banner; `21-logo-till-{light,dark}.png` a till.

**Where it shows.** This is the recommended answer to Q6; B and C change only what happens to
Waitron's own logo (section 16).

| Surface | Where | Box: the logo is fitted inside, keeping its shape |
| --- | --- | --- |
| Dashboard banner, signed in and on the sign-in page | Where Waitron's lockup is today, before the legal name | 40 px tall, at most 160 px wide |
| The same at phone width | The lockup's place on the first row, shrinking first as the lockup does (`dashboard-app.ts:737-773`) | The same |
| Till top bar | Where the word "Waitron" is today, left out by the same rules (section 3) | 32 px tall, at most 128 px wide |
| Till sign-in screen | Above the heading | At most 96 px tall and 320 px wide |
| Kiosk and kitchen-display modes | Nowhere: they draw no bar (section 3) | — |
| Trust page, setup, user guide, recovery page | Nowhere: Waitron's lockup stays | — |
| Favicon, installed app icon, browser-bar colour | Nowhere: Waitron's stay (below) | — |
| Receipts and the A4 invoice | Q5 (below) | — |

The banner keeps the tenant's legal name beside the logo: CLAUDE.md §3 makes the banner "persistent
identity chrome — top of the page, full width, the tenant's legal name (not a location)", and the
logo replaces only the picture before the name. Bar Lucía's 3:1 logo is drawn 120 × 40 in the banner
and 96 × 32 in the till bar. The sizes are my call: Waitron's lockup is 128 px wide and, at its
drawing's proportions (`viewBox="-4 -27 619.4… 131"`, `trust-page-logo.ts:12`), about 27 px tall, so
a venue logo gets a little more height than that and a little more width. Its alternative text is
the legal name where the name is not beside it (till bar, till sign-in) and empty where it is (the
banner), so a screen reader does not read the name twice (my call).

**Light and dark** (my call). One image is required; a second, for dark screens, is optional. With
both, each screen draws the one for its mode, the A681 choice deciding as it does for colours
(section 7). With one, dark screens draw it on a **plate**: a rounded box in the look's light card
colour, filling the logo's box, with the logo inside it 4 px from each edge (picture
`19-logo-dark-plate-or-version-dark.png`, left). The plate means a dark green or black logo never
disappears on a dark till; its cost is a light patch on a dark bar, which a second image removes
(the same picture, right). Rejected: inverting the colours automatically (it would turn a green
roundel pink), and checking a logo's contrast like a colour (a logo is many colours, and no rule
says which of them must read).

**Limits** (my calls; mostly the library's own, section 3):

- PNG, JPEG or WebP, judged by their bytes; up to 20 MB and 100 million pixels; kept with the
  longer side at most 1600 px. A see-through background is kept; a JPEG has none, so it shows its
  own rectangle.
- **No SVG.** The library refuses it, and this design keeps that. An SVG can carry a script, and
  the box serves library images from its own address. Probe
  (`a841-mockups-src/logo-probes/svg-probe.mjs`, Playwright's Chromium 156.0.8078.4): a page set a
  cookie and showed an SVG holding `<script>fetch("/stolen?cookie=" + encodeURIComponent(document.cookie))</script>` from
  `/media/logo.svg`. Drawn through `<img>`, the server saw only `/` and `/media/logo.svg`; opened
  directly, it saw `/media/logo.svg` and then `/stolen?cookie=session%3Dsecret123`. So the screens'
  `<img>` would not run it, but anyone opening the image's own address would, as the box. A PNG of
  the same drawing loses nothing a screen needs.
- Scaled to fit its box keeping its shape, never stretched or cropped. A small image is drawn up to
  the box and may look soft; the hint says so ("at least 200 pixels tall": the till sign-in's 96 px
  box on a screen with two device pixels to each CSS pixel needs 192).
- The image drawn is the library's "display" rendition, so a later crop or a replaced file in the
  library shows everywhere (section 3); the library's edit path already updates `media_images`,
  which the delivery path watches (section 12).
- **While it loads**, the box keeps its height and stays empty. **If it fails** to load, or the
  stored name has no image behind it, the screen draws what it draws with no logo: Waitron's lockup
  in the banner, the word in the till bar. The library refuses to delete an image in use, and the
  logo is counted as a use (below), so this is a fault path rather than a normal one. A till that
  starts while the box is out of reach still draws the logo if its browser kept the image (library
  images are marked unchanging for a year, `routes.ts:270,287`); whether a given till's browser
  kept it is the browser's choice.

**Waitron's own logo** is Q6. Recommended, A: the venue's logo takes Waitron's place in the banner
and the till bar, and both sign-in screens gain one small line under the form, "Powered by" with
Waitron's lockup (`22-logo-sign-in-{light,dark}.png`). With no venue logo set, nothing changes from
today. Options side by side: `24-q6-waitron-logo-light.png`.

**The favicon and the installed app icon stay Waitron's** (my call). A browser tab would follow a
changed favicon at once: in Playwright's Chromium 156.0.8078.4 run with a window
(`a841-mockups-src/logo-probes/favicon-probe.mjs`), changing the icon link's address from script
made the browser fetch the new image (`/waitron.png`, then `/venue.png` about 1.5 s later), and
adding a second link did the same; run without a window, the same browser fetched no icon at all, so that mode cannot
measure this. An installed app does not follow: "Once installed, all fields from the new manifest
except icons are updated … Note: Chrome on desktop doesn't yet support changes to icons", and on
Android a changed manifest waits until "all windows of the PWA have been closed, the device is
plugged in, and connected to WiFi" (<https://web.dev/articles/manifest-updates>, "How Chrome
handles updates to the web app manifest", last updated 2024-09-19). The till's manifest is also a
file written when the app is built (section 3), the same for every venue. A tab icon in the venue's
logo beside an installed icon in Waitron's would be two answers to one question, so both stay
Waitron's, like the browser-bar colour (section 8).

**Use Waitron's look removes the logo too** (my call; section 4, step 8). The button promises
Waitron's look, and a screen showing Bar Lucía's logo is not it — the reason it also puts colours
set by hand back. It changes the draft only, so Cancel keeps the logo; after Save the image is
still in the library, and Replace picks it again. The trade-off: an owner who only wanted Waitron's
colours back has to pick the logo again.

**Who may change it** (section 13). The save is under `layout.configure`, like the rest of the card.
The picker lists and uploads under `image.manage` (section 3), so a person needs both to set a logo;
managers and administrators hold both (`packages/identity/src/permissions.ts:55-73`,
`packages/media/src/module.ts:35`), and supervisors neither.

**Storage and delivery.** The theme document gains `logo` (section 11); no migration. The library
counts the logo as a use, in both of its counters, so it refuses to delete it. `/api/theme` carries
the logo's addresses and its hash covers them, so tills and open dashboards follow a new logo, a
removed one, or an edit to the image in the library (section 12).

**Receipts** are Q5 (`23-q5-logo-on-receipts-light.png`). With A, recommended, the logo also prints
on the receipts and A4 invoices of any department with no receipt logo of its own; a department's
own receipt logo still wins, and is how paper gets a different picture. The light image is the one
printed, never the dark one. The real drawing code (`drawLogoRasters` after `prepareImage`, run on
the made-up logo in a throwaway case in `apps/server`, deleted afterwards) printed 13,723 of 76,800
dots at 80 mm for the light version, its words readable, and 8,404 for the dark version, whose
cream words came out as scattered dots (`a841-mockups-src/lucia-logo{,-dark}-receipt-80mm.png`). The
Look card then shows how it prints, from the receipt preview's own drawing (`drawPreviewLogo`,
`receipt-logo.ts:66-85`), and says so when it prints nothing: in an earlier run of the same code on
400 px squares, a white circle on a see-through background printed 0 of 25,600 dots, the same circle
in black 11,305 and in lemon `#f2d300` 1,896. How A is built: the theme's save draws the printed
pictures outside the transaction, as a department's save does, and writes them with the logo's name
into the `tenant_receipts` row in the same transaction as the theme (`putReceipt` already requires
the pictures with a logo, `receipt-store.ts:164-188`); the print paths pass that row to
`resolveReceiptTrim` in place of the empty one (`receipt-print.ts:210-211`,
`invoice-document.ts:114-115`, and the till's ticket view and the receipt preview,
`apps/server/src/receipt-presentation.ts:20-55`, `apps/server/src/receipt-preview-api.ts:227-293`);
and the library's edit path redraws the venue's pictures as it does a department's
(`image-edits.ts:65-80`). With B none of that is built. With C the card gains a second upload, for
receipts only, stored in the same row.

**The two logo entries in the backlog.**

- "Left open by #1261's review (W111): database enforcement of logo retention remains open"
  (`docs/backlog.md:3513`): the venue's logo becomes a second kind of image whose deletion only the
  app refuses, like a department's receipt logo. This design adds no database trigger either, so
  that entry now covers it; the entry gains a line saying so.
- "The box's trust page and the favicon still follow the device's setting, not the Theme choice"
  (`backlog.md:3973-3978`), and A681's tidy-up (1), drawing the dashboard logo as a token-coloured
  inline image (`backlog.md:3980-3986`): unchanged. The trust page and the favicon stay Waitron's,
  so the first stays true; tidy-up (1) still applies to Waitron's lockup, drawn whenever a venue has
  no logo of its own. A venue's logo cannot be token-coloured: it is the venue's own picture.

**English only.** The new words live in the dashboard's and the till's strings files
(`apps/dashboard/src/i18n/strings.ts`, `apps/till/src/i18n/strings.ts`). No file name, image or
starter text is added to general code: a new venue has no logo.

## 9. Readability protection

Two sets of rules, run in light and dark on the finished set: the owner's colours as picked, and
everything Waitron works out around them.

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

**On a hard-to-read choice: warn, offer the fix, never refuse** (owner, Q2, 2026-10-19: "Don't
refuse, this is easy to fix. Instead show the warning and offer to fix automatically"). A colour the
owner picks — the brand colour in either mode, or a value set by hand — that leaves a rule failing
is shown as picked, in the preview too, with a warning beside it naming what it is hard to read
against, and a button that applies the fix (section 4, step 5). The fix is found by the rule the
design used to apply by itself: the same hue, moved in lightness until every rule naming the colour
passes (section 6). It is a draft change, so Cancel undoes it. The same rules check hand-set and
worked-out colours alike; a hand-set colour gets no exemption for having been typed exactly.

**What Save does while a warning is unfixed** — my call, after weighing three ways:

- (a) Save stores the colour as picked, at once, and the warning stays on the card. Shortest, but
  one press can put a hard-to-see Pay button on every till without the owner having noticed the
  warning — easy to miss when it is about dark screens and the owner is looking at the light
  preview.
- (b) Save stores the colour as picked, but the screens paint the fixed shade until the warning is
  dealt with. That is the earlier recommended answer (A) by another name: the screens would show a
  colour the owner did not choose, without them pressing anything. Rejected for that reason: the
  owner asked to be offered the fix, not to have it applied.
- (c) **Chosen.** Save asks once, in a small dialog headed "Hard to read" listing each warning, with
  **Fix and save** (the default, drawn as the main button), **Save anyway** and **Back**. Fix and
  save takes every fix, then saves; it is offered only when every warning has a fix. Save anyway
  stores every colour as picked; Back closes the dialog and saves nothing. When any warning has no
  fix, the dialog offers Save anyway and Back alone: the fixable ones can still be fixed in the
  editor first, and the one with no fix goes on the tills only by Save anyway. With no warning
  showing, Save saves at once and nothing asks.

The trade-off of (c): one more press for an owner who really wants the colour as picked; in
exchange, a hard-to-read colour reaches the tills only by a deliberate "Save anyway", never by
accident (Fix and save is not offered while any warning has no fix, so it cannot carry one past),
and nothing is refused. It is a warning, not an invalid field, so it follows the house form rules as
section 4 sets out: Save is never disabled by it and the correction message stays empty. The
dashboard already does the same with labour warnings: they show while you plan, and Publish lets you
review them before publishing anyway (`design-system.md:4398-4399`). I did not make this a question
for the owner: "Don't refuse" already says the owner may keep a colour as picked, and (c) differs
from (a) only in asking once.

After Save anyway, every dashboard and signed-in till paints the colour as picked. The warning
stays as a line on the saved Look card ("Buttons in the brand colour are hard to see on light
screens."), seen by every supervisor, manager and administrator who opens Appearance, and the
editor shows it again, with its fix, the next time it opens. Nothing else raises it (my call: an
alert would page someone about a choice the owner made on purpose).

Worked examples:

- **Café Limón, lemon, light screens.** The warning reads "Buttons in this colour are hard to see on
  light screens." with **Use #9f8b18 on light screens**. If the owner presses Save without it, the
  dialog lists "Brand colour: buttons are hard to see on light screens." Fix and save stores
  `brandFix: { "light": true }` and light screens show mustard buttons (`#9f8b18`), dark screens the
  lemon. Save anyway stores the lemon alone and every light-screen till shows lemon buttons on
  white, 1.49:1 (`16-save-hard-to-read-light.png`).
- **Bar Lucía, green, dark screens.** As picked, `#1e5b3a` stands 2.37:1 on her tinted dark page,
  2.18:1 on the dark cards and 1.86:1 on the dark field background, where buttons need 3:1 (on
  Waitron's neutral dark page it would be 2.33:1 and 2.12:1). The warning offers **Use #417c59 on
  dark screens**. Taken, light screens keep the green and dark screens show `#417c59`; saved anyway,
  the tills in dark mode show the dark green on the near-black page.
- **Bar Lucía, sage "Secondary text", light screens** (section 6, worked example step 4). The row
  warns, with **Use #526a5b**. Taken, the hand-set value becomes `#526a5b`; saved anyway, `#8fa898`
  is stored as typed and light screens show the pale sage at about 2 to 1.

**No shade passes.** Where no lightness of a colour's hue passes, the warning says "{Light / Dark}
screens: no shade of this colour can be read on {names}. Pick another colour." and offers no fix. It
never disables Save: the dialog lists it and offers only Save anyway and Back (Fix and save needs
every warning to have a fix), and Save anyway stores it as picked like any other. The sweeps found
no such case (section 6), so this is a sentence the plan must still test with a made-up case.

**Every way in is checked for validity; readability is reported, never enforced.** The server
derives on every save, hand-set values and fixes included, and answers `theme.invalid` only for
choices that are not valid — not an object, an unknown key or colour name, a value that is not
`#rrggbb`, a fix for a mode other than light or dark, a fix while the brand colour is Waitron's, or
a fix for a mode whose Main buttons is set by hand (section 11). A stored fix is a flag, not a shade
(section 11), so it cannot hold a shade other than the one the shared rule gives for that brand
colour and mode: the round-4 finding that a script could store any shade as the "fix" is closed by
construction rather than by a check. A valid choice that is hard to read is **stored as sent, and
the server does not apply the fix itself**: the fix is the owner's to take, a server that quietly
applied it would be the silent adjustment the owner turned down, and "Save anyway" would no longer
mean what it says. A request that skips the screen — a script, or a future tool — gets the same
warnings back in the answer (section 10), so it is told what the editor would have shown, and the
read route answers them too, so the saved card shows them to anyone who may open the page. A
configuration import is the second way to write `tenant_themes` (`configuration-transfer.ts:77`),
and `validateCoreConfiguration` checks no theme row today (`configuration-transfer.ts:5-24`): the
build adds the same validity check there, and an imported look that is hard to read shows its
warnings on the card like any other. The stylesheet is built only from the derived values —
`#rrggbb` colours and pixel radii the function itself writes, and the owner's values only after they
pass the same `#rrggbb` check — never from an unchecked stored string, so nothing stored can break
out of a declaration.

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
- Save sends the choices only — the logo, the three main choices, any fix taken and the hand-set
  values.
  When a warning is unfixed, the dialog of section 9 comes first, in the browser. The server checks
  the choices are valid, stores them and answers the stored choices with the worked-out values and
  the warnings. A warning carries keys only, never words: `{ field, mode, against, fix }` — `field`
  the colour's key as in `theme.invalid` (`brandColor`, `handSet.light.text-muted`; section 11),
  `mode` `light` or `dark`, `against` the keys of the colours it is hard to read on (token names
  without `--wt-color-`, such as `surface-lifted` or `station-red-dot`), and `fix` the offered
  `#rrggbb` or `null`. The browser words them from its own strings, in the screen's language; how
  meaning colours such as the fifteen station dots are named in a sentence is for the strings. They
  are the same warnings the editor shows, worked out by the same `deriveTheme`. The read route
  (`GET`) answers the warnings for the stored choice too, worked out by the same shared check, so
  the saved card — which a supervisor also sees — reads them from there rather than working them out
  itself. Reset is Save with
  Waitron's choices, no fix, no hand-set values and no logo, which deletes the row.
- **Use worked-out colour**, **Reset all to worked-out**, a warning's fix, **Fix all**, **Undo** and
  the logo's **Replace** and **Remove** change the draft only, like every other control on the card; Save stores the result and Cancel
  undoes them.

## 11. Storage

My call: **reuse and reshape what exists** rather than adding a parallel table.

- **Table:** `tenant_themes` stays, one row for the business. Scope: the whole business, not one
  location or one kind of device (owner, Q3, 2026-10-20: "one look for the whole business") — a brand belongs to the business, one database holds one business
  (`design-system.md:3256-3261`, the banner shows "the deployment tenant's legal name, not a
  location name"), and a single row needs no location key. Its `theme` document changes from `{
  tokens }` to the owner's **choices only**: `{ logo, brandColor, brandFix, background, corners,
  handSet }` (`logo` is `null`, or `{ light, dark? }`, each the image library's name for an image,
  such as `"3f9a….webp"`, `dark` optional, section 8a; `brandColor` is `#rrggbb`, or `null` for Waitron's; `brandFix` is `{ light?: true, dark?: true
  }`, saying the owner took the brand colour's fix for that mode — empty when none, and never set
  with Waitron's or for a mode whose Main buttons is set by hand; `background` and `corners` from
  fixed lists; `handSet` is `{ light: {…}, dark: {…} }`, each mapping one of the 22 names of section
  5, written without `--wt-color-`, to a `#rrggbb` value, and empty when nothing is set by hand).
  For example, Bar Lucía after step 3 of section 6's worked example, with the burgundy's dark fix
  taken, and her logo with no dark version: `{ "logo": { "light": "<library name>" }, "brandColor":
  "#7a1f2b", "brandFix": { "dark": true }, "background": "tinted", "corners": "round", "handSet": {
  "light": { "bg": "#f8f1e1" }, "dark": {} } }`, which paints dark buttons `#b05157`. **A fix is stored as a flag, not a shade** (round 4, changed from the shade
  first written here). The shade is whatever the shared rule gives for the stored brand colour, mode
  and surroundings, so a stored fix can never be a shade that does not belong to its brand colour,
  and a change of background or of a hand-set page re-works the shade rather than leaving a stale
  one. The trade-off: a release that changes the rule can move a fixed shade slightly, like any
  worked-out colour; the card and editor show the shade as it is now. Prototype: `derive.mjs` paints
  a flag with the same `until` search that offers the fix, and `warn` throws if the two ever differ;
  the brand sweep ran all 360 warnings through it without a throw. A hand-set value is stored as
  typed, or as the fixed shade if its fix was taken. No worked-out values are stored, so a release
  that improves Waitron's defaults reaches a themed venue too; the cost is that a release changing
  the defaults or the formula can shift a venue's worked-out colours slightly, which the editor
  shows as it works them out now. A release never changes a brand colour or hand-set value as
  stored, but it can make one hard to read that was not: it is then served as stored, and the card
  and editor show the new warning and its fix (section 17).
- **No migration is needed:** the table and its JSON column stay; the document's shape is checked in
  code. The logo is a name inside the document, not a column, so the library's use of it is counted
  by code: both of the library's usage counters (`images.ts:46-50`) learn a "venue logo" use, so
  the library refuses to delete the image while the look names it. With Q5 A, the printed pictures
  of the logo go into the existing `tenant_receipts` row (section 8a), also with no migration. Before go-live any installation may be reset (CLAUDE.md §3), so an old `{ tokens }` row is
  not carried forward: the server reads one as no theme (my call).
- **Routes:** `GET` and `PUT /management-api/theme` stay and take the new document; `GET` answers
  the choices, the worked-out values and the warnings for the stored choice (keys only, section 10),
  so the editor and the saved card — including a supervisor's read-only card — show the same
  warnings. Gates: section 13.
- **Error code:** `theme.invalid` stays, for choices that are not valid and nothing else: there is
  no readability refusal (section 9). It carries `field` (`brandColor`, `brandFix.light`,
  `background`, `corners`, or a hand-set value as `handSet.light.bg`, the same string as that
  input's `name`) and `reason` (among them `unknown_colour` for a name outside the 22, `bad_value`,
  `fix_without_brand` for a fix while the brand colour is Waitron's, and `fix_with_hand_set` for a
  fix in a mode whose Main buttons is set by hand), replacing `token`, so the card can put the
  sentence under the field or row (CLAUDE.md §3: "A screen puts a refusal beside a field by what the
  error CARRIES"); renaming params is free before go-live. For the logo, `field` is `logo.light` or
  `logo.dark`, and `reason` `image_not_found` (not a library name, or no image of that name in the
  library, checked as the department receipt's save checks it, `department-receipt-api.ts:46-55`)
  or `dark_without_light`. Readability goes in the answer's
  `warnings` instead (section 10).
- **Retired:** `THEMEABLE_TOKENS` and `MAX_THEME_VALUE_LENGTH` (`theme.ts:12-22`) and
  `validateThemeOverride`, with their exports (`packages/layouts/src/index.ts:28-29`) and the case
  that checks one (`packages/layouts/src/index.test.ts:7`), replaced by the choice check and the derived token list; the till's unused
  `ThemeOverride` copy (`apps/till/src/layout.ts:58-60`); the `--wt-font-family` override (no knob
  for it).
- **Backlog this closes or changes:** the `--wt-color-primary-text` entry (`backlog.md:4504-4510`,
  detail `backlog/dashboard.md:1227-1236`) closes — the theme writes primary text, hover and
  disabled colours; the `tenant_themes` DELETE restriction (`backlog.md:6277-6279`) is answered —
  Reset deletes the row, so DELETE is an intended path; `design-system.md:189-208` is rewritten.
- **Configuration copy:** the theme already travels (`configuration-transfer.ts:77`); the build adds
  its check to `validateCoreConfiguration` (section 9), including that a logo names an image the
  same copy carries — the library's tables travel too (`packages/media/src/module.ts:21-30`); the
  plan confirms the order in which the two are checked.

## 12. Delivery and refresh

Revised after round 1: a stylesheet linked in `<head>` holds the page until it answers. The reviewer's
`/tmp/a841-review/probe3.mjs`, re-run, printed for a 1.5 s answer no paint until `first-paint@1648`;
for a refused answer `first-paint@12`; and for an answer that never comes no paint and no script run
in 3.2 s of samples. So the theme is **applied from script, from a copy kept in the browser, and
fetched without holding anything** (B4: I chose the stored copy).

- **The answer.** `GET /api/theme` with no session (the colours are not secret, and the signed-out
  dashboard and the till's start screen need them) answers `{ hash, css, logo }`: the section-7 sheet
  built from the stored choices by the current release, or an empty `css` with no row; `logo`,
  `null` or `{ light, dark }` holding the addresses of the images' "display" renditions (`dark`
  `null` when there is none; section 8a); and `hash`, a SHA-256 of `css` and `logo` together (like
  `setupRevisionOf`, `till-setup.ts:115-117`). A rendition's address names its source and framing
  (`presentation.ts:10-16`), so an edit to the logo in the library changes the hash. A content hash, not a row
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
  (section 3), and on `media_images`, so an edit to the logo in the library reaches them too
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
  permission (section 12). The logo's image is served with no session, as every library image
  already is (section 3).
- The logo: saving it is the card's save, under `layout.configure`; picking or uploading it uses the
  image library, under `image.manage` (section 8a). Both are held by managers and administrators.

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
- The logo adds no guard. The plate's colour and the boxes' sizes read tokens, but the screens that
  draw them are in `apps/`, which `no-hardcoded-chrome.test.ts` does not scan (section 3), so review
  holds them to the token rule. The library's refusal to delete the logo is covered by cases
  (section 15), not by a guard. `scripts/brand-icons.test.ts` is unaffected: the favicon and the
  brand files do not change.

## 15. Testing

- `deriveTheme`: the section-6 sweeps as tests — brand colours on a grid × Neutral and Tinted ×
  light and dark (corners do not touch colour, so they are left out of the colour sweep and tested
  on their own). As picked, every failing rule names the brand colour and every warning has a fix;
  with each fix taken, every rule passes, and a fix flag paints exactly the shade the warning
  offered. The same choices give the same values; the written token list never changes. Proof by
  deletion: remove the darkening step from the fix search and the lemon's fix must fail at 1.39:1 on
  the page; and a control in the other direction — Café Limón as picked must warn, and Waitron's own
  blue typed as a custom colour must not.
- Hand-set values: section 6's worked example as cases (the cream page kept exactly and every rule
  passing; the brand change keeping it and dropping the green's dark fix; Use worked-out colour
  giving `#fff3f3`; the sage warning with the fix `#526a5b`, the cream page not named); a hand-set
  Main buttons colour with "Waitron's" brand colour writing its whole family; a rule between the
  brand colour and a hand-set colour warning on the hand-set one; a sweep of hand-set values in
  which every failing rule names an owner-picked colour and Fix all leaves nothing failing; an
  extreme hand-set colour (pure blue cards) whose fix keeps its hue and passes every rule; a made-up
  colour with no passing shade warning without a fix (section 9); and Main buttons set by hand for a
  mode dropping that mode's brand fix from the draft, with Use worked-out colour on that row
  bringing back the brand colour as picked and its warning (`/tmp/a841q2/check5.mjs` in the
  prototype: the fix leaves, the hand-set `#5a9c74` paints with no warning, and after Use worked-out
  colour the green `#1e5b3a` paints and warns with the fix `#417c59`).
- Server: `PUT` refuses invalid choices with `theme.invalid` naming the field (a hand-set value as
  `handSet.light.bg`, a fix as `brandFix.light`, a fix with Waitron's brand colour, a fix beside a
  hand-set Main buttons for the same mode); stores a valid but hard-to-read choice as sent — the
  lemon, unfixed — and answers it with its warning in keys (`field: "brandColor"`, `mode: "light"`,
  `against: ["field-fill", "bg", "surface"]`, `fix: "#9f8b18"`), never with `theme.invalid` and
  never with English names; answers the same warning from `GET`, to a supervisor too; serves that
  choice from `/api/theme` as picked; refuses without `layout.configure`; a supervisor's `GET` is
  answered and its `PUT` refused; a configuration import with an invalid theme row is refused and
  one that is only hard to read is accepted; `/api/theme` answers empty with no row and the three
  blocks with one, and the hash changes after Reset then a new save; the till's revision moves when
  the theme changes. The six existing cases in `management-api.canvas-retirement.test.ts:146-229`
  are rewritten for the new document, keeping their refusal cases.
- Browser (real Chromium, and WebKit for the start-up probe): the section-7 probe as a test against
  the real token files; probe7's three cases against the real dashboard and till; the dashboard and
  a signed-in till repaint after a save without a reload; the editor's form, `*.unsaved.test.ts` and
  axe tests in both themes; the editor opens with Save quiet and disabled, a saved fix included; a
  warning leaves Save enabled and the bottom message empty; a fix, Fix all and Undo change the draft
  and Cancel undoes them; picking another brand colour drops a fix; the Save dialog — Fix and save
  stores the fixed draft and is absent when any warning has no fix, Save anyway stores it as picked,
  Back and Escape store nothing, and no dialog with no warning; the saved card shows a warning saved
  anyway, worded from the `GET` warning's keys in both screen languages.
- The logo. Server: `PUT` refuses a logo naming no library image (`theme.invalid`, `field:
  "logo.light"`, `reason: "image_not_found"`) and a dark image without a light one; the library
  refuses to delete an image the look names, and both of its counters count it (a control: the same
  image is deleted once the logo is removed); `/api/theme` answers the logo's addresses, and its hash
  moves after the logo is replaced, removed, or reframed in the library; a till's revision moves with
  it; a configuration copy whose logo names an image it does not carry is refused. Browser: the
  banner, the till bar and the till sign-in draw the logo inside their boxes without stretching (a
  tall 1:4 image and a wide 4:1 one); dark screens draw the plate with one image and the dark image
  with two; a failed load falls back to Waitron's lockup or word; the editor's Replace, Remove and
  Use Waitron's look change the draft and Cancel undoes them; phone width; axe in both themes.
  With Q5 A: a department with no receipt logo prints the venue's pictures and one with its own
  prints its own; reframing the image in the library redraws the venue's pictures; the card says
  when the logo prints blank (a white image on a see-through background must, and a black one must
  not).

## 16. Build slices (each one pull request)

The build takes the full review path: it changes permissions on a route (section 13) and a contract
between packages (the theme document and `/api/theme`), and with Q5 A, what a receipt prints.

1. **The derivation and the shared checks.** `deriveTheme`, the contrast rules moved out of
   `colors.test.ts`, the sweep, the token-list guard. No screen. Hand-set values may be their own
   slice (1b) if this one grows past one implementer: fixed inputs, the settling steps of section 6,
   the hand-set sweep.
2. **The stored document and the server.** `tenant_themes`'s new document, the routes' new body and
   read permission (a supervisor reads, and is refused a save), `brandFix`, `theme.invalid` with
   `field` for invalid choices only, `warnings` in the answers, the import check, `/api/theme`, the
   till's `themeHash`; retire `THEMEABLE_TOKENS`,
   `validateThemeOverride` and the till's copy.
3. **Delivery.** The stored copy and the fetch in the dashboard's and till's `main.ts`, the
   dashboard's live read, the till's `#applyVenueSetup` swap, the start-up probes in Chromium and
   WebKit, the fixed-until-reload entry.
4. **Primary-coloured text.** Move the text uses of `--wt-color-primary` to `--wt-color-primary-text`
   and add the guard.
5. **The editor.** The Appearance page in the side menu's Settings section, the Look card,
   preview, the brand colour's warning, fix and Undo, Fix all, the Save dialog, the saved card's
   warning line, Spanish strings, and the design-system rewrite of
   `design-system.md:189-208` beside "Retheming a deployment"; the user guide gains the page.
6. **Advanced.** The closed section and its summary, the 22 rows with picker and code field, Set by
   hand marks, Use worked-out colour, Reset all to worked-out, the kept-colours note, warnings and
   fixes under rows, the closed line's "hard to read" count, and their `*.unsaved.test.ts` and axe
   cases.
7. **The logo, stored and served.** The document's `logo`, its validity check and the import check,
   the library's new use in both counters, `/api/theme`'s addresses and hash, the till's
   `themeHash`, and the dashboard theme read's dependency on `media_images`.
8. **The logo on the screens.** The Logo field, the preview's banner strip and the saved card's row;
   the banner, the till bar and the till sign-in screen; the plate; the loading and failure
   fallbacks; Q6's answer (under A, the "Powered by" line on both sign-in screens); Use Waitron's
   look removing the logo; the strings in both languages; the user guide's Appearance page.
9. **The logo on receipts — only if Q5 comes back A or C.** Under A: the `tenant_receipts` copy and
   its printed pictures, the print paths' fallback to it, the redraw on a library edit, "How it
   prints" and the blank-print line. Under C: the second upload instead of the fallback to the screen
   image.

### The answers, and the branches not taken

- **Q1** is answered (both, A by default and B behind Advanced); this design already holds it.
- **The extra question** is answered A (2026-10-20): colours set by hand are kept when a main choice
  changes. Not taken: B, which would have cleared `handSet` in the draft whenever Brand colour or
  Background changed, with a note naming what was put back.
- **Q2** is answered, and with neither A nor B (warn and offer the fix, never refuse); this design
  holds it. One choice inside it is mine, not the owner's: Save asks once before saving a warning
  unfixed (section 9). If the owner would rather Save never asked, the dialog goes and Save stores as
  picked at once, the card's warning line staying; nothing else changes.
- **Q3** is answered A (2026-10-20): one look for the whole business, one `tenant_themes` row, and
  one logo. Not taken: B, several named looks each chosen by a device profile, which would have
  needed a migration and repeated the Advanced list, its warnings and the logo per look.
- **Q4 B (text size):** a fourth knob scaling the four font-size tokens; every layout test that
  measures text in pixels is re-run at Large, and the slices gain one for the screens that break.
- **Q5 B (screens only):** slice 9 is dropped; receipts stay as they are today, and the Look card
  says nothing about paper. **Q5 C (two uploads):** slice 9 adds a "For receipts (optional)" upload
  under the logo, stored with its printed pictures in `tenant_receipts`, and the print paths fall
  back to that image rather than to the screen one; nothing prints until it is set.
- **Q6 B (no Waitron logo):** the "Powered by" line is not built; nothing else changes. **Q6 C
  (both logos):** the banner draws Waitron's lockup, then the venue's logo, then the legal name, and
  the till bar the word "Waitron", then the logo; both are left out together when the bar is short
  of room, and at phone width the banner keeps only the venue's (my call: the first row has room for
  one picture).

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
- **A till can show a hard-to-read button, by the owner's choice.** "Save anyway" stores a colour
  that fails a rule, and every till then paints it (owner, Q2: "Don't refuse"). Mitigation: the
  warning beside the colour, the one-press fix, the Save dialog whose default is Fix and save, and
  the warning line on the saved card.
- **The warning will be common on dark screens.** Most deep brand colours are too dark for buttons
  on a dark page as picked: the sweep warned for 73 of its 216 brand colours on dark screens and 111
  on light (section 6), and Bar Lucía's own green and burgundy both warn on dark screens. So many
  owners will meet a warning about dark screens on their first visit, possibly while never using
  dark mode. Mitigation: it says which screens, and the fix is one press; the plan should check the
  wording is calm rather than alarming.
- **Releases move colours.** Deriving at serve time means a release can shift a venue's worked-out
  colours slightly (section 11), and a taken fix's shade with them, since a fix is stored as a flag;
  every worked-out colour and every fix shade still passes the rules, because the sweeps test the
  release's own working out.
- **A release can make a saved colour hard to read.** An owner's value (a brand colour or a hand-set
  value) that passed when saved can fail after a release adds a rule or changes what is worked out
  around it. My call: it is served as stored, like any colour the owner chose, and the saved card
  and the editor show the new warning with its fix until the owner deals with it. This replaces the
  earlier call to serve such a value as worked out, which would have been the silent adjustment the
  owner turned down.
- **Recovery sheet.** It keeps the theme's border colour and corner radius on paper (section 8).
- **A logo crowds the bars.** A wide logo and a long legal name share the banner's first row, and the
  till bar already drops its first item when short of room. Mitigation: fixed boxes (section 8a),
  and the bar's existing rules; picture 24 shows what two logos side by side (Q6 C) cost.
- **The plate is a light patch on dark tills.** Mitigation: the optional image for dark screens.
- **The logo is public on the venue's network.** Library images are served with no session
  (section 3), so anyone who can reach the box can fetch the logo by its address; a logo is meant to
  be seen, and this exposes nothing new, but a wrong file uploaded by mistake is public until
  replaced.
- **With Q5 A, saving a logo changes printed receipts** of every department with no receipt logo
  of its own, from the next receipt. Mitigation: the card says so beside the logo and shows how it
  prints.
- **A stale design-system sentence** (`design-system.md:108-110`), backlog A899, narrowed in round 1:
  a bare `[data-wt-theme-root]` selector wins over the token layer in all six cases of probe.mjs's
  third variant; a bare `[data-theme]` selector matches nothing under Follow device, which removes
  the attribute (`theme-choice.ts:28`), so the advice against that one has a real reason, just not
  the written one.

## 18. Mock-ups

In `docs/backlog/mockups/a841-theme-editor/`, built from the real token files with Playwright's
Chromium (sources and the prototype outside the repository, in
`/Users/clintongormley/waitron-campaign/a841-mockups-src/`; `node build.mjs` there re-renders every
picture except 08, 09, 10, 11 and 14, which it leaves as the owner saw them). Since Q2 every
picture shows colours as picked; Bar Lucía's saved look has taken the fix for her green on dark
screens. Pictures 01 to 16 show her look before she uploads a logo; the logo revision (2026-10-20)
redrew 01 to 05, 12, 13, 15 and 16 to add the Logo row or field and the preview's banner strip, and
06 to show the word "Waitron" where the till's bar has it (section 3: it had shown "Bar Lucía");
07 rendered the same file as before. Pictures 17 to 24 show the logo. The side menu is the one a
manager sees on that page: every group starts folded and the open page's group unfolds
(`apps/dashboard/src/dashboard-app.ts:863-867`), and the Settings group lists the eight pages a
manager may open — all of `dashboard-app.ts:280-291` but Servers, which needs `mirror.create`, an
admin's permission (`permissions.ts:56-83`). In the editor pictures only the preview shows the draft;
the dashboard around the card, the card included, keeps the saved look (section 4, step 4):

| File | Shows |
| --- | --- |
| `01-appearance-card-{light,dark}.png` | The Appearance page in the side menu's Settings section: the saved Look card, with Bar Lucía's look applied to the dashboard; Logo "None"; the Brand colour row names her dark-screens fix |
| `02-editor-{light,dark}.png` | The editor just opened, with its Light and Dark preview, Advanced closed; under Brand colour, "Buttons on dark screens: #417c59 · Undo"; Save quiet and disabled until something changes, Use Waitron's look in its own variant |
| `03-editor-phone-light.png` | The editor at 390 px, just opened, Save quiet and disabled |
| `04-hard-to-read-light.png` | Café Limón's lemon as picked: the warning under Brand colour with its fix, **Use #9f8b18 on light screens**; the light preview shows lemon buttons. Replaces `04-adjusted-light.png` |
| `05-fixed-light.png` | The same after pressing the fix: "Buttons on light screens: #9f8b18 · Undo", the light preview in mustard, dark still lemon. Replaces `05-refused-light.png` |
| `06-till-{light,dark}.png` | A till counter screen in Bar Lucía's look; product tiles keep their own colours |
| `07-dashboard-{light,dark}.png` | The Products screen in Bar Lucía's look |
| `08-q1-knobs-or-every-colour-light.png` | Q1 options side by side, kept unchanged as the record of what the owner saw when they answered (2026-10-19). Superseded by 02 and 12: its B side says 23 colours and has no Set by hand marks |
| `09-q2-adjust-or-refuse-light.png` | Retired: Q2's options side by side, kept unchanged as the record of what the owner saw when they answered (2026-10-19), as 08 is. Its A side (silent darkening) and B side (refusal) are both superseded by 04, 05, 15 and 16 |
| `10-q3-one-theme-or-per-device-light.png` | Q3's options side by side, kept unchanged as the record of what the owner saw when they answered A (2026-10-20) |
| `11-q4-text-size-light.png` | Q4's options side by side, kept unchanged while Q4 is open (its till bar still shows "Bar Lucía", section 3) |
| `12-advanced-{light,dark}.png` | Advanced opened: Bar Lucía's light page set by hand to cream in the draft, marked, beside worked-out colours; her dark page still worked out; Main buttons reads "Brand colour" (light) and "Fixed" (dark). The saved look around the card has no cream |
| `13-advanced-phone-light.png` | Advanced opened at 390 px: each row stacks its Light and Dark values |
| `14-q-hand-kept-or-put-back-light.png` | The extra question: with the cream page saved, the brand changed to burgundy in the draft; the cream page kept (A) or put back (B). On both sides the green's dark fix is dropped with the green, so burgundy warns for dark screens with its fix. Kept unchanged as the record of what the owner saw when they answered A (2026-10-20); its left side is the behaviour now decided |
| `15-hand-set-and-dark-warnings-light.png` | Left: Bar Lucía with the cream page saved, the sage typed for Secondary text and her green's dark fix not yet taken — two warnings, the sage's under its row with **Use #526a5b**, the green's under Brand colour with **Use #417c59 on dark screens**, and "2 colours are hard to read. · Fix all" above the buttons. Right: the same after Fix all, the sage row showing "Light screens: fixed from #8fa898 · Undo" until the editor closes. Replaces `15-q2-hand-set-adjust-or-refuse-light.png`, which the owner saw beside 09 (in git history at 1f88662fb) |
| `16-save-hard-to-read-light.png` | Left: Save pressed with the lemon unfixed — the "Hard to read" dialog with Back, Save anyway and Fix and save. Right: after Save anyway — the lemon on the page and on a till's Pay button, and the warning line on the saved card |
| `17-logo-editor-{light,dark}.png` | The editor just after Bar Lucía uploads her logo: the Logo field with Replace and Remove, "+ Add a version for dark screens" with its hint, and the preview's banner strips — the logo on the light panel, on a plate on the dark one. The dashboard around the card still shows Waitron's lockup: the logo is not saved yet |
| `18-logo-editor-phone-light.png` | The same at 390 px |
| `19-logo-dark-plate-or-version-dark.png` | Dark screens, the banner and a till bar: with one image, drawn on a plate (left); with a second image for dark screens (right) |
| `20-logo-banner-{light,dark}.png` | After Save: the banner shows her logo before "BAR LUCÍA S.L." (on a plate in dark), and the saved card's Logo row says "Dark screens: on a light plate" |
| `21-logo-till-{light,dark}.png` | A till counter screen with her logo in the bar's first place |
| `22-logo-sign-in-{light,dark}.png` | The dashboard's sign-in page and a till's sign-in screen with her logo, and "Powered by" with Waitron's lockup under each (Q6 A) |
| `23-q5-logo-on-receipts-light.png` | Q5's options side by side: A, one upload that also prints, with "How it prints" and a receipt carrying the real 80 mm dots of her logo; B, screens only and a receipt with no logo, as today; C, a second upload for receipts |
| `24-q6-waitron-logo-light.png` | Q6's options side by side, each as the dashboard's sign-in page and a signed-in till bar: A, her logo in Waitron's place and "Powered by" on the sign-in page; B, the same without "Powered by"; C, both logos |

## 19. Questions for the owner

**Q1 of 4 — How much can the owner change? ANSWERED 2026-10-19:** "A by default, with advanced
access to B. Also this should be in settings rather than venue". Folded in: the three choices are
the default, and an Advanced section, closed until opened, offers 22 colours by hand (the 23 less the
see-through shade behind dialogs; section 5); the card moves to a new Appearance page in the side
menu's Settings section (section 4). It raised one extra question, answered below.

**Extra question (from the Q1 answer) — When the brand colour changes, what happens to colours set
by hand? ANSWERED 2026-10-20** (about 01:55, through the watcher): **A — hand-set colours are
kept**, with the note naming them, "Use worked-out colour" on each row and "Reset all to
worked-out". Folded in: section 4, step 6, and section 6; B is in section 16 as the branch not
taken. Picture `14-q-hand-kept-or-put-back-light.png` is kept as what the owner saw. The question
as asked: Bar Lucía's manager has set the light page to the bar's cream by hand. Later she changes
the brand colour from green to burgundy. With A, the cream page stays, still marked "Set by hand",
and a note under the brand colour says "You set 1 colour by hand, and it is kept: Page (light).
Advanced shows it."; one tap ("Use worked-out colour") gives her the burgundy-tinted page instead.
With B, changing the brand colour (or the background) puts every colour set by hand back to worked
out, and a note says which; Cancel still brings them back. Either way, Waitron still checks every
colour: under A, a kept colour that is hard to read beside the new brand colour shows a warning with
its fix under its row, like any other (Q2's answer). A fix she took for the old brand colour is not
a colour set by hand and goes with the old colour either way: in the picture, burgundy warns for
dark screens afresh. Pictures: `14-q-hand-kept-or-put-back-light.png` (and `12-advanced-light.png`).

- **A (recommended; chosen):** colours set by hand are kept until she puts them back herself.
- **B:** changing the brand colour or background puts them all back.

**Q2 of 4 — What happens when a chosen colour would be hard to see? ANSWERED 2026-10-19** (about
16:00, through the watcher; the owner chose "Stop here — I'll write" on the A/B picker): "Don't
refuse, this is easy to fix. Instead show the warning and offer to fix automatically". Neither A
(silent adjustment) nor B (refusal). Folded in: a colour that is hard to read — the brand colour in
either mode, or one set by hand — is shown as picked with a warning beside it and a one-press fix,
the shade the earlier design would have moved it to (section 4, step 5; section 9); it is never
refused. A fix is a draft change; Fix all takes every fix; Save asks once while a warning is
unfixed, with Fix and save, Save anyway and Back (my call, section 9: the owner said not to refuse,
so I did not ask again); the server stores a valid choice as sent and reports its warnings,
`theme.invalid` now meaning only "not valid" (section 11). Pictures: `04-hard-to-read-light.png`,
`05-fixed-light.png`, `15-hand-set-and-dark-warnings-light.png`, `16-save-hard-to-read-light.png`;
`09-q2-adjust-or-refuse-light.png` is kept as what the owner saw.

**Q3 of 4 — One look for the whole business, or one per kind of device? ANSWERED 2026-10-20**
(about 01:50, through the watcher): **A — one look for the whole business.** The owner raised no
objection to the reading of the Q2 answer sent with it (the warning with a one-press fix; Save
asking once, with Fix and save, Save anyway and Back). Folded in: section 11's single row, which
also holds the one logo; B is in section 16 as the branch not taken. Picture
`10-q3-one-theme-or-per-device-light.png` is kept as what the owner saw. The question as asked: Bar
Lucía has bar tills and terrace handhelds. With A there is one look, and every till and dashboard
shows it. With B the owner can save several looks ("Bar" in green, "Terrace" in blue) and each
device profile picks one, so the terrace handhelds look different from the bar tills. Each look
then has its own colours set by hand and its own fixes too, so with two looks there are two Advanced
lists to keep.
Pictures: `10-q3-one-theme-or-per-device-light.png`.

- **A (recommended; chosen):** one look for the whole business.
- **B:** several named looks, each device profile chooses one.

**Q4 of 4 — Should the look also make text bigger?**
A waiter at Bar Lucía finds the till's text small. With A, the look changes colours and corners
only, and bigger text becomes a separate item that can be tested screen by screen. With B, the card
gains "Text size: Standard / Large", and Large makes all text on every till and dashboard about 30%
bigger at once, so longer names wrap (in the picture "Tinto de verano" takes two lines). Pictures:
`11-q4-text-size-light.png`.

- **A (recommended):** no text size in the look; bigger text is its own later item.
- **B:** a Text size choice on the card, Standard or Large.

**Q5 — Should the new logo also print on receipts?** (asked with the logo design, 2026-10-20)
Today each department sets its own receipt logo on its Receipt tab, and a department without one
prints none (section 3). A receipt printer prints black dots only: a colour logo comes out in grey
dots, and a white or pale one comes out faint or blank (section 8a). Bar Lucía uploads her green
logo for the screens; her bar department has no receipt logo of its own. With A, the bar's receipts
and A4 invoices print her logo in dots from then on — in the picture its words are readable — and
the Look card shows how it prints; if she wants something else on paper, she sets a receipt logo on
the department, and that wins. With B, the logo is for screens only, and the bar's receipts stay
without a logo until she sets one on the department, as today. With C, the Look card has two
uploads, one for screens and one for receipts, and the receipt one prints wherever a department has
none. Pictures: `23-q5-logo-on-receipts-light.png`.

- **A (recommended):** one upload; it also prints wherever a department has no receipt logo. One
  upload covers the usual venue with one logo, the department's own receipt logo already gives paper
  a different picture where one is needed, and the printing code was written to fall back to a venue
  logo (section 3).
- **B:** screens only; receipts stay as they are.
- **C:** two uploads on the Look card, one for screens and one for receipts.

**Q6 — When a venue sets its logo, what happens to Waitron's?** (asked with the logo design,
2026-10-20) Today the top of the dashboard shows Waitron's logo and then "BAR LUCÍA S.L.", and the
till's top bar starts with the word "Waitron". With A, Bar Lucía's logo takes Waitron's place in
both, and the dashboard's and the till's sign-in screens show a small "Powered by" line with
Waitron's logo under the form. With B, her logo takes Waitron's place and Waitron's logo is gone
from her screens; it stays only in the browser tab's icon, the installed till's icon, setup, the
trust page and the user guide. With C, both logos show side by side, Waitron's first. Pictures:
`24-q6-waitron-logo-light.png` (and `22-logo-sign-in-{light,dark}.png` for A's sign-in screens).

- **A (recommended):** the venue's logo in Waitron's place; "Powered by Waitron" on the sign-in
  screens. The working screens are the venue's, and Waitron is still named where it takes no working
  space: the till bar is short of room already, and leaves out the word "Waitron" first when it runs
  out.
- **B:** the venue's logo in Waitron's place, with no Waitron logo on the venue's screens.
- **C:** both logos side by side.
