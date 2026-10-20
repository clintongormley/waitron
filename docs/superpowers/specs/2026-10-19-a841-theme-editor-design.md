# A841 — a theme editor: design

Status: design. Revised after review rounds 1 and 2; after the owner's answer to Q1 (2026-10-19: "A
by default, with advanced access to B. Also this should be in settings rather than venue") and
review round 3; after the answer to Q2 (2026-10-19: "Don't refuse, this is easy to fix. Instead show
the warning and offer to fix automatically"); after review round 4 of that revision; and after the
owner's answers of 2026-10-20, through the watcher — Q3, one look for the whole business, and the
extra question, colours set by hand are kept — and their request the same night: "Also we should
allow uploading a new logo" (section 8a); and after their answer to Q4 the same night, with what
followed it — a text-size slider, text set by hand under Advanced, Advanced folded into sections,
and saved **custom themes** (sections 5a and 8b); then fixed after review round 6 (long words and
hyphenation, Google's button, rounding, the storage shape, the name dialog) and round 7 (which
language the till hyphenates in, and English, which Chromium does not hyphenate); and after the
owner's answers of 2026-10-20 to Q5 to Q8, through the watcher (section 19): the logo also prints on
paper where no department receipt logo applies (Q5 A); the venue's logo takes Waitron's place, with
"Powered by Waitron" under both sign-in forms (Q6 A); uploaded font files come later as their own
item (Q7 B); and, replacing a first Q8 answer, every custom theme has a light version and a dark
version that switch with each screen's Theme setting, which keeps its name (Q8, revised). **The
design is final; the build plan is next.** Backlog: A841 (owner, 2026-10-17).
Builds on A681 (#1842), the per-browser Light / Dark / Follow device choice. Mock-ups:
`docs/backlog/mockups/a841-theme-editor/`.

A note on words. A **token** is one of Waitron's named style settings, written `--wt-…` in the code:
`--wt-color-primary` is "the colour of main buttons", `--wt-radius-md` is "how round a normal
corner is". The dashboard's and the till's shared components paint from tokens (the guards in
section 3 hold them to it), so changing a token's value repaints everything that reads it. A
**knob** in this document is one simple choice the owner makes (a colour, "Round corners") from
which many token values are worked out. **Contrast** is how far apart two colours are in brightness,
written as a ratio such as 4.5:1; a higher number is easier to read. A theme's **light version** and
**dark version** are its two halves: the colours (and logo image) a screen shows when it is light,
and those it shows when it is dark. **Theme**, with a capital, is also the name of the existing
Light / Dark / Follow device setting in the account menu and on the till (section 3), which decides
which version a screen shows; it keeps that name (Q8, section 19).

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
- Every custom theme has a **light version and a dark version** (owner, Q8 revised, 2026-10-20:
  "custom light and dark themes which will continue to switch with follow device"). Both are worked
  out from the same choices, so the owner never has to pick a dark-screen colour; each can be given
  its own colours where the owner wants (section 7). Each screen shows the version its own Theme
  setting picks — Light, Dark, or Follow device, which follows the device's light or dark mode.
- For the owner who wants one colour exactly, an **Advanced** section, closed until opened, lets them
  set any of 22 colours by hand, each with its own light and dark value (owner, Q1, 2026-10-19;
  section 5).
- Every colour Waitron works out passes every contrast rule Waitron's own palette is tested against,
  plus Waitron's own button rules (section 9). A colour the owner picks — the brand colour, or one
  set by hand — that fails one is never refused: it shows a warning with a one-press fix (owner, Q2,
  2026-10-19; section 9).
- The owner can upload the venue's own logo on the same card, with an optional second image for the
  dark version. It takes the place of Waitron's logo at the top of the dashboard and in the till's
  top bar, shows on both sign-in screens with a small "Powered by Waitron" line under the form (owner,
  Q6 A), and prints on receipts and A4 invoices wherever no department receipt logo applies (owner,
  Q5 A; section 8a).
- One **Text size** slider on the same card makes text bigger on every till, handheld and the
  dashboard at once, in steps, up to the largest size the till's busiest screens were measured at
  (owner, Q4, 2026-10-20; section 5a).
- Under Advanced, the owner can also set the typeface (one of the device's own fonts), each of the
  four text sizes and each of the three weights by hand, and Advanced is folded into sections so its
  long list stays manageable (owner, Q4 and Q7; section 5a).
- The owner can save the whole look under a name as a **custom theme**, keep several, and switch
  the whole business from one to another; only one is in use at a time, the same on every device
  (owner, 2026-10-20; section 8b).
- Open dashboards and signed-in tills pick up a saved theme, or a switch to another, without a
  reload (section 12).
- "Use Waitron's look" gives exactly Waitron's own colours, text and logo back in the draft.

Non-goals (not in A841; each could be its own item later)

- Font files the venue uploads: wanted, but designed and built after A841 as their own item (owner,
  Q7 B: "designed and built after this"), with its own backlog entry; A841 leaves a seam for them
  (section 5a). Line heights and letter spacing (section 5a).
- The favicon, the installed till's icon and the till's browser-bar colour (sections 8 and 8a).
- A look per device or per device profile: one theme is in use at a time, everywhere (owner, Q3
  and 2026-10-20: "And the same look in all devices").
- Importing or exporting one theme as a file: themes travel only inside a configuration copy
  (section 11).
- Colour on receipts, kitchen tickets and anything else a printer prints (section 8). The venue's
  logo does print, in black dots, where no department receipt logo applies (Q5 A, section 8a).
- The server's own pages: the trust page, the user guide pages, the recovery page. Their colours
  stay Waitron's, and none of them shows the venue's logo.
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
- Become a second, hand-kept copy of Waitron's default colours or type: a venue's theme stores only
  the owner's choices — the logo, the three main choices, the text size, any fix they took and any
  colour or text setting they set by hand — and everything else is worked out from the current
  release's defaults (section 11). (It also keeps the logo's printed dots, which are drawn from the
  logo, not copied from Waitron; section 8a.)

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
  (`packages/db/src/classification.ts:141`); copied with a venue's configuration
  (`packages/db/src/configuration-transfer.ts:72`). Every core table but `change_log` and
  `node_sealed_state` is a live-update source (`classification.ts:256-259`), so it already is one.
- The document is `{ tokens: Record<string, string> }`, checked by `validateThemeOverride`
  against a seven-name allowlist `THEMEABLE_TOKENS` — primary, on-primary, surface, text, danger,
  `--wt-radius-md`, `--wt-font-family` — and a value pattern that excludes `; { } : < > " ' \`
  (`packages/layouts/src/theme.ts:3-52`). Its refusals are `theme.invalid` with `reason`
  (`not_object`, `bad_tokens`, `unknown_token`, `bad_value`, `too_long`) and, for the last two,
  `token` (`theme.ts:32-47`; the code is registered at `packages/layouts/src/errors.ts:45`).
- `getTenantTheme` / `putTenantTheme` (`packages/layouts/src/theme-store.ts:13-35`) behind
  `GET` and `PUT /management-api/theme`, both gated by `layout.configure`
  (`apps/server/src/management-api.ts:1260,1274`, `theme-store.ts:23-26`), pinned by
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
- **The till draws no logo image on its own screens.** Re-read on main 6515785a2 for the Q6 answer:
  the word "Waitron" in bold, "The product WORDMARK: a fixed name, never translated UI copy"
  (`apps/till/src/widgets/till-shell.ts:33-34`, styled at `:148-152`), is drawn first in the bar
  only on a handheld (the `phone-portrait` and `tablet-landscape` form factors, `apps/till/src/layout.ts:21`)
  that is above phone width, has no item other than Find bill moved into its menu and is not shrinking its bar
  (`till-shell.ts:996`). **A counter till (form factor `till`) has drawn no word since #1905** (A738,
  2026-10-20): that change added `this.formFactor === "till" ||` to the condition
  (`git log -S'this.formFactor === "till" || this.steps > 0'` names only d99a9f403), and the counter
  till's bar holds the till strip of tabs, Parked and Waiting, transfers and the kitchen pass instead
  (`till-shell.ts:997-1006`). The till form factor runs none of the handheld's measuring
  (`till-shell.ts:423,589`). The kiosk and kitchen-display modes draw no bar (`till-shell.ts:990-993`).
  The sign-in screen shows the device's name, or "Choose your name", above the list of people, and
  no logo (`apps/till/src/screens/till-lock-screen.ts:310-335`). Pictures 06 and 11 drew "Bar
  Lucía" in the bar's first place; 06 was then redrawn with the word, and is redrawn again without
  it (section 18).
- **The trust page** inlines a copy of Waitron's lockup, which "must stay one self-contained string
  with nothing to fetch" (`packages/ui/brand/README.md:40-41`;
  `apps/server/src/trust-page-logo.ts:12`, `trust-page.ts:120-124`). Setup draws the lockup inline
  too (`README.md:49`).
- **The favicon and the installed till's icon** are Waitron's files in `packages/ui/brand/public/`,
  served by all three apps (`README.md:16-25`; `ls packages/ui/brand/public` printed
  `apple-touch-icon.png favicon.ico favicon.svg icon-192.png icon-512.png`). The till's manifest
  names `/icon-192.png` and `/icon-512.png` and is written when the app is built
  (`apps/till/src/manifest.ts:3-17`, `apps/till/vite.config.ts:14-20`).
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
  products, variants, sections, include folders, menu versions and department receipt logos, in a
  typed list (`ImageUsage`, `images.ts:53`) and two counters that "must stay
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

**Type today** (read for the Q4 answer, 2026-10-20, on main bede6d9b3).

- `structure.css` declares ten type tokens: three typefaces — `--wt-font-family` (the device's own
  sans-serif, `system-ui, -apple-system, "Segoe UI", sans-serif`, line 17), `--wt-font-family-mono`
  (18) and `--wt-font-family-google` (20, Google's sign-in button only, by Google's branding
  guidelines, 19) — four sizes, `--wt-font-size-sm|md|lg|xl` at 12, 14, 18 and 22 px (21-24), and
  three weights, `--wt-font-weight-normal|medium|bold` at 400, 500 and 600 (25-27). The only other
  type token is `--wt-google-button-line-height` (33), Google's button again. `git grep -nE --
  '--wt-(font|line|weight)[a-z-]*[[:space:]]*:'` over the `.ts` and `.css` files of `apps` and
  `packages`, less `structure.css`, found one line, `--wt-line-course-field-height`
  (`apps/till/src/widgets/modifier-picker.ts:91`), a field's height, not type.
- How often each is read: `git ls-files 'apps/*.ts' 'packages/*.ts'`, less `*.test.ts`, searched
  for `var(--wt-<token>)`, counted sm 262, md 70, lg 103, xl 30, normal weight 35, medium 13, bold
  261, the typeface 11, mono 7 and Google's 1.
- A size written as a number rather than a token: the same files searched for
  `font-size: <number>(px|rem|em)` found 7 lines in 3 files — the print agent's setup page
  (`apps/print-agent/src/setup-page.ts:75-79`), the trust page (`apps/server/src/trust-page.ts:100,112`)
  and one on the till, `font-size: 4rem` (`apps/till/src/screens/till-enrol-screen.ts:67`). A line
  height is never a token: the same search for `line-height:` found literal values (`1`, `1.2`,
  `1.25`, `1.5`) in 9 declarations and token sums in 5. A weight written as a number: the search
  for `font-weight:` followed by three digits found 7 lines, five on server and print-agent pages
  the theme does not reach and two on themed screens, the till's bill
  (`apps/till/src/widgets/basket.ts:293`) and `apps/dashboard/src/screens/payments-screen.ts:215`,
  both `600` (slice 11 moves those two to tokens).
- `design-system.md:486-488`: "The type scale is 12px, 14px, 18px and 22px … in each device's own
  system font", and "The only font file any app bundles is Google Sans Medium, which the dashboard
  uses on its Google sign-in button alone".
- A slider primitive exists: `wt-slider`, "A labelled whole-number range that shows its value", with
  `label`, `name`, `min`, `max`, `step` and `value` (`packages/ui/src/components/wt-slider.ts:7,52-57`).
- The equipment label copies `--wt-font-family`, `--wt-font-size-md`, `--wt-font-size-xl` and
  `--wt-font-weight-bold` from a frame it marks as a theme root
  (`apps/dashboard/src/widgets/equipment-label.ts:44,52-59`), and the recovery sheet copies the
  typeface, the mono typeface and the md and xl sizes among its twelve
  (`node-recovery-print.ts:11-27`).

**The word "Theme" today** (line numbers re-read on main 6515785a2). The dashboard's string
`theme.label` is "Theme" ("Tema" in Spanish; `apps/dashboard/src/i18n/strings.ts:808,3858`). It is
drawn as the visible heading of the Light / Dark / Follow device buttons in the account menu
(`dashboard-app.ts:1807-1811`, through `themeChoices`, `packages/ui/src/theme-choices.ts:72`, its
labels from `dashboard-app.ts:1003-1008`), and names the signed-out page's chooser for screen
readers, as "Theme: Light" (`packages/ui/src/components/wt-theme-chooser.ts:122`). The till has its
own `theme.label`, "Theme" and "Tema" (`apps/till/src/i18n/strings.ts:460,2103`), used in the
person's menu (`apps/till/src/widgets/till-shell.ts:837-841`) and in the chooser of the sign-in
screen, the enrol screen and the language corner (`till-lock-screen.ts:313`,
`till-enrol-screen.ts:191`, `till-shell.ts:992`, all through `apps/till/src/widgets/theme-chooser.ts:6-23`).
Q8's revised answer keeps all of these as they are (section 19).

**A folding section already exists.** `wt-disclosure` is a shared section with a heading that
opens and closes it, a `summary` line shown while it is closed, and `has-error`, which forces it
open while it holds a validation error (`docs/developers/design-system.md:708`).

**How settings reach an open dashboard.** A dashboard read names the tables it depends on
(`apps/dashboard/src/api/live-queries.ts:523`, `getVenueDefaults: ["locations",
"catalogue_settings"]`), and the server's change feed is built from each migration set's change
sources at start (`apps/server/src/boot.ts:1459-1466`).

**How settings reach an open till.** `GET /api/till` is unauthenticated (`apps/server/src/
till-api.ts:1427-1442`, re-read on main 8c3d8abed). It answers `readTillSetup`
(`apps/server/src/till-setup.ts:17-110`), plus `setupRevision`, a hash of `readTillSetup`'s answer
(`till-setup.ts:115-118`), plus `servers`, added outside that hash (`till-api.ts:1436-1440`).
`/api/menu-state` repeats the revision, running `readTillSetup` again on every call
(`till-api.ts:1563`). A signed-in till polls menu state every 15 s
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
   The page holds two cards: **Look**, the theme in use, and under it **Themes**, Waitron's theme
   and the venue's custom themes (section 8b). Read-only, the Look card lists "Theme in use" (its
   name, or "Waitron"), Logo ("None", or the image and how dark screens show it, section 8a),
   Brand colour (a swatch and the value), Background, Corners, Text size ("100% (standard)", or the
   step), "Colours set by hand" ("None", or the names, such as "Page (light)") and "Text set by
   hand" ("None", or the names, such as "Small text"), with one line under them: "Applies to the
   dashboard and every till. Each screen shows this theme's light or dark version, as its own Theme
   setting says: Light, Dark or Follow device." A fix the owner took shows in the Brand colour row ("Custom ·
   #1e5b3a · dark screens #417c59", the shade the fix paints; a fix is only ever stored where it
   paints, section 11), and so does a button colour of the dark version's own ("· dark screens
   #5fa77a, set by hand", section 7); a warning saved with "Save anyway" shows as a line under the
   rows (step 7). Mock-up `01-appearance-card-{light,dark}.png`.
2. **Edit** opens the card in place, like the Defaults card. A line under its heading names what
   is being edited: "Theme in use: Bar Lucía. Saving changes every screen." (editing a theme that
   is not in use, section 8b, says "Not in use. Saving changes no screen until you use it.").
   Left: the **Logo** field (section 8a),
   the three main choices, the **Text size** slider (section 5a), and under them the closed
   **Advanced: set colours and text by hand** section,
   whose closed line says "None set by hand. Waitron works out every colour and text size." or names the ones that
   are (`wt-disclosure`'s `summary`, section 3). Right: **Preview**, under the line "Each screen
   shows one version, as its own Theme setting says: Light, Dark or Follow device.", the theme's two
   versions side by side, one panel headed "Light version" and one "Dark version" — this is how the
   editor shows the pair (section 7) — each showing a strip like the banner (the logo, or Waitron's lockup while there is
   none, and the legal name), a sidebar item, a field with focus, Save and Cancel buttons, a switch,
   a link, a two-way choice, and a till product button with a bill line, painted with the draft at
   the draft's text size. Beside Save, **Save as new theme…** stores the draft under a new name
   (section 8b). Mock-up `02-editor-{light,dark}.png` (Bar
   Lucía has taken the fix for dark screens, so a line under Brand colour says "Buttons on dark
   screens: #417c59 · Undo"); under it a link, **Pick a different colour for dark screens**, gives
   the dark version a button colour of its own (section 7); at phone width the preview goes below the
   choices, the light version above the dark (`03-editor-phone-light.png`).
3. **Advanced, opened**, shows five folding sections (owner, Q4: "Put choices behind collapsible
   sections"; section 5a says how they are grouped, what is open and what is remembered): four of
   colours — Page and surfaces, Text colours and links, Buttons, Fields and focus — and **Text**.
   Together the four colour sections list the 22 colours of section 5 in plain words ("Page", "Cards",
   "Secondary text", "Main buttons", "Focus ring" …), one row each, with a Light and a Dark value —
   the light version's colour and the dark version's, side by side.
   Each value shows its colour and its six-digit code. A worked-out value says "Worked out"; Main
   buttons says "Brand colour" where it is the brand colour as picked, and "Fixed" where the owner
   took the brand colour's fix for that kind of screen (step 5). Setting Main buttons by hand for a
   mode replaces the brand colour's fix for that mode: the fix leaves the draft, so the stored look
   never holds a fix that paints nothing, and **Use worked-out colour** on that row goes back to the
   brand colour as picked, with its warning and fix offered again (round 4). A value set by hand is
   drawn in bold with a **Set by hand** tag and a **Use worked-out colour** link that puts it back.
   Changing a value (a colour picker or the code) sets it by hand. Light and dark are separate:
   setting the light page leaves the dark page worked out. **Reset all to worked-out** at the end of
   Advanced puts every colour and every text setting back. Mock-up `12-advanced-{light,dark}.png`,
   Bar Lucía's light page set by hand to cream `#f8f1e1`, with Page and surfaces opened; at phone
   width each row stacks its name, its Light value and its Dark value
   (`13-advanced-phone-light.png`). The **Text** section's rows are section 5a's. Advanced stays
   closed each time the editor opens
   (my call: the closed line already says what is set by hand), except that it opens itself while
   one of its values holds an error (`has-error`, section 3), and so does the section holding it. A
   warning (step 5) is not an error and does not open either; each closed line ends with "· {n}
   hard to read" instead (my call).
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
   sit under its row ("Light screens: hard to read on Selected item, Field background,
   Switched-off field background and the 15 station colours." with **Use #526a5b**); pressing it replaces the hand-set value
   with the fixed shade and shows "Light screens: fixed from #8fa898 · Undo" until the editor
   closes. When two or more warnings with a fix show, a line above the form's buttons says "2
   colours are hard to read." with **Fix all** (`15-hand-set-and-dark-warnings-light.png`). The
   colour is never refused, and a warning never disables Save (section 9 says how the fix is found,
   and what has no fix).
6. **Changing a main choice keeps the colours set by hand** (owner, the extra question, 2026-10-20:
   "A — hand-set colours are kept"; section 19). When any are set, a note under Brand colour says so
   after a change: "You set 1 colour by hand, and it is kept: Page (light). Advanced shows it."
   (mock-up `14-q-hand-kept-or-put-back-light.png`, left). A fix to the brand colour is not a colour
   set by hand: picking another brand colour drops it, because it belonged to the old colour (my
   call).
7. **Save** stores the choices. With no warning showing it saves at once. With a warning still
   unfixed it first asks, once, in a small dialog headed "Hard to read" that lists each warning,
   with **Back**, **Save anyway** and **Fix and save** (`16-save-hard-to-read-light.png`, left). Fix
   and save applies Fix all and saves; it is offered when running Fix all on the draft would leave
   no warning, even if a warning has no fix of its own (lane A ruling 2026-10-20). Save anyway
   stores every colour as picked; Back saves nothing. When Fix all would leave a warning, the dialog
   offers only Save anyway and Back, so a colour with no fix reaches the tills only by Save anyway. The
   dashboard that saved repaints at once; other open dashboards and signed-in tills follow (section
   12). A warning saved with Save anyway stays on the saved card, under its rows ("Buttons in the
   brand colour are hard to see on light screens."), for whoever opens the page next
   (`16-save-hard-to-read-light.png`, right). **Cancel** drops the draft.
8. **Use Waitron's look** sets the draft back to Waitron's choices — the brand colour "Waitron's",
   Neutral, Standard corners, text size 100% — drops any fix, **puts every colour and text setting
   set by hand back to worked out**, since a look with a hand-set colour is not Waitron's, **and
   removes the logo**, for the same reason (section 8a). Save then stores the theme being edited
   with Waitron's choices, which paint exactly Waitron's own token values and Waitron's own logo.
   It does not save by itself, so Cancel still undoes it (my call: one way of saving on the card).
   Before custom themes, Save here deleted the venue's row; now putting **Waitron's theme itself**
   in use is the Themes card's **Use on every screen** on its row, which leaves the custom theme
   saved (section 8b).

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
| Advanced heading | Advanced: set colours and text by hand |
| Advanced, closed | None set by hand. Waitron works out every colour and text size. / {n} set by hand: {names} |
| Advanced's sections | Page and surfaces · Text colours and links · Buttons · Fields and focus · Text |
| A section, closed | None set by hand / {n} set by hand: {names} · … · {n} hard to read |
| Text size slider | Text size · {n}% · hint: 100% is Waitron's standard size. Larger text wraps long names onto more lines. |
| Under the slider | Text on screens: small {n} px · normal {n} px · large {n} px · largest {n} px |
| Saved card rows | Theme in use: Waitron / {name} · Text size: 100% (standard) / {n}% · Text set by hand: None / {names} |
| Text rows (section 5a) | Typeface · Small text · Normal text · Large text · Largest text · Normal weight · Medium weight · Bold weight |
| A text value | Worked out · Set by hand · Use worked-out size / Use worked-out typeface / Use worked-out weight · at {n}%: {n} px |
| Typeface choices (device fonts only, Q7) | The device's own · Serif |
| Too small, under its row | {name}: {d} px is smaller than 12 px; text that small is often hard to read. · Use {s} px ({f} px at {step}%) — {d} the size drawn, {s} the size the fix stores, {f} the size it draws; the bracket is left out at 100% |
| A text size refused | Enter a whole number from 8 to 40. |
| Larger than checked, under its row | {name}: {d} px is larger than Waitron checks the tills at; long names may wrap more or be cut off. · Use {s} px ({f} px at {step}%), the same placeholders |
| Editor, under the heading | Theme in use: {name}. Saving changes every screen. / Not in use. Saving changes no screen until you use it. |
| Editor, beside Save | Save as new theme… |
| Themes card (section 8b) | Themes · New theme · Waitron (built in) · In use · {n} hard to read |
| A theme's row menu | Use on every screen · Edit · Rename · Make a copy · Delete |
| Advanced, opened | A colour you set here stays as you set it when you change the brand colour, background or corners. A text size you set here grows and shrinks with Text size. Waitron still checks both can be read. |
| Advanced columns | Colour · Light screens · Dark screens |
| A value | Worked out · Set by hand · Use worked-out colour |
| Advanced, end | Reset all to worked-out |
| After a main choice changes (one) | You set 1 colour by hand, and it is kept: {name}. Advanced shows it. |
| After a main choice changes (several) | You set {n} colours by hand, and they are kept: {names}. Advanced shows them. |
| Colour choices | Waitron's · Custom |
| Preview | Preview |
| Reset | Use Waitron's look |
| Note | Applies to the dashboard and every till. Each screen shows this theme's light or dark version, as its own Theme setting says: Light, Dark or Follow device. |
| Brand colour warning | Buttons in this colour are hard to see on {light / dark} screens. |
| Its fix | Use {colour} on {light / dark} screens |
| After the fix | Buttons on {light / dark} screens: {colour} · Undo |
| Hand-set warning, under its row | {Light / Dark} screens: hard to read on {names}. / {Light / Dark} screens: {names} hard to read on it. |
| Its fix | Use {colour} |
| {names} in a warning | Each colour by its plain name, except the station colours: the station fills a value fails against are one item, "the 15 station colours" when all fifteen and "{n} station colours" otherwise, and its station dots likewise "the 15 station dots" or "{n} station dots"; the item stands where the first of them would (lane A ruling 2026-10-20, fills and dots) |
| No shade passes, under its row | {Light / Dark} screens: no shade of this colour can be read on {names}. Pick another colour. / {Light / Dark} screens: no shade of this colour lets {names} be read on it. Pick another colour. When other colours set by hand block every shade (the warning's `blockedBy`), the sentence ends "… while {name} is set by hand to {colour}." instead of "Pick another colour.", naming each, joined with "and" (lane A ruling 2026-10-20) |
| Two or more fixes, above the buttons | {n} colours are hard to read. · Fix all |
| Advanced, closed, with a warning | … · {n} hard to read |
| Save dialog | Hard to read · one line per warning: "Brand colour: buttons are hard to see on {light / dark} screens." / "{name} ({light / dark}): hard to read on {names}." / "{name} ({light / dark}): {names} hard to read on it." / "{name} ({light / dark}): no shade can be read." / "{name} ({light / dark}): no shade can be read while {name} is set by hand to {colour}." · Back · Save anyway · Fix and save (offered when Fix all would leave no warning) |
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
| Dark version refused by the server (no main image) | Add the main logo before a version for dark screens. |
| Sign-in screens, with a venue logo (Q6 A) | Powered by {Waitron's lockup, alternative text "Waitron"} |
| Under the logo (Q5 A) | How it prints on receipts of departments with no receipt logo of their own. · This logo prints blank on receipts. |
| Preview, under its heading | Each screen shows one version, as its own Theme setting says: Light, Dark or Follow device. |
| Preview panels | Light version · Dark version |
| Under Brand colour, while the dark version has no own colour | Pick a different colour for dark screens |
| Under Brand colour, once it has | Buttons on dark screens: {colour}, set by hand · Use the brand colour (a link that wraps onto its own line drops the "·"; so does Undo) |
| Name dialog (Save as new theme, Make a copy, Rename, first save of Waitron's) | Name this theme · Name · Use it on every screen now · Back · Save |
| Name refused | A theme with this name already exists. / "Waitron" is the built-in theme's name. Pick another. |
| Switch dialog | Use {name} on every screen? · Every dashboard changes now, and every signed-in till within 15 seconds. · Text on the tills changes size too. · Hard to read: {lines} · Back · Use it |
| Name dialog's messages | Enter a name. · Use 60 characters or fewer. · Correct the highlighted fields to continue. |
| Delete dialog, theme in use | {name} is in use on every screen. Deleting it puts Waitron's theme on every screen. |

In the hand-set rows, {names} are the plain names (section 5) of the other colours in the rules the
value fails. The first form is used when the hand-set colour is drawn on the others (a text, a
line), the second when the others are drawn on it (a background). Fix and save appears when running
Fix all would leave no warning (lane A ruling 2026-10-20). The server sends keys, not these words (section 10); the browser words them
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
- **Spacing and tap size.** Spacing and the tap minimum are read from script by the components
  listed in section 3, and the tap minimum is an accessibility floor. The text size and the type
  set by hand are section 5a's (owner, Q4).

## 5a. Text size, and text set by hand

Added for the owner's Q4 answer (2026-10-20, through the watcher): "More granular. Allow a slider
for text sizes, but under advanced also allow overwriting the font faces, size etc for each place we
set it. Put choices behind collapsible sections to make all of the advanced choices more
manageable". Every call here is mine except which typefaces a theme may use, which is the owner's
Q7 (answered B, section 19: uploaded fonts wanted, as their own item after A841).

**How I read "each place we set it"** — where I read it differently from the watcher's note, which
said "each typographic token". The code sets type in several hundred places (section 3: about 800
reads), and all but seven of them, which section 3 lists, read one of ten named settings — three
typefaces, four sizes, three weights. I read "each place" as each of those named settings, since a size set for "Small text"
then reaches every place that uses small text, the way a colour set for "Page" does. The other
reading, one setting per screen element (the product button, the bill line, a table's name), would
need a new token for each element and every screen rewritten to read it; it is not in A841, and if
the owner meant it, it is its own item.

### The slider

- **On the Look card, after Corners: Text size, 100% to 130%, in steps of 5%** — seven positions,
  100% being today's sizes, with the slider's own value shown ("115%") and, under it, the four
  sizes it gives in whole pixels: "Text on screens: small 14 px · normal 16 px · large 21 px ·
  largest 25 px" at 115%. It scales the four size tokens together (12, 14, 18 and 22 px at 100%,
  `structure.css:21-24`) and nothing else: not spacing, not the 44 px tap minimum, not the product
  buttons' height. It reaches every till, handheld, kitchen screen (a kitchen screen in device mode at
  its next reload, section 12) and the dashboard, because it is part of the theme (section 12). The control is the existing `wt-slider` (section 3), `min` 100,
  `max` 130, `step` 5, `name` `textScale`.
- **Why no step below 100%.** Small text is already 12 px at 100%; under 12 px, Lighthouse says,
  text is "often difficult to read on mobile devices" (section 9); a smaller step would put every small label under it. The owner's
  waiter wanted text bigger, not smaller.
- **Why the top is 130%: measured.** A throwaway Vitest browser test in `apps/till` (Chromium from
  Playwright 1.64.1, macOS system fonts; deleted after the run, kept outside the repository as
  `a841-mockups-src/text-size-probe/a841t-probe.test.ts` with its output) rendered the real counter
  screen — the product buttons with "Tinto de verano con limón" among twelve drinks, and a bill of
  three lines — and the real floor screen's map and list with twelve tables, four named "Terraza
  {n}", at 1280 × 800 and 1024 × 768 (the sizes the till's own layout tests use,
  `till-counter-screen.layout.test.ts`) and 390 × 844, at 100%, 130% and 150%, by setting the four
  size tokens on the screen's theme root. It counted, per product button, the name's lines and
  whether the button cut its text off; per bill line, the name's lines and whether its name or total
  overflowed; and the page's height against the screen's. What a failing case would print: a
  `clipped true`, a page taller than the screen where 100% was not, or a word broken inside itself
  in the pictures. What it printed at 1280 × 800:
  - 100%: "Tinto de verano con limón" on 3 lines in an 84 px tall button; the bill's names on 2 to
    3 lines; page 800 px high.
  - **130%**: the same name on 3 lines in a 102 px button, nothing cut off; the bill's names on up
    to 4 lines, every word whole; page 800 px high, nothing scrolls.
  - 150%: buttons 111 px, still nothing cut off; but the bill's name column breaks words inside
    themselves ("Tortill / a / españ / ola", "Cerve / za sin / alcoh / ol") and the page grows to
    821 px on an 800 px screen, so the Park button's lower edge falls below it.

  At 1024 × 768 the counter stacks the bill under the menu and scrolls at 100% already (page 862
  px), and at 130% and 150% the probe reported nothing cut off. Two results in the first run were
  not measurements, and I withdraw them as such (round 6): the floor screen's check looked for
  `wt-table-token` elements and found none (it printed `tokens 0 … clipped 0` in every case, so
  "nothing clipped" was a reading taken where both answers look alike); what I know of the floor
  comes from looking at its screenshots, in which the list's table cards wrap "Terraza 4" and
  "Terraza 10" onto two lines at 100% and "Terraza 1" as well at 130%, and the map's names sit
  inside their squares at 150%. And at 390 × 844 the probe's page was 737 to 905 px wide with
  122 px product buttons — not the phone layout — so it measured nothing about phones; the till's
  own 390 px layout cases (below) are what will. Pictures
  `27-text-size-top-step-{light,dark}.png` are that probe's 1280 × 800 counter in Bar Lucía's look
  at 100% and 130%.
- **Long words (round 6).** The first run's longest words had eight letters ("Tortilla",
  "española"), so "every word whole" said nothing about longer ones. The round-6 reviewer's probe
  (`a841-review/round6-probe/r6-probe.test.ts`) adds a detector — a word counts as broken when its
  own text range draws on more than one line — and twelve common dishes with longer words
  (Hamburguesa, Champiñones al ajillo, Albóndigas, Berenjenas, Ensaladilla rusa …). I re-ran it,
  extended, as a throwaway test in `apps/till` (deleted; kept with its log as
  `a841-mockups-src/text-size-probe/round6/`), command `env -u AI_AGENT -u CLAUDECODE gtimeout 400
  pnpm exec vitest run src/a841d6-probe.test.ts` (16 passed), at 1280 × 800 in Chromium from
  Playwright 1.64.1 on macOS, in the system sans-serif and in the Serif stack as that Chromium draws
  it. What the failing case prints: `broken [<word>]`. What it printed:
  - Plain (today's CSS), system font: no broken word at 100%, 105% and 110%; at 115% and 120%
    "Hamburguesa" and "Champiñones" broken in their product buttons and in the bill; at 130%
    "Albóndigas" in the bill as well. The reviewer's 100% run of the same words printed none, the
    control that the detector does not invent breaks.
  - Plain, Serif: "Hamburguesa" and "Champiñones" already broken in the product buttons at 105%.
  - With `hyphens: auto` on the names and `lang="es"` on the screen: words still break at 115% and
    130% (the detector counts any word on two lines), but the screenshots, taken for the long-word
    set at 130%, show every break at a syllable with a hyphen — "Hambur-guesa", "Champiño-nes" in its
    button and "Champi-ñones" in the bill, "Albóndi-gas" (system), and "Berenje-nas", "Ensaladi-lla"
    (Serif). The plain run at 115% instead drew "Hamburguesa" split with no hyphen. Hyphenation also
    splits a word that plain CSS would have moved whole to the next line: the detector reported
    "verano" broken in the "Tinto de verano con limón" button at 115% and 130% in the system font,
    and in the Serif bill at 115%, where the reviewer's plain run of the same names reported none; no
    screenshot was taken of those names, so where the hyphen falls is not recorded. The computed
    `hyphens` read `auto`, so the style reached the names. The log prints `lang=-` in every case
    because its `closest("[lang]")` does not cross a shadow root; it does not mean the `lang` was
    missing — Chromium hyphenates only with a `lang` (below), so the hyphens in the screenshots show
    it reached the names.
  - **English is not hyphenated** (the round-7 reviewer's run, `/tmp/a841r7.4ifw/hy.mjs`, nine words
    in 70 px boxes with `hyphens: auto` and `overflow-wrap: normal`, where a word can take two lines
    only if the browser hyphenated it): in Chromium 156.0.8078.4 on macOS (Playwright 1.64.1),
    `es`, `es-ES`, `ca`, `fr`, `de` and `it` hyphenated, while `en`, `en-US`, `en-GB` and no `lang`
    left every word on one line; in Chromium 153.0.8010.12 on Linux (the Playwright 1.63.0 image,
    aarch64), `es` hyphenated and `en`, `en-US`, `ca` and no `lang` did not. With the till's own
    `overflow-wrap`, the `en` screenshot drew "Hambur / guesa", "Strawbe / rries", "Cheeseb / urger".
- **What the design does about it** — three ways weighed, with those numbers: (b) a lower top step
  does not help: the plain Serif run broke words at 105%, and the plain system run at 115%, so the
  top would have to be 110% in the device's font and 100% in Serif; (c) accepting mid-word breaks
  leaves "Hamburguesa" split with no hyphen in the bill at 115% (`d6.txt`: `bill "Hamburguesa" w 95
  broken [Hamburguesa]`; the "Tortill / a" of the first probe was at 150%); (a) **chosen:
  hyphenation**, keeping 130%. The build puts `hyphens: auto` on the product button's name and the
  bill line's name, and a `lang` on them. **Which `lang`:** a till's names carry no language — the
  button and the bill show the product's staff name, one plain string (`productName` and
  `lineProductName`, `apps/till/src/widgets/product-name.ts:22-27,34-36`, whose comment says it
  "takes no locale") — so the `lang` is the venue's default content language,
  `currentContentLanguages().defaultLanguage`, which the till already reads
  (`apps/till/src/state/working-order.ts:130`). That is an assumption: that staff names are typed in
  the venue's default content language. A name typed in another language is hyphenated by the wrong
  rules ("Strawbe-rries" under Spanish), and `apps/till/index.html` sets no `lang` today. **What
  happens in English** (my call, after the measurement above): Chromium does not hyphenate English,
  so a venue whose default content language is English keeps today's behaviour — long names break
  mid-word with no hyphen from 115% — and I keep 130% as the top for it too, rather than a top step
  that depends on the language. The reasons: which languages hyphenate differs between browsers
  (Catalan on the Mac, not on Linux), so a per-language top would need a list kept against browsers
  Waitron does not control; Waitron's venues are Spanish, where the default content language
  hyphenates; and the slider is the owner's to set, with the preview showing the wrap. The owner is
  told this in plain words. What it rests on: Chromium on macOS and Linux as above; WebKit and the
  tills' own browsers were not measured. The 150% result stands: its bill broke short words too, so 130% stays the top. Going
  higher needs the bill line laid out differently at large text first, which is a backlog item of its
  own, not A841. The build adds layout cases at 130% to the
  till's own suites — counter at 1280 × 800, 1024 × 768 and 390 × 844, the floor list and map, a
  bill with "Tinto de verano con limón" and "Champiñones al ajillo", a kitchen station's queue —
  checking nothing is cut off and the page fits, beside today's cases at 100%. **The hyphen
  assertion** applies only to the names that get `hyphens: auto` (the product button and the bill
  line), and tells the two kinds of break apart this way: the case sets `overflow-wrap: normal` on
  those names and asserts that no name overflows its box, so a word that takes two lines can only
  have been hyphenated (the reviewer's method, above); it runs with the content language Spanish,
  which Linux CI's Chromium does hyphenate (measured on 153 aarch64, not yet on the repository's
  1.64.1 x86-64 image, which the first CI run shows). Kitchen and floor names get no hyphenation in
  A841, so their cases do not assert it; and the dashboard's
  product editor already runs its phone-width cases at raised sizes larger than 130%
  (`design-system.md:615-623`).
- **The preview** applies the draft's text size to both panels and adds a till product button
  ("Tinto de verano con limón") and a bill line, drawn at the real pixel sizes, so the owner sees
  the wrap before saving (`25-text-size-editor-{light,dark}.png`, phone `26-…`).

### Text set by hand, under Advanced

The Text section of Advanced lists the type settings a manager may set by hand, one row each,
with a single value (type has no light and dark):

| Row | Token (`structure.css`) | Waitron's value | A value set by hand |
| --- | --- | --- | --- |
| Typeface | `--wt-font-family` (17) | the device's own sans-serif | "The device's own" or "Serif" (an uploaded font later, below) |
| Small text | `--wt-font-size-sm` (21) | 12 px | a whole number of pixels, 8 to 40 |
| Normal text | `--wt-font-size-md` (22) | 14 px | the same |
| Large text | `--wt-font-size-lg` (23) | 18 px | the same |
| Largest text | `--wt-font-size-xl` (24) | 22 px | the same |
| Normal weight | `--wt-font-weight-normal` (25) | 400 | 400, 500, 600, 700 or 800 |
| Medium weight | `--wt-font-weight-medium` (26) | 500 | the same |
| Bold weight | `--wt-font-weight-bold` (27) | 600 | the same |

"Etc" in the owner's words I read as typeface, size and weight (my call). Left out, each my call:
the code typeface `--wt-font-family-mono` (18), because it is used where characters are read one
by one, such as a key or a log line (`design-system.md:463`), and the only faces that keep that
working are other monospace faces; Google's typeface and line height (20, 33), which Google's
branding rules fix, as section 2 leaves Google's button colours alone — and, since round 6, the
Google button's size and weight too. Today that button reads `font-size: var(--wt-font-size-md)`
and `font-weight: var(--wt-font-weight-medium)` beside Google's own typeface and line height
(`apps/dashboard/src/screens/login-screen.ts:156-166`), so the slider and the Normal text and Medium
weight rows would reach it: at 130% its text would be 18 px (14 × 1.3 = 18.2, drawn whole) on Google's fixed 20 px line. Google's
guideline gives the button's type as "Font: #1F1F1F | Google Sans Medium | 14/20" (light and
neutral buttons; "#E3E3E3" for dark; <https://developers.google.com/identity/branding-guidelines>,
last updated 2026-07-07, fetched 2026-10-20 with `curl` and read as text). So the build adds
`--wt-google-button-font-size` (14 px) and `--wt-google-button-font-weight` (500) to
`structure.css`, outside the theme's list, and the Google button reads them instead; line heights and letter
spacing, which are not tokens at all (section 3) and would need tokens first; and weights under
400, whose thin strokes at 12 px would be the hard-to-read text the rest of this design guards
against. "Serif" is `ui-serif, Georgia, "Times New Roman", serif`; which serif each kind of till
draws I did not check, and the plan lists the devices' fonts.

**Device fonts now, and where uploaded fonts plug in later** (owner, Q7 B, 2026-10-20: "also
uploaded font files", "designed and built after this as their own item (licence, file size and
format questions to settle there)"). A841 offers only "The device's own" and "Serif". It builds the
typeface so that the later item adds a choice to the stored list, the CSS and the delivered
stylesheet without reshaping them; the editor's preview is the exception, below. The seam (my call
on its shape):

- **The stored choice** is `text.family`, a string from a fixed list, `"system"` or `"serif"`
  (section 11). The validity check reads that list from one exported constant, so the fonts item
  widens it — for example to `"font:<id>"` naming a stored font — in one place, and an unknown
  value stays `theme.invalid` with `field: "text.family"` until then.
- **One function turns the choice into CSS**: `typefaceStack(family)` in the shared derivation
  (section 6) returns the `font-family` value, `system-ui, …` or `ui-serif, Georgia, "Times New
  Roman", serif`. Nothing else in the tree maps a typeface choice to a font name, so an uploaded
  font is one more case there, ending in the device's sans-serif as its fallback.
- **The served stylesheet is whole text** (`/api/theme`'s `css`, section 12), and its hash covers it,
  so the later item can put an `@font-face` rule ahead of the three blocks, with `font-display:
  swap` (a till draws its own font until the file arrives and never waits for it), and every till
  and dashboard follows a change by the delivery A841 already builds. That holds because the
  delivered sheet is adopted by the whole page, as the token layer is when `applyTokens` is given
  the document's root (`packages/ui-core/src/tokens/index.ts:6-25`, section 12). Where the files
  live — the image library takes images only (section 3) — is the later item's question.
- **The editor's Typeface field** draws its choices from the same list, so a new font appears there
  without a new control. **Its preview is not ready for an uploaded font.** The preview panels draw
  the draft from a stylesheet inside the Look card's shadow root (section 10), and a font rule there
  does nothing. Measured with the round-9 reviewer's per-case probe, extended and re-run
  (`a841q8-design/font-probe/phases.mjs` in the campaign folder, output `phases-output.txt`;
  Playwright's Chromium 156.0.8078.4; a fresh page per case, font requests counted per page; a
  macOS script face served as `/venue.ttf`; a span inside a shadow root set in `"VenueFace",
  monospace` at 40 px): no rule, the control, 600 px and 0 requests; the `@font-face` rule in a
  sheet adopted by the shadow root, 600 px and 0 requests; the same rule in a sheet adopted by the
  document, 327 px and 1 request; `document.fonts.add(new FontFace(…))`, 327 px and 1 request. (The
  round-8 probe beside it, `fontprobe.mjs`, gives the same widths but counts requests for the whole
  page.) So the later item must register each font for the
  whole page — an `@font-face` rule in a page-level sheet, or `document.fonts.add(new FontFace(…))`
  — and let the preview use it from there. WebKit was not measured.

What the later item must settle, and A841 does not: the licence (Waitron cannot check one), the
preview's page-level font registration (above), the formats and size limit, where files are stored and how they are served, how a till caches them for
a restart without the box, and re-running the 130% layout cases and the hyphenation check in the
uploaded face (a wider face wraps sooner than the faces measured above). Its backlog entry is in
`docs/backlog.md`, under A841. The text-size reading the owner did not correct stands: the slider
is 100–130%, and "each place we set it" is the four shared text sizes.

A row works as a colour row does (section 4, step 3): changing it sets it by hand, drawn in bold
with a **Set by hand** tag and **Use worked-out size** (or typeface, or weight); **Reset all to
worked-out** at the end of Advanced puts it back with the colours; a hand-set value is kept when
a main choice changes (the owner's answer to the extra question, which I extend to text: nothing
about a brand colour bears on a text size). Each size row also shows the size the slider makes of
it ("at 115%: 16 px" for Normal text, 14 × 1.15 = 16.1).

**The slider scales a size set by hand too** (my call). A hand-set size is the size at 100%, and
every row and the line under the slider show the size it becomes. The slider is the one control a
manager reaches for when a waiter says the text is small, and it should make all text bigger,
including text someone set earlier. The trade-off: a hand-set size is not the exact size every
screen draws unless the slider is at 100%; the row says what it draws. The way not taken — a
hand-set size that the slider leaves alone — would let one hand-set row stay small while
everything around it grows, which is the complaint the slider answers.

**Readability for type** (Q2's rule: a warning with a one-press fix, never a refusal; section 9).
**Rounding** (my call): the screens draw whole pixels. The drawn size is the stored size (Waitron's,
or the hand-set value) times the step, rounded half up to a whole pixel; that whole number is what
the stylesheet carries, what the line under the slider and each row show, and what every check
compares. A drawn size under 12 px warns under its row: "Small text: 10 px is smaller than 12 px;
text that small is often hard to read." with **Use {s} px**, where s is the smallest whole number
whose drawn size at the current step is at least 12 px. It counts in the closed lines' "hard to
read" and is listed by the Save dialog like a colour's. A drawn size above the largest the tills were
measured at — Waitron's own value times 1.3, rounded the same way (16, 18, 23 and 29 px) — gets a note
under its row: "Largest text: 33 px is larger than Waitron checks the tills at; long names may wrap
more or be cut off." with **Use {s} px**, where s is the largest whole number whose drawn size at
the current step is no more than that limit. Both fixes store the size at 100%, and the button says
what it draws: "Use 22 px (29 px at 130%)"; at 100% the part in brackets is left out. The limit is
rounded the way the screens draw, so Waitron's own sizes never get the note: at 130% they draw
16, 18, 23 and 29 px, exactly the limits, while the unrounded 15.6, 18.2, 23.4 and 28.6 would flag
the small and largest sizes. **Every check re-runs at the draft's current step**, so a size fixed
at one step can warn again at another: a Small text fixed to 9 at 130% draws 9 px at 100% and 10 or
11 px between, and its row warns again there, offering 12, 11 or 10. Worked example at 130%: Largest text set by hand to 25
draws 32.5, rounded to 33 px, above 29; the fix offers 22 (22 × 1.3 = 28.6, drawn 29), since 23
would draw 29.9, rounded to 30. Small text set by hand to 8 draws 10.4, rounded to 10 px, under 12;
the fix offers 9 (11.7, drawn 12). The note is not a readability warning: it does not count as hard
to read and the Save dialog does not list it (my call: big text is easy to read; whether it fits is
a layout matter, and the owner chose it). A weight or a typeface never warns: no rule I have a
receipt for says which of them is hard to read.

### Advanced, in sections

Advanced keeps its heading and its closed line, and holds five `wt-disclosure` sections in this
order (my grouping of section 5's 22 colours by what they paint):

- **Page and surfaces** (7): Page, Cards, Menus and dialogs, Selected item, Sunken areas, Bar
  tracks, Lines and borders.
- **Text colours and links** (3): Text, Secondary text, Links and accent text.
- **Buttons** (6): Main buttons, Main buttons pointed at, Text on main buttons, Main buttons
  switched off, Text on switched-off buttons, + and − buttons.
- **Fields and focus** (6): Field background, Field underline, Field label while typing, Field
  text, Switched-off field background, Focus ring.
- **Text** (8): the table above.

Each section's closed line says "None set by hand" or "{n} set by hand: {names}", and ends with
"· {n} hard to read" while one of its rows warns. **What is open** (my calls): when Advanced opens,
every section is closed, because the closed lines already say what is inside; a section holding an
error opens itself, as Advanced does (`has-error`). A section stays as the manager left it until the
editor closes, and is closed again the next time — nothing is remembered between visits or between
browsers, because the closed lines carry what a remembered open section would show. At phone width
the sections stack, each row inside stacking as section 4 describes, and the Text section's rows put
the value under the name. Pictures: `28-advanced-sections-light.png` (closed, and Text opened, at
desktop width), `29-advanced-sections-phone-light.png` (the same at 390 px),
`30-text-too-small-light.png` (a size set by hand, with its warning). The logo and the corners stay
on the card itself: they are main choices, not Advanced ones (my call; the watcher's example
grouping listed them).

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
  `node build.mjs` there prints them). The prototype checks 67 rules in light and 72 in dark, which
  misses 31 that section 3 lists and that read a token the theme writes: text on the search
  highlight (`colors.test.ts:281`), and text and secondary text on each of the 15 station fills
  (`colors.test.ts:532-545`). With them — every rule of `colors.test.ts` listed in section 3 that
  reads a token the theme writes, plus Waitron's own button rules of section 9 — it is 98 in light
  and 103 in dark (corrected 2026-10-20 by the slice 1 plan,
  `docs/superpowers/plans/2026-10-20-a841-1-theme-derivation.md`, whose reference in
  `~/waitron-campaign/a841-plan1-probes/` reproduces every colour this section gives; the corrections below cite it).
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
     works out. The **fix** offered is that value moved, keeping its hue, to the nearest lightness at
     which, with the rest worked out again, no rule names it — searched for each warned value on its
     own, with the brand colour as picked and every other hand-set value as typed, so a fix taken
     alone always clears its own warning (decided in the slice 1 plan after its review found a value
     drawn underneath offered no fix although one existed). Meaning colours (danger, success,
     station dots, Google's button line, the search highlight) never move, so a hand-set background
     that fails against one of them is the one with the warning. When both colours in a failing rule
     are hand-set, both warn, each offering its own fix. **Fix all** takes the fixes one at a time:
     in rule order, the first failing rule that names a colour whose warning has a fix; the fix of
     the colour drawn on top in it (text, line or button) if that one has a fix, else the other's;
     then everything is worked out again, until no warning has a fix. Taking the top one first can
     clear the other's warning. Where no lightness of its hue, from black to white, passes, the
     warning says so and offers no fix ("no shade of this colour can be read on …"). Because the
     other hand-set values are held as typed, a value can have no fix because of another value set
     by hand: in the slice 1 plan's two-colour sweep (Bar Lucía, light; eight pairs of colours that
     share a rule, each set to `#555555` or `#aaaaaa`; 32 cases), 20 of 61 warnings had no fix, and
     after Fix all 7 cases still held a warning, each with no fix (`two-hand-sweep.mjs`,
     `output-two-hand-sweep-light-mid.txt` in `~/waitron-campaign/a841-plan1-probes/`). Taking a fix replaces the hand-set value in the draft; it is still set by hand,
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
- **Changing a main choice later keeps hand-set values** (owner, the extra question, 2026-10-20: "A
  — hand-set colours are kept"). Each stays exactly as set, marked "Set by hand", with **Use
  worked-out colour** on its row and **Reset all to worked-out** at the end of the section. After a
  change, a note under Brand colour names what was kept. The trade-off: a colour chosen to go with
  the old brand (a pale green selected-item background, say) stays when the brand turns burgundy,
  and can clash; the note and the preview show it, and one tap puts it back. The way not taken — a
  change of brand colour or background puts every hand-set value back — would always give a matching
  set, but throws away deliberate work without asking. Corners touch no colour, so they never affect
  a hand-set value either way.
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
   The rules for secondary text ask 4.5:1 on the selected item, the field background, the
   switched-off field background and each of the 15 station fills; the sage reads 2.04:1, 2.24:1
   and 2.38:1, and 1.97:1 to 2.22:1 on the station fills. No worked-out colour
   can move far enough from it (even white reaches only 2.55:1), so the sage is at fault (step 3).
   The warning is on the sage alone — the cream page is named by no failing rule, and the tint stays
   at full strength (tint 1, field background `#ebf2ed`, only the 18 secondary-text rules failing:
   three in `/tmp/a841q2/check4.mjs`, which lacked the station-fill rules, corrected by the slice 1
   plan's reference, `output-settle2.txt` and `output-sage-stations.txt` in `~/waitron-campaign/a841-plan1-probes/`). Its
   row says "Light screens: hard to read on Selected item, Field background, Switched-off field
   background and the 15 station colours." with **Use #526a5b**; that shade reads 4.70:1, 5.17:1
   and 5.49:1, and 4.54:1 to 5.11:1 on the station fills, every rule passing. If she presses it, the stored choice becomes `#526a5b`; if
   she saves without it, Save asks once and Save anyway stores `#8fa898` as typed, and the light
   tills show the pale sage. Mock-up `15-hand-set-and-dark-warnings-light.png`, which also shows her
   green warning for dark screens before she took that fix, and Fix all taking both; its sage row
   names the first three colours only (section 18).

**Extreme picks** (`node sweep-warn.mjs hand light` and `… hand dark` in the same folder, added for
Q2: Bar Lucía, Tinted, with her dark fix `#417c59` taken, each of the 22 colours set by hand in turn
to each of the eight corner colours of the colour cube — black, white, red, green, blue, cyan,
magenta, yellow — 176 cases per mode). They printed `hand sweep light: cases 176, no warning 87,
hand-set warnings 89 (with a fix 89, no shade passes 0), brand-colour warnings 0 (no fix 0), cases
with an unexplained failing rule 0, cases still failing after Fix all 0` and, for dark, `no warning
79, hand-set warnings 97 (with a fix 97, no shade passes 0), brand-colour warnings 0 (no fix 0),
cases with an unexplained failing rule 0, cases still failing after Fix all 0`. Those are the same
counts the earlier design's automatic moves gave (87 left as typed and 89 moved in light, 79 and 97
in dark). With the 31 rules the prototype missed (above), the dark counts are 78 with no warning and
98 with one, every other count unchanged (`sweep-warn-exact.mjs hand dark`, slice 1 plan's
reference in `~/waitron-campaign/a841-plan1-probes/`). No case lacked a fix. A made-up one exists: light Secondary text
`#808080` with the switched-off field background set by hand to black — the text would have to
read on black and on the light surfaces at once — warns with no fix, while the same grey alone is
offered `#636363` (`ex2.mjs`, `ex3.mjs` there). A first run of the sweep counted 17 light and 15 dark
brand-colour warnings, all in cases where a hand-set colour made a rule with the green fail; one was
pure blue cards, where the green's own fix found no shade while the cards' fix cleared everything.
That is why a rule between the brand colour and a hand-set colour is now the hand-set colour's
warning (step 3), and the run above is after that change. An example of a fix: pure blue cards in
light mode fail 22 rules, all fifteen station dots among them; the fix offered is the same hue
lightened to `#e2ecff`, where every rule passes (`/tmp/a841q2/check2.mjs`). The prototype's settling
is still simple — step 2 moves one worked-out colour at a time and only when that lowers the number
of failing rules, and the fix search tries lightness in steps of a hundredth — so the plan decides
how the real one searches.

## 7. Light, Dark and Follow device: every theme has a light and a dark version

Rewritten for the owner's revised Q8 answer (2026-10-20, through the watcher): "The user should be
able to specify custom light and dark themes which will continue to switch with follow device. That
functionality is called custom themes. Light and dark switching should still be called theme (or
display theme)". So every custom theme — and Waitron's own — has a **light version** and a **dark
version**. The Theme setting each browser already keeps (A681: Light, Dark or Follow device, in the
account menu and on the till) decides which version that screen shows; Follow device shows the
version matching the device's own light or dark mode and switches when the device does. Still one
theme is in use for the whole business, the same on every device (Q3); the setting chooses only
which of its two versions a screen shows.

**Which parts belong to a version, and which the two share** (my calls):

| Part | Per version or shared | Why |
| --- | --- | --- |
| The 22 colours (section 5) | Per version: each has a light and a dark value | A colour that reads on a white page rarely reads on a near-black one; this is what makes two versions at all. |
| Brand colour | Shared as the starting point; the dark version may take its own button colour | One pick paints both versions, so the owner never has to choose a dark colour (Q1). The dark version then has three ways to its buttons: the brand colour as picked, its fix (section 9), or a colour of its own. |
| The brand colour's fix | Per version (`brandFix.light`, `brandFix.dark`) | Already so: a colour can read on one kind of screen and not the other. |
| Colours set by hand | Per version (`handSet.light`, `handSet.dark`) | Already so (section 6). |
| Background (Neutral or Tinted) | Shared | It decides only whether the page takes a faint cast of the brand's hue; a page that is tinted in one version and grey in the other is reachable by setting that version's page by hand, and a second switch would add a knob for a faint effect. |
| Corners | Shared | Shape, not colour: a button that changed shape when a device turned dark at dusk would look like a fault. |
| Text size and text set by hand | Shared | Type has no light or dark (section 5a), and a till on Follow device switching at dusk must not reflow its buttons under a waiter's finger. |
| Logo | Per version, in one field | The main image is the light version's; the optional image "for dark screens" is the dark version's, which otherwise draws the main image on a white plate (section 8a). |
| Name, warnings | The name is the theme's; warnings are per version | A warning always names its kind of screen (section 9). |

**The dark version's own button colour.** Under Brand colour, the link **Pick a different colour for
dark screens** opens Advanced at its Buttons section with the Dark value of Main buttons ready to
set. That value is the dark version's button colour: a hand-set Main buttons colour already leads
its family (section 6), so pointed-at, text on it, links, focus ring and the rest follow it, and it
replaces the dark fix (section 4, step 3). The card then says "Buttons on dark screens: #5fa77a,
set by hand · Use the brand colour", and **Use the brand colour** puts the row back to worked out.
It stores nothing new: it is `handSet.dark.primary` (section 11). I give the shortcut to the dark
version only, because the brand colour as picked is already the light version's button colour; a
light version with its own is reachable the same way in Advanced (Light value of Main buttons).
Worked example, Bar Lucía: brand `#1e5b3a`, Tinted, and the dark version's own `#5fa77a` instead of
the fix. The prototype (`warn` in `a841-mockups-src/derive.mjs`, run by
`a841q8-design/probes/dark-own.mjs` in the campaign folder, outside the repository) printed for the dark version
`rules 72 failing 0` (text on the button `#001206` at 6.70:1, the button 6.63:1 on the dark page
`#0b110d`, pointed-at `#72ba8c`, links `#6ab284`, from `probes/dark-own-shades.mjs`) and for the light version `rules 67 failing 0`
with its buttons still `#1e5b3a` (with the 31 rules section 6 says the prototype missed, 103 and 98
rules, still none failing: "dark own" and "lucia light" in `output-settle2.txt`, slice 1 plan's
reference); the control, the same theme with neither the fix nor an own dark
colour, printed `failing 3` (the green on the dark field background, page and cards), so the check
tells the two apart. Each version is worked out from the shared choices and that version's own
hand-set values only (the prototype calls `warn(k, mode, handOf(k, mode))`, `a841-mockups-src/build.mjs:63`),
so nothing set for the dark version can move a light colour. The control that the light call does
see a light value: the same `#5fa77a` set by hand for the LIGHT version moved 8 light tokens
(`probes/dark-own-shades.mjs`, last line). Pictures
`37-theme-versions-{light,dark}.png`, phone `38-theme-versions-phone-light.png`.

**How the editor shows and edits the pair.** One card, not two: the shared choices once on the left;
the preview's two panels, "Light version" and "Dark version", side by side on the right (stacked at
phone width); every Advanced row with a Light value and a Dark value side by side; every warning
saying which kind of screen it is about; and the logo field's two images. I chose this over two
tabs, one per version, because the brand colour, background, corners and text would then appear
twice or on neither tab, and because seeing both versions at once is what catches a colour that
works in one and not the other (section 9 notes that a dark-screen warning is easy to miss while
looking at the light preview). The saved card and the Themes list show both versions
too: the brand row names each version's button colour, and the Themes list's colour strip shows the
light and the dark page.

**Waitron's own theme** is the same pair: its light version is the default block of `colors.css`
(lines 1-123, and 243-357 when forced) and its dark version the dark blocks (125-241, and 359-473 when forced), the values
every screen shows today. "Waitron" in the Themes list is that pair, and "Use Waitron's look" puts
both versions of the draft back to it.

**The word.** The account menu's item stays **Theme** (my recommendation, taken without asking: the
owner wrote "should still be called theme (or display theme)"). Against "Display theme": it would
rename `theme.label` in both apps and both languages, CLAUDE.md §3's banner rule and the
design-system lines that quote it, for a gain the screens already give — the Appearance page names
its things "Look", "Themes" and "Theme in use", and its note says each screen shows the light or dark
version "as its own Theme setting says". So nothing is renamed and CLAUDE.md needs no change.
Picture `39-account-menu-theme-light.png`.

**How a screen shows the right version.** The theme stylesheet repeats the token layer's three
cases, so nothing in `theme-choice.ts` changes:

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

The logo's two images follow the same setting: each place draws a `<picture>` whose dark source
carries the media condition the banner already uses for Waitron's own lockup — `all` under Dark,
`not all` under Light, `(prefers-color-scheme: dark)` under Follow device (`darkLogoMedia`,
`apps/dashboard/src/dashboard-app.ts:189-193`). A switch of the setting, or of the device's mode,
therefore needs no fetch: both versions are already in the stylesheet and the stored copy (section
12).

## 8. Where the theme shows, and where it does not

| Surface | Theme? | Why |
| --- | --- | --- |
| Dashboard, signed in and signed out | Yes | The owner's main surface. |
| Till: counter, tables, bills, kitchen and station screens, handhelds | Yes | Same app (`apps/till`). When each follows a change: section 12. |
| Setup wizard | No | Runs before a theme exists; my call. |
| Trust page, user guide, server recovery page | No | Server-built pages with hand-copied tokens (section 3); my call, could follow later. None shows the venue's logo (section 8a). |
| Dashboard recovery sheet | Partly | It copies tokens from the page (section 3), so on screen it shows the theme; printed, its text and background are forced plain, and its border colour and corner radius stay the theme's. My call: leave it, since the printed words and page are plain. |
| Equipment label | No | It copies four font tokens from a frame marked as a theme root (section 3), so the theme's typeface and sizes would reach it. My call: the label prints in Waitron's type, because its paper was laid out at Waitron's sizes; the build gives the label Waitron's own values (the plan picks how, for example a theme sheet selector that skips print frames). The recovery sheet's typeface and two sizes, copied the same way, likewise stay Waitron's on paper. |
| Text size and text set by hand | Yes, on every surface above marked Yes | Part of the theme (section 5a); printed paper never (receipts, tickets, the label). |
| Waitron's logo in the dashboard banner and the till's top bar | Replaced | By the venue's logo, when one is set; Waitron's lockup then shows only in the "Powered by" line under both sign-in forms (Q6 A, section 8a). |
| Favicon, installed app icon, till browser-bar colour | No | Waitron's own frame (section 3). My call: the browser-bar colour and the manifest stay Waitron's blue, like the favicon; Chrome takes a changed manifest only on its own schedule, and on desktop "doesn't yet support changes to icons" (section 8a). |
| Product tiles, categories | No | Painted from the product's stored colour (section 3). |
| Floor-plan table states, stations, calendars, danger/success/warning | No | Their colours carry meaning and are tested apart from each other (`colors.test.ts:446-576`). |
| Receipts, A4 invoices, kitchen tickets | No colour | Printer commands and a PDF, not web pages (section 3). The venue's logo does print, in black dots, on receipts and A4 invoices where no department receipt logo applies (Q5 A, section 8a); kitchen tickets print no logo, as today (`grep -ci 'logo\|bitmap'` printed 0 for `apps/server/src/kitchen-ticket.ts` and `kitchen-print.ts`). |

## 8a. The venue's logo

Added for the owner's request of 2026-10-20: "Also we should allow uploading a new logo". The owner
answered Q5 A (it also prints on paper where no department receipt logo applies) and Q6 A (it takes
Waitron's place, with "Powered by Waitron" under both sign-in forms) the same morning (section 19);
every other call here is mine, with its trade-off. The
mock-ups give Bar Lucía a made-up logo: a green roundel with "BL" in cream, and "Bar Lucía" in green
beside it over a smaller "SINCE 1998", on a see-through background
(`a841-mockups-src/lucia-logo.svg`, outside the repository).

**What the owner does.** The Look card gains a **Logo** field, first on the card (my call: it is the
first thing most venues will set). With no logo it is one "+ Add a logo" box. Pressing it opens the
image library's picker — the one a department's receipt logo already uses (section 3) — where the
owner uploads a file or picks one already in the library. With a logo, the box shows it on the
plate's white (below), with **Replace** and **Remove** beside it. Under it, **For dark screens
(optional)** offers a second image the same way. That field is offered only while there is a main
image, and Remove on the main image takes the dark one with it, so the draft never holds a dark
image alone (my call, round 5); the server refuses one sent alone (`dark_without_light`,
section 11), worded "Add the main logo before a version for dark screens." Both are part of the
draft, like a colour: the
preview shows them at once, Save stores them, Cancel drops them, and the quiet-Save rule
(section 4) counts them as changes. Mock-ups `17-logo-editor-{light,dark}.png` and
`18-logo-editor-phone-light.png`.

Worked example. Lucía, the bar's manager, presses "+ Add a logo" and uploads `bar-lucia.png`, 1200 ×
400 pixels with a see-through background. The Light preview's banner strip shows it; the Dark one
shows it on the plate, since she has given no dark version. She presses Save. Her own dashboard
shows it at once, other open dashboards follow through their live read, and every signed-in till
within one menu-state poll, 15 s (section 12). Picture `20-logo-banner-{light,dark}.png` shows the
saved card and the banner; `21-logo-till-{light,dark}.png` a till.

**Where it shows** (owner, Q6 A, 2026-10-20: "the venue's logo takes Waitron's place in the
dashboard banner and the till's top bar, with a small 'Powered by Waitron' line under the dashboard
and till sign-in forms"). Pictures `40-logo-on-screens-{light,dark}.png` and, at phone width,
`41-logo-on-screens-phone-light.png` show the four places together.

| Surface | Where | Box: the logo is fitted inside, keeping its shape |
| --- | --- | --- |
| Dashboard banner, signed in and on the sign-in page | Where Waitron's lockup is today, before the legal name | 40 px tall, at most 160 px wide |
| The same at phone width | The lockup's place on the first row, shrinking first as the lockup does (`dashboard-app.ts:737-773`) | The same |
| Handheld top bar | Where the word "Waitron" is today, left out by the same rules (section 3) | 32 px tall, at most 128 px wide |
| Counter till top bar | First in the bar, before the till strip, while the strip has room for it; left out first when it has not (below) | 32 px tall, at most 128 px wide |
| Till and handheld sign-in screen | Above the heading | At most 96 px tall and 320 px wide |
| "Powered by Waitron", both sign-in screens | Under the form, centred (below) | Waitron's lockup 64 px wide |
| Kiosk and kitchen-display modes | Nowhere: they draw no bar (section 3) | — |
| Trust page, setup, user guide, recovery page | Nowhere. The trust page and setup draw Waitron's lockup (`apps/server/src/trust-page.ts:124`, `apps/setup/src/setup-app.ts:1498`); the user guide and the recovery page draw no logo at all (`/usr/bin/grep -c -i -E "logo\|<svg\|<img\|lockup"` printed 0 for `guide-pages.ts` and `recovery-surface.ts`) | — |
| Favicon, installed app icon, browser-bar colour | Nowhere: Waitron's stay (below) | — |
| Receipts and the A4 invoice | In black dots, where no department receipt logo applies (below) | 504 × 160 dots at most on 80 mm paper, 360 × 160 on 58 mm (section 3) |

The banner keeps the tenant's legal name beside the logo: CLAUDE.md §3 makes the banner "persistent
identity chrome — top of the page, full width, the tenant's legal name (not a location)", and the
logo replaces only the picture before the name. Bar Lucía's 3:1 logo is drawn 120 × 40 in the banner
and 96 × 32 in the till bar. The sizes are my call: Waitron's lockup is 128 px wide and, at its
drawing's proportions (`viewBox="-4 -27 619.4… 131"`, `trust-page-logo.ts:12`), about 27 px tall, so
a venue logo gets a little more height than that and a little more width. Its alternative text is
the legal name where the name is not beside it (till bar, till sign-in) and empty where it is (the
banner), so a screen reader does not read the name twice (my call).

**The counter till's bar** (my call, from a measurement). Q6 was asked, and answered, with pictures
of a counter till whose bar began with the logo (`21-logo-till-{light,dark}.png`,
`24-q6-waitron-logo-light.png`). Since #1905 a counter till's bar draws no "Waitron" at all (section
3), so "in Waitron's place" alone would put the logo on handhelds only. I keep the owner's answer and
fit it to the bar #1905 left: the logo goes first in a counter till's bar **while the till strip has
room for it**, and is the first thing left out when it has not; no work control ever moves or
shrinks for it. Measured with a throwaway Vitest browser test in `apps/till` (deleted; kept with its
output in the campaign folder as `a841q8-design/bar-probe/`), command `env -u AI_AGENT -u CLAUDECODE
gtimeout 400 pnpm exec vitest run src/a841q8-probe.test.ts` (8 passed; Vitest 4.1.11, Playwright
1.64.1 Chromium, macOS), which mounted the real `till-shell` with form factor `till` and measured the
till strip's width against its contents. A failing case — a bar with no room — prints a `free` under
the logo's 108 px (Bar Lucía's 96 px and the bar's 12 px gap). It printed: a busy bar (two counter
zones, Parked 3, Waiting 2, two transfers, the kitchen pass, "Ana Fernández") at 1024 × 768 had 54 px
free in English and was already 11 px over in Spanish; the same at 1280 × 800 had 310 and 245 px; a
quiet bar (the Counter and Floor tabs, Parked orders and Waiting) had 343 to 658 px. So on the usual 1280-wide till the
logo shows; on a 1024-wide till it shows until the bar fills with Parked, Waiting, transfers and the
kitchen pass, then steps aside. That needs the counter till to measure its bar as the handheld does
(it measures nothing today, `till-shell.ts:423,589`), which slice 14 adds, with cases at both widths
in both languages. The trade-off: on a busy 1024-wide till the logo can come and go as the counts
appear; the way not taken, never drawing it on a counter till, would leave the owner's answer to
handhelds and the sign-in screen alone.

**"Powered by Waitron"** (owner, Q6 A). Shown only while a venue logo is in use: with none, the
banner and the bar keep Waitron's own and nothing is added. Exactly where:

- **Dashboard sign-in:** in the sign-in page's body, directly after the sign-in form's card
  (`<dashboard-login-screen>`, `apps/dashboard/src/dashboard-app.ts:1563-1568`; the card is its
  `.screen`, at most `calc(var(--wt-space-6) * 15)` = 480 px wide, `login-screen.ts:93-101`), centred
  under it, `--wt-space-4` (16 px) below it. It stays there for every step of the form, since the
  card holds them all.
- **Till and handheld sign-in:** inside the lock screen's `.screen`, last, after the list of names or
  the PIN pad and after the development-mode Switch device button (`apps/till/src/screens/till-lock-screen.ts:319-333`),
  centred, `--wt-space-4` above it, and before the server status line that follows `.screen`
  (`:334`). The enrol screen and the kiosk and kitchen-display modes do not show it.
- **What it is:** the words "Powered by" in `--wt-font-size-sm` (12 px) and `--wt-color-text-muted`,
  then, `--wt-space-2` (8 px) after them, Waitron's lockup as an image 64 px wide
  (`calc(var(--wt-space-6) * 2)`, half the banner's 128 px), about 14 px tall at the drawing's
  619.4 : 131 proportions, swapping its light and dark drawing as the banner's does
  (`packages/ui/brand/waitron-lockup.svg` and `waitron-lockup-dark.svg`, by `darkLogoMedia`, section
  7). Its alternative text is "Waitron", so a screen reader reads "Powered by Waitron". It is not a
  link. New strings: `login.powered_by` in the dashboard and the till, English "Powered by", Spanish
  written with the strings. No new token: the line reads existing ones.
- **Readability:** muted text is held to 4.5:1 on the lifted surface and the fields, not on the page
  itself (`colors.test.ts:134-149,199-229`). Waitron's own muted text reads 5.72:1 on its light page
  and 7.76:1 on its dark one, and Bar Lucía's 5.70:1 and 7.90:1 (`a841q8-design/probes/muted-on-page.mjs`);
  a hand-set page or muted colour could lower that, as it already can for every hint on the page.
  I add no rule for it, because a new rule would change the sweeps' counts of section 6.

**Light and dark** (my call). One image is required; a second, for dark screens, is optional. With
both, each screen draws its version's image, the Theme setting deciding as it does for colours
(section 7). With one, dark screens draw it on a **plate**: a rounded box filling the logo's box,
with the logo inside it 4 px from each edge (picture `19-logo-dark-plate-or-version-dark.png`,
left). The plate is white, from a new token, `--wt-color-logo-plate`, declared `#ffffff` in all four
blocks of `colors.css` and written by no look: it is kept out of the colours a manager can set by
hand (section 5), as the scrim is, and out of the list `deriveTheme` writes (section 14), so nothing
a look does can darken it (round 5: the earlier plate in the look's light card colour would have
gone dark with a hand-set dark Cards colour, such as the sweep's pure blue). For Waitron's own
palette and Bar Lucía's the light card colour is white anyway (`colors.css:7`; the bar's Cards `#ffffff`
in picture 12), so the pictures do not change; the trade-off is a white plate beside cream cards on
a look whose light cards are set to cream. The plate means a dark green or black logo never
disappears on a dark till; its cost is a light patch on a dark bar, which a second image removes
(the same picture, right). Rejected: inverting the colours automatically (it would turn a green
roundel pink), and checking a logo's contrast like a colour (a logo is many colours, and no rule
says which of them must read).

**Limits** (my calls; mostly the library's own, section 3):

- PNG, JPEG or WebP, judged by their bytes; up to 20 MB and 100 million pixels; kept with the
  longer side at most 1600 px. A see-through background is kept; a JPEG has none, so it shows its
  own rectangle.
- **No SVG.** The library refuses it, and this design keeps that. An SVG can carry a script, and the
  box serves library images from its own address. Probe
  (`a841-mockups-src/logo-probes/svg-probe.mjs`, Playwright's Chromium 156.0.8078.4): a page set a
  cookie and showed an SVG holding `<script>fetch("/stolen?cookie=" +
  encodeURIComponent(document.cookie))</script>` from `/media/logo.svg`. Drawn through `<img>`, the
  server saw only `/` and `/media/logo.svg`; opened directly, it saw `/media/logo.svg` and then
  `/stolen?cookie=session%3Dsecret123`. So the screens' `<img>` would not run it, but anyone opening
  the image's own address would, as the box. A PNG of the same drawing loses nothing a screen needs.
- Scaled to fit its box keeping its shape, never stretched or cropped. A small image is drawn up to
  the box and may look soft; the hint says so ("at least 200 pixels tall": the till sign-in's 96 px
  box on a screen with two device pixels to each CSS pixel needs 192).
- The image drawn is the library's "display" rendition, so a later crop or a replaced file in the
  library shows everywhere (section 3); the library's edit path already updates `media_images`,
  which the delivery path watches (section 12).
- **While it loads**, the box keeps its height and stays empty; before `/api/theme` has answered at
  all, section 12 says what the place shows. **If it fails** to load, or the stored name has no
  image behind it, the screen draws what it draws with no logo: Waitron's lockup in the banner, the
  word in a handheld's bar, nothing in a counter till's, and no "Powered by" line. The library refuses to delete an image in use, and the logo is counted as a
  use (below), so this is a fault path rather than a normal one.

**Waitron's own logo** (owner, Q6 A): the venue's logo takes Waitron's place in the banner and the
bars, and Waitron is named on both sign-in screens by the "Powered by" line above
(`22-logo-sign-in-{light,dark}.png`, `40-…`, `41-…`). With no venue logo set, nothing changes from
today. What the owner was shown: `24-q6-waitron-logo-light.png`.

**The favicon and the installed app icon stay Waitron's** (my call). A browser tab would follow a
changed favicon at once: in Playwright's Chromium 156.0.8078.4 run with a window
(`a841-mockups-src/logo-probes/favicon-probe.mjs`), changing the icon link's address from script
made the browser fetch the new image (`/waitron.png`, then `/venue.png` about 1.5 s later), and
adding a second link did the same; run without a window, the same browser fetched no icon at all, so
that mode cannot measure this. An installed app is another matter. The source, for desktop Chrome:
"Once installed, all fields from the new manifest except icons are updated" and "Note: Chrome on
desktop doesn't yet support changes to icons"; for Android it lists `icons` among the properties
that trigger an update, which Chrome requests "after all windows of the PWA have been closed, the
device is plugged in, and connected to WiFi" (<https://web.dev/articles/manifest-updates>, "How
Chrome handles updates to the web app manifest", last updated 2024-09-19). So, on that page's
account, an installed till's icon would not change on desktop Chrome for now, and on Android only
some time after the change, once those conditions are met. The till's manifest is also a file
written when the app is built (section 3), the same for every venue. A tab icon in the venue's logo
beside an installed icon in Waitron's would be two answers to one question, so both stay Waitron's,
like the browser-bar colour (section 8).

**Use Waitron's look removes the logo too** (my call; section 4, step 8). The button promises
Waitron's look, and a screen showing Bar Lucía's logo is not it — the reason it also puts colours
set by hand back. It changes the draft only, so Cancel keeps the logo; after Save the image is
still in the library, and Replace picks it again. The trade-off: an owner who only wanted Waitron's
colours back has to pick the logo again.

**Who may change it** (section 13). The save is under `layout.configure`, like the rest of the card.
The picker lists and uploads under `image.manage` (section 3), so a person needs both to set a logo;
managers and administrators hold both (`packages/identity/src/permissions.ts:55-73`,
`packages/media/src/module.ts:35`), and supervisors neither.

**Storage and delivery.** A theme's document holds `logo` (section 11). The library
counts the logo as a use, in its typed list and both of its counters, so it refuses to delete it,
and shows that use as "Logo of theme {name}" (section 8b) with a link to the Appearance page, beside today's "<department>
receipt logo" and its link to the department's Receipt tab
(`packages/media/src/dashboard/image-library.ts:36-63`,
`packages/media/src/dashboard/strings.ts:76,159`). The user guide's page on the library lists those
uses and says how to free a photo (`apps/server/src/guide/en/content-and-images.md:170,214-217`,
`guide/es/content-and-images.md:182,229-232`); both languages gain the venue logo (slice 8).
`/api/theme` carries the logo's addresses and its hash covers them, with the cache keyed so that a
replaced or reframed image misses it (section 12), so tills and open dashboards follow a new logo, a
removed one, or an edit to the image in the library.

**Receipts and A4 invoices** (owner, Q5 A, 2026-10-20: "the new logo also prints on receipts and
A4 invoices wherever no department receipt logo applies; a department's own receipt logo still
wins; the Look card shows how it will print"). The logo of **the theme in use** prints on every
receipt and A4 invoice that has no department receipt logo: a department with none, and a sale with
no department at all. A department's own receipt logo still wins, and is how paper gets a different
picture. So switching themes (section 8b) changes what such receipts print from the next receipt,
like the screens; a theme not in use prints nothing. The light image is the one printed, never the
dark one. Picture `42-logo-on-receipt-and-invoice-light.png`: the bar department, with no receipt
logo, prints the venue's dots on its receipt and its A4 invoice; the terrace department, with its
own (a drawn stand-in, not the real dither), prints its own on both. What the owner was shown:
`23-q5-logo-on-receipts-light.png`.

**How "the department wins" is decided today** (followed on main 6515785a2). The receipt print path
reads the sale's department (`apps/server/src/receipt-print.ts:193-194`), and reads that department's
printed receipt only when there is one (`:196-208`, `VENUE_SERVICE.readPrintedDepartmentReceipt`),
which answers the department's pictures only when the department names a logo
(`packages/venue-service/src/department-receipts.ts:227-229`). It then passes the department's
receipt and an EMPTY venue receipt, `{}`, to `resolveReceiptTrim` (`receipt-print.ts:210`), which
takes `department?.logo || venue.logo` (`packages/shared/src/receipt-text.ts:85`) — so the
department's name always wins and the venue's never exists — and takes the dots from the department
alone, `department?.logo ?? null` (`receipt-print.ts:211`). The A4 invoice does the same on 80 mm
pictures (`apps/server/src/invoice-document.ts:98-115`) and draws those dots centred at the top of
the page (`apps/server/src/invoice-page.ts:208-225`, written to the PDF at `invoice-pdf.ts:31`). So
today "department wins" holds because nothing else can print; A841 keeps the order those two lines
already state, department first, and fills the empty venue side. The real
drawing code (`drawLogoRasters` after `prepareImage`, run on the made-up logo in a throwaway case in
`apps/server`, deleted afterwards) printed 13,723 of 76,800 dots at 80 mm for the light version, its
words readable, and 8,404 for the dark version, whose cream words came out as scattered dots
(`a841-mockups-src/lucia-logo{,-dark}-receipt-80mm.png`). The Look card then shows how it prints,
from the receipt preview's own drawing (`drawPreviewLogo`, `receipt-logo.ts:66-85`), and says so
when it prints nothing: in an earlier run of the same code on 400 px squares, a white circle on a
see-through background printed 0 of 25,600 dots, the same circle in black 11,305 and in lemon
`#f2d300` 1,896.

How it is built (my calls; rewritten after review round 5, which found the first version printed
nothing and left two holes):

- **Where the dots are kept.** The theme's save draws the printed pictures of the light image
  outside the transaction, from its "display" rendition, as a department's save does
  (`department-receipt-api.ts:110,118-133`, keeping the old pictures when the image is unchanged),
  and stores them in the theme document beside the choices, under `printedLogo`, one per paper
  width. They are derived, kept only because a receipt is drawn inside the sale's transaction, where
  an image cannot be decoded (`receipt-logo.ts:12`), and are always redrawn from the logo, never
  edited on their own. With a logo the save requires them, as `putReceipt` requires them for the
  venue receipt row (`receipt-store.ts:164-188`). I chose the theme row over the unused
  `tenant_receipts` row so that the pictures travel and disappear with the look: a configuration
  copy carries the theme table (`tenant_themes` today, `packages/db/src/configuration-transfer.ts:72`; `custom_themes` after slice 2) but, since A493, not
  `tenant_receipts` (`docs/backlog/printers.md:502-505`). Trade-off: the theme document is no longer
  choices only; section 2's anti-goal is about not copying Waitron's default colours, which this
  does not do.
- **What prints.** Both print paths give `resolveReceiptTrim` the venue's logo name in place of the
  empty receipt (`receipt-print.ts:210`, `invoice-document.ts:114`); it already prefers the
  department's (`receipt-text.ts:85`). The dots are a separate line today, the department's alone
  (`receipt-print.ts:211`, `invoice-document.ts:115`), and `readPrintedDepartmentReceipt` answers
  `logo: null` for a department with none
  (`packages/venue-service/src/department-receipts.ts:227-229`). That line becomes: the department's
  dots when the department names a logo, otherwise `printedLogo`. A department that names a logo
  whose pictures cannot be read still prints none, as today, rather than the venue's: the fallback
  follows the name, as `resolveReceiptTrim` does.
- **When the department's receipt settings cannot be trusted, no logo prints** (ruled in rounds 8
  and 9), never a possibly wrong one: the department may have its own logo, and the venue's would
  then be the wrong picture. Every one of these cases answers `{ receipt: {}, logo: null }` today
  (all in `packages/venue-service/src/department-receipts.ts`), exactly what a department that
  exists with no receipt row answers (`:228-229`, pinned by `department-receipts.test.ts:63-69`),
  so today they print nothing only because nothing else can print:
  1. **The read throws**: the `catch` answers the empty receipt (`:230-240`; pinned by the
     "optional SELECT failure" case, `department-receipts.test.ts:253`).
  2. **The stored document is not a JSON object**: invalid JSON is read as `{}`
     (`validDocument`, `:34-38`), and a valid `null`, `[]` or `42` yields no field because every
     field is read with `json_type`/`json_extract` on it (`stringField`, `:40-45`); pinned by the
     "contains imported %s" cases (`department-receipts.test.ts:171-176`). The configuration import
     refuses a non-object document (`packages/venue-service/src/configuration-transfer.ts:676-686`),
     so this needs some other write — but the read must not assume there is none.
  3. **A logo name is stored but the read drops it**: not text, or longer than 255 bytes
     (`stringField("logo", 255)`, `:77`, `:40-45`), or not a library file name
     (`MEDIA_FILENAME`, `parseReceipt`, `:122`). The import checks only `printAddress` and
     `operationDescription` inside the document (`configuration-transfer.ts:687-698`), and
     `grep -n logo` printed nothing for that file or `apps/server/src/configuration-transfer.ts`,
     so an imported bad name can reach it.
  4. **The sale names a department the read cannot find in this location** (`if (!row)`, `:227`)
     (my call, beside the ruling's three: the department's own settings cannot be known either).

  So the build makes "cannot be trusted" visible: `readPrintedDepartmentReceipt` also reads whether
  the receipt row exists, whether its document is valid JSON whose top level is an object, and
  whether it has a `logo` key, and answers `unreadable: true` beside the empty receipt in cases 1
  to 4 — a document with a `logo` key and no kept name is case 3. A department with no receipt row,
  or with a readable document that has no `logo` key, is not unreadable, and takes the venue's logo.
  **The two that print** — the receipt (`apps/server/src/receipt-print.ts:199`) and the A4 invoice
  (`apps/server/src/invoice-document.ts:103`) — then take no logo at all, the sale still printing as
  today. Of **the four places that read a department's receipt settings** (the only non-test
  callers of `readPrintedDepartmentReceipt`, `git grep`; the round-9 reviewer's list), the other two
  are below: the till's ticket view (`receipt-presentation.ts:26`) gives no logo image address, and
  the department Receipt tab's preview (`receipt-preview-api.ts:368`) keeps drawing the draft's own
  logo from its library image as today, never the venue's.
- **A sale with no department** (`receipt-print.ts:193-197`, `invoice-document.ts:98-103`) prints
  the venue's logo too; `resolveReceiptTrim` already renders "venue-only" for a null department
  (`receipt-text.ts:73`).
- **The till's ticket view and the receipt preview** follow the same rule. The ticket view resolves
  the trim the same way and turns its logo name into an image address
  (`apps/server/src/receipt-presentation.ts:19-55`); it gains the theme's light image where the
  department names none. The department Receipt tab's preview draws the department's draft logo
  (`apps/server/src/receipt-preview-api.ts:229-250,348-391`); with no logo in the draft it draws the
  theme's `printedLogo`, so a manager editing a department sees what its receipts will print.
- **A configuration copy** carries `printedLogo` with the theme. The import check refuses a copy
  whose look names a logo without a readable picture for each paper, as `printable` judges one
  (`receipt-store.ts:190-195`).
- **Remove and Use Waitron's look**, once saved, rewrite the theme's row, and `printedLogo`
  goes with the logo: the next receipt prints no venue logo, while a department's own still prints.
- **A library edit** redraws `printedLogo` as it redraws a department's pictures, matching the
  image's name inside the write transaction (`image-edits.ts:65-80`).

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

**English only.** The new words live in the dashboard's, the till's and the image library's strings
files (`apps/dashboard/src/i18n/strings.ts`, `apps/till/src/i18n/strings.ts`,
`packages/media/src/dashboard/strings.ts`). No file name, image or
starter text is added to general code: a new venue has no logo.

## 8b. Custom themes

Added for the owner's words of 2026-10-20 (through the watcher): "Perhaps even allow saving custom
settings as named profiles", then "Use themes instead", "And the same look in all devices" and
"Custom themes". I read the four together as a decision, not a "perhaps" still to ask: the owner
named the thing twice and its scope once. The watcher's note proposed asking whether the owner
meant this at all; I do not, and the question file says so in one line. Every call below is mine
except what a custom theme holds, which the owner settled in the revised Q8 answer: "The user should
be able to specify custom light and dark themes which will continue to switch with follow device.
That functionality is called custom themes" (section 7).

**What a theme is.** A theme is a **pair, a light version and a dark version**, and everything the
Look card holds: the logo (and its image for the dark version), the brand colour and any fix taken
for it, Background, Corners, the text size, every colour set by hand for either version and every
text setting set by hand; section 7 says which of these each version has of its own. It also
carries its logo's printed pictures (section 8a), drawn when the theme is saved. Not in a theme:
each browser's Theme setting (Light / Dark / Follow device), which stays the browser's and decides
which version that screen shows (section 7). **Waitron's theme** is always in the
list, first, named "Waitron" with the tag "built in", and cannot be edited, renamed or deleted.
The venue's own are its **custom themes**. Exactly one theme is **in use** at a time, and it is the
same on every till, handheld and dashboard (owner, Q3; "And the same look in all devices").

**The page.** Appearance holds the **Look** card (the theme in use, as section 4 describes, with
"Theme in use" as its first row) and under it a **Themes** card: a `wt-data-table` with the theme's
name, a strip of its colours (brand colour, light page, dark page) and its tags ("In use", "built
in", "{n} hard to read"), and a row menu column keyed `actions` and pinned to the end (CLAUDE.md
§3). Its header action is **New theme**. Each custom theme's row menu offers **Use on every
screen**, **Edit**, **Rename**, **Make a copy** and **Delete**; Waitron's offers **Use on every
screen** and **Make a copy**; the theme in use offers no Use. Pictures
`31-themes-{light,dark}.png`, phone `32-themes-phone-light.png`.

**Editing.** Edit on the Look card edits the theme in use; Edit on another theme's row opens the
same editor for that theme, headed "Edit theme: {name}", with the line "Not in use. Saving changes
no screen until you use it." Every edit is a draft until Save, as section 4 says; **Save** stores it
into that theme. Saving the theme in use repaints every screen (section 12); saving another changes
no screen. **Save as new theme…** asks for a name and stores the draft as a new custom theme,
leaving the theme being edited as it was saved; its dialog's **Use it on every screen now** is on
when the theme being edited is the one in use (the manager was changing what everybody sees) and
off otherwise. **Edit** while Waitron's theme is in use opens the editor on Waitron's choices; since
Waitron's cannot change, **Save** there opens the same name dialog, switch on. That is how a new
venue makes its first theme: it presses Edit on the Look card, picks its colours, presses Save and
names it. **New theme** opens the editor on Waitron's choices too, as a theme not in use. Picture
`33-theme-save-and-switch-{light,dark}.png`.

**Names.** A name is 1 to 60 characters after trimming, unique ignoring case, and never "Waitron"
in any case (the built-in's, which is never translated). Names are the venue's own words and are
not translated (my call: only managers see them, on the dashboard). Uniqueness compares a key the
one writer computes with JavaScript: the name normalised to NFC, trimmed, then `toLowerCase()`
(which does not depend on the device's language), so "Lucía" typed with a composed or a decomposed
accent is one name; SQLite's own `lower()` is never used for it, since it folds only A to Z.

**The name dialog** follows the house form rules (`design-system.md` → Forms): Name is required and
marked; an empty name says "Enter a name." under the field, more than 60 characters "Use 60
characters or fewer.", and a name taken by another theme "A theme with this name already exists."
(the server's `theme.name_taken`, placed by its `field`) or "\"Waitron\" is the built-in theme's
name. Pick another." — each under the field and, for the browser's own checks, once at the bottom,
"Correct the highlighted fields to continue.", with Save disabled until the field is fixed; a
refusal from the server does not disable Save. It takes a draft scope from `draftScopeFor` and has a
`*.unsaved.test.ts` (CLAUDE.md §3). Rename opens with the current name and Save quiet until it
changes, as the rule asks. **Exception, stated here as the rule requires:** Make a copy and Save as
new theme open already savable, with a proposed name — "{name} (copy)", the original shortened so
the whole fits 60 characters — because the proposal is itself the draft the manager came to save;
the first save from Waitron's theme opens with the field empty, Save disabled until a name is
typed. In the editor, **Save as new theme…** is never drawn quiet: it does not save the theme being
edited, so an unchanged draft is a valid copy (pictures 02 and 03 drew it quiet and are redrawn).

**Switching.** **Use on every screen** asks once: "Use {name} on every screen?" with "Every
dashboard changes now, and every signed-in till within 15 seconds.", "Text on the tills changes
size too." when the two themes' text sizes differ, and, when the theme has
warnings, a "Hard to read:" list worded as the Save dialog's (section 9); then **Use it** or
**Back**. A switch never refuses a theme for being hard to read (Q2), and offers no fix — the
fixes are in the editor. It stores one thing, which theme is in use (section 11). Rename, Make a
copy and Delete change no screen, except deleting the theme in use.

**Deleting.** Delete asks in the shared delete dialog. For the theme in use it says: "{name} is in
use on every screen. Deleting it puts Waitron's theme on every screen." and, if confirmed, puts
Waitron's theme in use and deletes the custom theme in one transaction. The trade-off: one press
more than refusing ("switch to another theme first") would cost, and it can surprise a manager who
did not read the dialog; refusing would send them round the list for a step that the dialog can
name. A deleted theme's logo stays in the image library, no longer counted as a use if no other
theme names it.

**Readability and "Set by hand" inside a saved theme.** Each theme keeps its own hand-set values,
fixes and warnings; nothing is shared between themes. The server works out a theme's warnings
whenever it is read, as it does for the theme in use today (section 10), so the Themes list shows
"{n} hard to read" on any theme saved with Save anyway, and the switch dialog lists them. A release
that makes a stored colour hard to read (section 17) shows on every theme, not only the one in use.

**Make a copy** opens the name dialog with "{name} (copy)" and stores a copy that is not in use;
it is how a manager starts "Christmas" from "Bar Lucía" without touching it.

**Worked example.** Bar Lucía's manager has the "Bar Lucía" theme in use: the green, Tinted, Round,
the logo, text at 100%. In November she presses Make a copy, names it "Christmas", opens it with
Edit (the line says it is not in use), sets the brand colour to burgundy `#7a1f2b`, takes the fix
for dark screens, moves Text size to 110% and saves: no till changes. On 1 December she presses Use
on every screen on Christmas's row; the dialog says every signed-in till follows within 15 seconds;
she presses Use it, and the dashboard repaints at once. In January she uses Bar Lucía again; the
Christmas theme stays in the list for next year.

**Logos and the image library.** Every custom theme's logo counts as a use of its image (section
8a's use, now per theme): the library refuses to delete an image any theme names, and shows the
use as "Logo of theme {name}", linking to the Appearance page.

## 9. Readability protection

Two sets of rules, run on each version of the theme — the light version against the light rules and
the dark version against the dark — on the finished set: the owner's colours as picked, and
everything Waitron works out around them. A warning always belongs to one version and says so
("on light screens", "Dark screens: …"); the Themes list counts both versions' warnings together.

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
`--wt-color-primary`" (`design-system.md:3294-3297`) — and a switch's track is the same colour.
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
  save applies Fix all (section 6, step 3), then saves; it is offered when running Fix all on the
  draft would leave no warning — decided by running it, so a warning with no fix of its own that
  Fix all clears (another colour set by hand was blocking it) does not withhold it (lane A ruling
  2026-10-20; it replaces "offered only when every warning has a fix"). Save anyway stores every
  colour as picked; Back closes the dialog and saves nothing. When Fix all would leave a warning,
  the dialog offers Save anyway and Back alone: the fixable ones can still be fixed in the editor
  first, and the one with no fix goes on the tills only by Save anyway. In the slice 1 plan's light
  two-colour sweep, 10 of its 32 cases have a warning with no fix that Fix all clears, and 7 leave
  one (`fix-and-save.mjs`, `output-fix-and-save.txt` in `~/waitron-campaign/a841-plan1-probes/`). With no warning
  showing, Save saves at once and nothing asks.

The trade-off of (c): one more press for an owner who really wants the colour as picked; in
exchange, a hard-to-read colour reaches the tills only by a deliberate "Save anyway", never by
accident (Fix and save is offered only when Fix all leaves no warning, so it cannot carry one past),
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
screens: no shade of this colour can be read on {names}. Pick another colour." and offers no fix.
When other colours set by hand block every shade, the warning names them (`blockedBy`, section 10)
and the sentence says so: "Light screens: no shade of this colour can be read on {names} while
Sunken areas is set by hand to #000000." (lane A ruling 2026-10-20). A colour set by hand blocks
it when, worked out instead, it would leave the warned colour a fix; when no single one does but
working out all the others would, every other hand-set colour that shares a rule with it is named;
when none would, nothing is named and the sentence stays as above. It never disables Save: the
dialog lists it and offers Fix and save only when Fix all would leave no warning, and Save anyway
stores it as picked like any other. The one-colour
sweeps found no such case; with two colours set by hand it is common, because each value's shade
is searched with the other held as typed (section 6, step 3). The slice 1 plan tests the made-up
one-colour case of section 6 and the two-colour sweep.

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
configuration import is the second way to write the theme table (`configuration-transfer.ts:72`),
and `validateCoreConfiguration` checks no theme row today (`configuration-transfer.ts:5-24`): the
build adds the same validity check there, and an imported look that is hard to read shows its
warnings on the card like any other. The stylesheet is built only from the derived values —
`#rrggbb` colours and pixel radii the function itself writes, and the owner's values only after they
pass the same `#rrggbb` check — never from an unchecked stored string, so nothing stored can break
out of a declaration.

**Text too small** (added for Q4). WCAG 2.2 has a resize rule — 1.4.4 Resize Text: "Except for
captions and images of text, text can be resized without assistive technology up to 200 percent
without loss of content or functionality" (<https://www.w3.org/TR/WCAG22/>) — but a search of that
page's text for "minimum font size" and "minimum text size" found neither, so I take the floor from
Chrome's Lighthouse: "Font sizes smaller than 12 px are often difficult to read on mobile devices
and may require users to zoom in to display text at a comfortable reading size." and "Aim to have a
font size of at least 12 px on at least 60% of the text on your page."
(<https://developer.chrome.com/docs/lighthouse/seo/font-size>, "Document doesn't use legible font
sizes", last updated 2019-05-02; fetched 2026-10-20 with `curl` and read as text). So a size the
screens would draw under 12 px warns, with the fix of section 5a (the smallest size that draws at least 12 px at the current step; "Use 12 px" at 100%). Lighthouse judges a
page by its share of small text; this design is stricter and warns for any of the four sizes under
12 px, because each one is used across hundreds of places (section 3). Waitron's own smallest size
is exactly 12 px, so Waitron's theme never warns. The slider does not stand in for 1.4.4: browser
zoom still enlarges everything, and the slider's 130% is not 200%.

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
- Save sends the choices only — the logo, the three main choices, the text size, any fix taken
  and the hand-set colours and text settings — to the theme being edited.
  When a warning is unfixed, the dialog of section 9 comes first, in the browser. The server checks
  the choices are valid, stores them and answers the stored choices with the worked-out values and
  the warnings. A warning carries keys only, never words: `{ field, mode, against, fix, blockedBy }` — `field`
  the colour's key as in `theme.invalid` (`brandColor`, `handSet.light.text-muted`; section 11),
  `mode` `light` or `dark`, `against` the keys of the colours it is hard to read on (token names
  without `--wt-color-`, such as `surface-lifted` or `station-red-dot`), and `fix` the offered
  `#rrggbb` or `null`, and `blockedBy` the keys of the other colours set by hand that block every
  shade when `fix` is `null` (empty otherwise; section 9). The browser words them from its own strings, in the screen's language; the station fills and dots
  are one item each, as section 4's product-text table says (lane A ruling 2026-10-20). They
  are the same warnings the editor shows, worked out by the same `deriveTheme`. The read route
  (`GET`) answers the warnings for the stored choice too, worked out by the same shared check, so
  the saved card — which a supervisor also sees — reads them from there rather than working them out
  itself. A text warning has the same shape with `mode` `null`, `against` empty, `field` its key
  (`text.size.sm`) and `fix` a whole number of pixels (`12`); the "larger than checked" note of
  section 5a is not a warning and is worked out by the browser alone. "Use Waitron's look" then Save
  stores the theme with Waitron's choices; it no longer deletes anything (section 8b).
- **Use worked-out colour** (and size, typeface, weight), **Reset all to worked-out**, a warning's
  fix, **Fix all**, **Undo**, the slider and the logo's **Replace** and **Remove** change the draft
  only, like every other control on the card; Save stores the result and Cancel undoes them.
- **Save as new theme…**, **Rename**, **Make a copy**, **Delete** and **Use on every screen** are
  their own requests (section 11's routes), each confirmed by its dialog (section 8b); none is part
  of the draft.

## 11. Storage

My call, revised for custom themes (section 8b) and again in round 6: **the choices move to a
table of themes, one row each, with a column marking the one in use; `tenant_themes` is retired.**
Several named themes, each renamed, deleted and edited on its own, fit rows better than one JSON
document holding them all — two managers editing two different themes do not overwrite each other,
and a name's uniqueness is a unique index rather than code. Round 6 replaced the first revision's
pointer (`tenant_themes.custom_theme_id`, a foreign key that refused deleting the theme it named):
that key would have made `custom_themes` the target of a restricting child, and by
`docs/developers/conventions-data.md:1538-1547` a drizzle table rebuild's `DROP TABLE` fails on such
a child holding rows, so every later rebuild of `custom_themes` would have failed on any box with a
theme in use.

- **The table.** Scope: the whole business, not one location or one kind of device (owner, Q3,
  2026-10-20: "one look for the whole business"; and "And the same look in all devices") — a brand
  belongs to the business, one database holds one business (`design-system.md:3282`, the banner
  shows "the deployment tenant's legal name, not a location name"), so it has no location key.
  **`custom_themes`** (new, in the core set, replacing `tenant_themes`): `id`, `name` (as typed),
  `name_key` (section 8b's key, with the unique index `custom_themes_name_key_uq`), `in_use`
  (declared with the vocabulary's `count` builder, nullable — not `flag`, whose boolean mode would
  write `0` for false, which the CHECK refuses; the one writer stores NULL for "not in use"; the
  CHECK `custom_themes_in_use_ck` allows only `1`, and the unique index is `custom_themes_in_use_uq`;
  `1` on the theme in use and NULL on every other), `theme` (the JSON document below) and
  `updated_at`. A plain unique index on `in_use` lets at most one row hold `1`, because SQLite's
  unique index lets NULLs repeat. Measured 2026-10-20 with `node:sqlite` (Node v26.11.1, SQLite
  3.54.0), a table `t (in_use integer check (in_use = 1))` with a unique index on `in_use`: two NULL
  inserts succeeded, the first `1` succeeded, the second `1` was refused "UNIQUE constraint failed:
  t.in_use", and a `2` was refused by the CHECK; the case of section 15 repeats it on the real
  schema. No row holding `1` means
  Waitron's theme is in use. Both indexes are on plain columns — no expression index and no partial
  index — so CLAUDE.md §3's drizzle-kit 0.31.11 trap about rewriting expression indexes on a rebuild
  does not apply. No foreign key points at `custom_themes` and it points at nothing, so a rebuild
  deletes no other table's rows. Classified `state`, as `tenant_themes` is today
  (`packages/db/src/classification.ts:141`), and, like every core table but two, a live-update
  source (section 3). Switching clears the old row's `in_use` and then sets the new one's, in one
  transaction, in that order, so the unique index never sees two `1`s (CLAUDE.md §3: rewriting rows
  one at a time can break a unique index the final state satisfies). Deleting the theme in use
  deletes its row, which leaves Waitron's in use.

  **One row holds both versions** (checked for the revised Q8 answer; my call to keep it). The
  document already keeps every per-version part under a `light` and a `dark` key — `brandFix`,
  `handSet`, `logo` — and the shared parts once (section 7's table), so a theme with a light and a
  dark version needs no new column, no new table and no change to the document's shape; the dark
  version's own button colour is `handSet.dark.primary`. The way not taken, one row per version,
  would let half a theme be in use, renamed or deleted, would need a key tying the two rows (a
  foreign key into `custom_themes`, the restricting child round 6 removed, above), and would give
  the shared choices two copies to keep equal. Classification (`state`), the two unique indexes,
  the CHECK and the guards of section 14 are therefore unchanged by the revision.
  A theme's `theme` document holds the owner's **choices only**: `{
  logo, brandColor, brandFix, background, corners, textScale, handSet, text }` (`logo` is `null`, or `{ light, dark?
  }`, each the image library's name for an image, such as `"3f9a….webp"`, `dark` optional, section
  8a; `brandColor` is `#rrggbb`, or `null` for Waitron's; `brandFix` is `{ light?: true, dark?: true
  }`, saying the owner took the brand colour's fix for that mode — empty when none, and never set
  with Waitron's or for a mode whose Main buttons is set by hand; `background` and `corners` from
  fixed lists; `handSet` is `{ light: {…}, dark: {…} }`, each mapping one of the 22 names of section
  5, written without `--wt-color-`, to a `#rrggbb` value, and empty when nothing is set by hand;
  `textScale` a whole number from 100 to 130 in steps of 5; `text` is `{ family?, size?: { sm?, md?,
  lg?, xl? }, weight?: { normal?, medium?, bold? } }`, holding only what is set by hand — sizes in
  whole pixels from 8 to 40, weights 400 to 800 in hundreds, `family` `"system"` or `"serif"`, the
  list the uploaded-fonts item later widens, section 5a). It also holds `printedLogo` (section 8a).
  For example, Bar Lucía after step 3 of section 6's worked example, with the burgundy's dark fix
  taken, and the bar's logo with no dark version: `{ "logo": { "light": "<library name>" },
  "brandColor": "#7a1f2b", "brandFix": { "dark": true }, "background": "tinted", "corners": "round",
  "handSet": { "light": { "bg": "#f8f1e1" }, "dark": {} } }`, which paints dark buttons `#b05157`.
  **A fix is stored as a flag, not a shade** (round 4, changed from the shade first written here).
  The shade is whatever the shared rule gives for the stored brand colour, mode and surroundings, so
  a stored fix can never be a shade that does not belong to its brand colour, and a change of
  background or of a hand-set page re-works the shade rather than leaving a stale one. The
  trade-off: a release that changes the rule can move a fixed shade slightly, like any worked-out
  colour; the card and editor show the shade as it is now. Prototype: `derive.mjs` paints a flag
  with the same `until` search that offers the fix, and `warn` throws if the two ever differ; the
  brand sweep ran all 360 warnings through it without a throw. A hand-set value is stored as typed,
  or as the fixed shade if its fix was taken. No worked-out values are stored, so a release that
  improves Waitron's defaults reaches a themed venue too; the cost is that a release changing the
  defaults or the formula can shift a venue's worked-out colours slightly, which the editor shows as
  it works them out now. A release never changes a brand colour or hand-set value as stored, but it
  can make one hard to read that was not: it is then served as stored, and the card and editor show
  the new warning and its fix (section 17).
- **A migration is needed** (before custom themes none was): `custom_themes` is created and
  `tenant_themes` dropped. The commit states why a new table enters the core set (CLAUDE.md §3): it
  replaces `tenant_themes`, which is core, and serves `/api/theme` to every app, so a module of its
  own would split one contract. What drizzle-kit is expected to generate: a `CREATE TABLE` with the
  CHECK, two `CREATE UNIQUE INDEX` statements and a `DROP TABLE tenant_themes`; nothing references
  `tenant_themes` (`git grep -i 'references.*tenant_themes'` over `apps` and `packages` found no
  line), so the drop deletes no other rows. Slice 2 generates the migration, reads the SQL it wrote
  rather than assuming it, and runs the guards of section 14. The document's shape is still checked
  in code. A logo is a name inside a theme's document, not a column, so the library's use of it is
  counted by code: both of the library's usage counters (`images.ts:46-50`) learn a "theme logo"
  use over every row of `custom_themes`, so the library refuses to delete an image any theme names.
  Before go-live any installation may be reset (CLAUDE.md §3), so an old `tenant_themes` row is not
  carried forward (my call).
- **Routes:** `GET /management-api/themes` lists every custom theme — id, name, choices,
  worked-out values and warnings (keys only, section 10) — and which one is in use, so the Look
  card, the Themes card and a supervisor's read-only page all show the same warnings. `POST
  /management-api/themes` creates one (New theme's first save, Save as new theme, Make a copy),
  `PUT /management-api/themes/{id}` saves its choices, `PATCH …/{id}` renames it, `DELETE …/{id}`
  deletes it (the theme in use too, which leaves Waitron's in use), and `PUT
  /management-api/theme-in-use` with `{ customThemeId }` or `null` switches. Today's
  `/management-api/theme` routes go. Gates: section 13. A request naming a theme that is not there
  answers `theme.not_found`.
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
  or `dark_without_light`. For text, `field` is `textScale`, `text.family` or `text.size.sm` (and so
  on), `reason` `bad_value`. Names are refused as `theme.name_taken` (`field: "name"`) when another
  theme has the same name ignoring case, and `theme.invalid` with `field: "name"` and `reason`
  `empty`, `too_long` or `reserved` (the name "Waitron"). Readability goes in the answer's
  `warnings` instead (section 10).
- **Retired:** `THEMEABLE_TOKENS` and `MAX_THEME_VALUE_LENGTH` (`theme.ts:12-22`) and
  `validateThemeOverride`, with their exports (`packages/layouts/src/index.ts:28-29`) and the case
  that checks one (`packages/layouts/src/index.test.ts:7`), replaced by the choice check and the derived token list; the till's unused
  `ThemeOverride` copy (`apps/till/src/layout.ts:58-60`); the `--wt-font-family` override as a raw
  token value (the typeface returns as a Text row with fixed choices, section 5a).
- **Backlog this closes or changes:** the `--wt-color-primary-text` entry (`backlog.md:4504-4510`,
  detail `backlog/dashboard.md:1227-1236`) closes — the theme writes primary text, hover and
  disabled colours; the `tenant_themes` DELETE restriction (`backlog.md:6277-6279`) is answered —
  the table is retired, and deleting a custom theme is an intended path;
  `design-system.md:189-208` is rewritten.
- **Configuration copy:** the theme already travels (`configuration-transfer.ts:72`); the build
  replaces `tenant_themes` in that list with `custom_themes` and moves the bundle format to 6 (slice 2), and adds to `validateCoreConfiguration`
  (section 9) the check of every theme's document, at most one row with `in_use`, and each
  `name_key` recomputed from its `name` rather than taken as sent, including that a logo
  names an image the same copy carries — the library's tables travel too (`packages/media/src/module.ts:21-30`); the
  plan confirms the order in which the two are checked.

## 12. Delivery and refresh

Revised after round 1: a stylesheet linked in `<head>` holds the page until it answers. The reviewer's
`/tmp/a841-review/probe3.mjs`, re-run, printed for a 1.5 s answer no paint until `first-paint@1648`;
for a refused answer `first-paint@12`; and for an answer that never comes no paint and no script run
in 3.2 s of samples. So the theme is **applied from script, from a copy kept in the browser, and
fetched without holding anything** (B4: I chose the stored copy).

- **The answer.** `GET /api/theme` with no session (the colours are not secret, and the signed-out
  dashboard and the till's start screen need them) answers `{ hash, css, logo }`: the section-7
  sheet built from the choices of the theme in use by the current release, or an empty `css` while
  Waitron's theme is in use (no row with `in_use`); `logo`,
  `null` or `{ light, dark }` holding the addresses of the images' "display" renditions (`dark`
  `null` when there is none; section 8a); and `hash`, a SHA-256 of `css` and `logo` together (like
  `setupRevisionOf`, `till-setup.ts:115-117`). A rendition's address names its source and framing
  (`presentation.ts:10-16`), so an edit to the logo in the library changes the hash. A content hash,
  not a row counter, because deleting a theme and creating another could repeat a counter while the
  content differs. The
  server keeps the last answer in memory keyed by which theme is in use and its stored document,
  together with, for each logo
  image, what its rendition address is made of: the image's current source file and framing
  (`packages/media/src/image-page-query.ts:11-17`, read by `readPresentations`,
  `presentation.ts:49-66`, which builds the address from them, `presentation.ts:10-16`). Replacing
  the image's file changes its source (`media_image_edits.source_hash`, `image-page-query.ts:17`)
  and reframing it changes its framing, so either one misses the cache and moves the hash, though
  the theme row has not changed (round 5: keyed by the document alone, the cache served the old
  address). Serving reads the theme row and, with a logo, the image rows; it derives nothing new
  when neither changed, and never waits on anything but those reads.
- **Applied at start-up, in the same step as the token layer.** Each app's `main.ts`, right after
  `applyTokens`, adopts a second sheet holding the copy stored in the browser under
  `waitron-venue-theme` (if any), then fetches `/api/theme` with a time limit; a newer answer
  replaces the sheet's text and the stored copy. Nothing waits on the fetch. The stored copy is the
  whole answer, `logo` included.
- **The logo's place before the answer** (my call, round 5). With a stored copy, the banner, the
  till bar and the till sign-in draw the stored copy's logo, or Waitron's lockup or word when the
  copy has none. With no stored copy, the logo's place stays empty, its height kept, until the
  answer arrives or the fetch's time limit passes; only then does it draw the venue's logo or, with
  none, Waitron's. So no screen draws Waitron's logo and then swaps it for the venue's. The
  trade-off: on a browser's first visit to a venue with no logo, Waitron's lockup appears only when
  the answer does; and a stored copy from before a logo change shows the old logo until the answer,
  as it shows old colours.
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
- **Open dashboards** watch a theme read that depends on `custom_themes` (every core table is a
  change source, section 3), and on `media_images`, so an edit to the logo in the library reaches them too
  (section 3). It is passive (house rule: automatic reads do not keep a session alive) and open to
  every signed-in person, with no permission; on a new hash the shell replaces the sheet's text.
- **Signed-in tills** get a `themeHash` field in `readTillSetup`, the same hash as `/api/theme`'s,
  worked out the same way, so it moves `setupRevision` after a reframe as well as after a save;
  `/api/menu-state` runs `readTillSetup` on every poll (section 3);
  `#applyVenueSetup` fetches `/api/theme` and replaces the sheet. A signed-in till therefore follows
  within one menu-state poll (15 s).
- **Switching and editing.** A switch rewrites two rows' `in_use`, which moves the hash, so every
  open dashboard repaints and every signed-in till follows within one poll, exactly as after a save
  of the theme in use. Saving, renaming or copying a theme that is not in use changes `custom_themes`
  but not what `/api/theme` answers, so the hash stays and no screen repaints; the dashboards' theme
  read re-runs and the Themes card shows the change. A browser's stored copy (above) is the answer
  for the theme in use, so a switch replaces it like any new answer.
- **Signed-out tills** run no poll (section 3): they follow at their next start-up, or at the next
  sign-in, whose first poll carries the new revision.
- **The two versions change nothing here** (checked for the revised Q8 answer). `/api/theme`'s
  `css` already carries both versions — the light values in the first block, the dark values in the
  two dark blocks (section 7) — and `logo` both images, so the hash, the stored copy, the
  dashboards' live read and the till's `themeHash` cover both. A screen whose Theme setting changes,
  or whose device turns dark under Follow device, switches version with no request at all, as it
  switches Waitron's own colours today; saving and switching are unchanged.
- **Fixed until reload:** a kitchen screen in device mode, which runs no poll (backlog A785); it is
  added to that list in `docs/developers/conventions-ui.md`.

## 13. Permissions

My call:

Revised for the move to the Settings section. The rule stays: supervisors see the look; managers
and administrators change it.

- Reading: the read of the themes (section 11's `GET /management-api/themes`, replacing today's
  `GET /management-api/theme`, gated by `layout.configure`
  (`apps/server/src/management-api.ts:1260`) to `venue.view`, like
  `GET /management-api/venue-defaults` (`apps/server/src/location-settings-api.ts:297-302`); a
  supervisor holds `venue.view` but not `layout.configure` (`permissions.ts:46-55`), so the
  read-only card would otherwise be refused.
- Editing: **stays `layout.configure`** for every write of section 11, the permission today's
  `PUT /management-api/theme` checks
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

- Custom themes (section 8b): the routes of section 11 replace `/management-api/theme`. Reading
  the list, and which theme is in use, needs `venue.view`, as reading the look does above; creating,
  saving, renaming, copying, deleting and switching all need `layout.configure`, so a supervisor sees
  the Themes card without its row menus' changing items and without New theme. Switching is not a
  lesser right than saving: it changes every screen as much as a save of the theme in use does.
- The text size and text set by hand are part of the card's save: `layout.configure`.

## 14. What the guards need

- `style-token-names.test.ts`: the theme writes only names already declared in `colors.css` and
  `structure.css`, so no read becomes undeclared. A theme that wrote a name declared nowhere would
  do nothing, and this guard would not see it (its header: it does not see a name written from
  script or as a quoted key). The list `deriveTheme` writes is guarded by
  `packages/ui-core/src/theme/tokens.test.ts` (slice 1), beside the token files it reads, and slice
  2 deletes `theme-registry.test.ts` with `THEMEABLE_TOKENS` rather than changing it (the layouts
  package cannot see `ui-core`'s list without a new dependency): every name declared in the token
  files, and the list the same for every choice. The 22 hand-settable names are that list's colours, so the same guard covers them; a test
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

- Type (section 5a): the list `deriveTheme` writes gains the four sizes, the three weights and
  `--wt-font-family`, written as Waitron's values where nothing is set, so every theme keeps one
  shape; `tokens.test.ts` checks them declared like the colours, and a case pins that the
  mono typeface and Google's typeface, line height, font size and font weight are outside the list;
  a browser case renders the Google button with a theme at 130% and a hand-set Medium weight of 800
  and asserts 14 px and 500. No guard checks that a
  screen reads a size token rather than a number (section 3 found seven that do not); the build's
  130% layout cases (section 5a) are what catch a screen that breaks.
- Custom themes' table (section 11): `scripts/classification-complete.test.ts` refuses an
  unclassified `custom_themes` (the `tenant_themes` entry goes with its table);
  `scripts/schema-constraints.test.ts` holds the two unique indexes to the TypeScript schema —
  weaker than its name, it matches unique indexes and check constraints by name
  (`schema-constraints.test.ts:20-22`; CLAUDE.md §3), so `custom_themes_name_key_uq`,
  `custom_themes_in_use_uq` and `custom_themes_in_use_ck` go into its lists, and
  `tenant_themes_singleton_ck` leaves `EXPECTED_CHECK_CONSTRAINTS` (`:793`); `scripts/migrations-match-schema.test.ts` and `scripts/migration-upgrade.test.ts` run the
  new migration. With no foreign key, `scripts/id-columns-are-references.test.ts` and
  `scripts/two-file-foreign-keys.test.ts` have nothing new to see. Nothing guards "at most one in
  use" but the unique index and its case (section 15), nor the name rules but the `name_key` index
  and the route's cases.
- The Themes card's row menu column is keyed `actions` and pinned to the end, which
  `scripts/pinned-actions-column.test.ts` holds (weaker than its name: it knows the column only by
  the literal key).
- The two versions (section 7) add no guard: they are the light and dark halves `deriveTheme`
  already writes, held by the token-list guard above for both. That a value set for one version
  never moves the other is a case (section 15), not a guard.
- The "Powered by" line and the counter till's logo read existing tokens in `apps/`, which
  `no-hardcoded-chrome.test.ts` does not scan, so review holds them to the token rule; the line's
  strings sit in the two apps' strings files, which `scripts/english-only.test.ts` does not read
  either (it skips `apps/*`, CLAUDE.md §3), so review checks the English file holds English.
- Nothing about the account menu's "Theme" changes, so no guard or pinned string moves for it.

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
  brand colour and a hand-set colour warning on the hand-set one; two hand-set colours failing one
  rule, each offered its own fix (text `#6a6a6a` on sunken areas `#bbbbbb`: both fixes, and either
  taken alone clears its own warning); a sweep of hand-set values in which every failing rule names
  an owner-picked colour and Fix all leaves nothing failing, and a two-colour sweep in which a fix
  taken alone always clears its own warning and Fix all leaves no warning that has a fix; an
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
  blocks with one, and the hash changes on each switch and returns to its first value after switching to Waitron's theme and back; the till's revision moves when
  the theme changes. The six existing cases in `management-api.canvas-retirement.test.ts:146-229`
  are rewritten for the new document, keeping their refusal cases.
- Browser (real Chromium, and WebKit for the start-up probe): the section-7 probe as a test against
  the real token files; probe7's three cases against the real dashboard and till; the dashboard and
  a signed-in till repaint after a save without a reload; the editor's form, `*.unsaved.test.ts` and
  axe tests in both themes; the editor opens with Save quiet and disabled, a saved fix included; a
  warning leaves Save enabled and the bottom message empty; a fix, Fix all and Undo change the draft
  and Cancel undoes them; picking another brand colour drops a fix; the Save dialog — Fix and save
  applies Fix all and is offered exactly when Fix all would leave no warning (a case with a warning
  that has no fix of its own but Fix all clears, and one Fix all cannot), Save anyway stores it as picked,
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
  Use Waitron's look change the draft and Cancel undoes them; Remove on the main image clears the
  dark one too; the plate stays white with Cards set by hand to `#0000ff` (light and dark); with a
  stored copy the logo's place draws its logo before the answer, and with none it stays empty until
  the answer and never draws Waitron's lockup first; phone width; axe in both themes. Server, the
  cache key: reframing the logo's image in the library, with the theme row untouched, must change
  `/api/theme`'s hash and the till's `setupRevision` on its next menu-state call (the control:
  reading twice with nothing changed gives the same hash). The library lists the use as "Logo of
  theme {name}", linking to the Appearance page. Receipts (Q5 A): a department with no receipt logo, and a sale
  with no department, print `printedLogo`; a department with its own prints its own; a department
  whose receipt settings cannot be trusted — the read throws, the stored document is `{bad json`,
  `null`, `[]` or `42`, the stored `logo` is a number, longer than 255 bytes or not a library file
  name, or the department is not found in this location — gets, in each case: no logo on the
  receipt, none on the A4 invoice, no logo image address in the till's ticket view, and, in the
  Receipt tab's preview of a draft that names its logo, that logo drawn from its image, never
  `printedLogo`; the sale still prints (the control, for every case: the same department with a
  working read and a readable logo prints its own, and with no receipt row prints `printedLogo`); a configuration
  copy whose look names a logo with no readable pictures is refused; Remove, and Use Waitron's look,
  saved, stop the venue logo printing; reframing the image redraws `printedLogo`; the card says when
  the logo prints blank (a white image on a see-through background must, and a black one must
  not).

- Text size and text set by hand (section 5a). The derivation: each step from 100% to 130% gives
  the four sizes as Waitron's times the step rounded half up to whole pixels, a hand-set size the
  same way, and nothing else changes; section 5a's worked example at 130% as cases (Use 22 px for a
  Largest text of 25, Use 9 px for a Small text of 8, each clearing its note or warning); a size the screens would draw under 12 px warns, with the
  smallest whole size that draws at least 12 px at the current step as its fix; Waitron's own theme
  at 100% does not warn (the control); a size drawn above the rounded limit (16, 18, 23, 29 px) gives
  the note and never a warning, and Waitron's own theme at 130% gives no note (the control); a Small
  text fixed to 9 at 130% warns again when the slider moves to 100%; weights and typefaces never warn. Server: `textScale` outside 100–130 or off the 5% steps,
  a size outside 8–40, a weight outside the list and an unknown typeface are refused as
  `theme.invalid` naming the field; a 10 px Small text is stored and answered with its warning. The
  layout cases at 130% of section 5a in the till's and dashboard's suites, each with a control at
  100% that already passes. The equipment label and the recovery sheet print Waitron's sizes with a
  theme at 130% (a case that sets the theme and reads the printed frame's tokens). Browser: the
  slider changes the preview, its line of sizes and nothing outside the preview until Save; Advanced's
  five sections start closed, a section holding an error opens, a section with a warning shows its
  count closed, a section stays as left until the editor closes and starts closed when it opens
  again; phone width; axe in both themes. The Google button keeps 14 px and 500 under a theme at 130%
  (section 5a). The 130% layout cases assert no word breaks without a hyphen, with "Champiñones al
  ajillo" among the names. The name dialog: its messages under the field and the one at the bottom,
  Save disabled until fixed, Rename quiet until changed, Make a copy and Save as new theme open
  savable, a proposed name never over 60 characters, and its `*.unsaved.test.ts`.
- Custom themes (section 8b). Server: create, save, rename, copy and delete each change only their
  row; a name clash ignoring case is `theme.name_taken` and "waitron" is refused; deleting the theme
  in use leaves no row with `in_use` and `/api/theme` empty (a control: deleting
  a theme not in use leaves the hash unchanged); a second row set to `in_use = 1` is refused by the unique index while two NULLs are not
  (the control);
  switching moves `/api/theme`'s hash and the till's `setupRevision`, and saving a theme not in use
  moves neither; the list answers each theme's warnings, to a supervisor too, whose writes are all
  refused; a configuration copy carries `custom_themes`, is refused with two rows in use, and recomputes
  `name_key`; the image library refuses to delete an image any theme names and frees it
  once no theme does. Browser: the Themes card's row menus per kind of row; the name dialog's switch
  defaulting on for the theme in use and off otherwise; the first save from Waitron's theme asking a
  name; the switch dialog listing a saved warning; the delete dialog's sentence for the theme in use;
  Save and Cancel on a theme not in use leave the page's own look alone; phone width; axe in both
  themes.
- The two versions (section 7). Derivation: a value set by hand for the dark version only, Main
  buttons among them, leaves every light token exactly as it was (the control: the same value set
  for the light version moves light tokens); a dark Main buttons set by hand drops the dark fix and
  its family follows it, with section 7's Bar Lucía case (`#5fa77a`, no dark rule failing) and its
  control (no fix, no own colour: three rules failing). Browser: under Light, Dark and Follow device
  with the operating system light and dark, a screen paints the version its setting picks (section
  7's probe, now with a theme whose two versions differ); changing the setting or the system mode
  repaints with no request to `/api/theme` (count the requests); the logo's dark image follows the
  same setting; **Pick a different colour for dark screens** opens Advanced at Buttons with the dark
  Main buttons value ready, and **Use the brand colour** puts it back.
- "Powered by Waitron" (Q6 A). Browser: on the dashboard's sign-in page and the till's and
  handheld's sign-in screen it shows under the form exactly while a venue logo is in use, and not at
  all with none (the control); it is drawn after the PIN pad as well as after the list of names; its
  image is 64 px wide and swaps to the dark drawing under Dark; a screen reader's name for it is
  "Powered by Waitron"; phone width; axe in both themes.
- The counter till's logo (section 8a). Browser, with form factor `till`: at 1280 × 800 with the
  busy bar of the measurement the logo is drawn first in the bar; at 1024 × 768 with the same bar in
  Spanish it is left out and no work control moves or scrolls because of it (the control: the same
  bar with no logo set measures the same); a quiet bar at 1024 × 768 draws it; a handheld still draws
  it where the word is drawn today and leaves it out by the same rules.

## 16. Build slices (each one pull request)

The build takes the full review path: it changes permissions on a route (section 13) and a contract
between packages (the theme document and `/api/theme`), and what a receipt prints (Q5 A).

Re-cut for the answers to Q5 to Q8 (2026-10-20). **Only slice 2 adds a migration** (`custom_themes`
created, `tenant_themes` dropped); no other slice touches the schema, because the two versions, the
logo, its printed dots, the text and the fonts seam all live in the theme's document (section 11).
Each slice is one pull request that leaves main working: nothing on main reads or writes
`tenant_themes` or `/management-api/theme` but the code slice 2 retires with them (`git grep -n
"management-api/theme\|getTenantTheme\|putTenantTheme"` over non-test files found only
`apps/server/src/management-api.ts`, `packages/layouts/src/index.ts` and `theme-store.ts`); until
slice 5, no screen writes a theme, so `/api/theme` answers empty and every screen stays Waitron's;
and each later slice adds to a screen that already works without it. The order: 1, 2, 3, then 5;
4 at any point; 6 and 12 after 5; 7 after 2; 8 after 5 and 7; 14 after 8; 9 after 8 (its "How it
prints" lines sit under the Logo field, which slice 8 adds); 10, 11 and 13 after 5.

1. **The derivation and the shared checks.** `deriveTheme`, the contrast rules moved out of
   `colors.test.ts`, the sweep, the token-list guard. No screen. Hand-set values may be their own
   slice (1b) if this one grows past one implementer: fixed inputs, the settling steps of section 6,
   the hand-set sweep.
2. **The stored themes and the server.** The migration: `custom_themes` created and `tenant_themes`
   dropped (section 11), generated with drizzle-kit and its SQL read before it is committed; the theme document, the list, create, save and switch routes and
   their read permission (a supervisor reads, and is refused every write), `brandFix`,
   `theme.invalid` with `field` for invalid choices only, `warnings` in the answers, the import
   check over both tables, `/api/theme` serving the theme in use, the till's `themeHash`; retire
   `tenant_themes` everywhere it is named — its schema file `packages/db/src/schema/tenant-themes.ts`,
   its export `packages/db/src/index.ts:174`, its classification and transfer entries, and
   `"tenant_themes_singleton_ck"` in `scripts/schema-constraints.test.ts:793`; the configuration
   bundle format moves from 5 to 6, as the A757 retirement moved it to 5 (`eb16d3805`: "moves to
   format 5 as A182 part 2 and A725 did"), because the import accepts only `version === 5` and answers
   `setup.configuration_outdated` for older ones (`apps/server/src/configuration-transfer.ts:483-486`)
   but refuses an undeclared table with the generic `setup.request_invalid { field: "tables" }`
   (`:565-569`), so a version-5 bundle carrying `tenant_themes` must be refused as outdated, with a
   "pre-theme-retirement export" case beside the older formats in `configuration-import.test.ts`;
   `THEMEABLE_TOKENS`, `validateThemeOverride`, the till's copy, `/management-api/theme`
   (`apps/server/src/management-api.ts:1260,1274`), `getTenantTheme` and `putTenantTheme`
   (`packages/layouts/src/theme-store.ts`, exported at `packages/layouts/src/index.ts:79`) with their
   tests (`packages/layouts/src/theme-store.test.ts`, and the six cases of
   `management-api.canvas-retirement.test.ts`, rewritten for the new routes). If this
   grows past one implementer, the migration and the import check are their own slice (2a).
3. **Delivery.** The stored copy and the fetch in the dashboard's and till's `main.ts`, the
   dashboard's live read, the till's `#applyVenueSetup` swap, the start-up probes in Chromium and
   WebKit, the fixed-until-reload entry.
4. **Primary-coloured text.** Move the text uses of `--wt-color-primary` to `--wt-color-primary-text`
   and add the guard.
5. **The editor.** The Appearance page in the side menu's Settings section, the Look card,
   preview with its "Light version" and "Dark version" panels and the line naming the Theme setting
   (section 7), the brand colour's warning, fix and Undo, Fix all, the Save dialog, the saved card's
   warning line and its note, Spanish strings, and the design-system rewrite of
   `design-system.md:189-208` beside "Retheming a deployment"; the user guide gains the page.
6. **Advanced.** The closed section and its summary, the 22 rows with picker and code field, Set by
   hand marks, Use worked-out colour, Reset all to worked-out, the kept-colours note, warnings and
   fixes under rows, the closed line's "hard to read" count, the dark version's own button colour
   (**Pick a different colour for dark screens**, the card's "Buttons on dark screens: …, set by
   hand · Use the brand colour" line and the saved card's brand row, section 7), and their
   `*.unsaved.test.ts` and axe cases. Slice 6 does not wait for slice 12 (my call): until slice 12
   folds Advanced into sections, the link opens Advanced, which is then one flat list, and moves
   focus to the Dark value of its Main buttons row; slice 12 changes it to open the Buttons section
   first, with a case for each.
7. **The logo, stored and served.** The document's `logo`, its validity check (`dark_without_light`
   included) and the import check; the library's new use, a `theme_logo` member of `ImageUsage`
   (`images.ts:53`) counted in both counters; `/api/theme`'s addresses, its cache key over the
   images' source and framing, and its hash; the till's `themeHash`; the dashboard theme read's
   dependency on `media_images`; and `printedLogo` — drawn from the light image outside the
   transaction on every save that sets or changes the logo, redrawn on a library edit, required
   beside a logo and checked on import (section 8a) — stored though nothing prints it yet.
8. **The logo on the screens.** The Logo field, the preview's banner strip and the saved card's row;
   the banner, the handheld's bar and the till and handheld sign-in screen, each image following
   the Theme setting (section 7); the plate and its token, `--wt-color-logo-plate`; what the logo's
   place shows before the first answer, while loading and on failure; the "Powered by Waitron" line
   under both sign-in forms (Q6 A, section 8a), with `login.powered_by` in both apps; Use Waitron's
   look removing the logo; the strings in both languages; the image library's wording and link for
   the new use ("Logo of theme {name}", to the Appearance page, `image-library.ts:36-63`); the user guide's
   Appearance page, and its image library page's list of uses in English and Spanish
   (`guide/en/content-and-images.md:170,214-217`, `guide/es/content-and-images.md:182,229-232`).
9. **The logo on receipts and A4 invoices** (Q5 A). The receipt and invoice paths' fallback to the
   theme in use's `printedLogo`, for departments with no receipt logo and for sales with no
   department, the department's own still first (section 8a); `readPrintedDepartmentReceipt`'s
   `unreadable` answer and no logo on it, in all four places that read a department's receipt
   settings (section 8a); the till's ticket view and the department Receipt tab's preview; "How it prints" and the blank-print line on the Look card.
10. **Text size.** `textScale` in the document and in `deriveTheme`'s list with the four sizes,
    rounded to whole pixels; the slider on the Look card, its line of sizes and the preview's till
    button and bill line; the saved card's row; the equipment label and the recovery sheet keeping
    Waitron's type; the Google button's own `--wt-google-button-font-size` and
    `--wt-google-button-font-weight`; `hyphens: auto` and a `lang` on the till's product button names
    and bill line names; the 130% layout cases in the till's and the dashboard's suites (section 5a).
    `wt-slider` gains what the card needs, with the token-painting and axe cases a changed primitive
    takes (CLAUDE.md §3): today it shows the bare number in `<span part="value" aria-hidden="true">`
    and has no unit, hint or `aria-valuetext` (`packages/ui/src/components/wt-slider.ts:52-61,92-96`),
    so it gains a value format (to show "115%"), a hint below it, an accessible value text read
    from the strings ("115 percent"), so a screen reader hears the unit, and a mark at each step under
    the track with the value drawn at the track's end, as the pictures show (today the value sits on
    the label row, `wt-slider.ts:94-97`, and there are no marks).
11. **Text set by hand.** The `text` part of the document and its validity check; the two weights
    written as numbers on themed screens moved to tokens (`font-weight: 600` at
    `apps/till/src/widgets/basket.ts:293`, the till's bill, and
    `apps/dashboard/src/screens/payments-screen.ts:215`), so a hand-set Bold weight reaches them;
    and a rule in the shared base styles, `strong, b, h1, h2, h3, h4, h5, h6, th { font-weight:
    var(--wt-font-weight-bold) }`, with a browser case, because neither base style sets those today
    (the round-7 reviewer read `packages/ui-core/src/base-styles.ts` and `packages/ui/src/base-styles.ts`)
    and the browser's own bold does not read the token: rendered in Chromium 156.0.8078.4
    (`/tmp/a841t-r7/bold.mjs`) with the Bold weight set to 800, `<strong>`, `<h1>` and `<th>`
    computed 700 without the rule and 800 with it, while a span reading the token computed 800 both
    times (the control that the setting was there); the Text section's
    eight rows, Set by hand, Use worked-out, the too-small warning and its fix, the larger-than-checked
    note; the typeface choices — "The device's own" and "Serif" only — read from one exported list,
    and `typefaceStack()` as the one place a choice becomes CSS (the seam of section 5a); the saved
    card's "Text set by hand" row.
12. **Advanced in sections.** The five sections, their closed lines and "hard to read" counts, what
    opens and what is remembered (section 5a); their `*.unsaved.test.ts` and axe cases. It can go
    with slice 6 if that one has not been built yet.
13. **The Themes card.** The list, its row menus, New theme, the name dialog for Save as new theme,
    Make a copy, Rename and the first save from Waitron's theme, the switch dialog, the delete dialog,
    editing a theme not in use, the image library's per-theme use wording ("Logo of theme {name}"),
    the rename, copy and delete routes, the strings in both languages, and the user guide's
    Appearance page.
14. **The counter till's logo.** The counter till's bar measures its till strip, as the handheld's
    does, and draws the logo first while the strip has room for it, leaving it out first when not
    (section 8a); its cases at 1024 × 768 and 1280 × 800 in English and Spanish, the busy bar of the
    measurement among them.

No slice renames the account menu's "Theme" (Q8 revised): the rename slice of the earlier draft (then
numbered 14) is gone, and its number now belongs to the counter till's logo, and CLAUDE.md, `design-system.md` and the strings keep the word. Uploaded fonts are not a
slice of A841 (Q7 B): they are their own backlog item, after A841, plugging into slice 11's seam.

The path stays FULL: the new table and the reshaped one are a migration, and switching adds a
permission-gated write (CLAUDE.md's risk triggers).

### The answers, and the branches not taken

- **Q1** is answered (both, A by default and B behind Advanced); this design already holds it.
- **The extra question** is answered A (2026-10-20): colours set by hand are kept when a main choice
  changes. Not taken: B, which would have cleared `handSet` in the draft whenever Brand colour or
  Background changed, with a note naming what was put back.
- **Q2** is answered, and with neither A nor B (warn and offer the fix, never refuse); this design
  holds it. One choice inside it is mine, not the owner's: Save asks once before saving a warning
  unfixed (section 9). If the owner would rather Save never asked, the dialog goes and Save stores as
  picked at once, the card's warning line staying; nothing else changes.
- **Q3** is answered A (2026-10-20): one look for the whole business, the same on every device
  (confirmed: "And the same look in all devices"). Custom themes (section 8b) keep that: several
  are saved, one is in use everywhere. Not taken: B, several named looks each chosen by a device
  profile.
- **Q4** is answered with neither A nor B (2026-10-20): a slider (its range, 100% to 130%, is my
  call), text set by hand under Advanced, and Advanced in sections (section 5a). Not taken: A (no text size) and B (Standard or Large, about
  30% bigger).
- **Q5** is answered A (2026-10-20): the logo also prints where no department receipt logo applies
  (slice 9). Not taken: B, screens only, which would have dropped slice 9 and `printedLogo`.
- **Q6** is answered A (2026-10-20): the venue's logo in Waitron's place and "Powered by Waitron"
  under both sign-in forms (slices 8 and 14). Not taken: B, no Waitron logo at all on the venue's
  screens; C, both logos side by side.
- **Q7** is answered B (2026-10-20): uploaded fonts are wanted, designed and built after A841 as
  their own item; A841 ships the device's fonts and the seam (section 5a). Not taken: A, the
  device's fonts for good.
- **Q8** is answered, revised (2026-10-20, about 06:00): every theme has a light and a dark version
  that switch with the Theme setting, which keeps its name (section 7). Superseded: the about 05:45
  answer, B, "Screen mode", and with it the rename slice; also not taken: A, "Light or dark".
- **A warning's station colours** (lane A ruling 2026-10-20, on the slice 1 plan review): the
  station fills a colour fails against are named as one item ("the 15 station colours", or "{n}
  station colours"), and the station dots likewise ("the 15 station dots"). Not taken: naming each.
- **When Fix and save is offered** (lane A ruling 2026-10-20): when running Fix all would leave no
  warning, decided by running it; the dialog's fix applies Fix all. Not taken: only when every
  warning has a fix of its own, which withheld it where another colour set by hand was the blocker.
- **A warning blocked by another colour set by hand** (lane A ruling 2026-10-20): its sentence names
  the blocking colour and its value ("… while Sunken areas is set by hand to #000000"); with no
  blocker it stays as it was. Not taken: naming only the colours it fails against.

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
  handheld's bar already drops its first item when short of room. Mitigation: fixed boxes (section
  8a), and the bar's existing rules.
- **On a 1024-wide counter till the logo can come and go.** Measured: a busy bar has 54 px left in
  English and none in Spanish, a quiet one 343 px or more (section 8a), so the logo shows while the
  bar is quiet and steps aside as Parked, Waiting, transfers and the kitchen pass appear. Mitigation:
  it is the first thing to go and no work control moves for it; on the usual 1280-wide till it stays.
- **The plate is a light patch on dark tills.** Mitigation: the optional image for dark screens.
- **The logo is public on the venue's network.** Library images are served with no session
  (section 3), so anyone who can reach the box can fetch the logo by its address; a logo is meant to
  be seen, and this exposes nothing new, but a wrong file uploaded by mistake is public until
  replaced.
- **Saving a logo, or switching themes, changes printed receipts and A4 invoices** of every
  department with no receipt logo of its own, from the next one. Mitigation: the card says so beside
  the logo and shows how it prints; a department's own receipt logo is untouched.
- **Text size was measured on one machine's fonts, in Spanish.** The 130% top, and hyphenation
  keeping long words readable at it, rest on probes in Chromium on macOS with Spanish names
  (section 5a). Chromium does not hyphenate English (macOS 156 and Linux 153, the round-7 reviewer's
  run), so a venue whose default content language is English keeps long names breaking mid-word from
  115%; WebKit and the tills' own browsers were not measured. Android and Windows tills, and CI's Linux runners, draw other fonts; a wider
  one wraps sooner. Mitigation: the build's 130% layout cases run in CI on every change, and the
  probe's screens are the busiest the till has; screens the probe did not render (dialogs, the
  kitchen screens, the dashboard beyond the product editor) are covered only by those cases.
- **Larger text means more scrolling on a stacked till.** At 1024 × 768 the counter already
  scrolls at 100% (section 5a); at 130% it scrolls further. Nothing is cut off; it is the price of
  bigger text on a small screen, and the slider's line of sizes and the preview show it.
- **A hand-set size can leave the measured range.** The "larger than checked" note says so and
  offers the largest checked size; the owner can keep it.
- **Switching changes every till within 15 seconds**, by one manager's press. Mitigation: the switch
  asks once and says so, and a switch is undone the same way. Deleting the theme in use puts
  Waitron's theme on every screen; its dialog says so.
- **A switch can change text size under a waiter's finger.** Switching between themes with
  different text sizes reflows every signed-in till's buttons within one poll, at a moment nobody
  chose. My call: apply it like every other theme change, not at the till's next idle moment or
  sign-in. A switch is a rare, deliberate manager action; its dialog says "Text on the tills
  changes size too." when the sizes differ (section 8b); and holding one change back per till
  would need a second "pending look" state on every till for one case. The trade-off: a waiter
  mid-order sees the grid move once.
- **"Theme" names two things** (the owner's choice, Q8 revised): the account menu's Light / Dark /
  Follow device setting and the venue's custom themes. A waiter who opens their menu to make the till
  dark reads "Theme" and might expect the bar's Christmas look. Mitigation: the setting's three
  buttons say exactly what they do; the custom themes live only on the Appearance page, which says
  that each screen shows the light or dark version "as its own Theme setting says"; and the setting
  now chooses a version of the theme in use, so the two meanings fit together.
- **A stale design-system sentence** (`design-system.md:108-110`), backlog A899, narrowed in round 1:
  a bare `[data-wt-theme-root]` selector wins over the token layer in all six cases of probe.mjs's
  third variant; a bare `[data-theme]` selector matches nothing under Follow device, which removes
  the attribute (`theme-choice.ts:28`), so the advice against that one has a real reason, just not
  the written one.

## 18. Mock-ups

In `docs/backlog/mockups/a841-theme-editor/`, built from the real token files with Playwright's
Chromium (sources and the prototype outside the repository, in
`/Users/clintongormley/waitron-campaign/a841-mockups-src/`; `A841_WT=<worktree> node build.mjs`
there re-renders every picture except 08, 09, 10, 11, 14, 23, 24, 35 and 36, which it leaves as the owner saw
them; 27 is built from the screenshots of section 5a's probe, kept in `text-size-probe/` there). The
Q4 and custom-themes revision (2026-10-20) redrew 01 to 05, 12, 13, 15, 16, 17, 18 and 20 to add the
Look card's "Theme in use", Text size and "Text set by hand" rows, the editor's line naming the theme,
its slider, the preview's till button and bill line, Save as new theme, Advanced's sections, and the
Themes card under the saved card; before any change, a rebuild of the unchanged sources into this
worktree left every picture byte for byte as committed (`git status` clean), and after it 06, 07, 19,
21 and 22 were still unchanged. Round 6 redrew 02, 03, 12, 13, 15, 25, 26, 28, 29 and 30: Save as
new theme is no longer drawn quiet (section 8b), Advanced's opening line says a hand-set text size
grows with Text size, the text warning's words follow section 9's quote, and the stylesheet carries
whole pixels (section 5a). Round 7 redrew 03, 13, 18, 25 (light and dark), 26 and 29: "px" no
longer wraps away from its number, and at phone width the editor's buttons wrap inside the card
instead of running past its edge (29's did since d147208c4). The slider's step marks and its value
at the track's end, which these pictures draw, are listed as `wt-slider` additions in slice 10. Since Q2 every
picture shows colours as picked; Bar Lucía's saved look has taken the fix for her green on dark
screens. Pictures 01 to 16 show her look before she uploads a logo; the logo revision (2026-10-20)
redrew 01 to 05, 12, 13, 15 and 16 to add the Logo row or field and the preview's banner strip, and
06 to show the word "Waitron" where the till's bar has it (section 3: it had shown "Bar Lucía");
07 rendered the same file as before. Pictures 17 to 24 show the logo. After review round 5, 22 gained
the till sign-in's Theme and language corner (`till-lock-screen.ts:312-318`) and 23 lost its third
option; making the plate a white token of its own changed no picture, since every plate drawn was
already white (a rebuild changed only 22 and 23). The side menu is the one a
manager sees on that page: every group starts folded and the open page's group unfolds
(`apps/dashboard/src/dashboard-app.ts:863-867`), and the Settings group lists the eight pages a
manager may open — all of `dashboard-app.ts:280-291` but Servers, which needs `mirror.create`, an
admin's permission (`permissions.ts:56-83`). The Q5–Q8 revision (2026-10-20): before any change, a rebuild of
the unchanged sources into this worktree left every picture byte for byte as committed (`git status`
clean). Then the editor gained the preview's "Light version" and "Dark version" headings and the line
naming the Theme setting, and the link **Pick a different colour for dark screens**; the saved card's
note now says each screen shows the light or dark version; "Powered by"'s lockup is drawn 64 px wide;
and a counter till's bar draws no "Waitron" word (section 3). That redrew, keeping their numbers, 01,
02, 03, 04, 05, 06, 12, 13, 15, 16, 17, 18, 20, 22, 25, 26, 28, 29, 30, 31 and 32; 07, 19, 21, 27 and
33 rendered the same files as before. 34 showed the "Light or dark" rename, now not wanted, and is
deleted (it stays in git history); 35 and 36 are now kept unchanged as the records of what the
owner saw for Q7 and Q8. New: 37 to 42. Round 8 then redrew, keeping their numbers: every counter
till's bar (06, 19, 21, 40) as main draws it — Counter and Floor, Parked orders and Waiting, the help
switch, the name and the menu button, no Bills tab; the signed-out Theme chooser (22, 40, 41) as the
icon button it is (`packages/ui/src/components/wt-theme-chooser.ts:117-126`), its "Theme: …" name
heard only by screen readers; the "·" kept on the same line as Undo or Use the brand colour (02, 03,
05, 12, 13, 15, 17, 18, 25, 26, 28, 29, 30, 37, 38); and the account menu in 39 widened so "Follow
device" stays on one line. Round 9 redrew 03, 13, 18, 26, 29, 37 and 38 so a link that wraps onto a
line of its own (Undo at phone width, Use the brand colour) drops the "·". In the editor pictures only the preview shows the draft;
the dashboard around the card, the card included, keeps the saved look (section 4, step 4):

| File | Shows |
| --- | --- |
| `01-appearance-card-{light,dark}.png` | The Appearance page in the side menu's Settings section: the saved Look card, with Bar Lucía's look applied to the dashboard; Logo "None"; the Brand colour row names her dark-screens fix |
| `02-editor-{light,dark}.png` | The editor just opened, with its Light and Dark preview, Advanced closed; under Brand colour, "Buttons on dark screens: #417c59 · Undo"; Save quiet and disabled until something changes, Use Waitron's look in its own variant |
| `03-editor-phone-light.png` | The editor at 390 px, just opened, Save quiet and disabled |
| `04-hard-to-read-light.png` | Café Limón's lemon as picked: the warning under Brand colour with its fix, **Use #9f8b18 on light screens**; the light preview shows lemon buttons. Replaces `04-adjusted-light.png` |
| `05-fixed-light.png` | The same after pressing the fix: "Buttons on light screens: #9f8b18 · Undo", the light preview in mustard, dark still lemon. Replaces `05-refused-light.png` |
| `06-till-{light,dark}.png` | A till counter screen in Bar Lucía's look, with no logo set. Its bar is drawn as main draws a counter till's (`till-shell.ts:996-1008`): the Counter and Floor tabs (`built-in-screens.ts:6`), Parked orders and Waiting, then the help switch, the person's name and the menu button, whose menu holds Find a bill (`till-shell.ts:889`); there is no Bills tab. Product tiles keep their own colours |
| `07-dashboard-{light,dark}.png` | The Products screen in Bar Lucía's look |
| `08-q1-knobs-or-every-colour-light.png` | Q1 options side by side, kept unchanged as the record of what the owner saw when they answered (2026-10-19). Superseded by 02 and 12: its B side says 23 colours and has no Set by hand marks |
| `09-q2-adjust-or-refuse-light.png` | Retired: Q2's options side by side, kept unchanged as the record of what the owner saw when they answered (2026-10-19), as 08 is. Its A side (silent darkening) and B side (refusal) are both superseded by 04, 05, 15 and 16 |
| `10-q3-one-theme-or-per-device-light.png` | Q3's options side by side, kept unchanged as the record of what the owner saw when they answered A (2026-10-20) |
| `11-q4-text-size-light.png` | Q4's options side by side, kept as the record of what the owner saw when they answered (2026-10-20; its till bar still shows "Bar Lucía", section 3) |
| `12-advanced-{light,dark}.png` | Advanced opened, with Page and surfaces opened and the other four sections closed: Bar Lucía's light page set by hand to cream in the draft, marked, beside worked-out colours; her dark page still worked out. The saved look around the card has no cream |
| `13-advanced-phone-light.png` | The same at 390 px: each row stacks its Light and Dark values |
| `14-q-hand-kept-or-put-back-light.png` | The extra question: with the cream page saved, the brand changed to burgundy in the draft; the cream page kept (A) or put back (B). On both sides the green's dark fix is dropped with the green, so burgundy warns for dark screens with its fix. Kept unchanged as the record of what the owner saw when they answered A (2026-10-20); its left side is the behaviour now decided |
| `15-hand-set-and-dark-warnings-light.png` | Left: Bar Lucía with the cream page saved, the sage typed for Secondary text and her green's dark fix not yet taken — two warnings, the sage's under its row with **Use #526a5b**, the green's under Brand colour with **Use #417c59 on dark screens**, and "2 colours are hard to read. · Fix all" above the buttons. Right: the same after Fix all, the sage row showing "Light screens: fixed from #8fa898 · Undo" until the editor closes. The sage's row is in the opened Text colours and links section. Replaces `15-q2-hand-set-adjust-or-refuse-light.png`, which the owner saw beside 09 (in git history at 1f88662fb). Drawn before the station-fill rules were counted (slice 1 plan): its sage row names three colours, where the build's reads "Selected item, Field background, Switched-off field background and the 15 station colours"; not redrawn, and that grouped item is the one difference. |
| `16-save-hard-to-read-light.png` | Left: Save pressed with the lemon unfixed — the "Hard to read" dialog with Back, Save anyway and Fix and save. Right: after Save anyway — the lemon on the page and on a till's Pay button, and the warning line on the saved card |
| `17-logo-editor-{light,dark}.png` | The editor just after Lucía, the manager, uploads the bar's logo: the Logo field with Replace and Remove, "+ Add a version for dark screens" with its hint, and the preview's banner strips — the logo on the light panel, on a plate on the dark one. The dashboard around the card still shows Waitron's lockup: the logo is not saved yet |
| `18-logo-editor-phone-light.png` | The same at 390 px |
| `19-logo-dark-plate-or-version-dark.png` | Dark screens, the banner and a till bar: with one image, drawn on a white plate (left); with a second image for dark screens (right); the till bar is a counter till's as main draws it |
| `20-logo-banner-{light,dark}.png` | After Save: the banner shows the bar's logo before "BAR LUCÍA S.L." (on a plate in dark), and the saved card's Logo row says "Dark screens: on a light plate" |
| `21-logo-till-{light,dark}.png` | A till counter screen with the bar's logo at the start of the top bar, a bar with room for it (section 8a) |
| `22-logo-sign-in-{light,dark}.png` | The dashboard's sign-in page and a till's sign-in screen, with its Theme and language corner, showing the bar's logo, and "Powered by" with Waitron's lockup under each (Q6 A) |
| `23-q5-logo-on-receipts-light.png` | Kept as what the owner saw when answering Q5 A. Q5's options side by side: A, one upload that also prints, with "How it prints" and a receipt carrying the real 80 mm dots of the logo; B, screens only and a receipt with no logo, as today |
| `24-q6-waitron-logo-light.png` | Kept as what the owner saw when answering Q6 A. Q6's options side by side, each as the dashboard's sign-in page and a signed-in till bar: A, the bar's logo in Waitron's place and "Powered by" on the sign-in page; B, the same without "Powered by"; C, both logos |
| `25-text-size-editor-{light,dark}.png` | The editor with Text size moved to 120% in the draft: the slider, its line of sizes, and both preview panels drawing the till button and bill line at that size (section 5a) |
| `26-text-size-editor-phone-light.png` | The same at 390 px |
| `27-text-size-top-step-{light,dark}.png` | The probe's screenshots of the real counter screen at 1280 × 800 in Bar Lucía's look, 100% beside 130%, the top step (section 5a). The probe's products carry no colour of their own, so the product buttons are drawn plain; the runner framed the screen at 1152 × 720 |
| `28-advanced-sections-light.png` | Advanced opened with every section closed, each closed line saying what is set by hand (Page (light), Normal text); and the same with Text opened |
| `29-advanced-sections-phone-light.png` | At 390 px: every section closed; and Page and surfaces opened |
| `30-text-too-small-light.png` | The Text section with Typeface set by hand to Serif and Small text to 10 px, its warning "Small text: 10 px is smaller than 12 px; text that small is often hard to read." with Use 12 px (at 100%, so no bracket); the preview drawing serif and 10 px |
| `31-themes-{light,dark}.png` | The Appearance page: the Look card for the theme in use and the Themes card listing Waitron (built in), Bar Lucía (In use), Christmas and Summer terrace ("1 hard to read"), with Christmas's row menu open |
| `32-themes-phone-light.png` | The same at 390 px, the colours column left out |
| `33-theme-save-and-switch-{light,dark}.png` | Make a copy's name dialog ("Christmas", Use it on every screen now off), and the switch dialog — for Christmas (light) and for Summer terrace with its warning listed (dark) |
| `35-q7-typefaces-light.png` | Kept as what the owner saw when answering Q7 B. Q7's options side by side: A, Typeface offering "The device's own" and "Serif"; B, also an uploaded font, with its licence line; each with product buttons in that face (B's in a script face standing in for a venue's own) |
| `36-q8-theme-naming-light.png` | Kept as what the owner saw before the revised Q8 answer. Q8's options side by side: the account menu's item as "Light or dark", "Screen mode" or "Theme", beside the Appearance page's Look and Themes names |
| `37-theme-versions-{light,dark}.png` | The editor showing a theme's two versions: Bar Lucía's dark version given its own button colour, `#5fa77a`, through **Pick a different colour for dark screens** — the line "Buttons on dark screens: #5fa77a, set by hand · Use the brand colour" under Brand colour, the preview's light version still `#1e5b3a` beside the dark version in the lighter green, and Advanced's Buttons section open with Main buttons' Light value "Brand colour" and Dark value "Set by hand", its family worked out from it |
| `38-theme-versions-phone-light.png` | The same at 390 px: the light version's preview above the dark version's, each Advanced row stacking its Light and Dark values |
| `39-account-menu-theme-light.png` | The account menu with its Light / Dark / Follow device item still called "Theme" (Q8 revised), over the Appearance page, whose note says each screen shows the light or dark version as its Theme setting says |
| `40-logo-on-screens-{light,dark}.png` | The four places the logo appears: the signed-in dashboard's banner; a counter till's bar with the logo first, and a busy bar (two counter zones, Parked orders 3, Waiting 2, Transfers, Pass) that leaves it out, its strip scrolling as today; the dashboard's sign-in page and a till's sign-in screen, each with "Powered by" and Waitron's lockup under the form, and the signed-out Theme chooser drawn as its icon button. The dark picture uses the logo's own dark version |
| `41-logo-on-screens-phone-light.png` | At 390 px: the signed-in dashboard's banner, the sign-in page with "Powered by" under the card, and a handheld's sign-in screen with "Powered by" under the names |
| `42-logo-on-receipt-and-invoice-light.png` | Left: the bar department, with no receipt logo of its own, prints the venue's logo (the real 80 mm dots) on its receipt and at the top of its A4 invoice. Right: the terrace department's own receipt logo wins on both (a drawn stand-in, not the real dither output) |

## 19. Questions for the owner

**Q1 — How much can the owner change? ANSWERED 2026-10-19:** "A by default, with advanced
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

**Q2 — What happens when a chosen colour would be hard to see? ANSWERED 2026-10-19** (about
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

**Q3 — One look for the whole business, or one per kind of device? ANSWERED 2026-10-20**
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

**Q4 — Should the look also make text bigger? ANSWERED 2026-10-20** (about 02:20, through the
watcher), with neither A nor B, in the owner's words: "More granular. Allow a slider for text sizes,
but under advanced also allow overwriting the font faces, size etc for each place we set it. Put
choices behind collapsible sections to make all of the advanced choices more manageable". Folded
in: section 5a — a Text size slider, 100% to 130% in 5% steps, the top measured; a Text section
under Advanced setting the typeface, the four sizes and the three weights by hand, with the
too-small warning; Advanced in five folding sections. Where I read the words differently from the
watcher's note: "each place we set it" as each named type setting rather than each screen element
(section 5a says why), and "etc" as weight, leaving line height out because it is not a setting
today. The question file tells the owner that reading in one line, with an example, so they can
correct it (round 6). The typeface's choices are Q7. Picture `11-q4-text-size-light.png` is kept as what the owner
saw. The question as asked:
A waiter at Bar Lucía finds the till's text small. With A, the look changes colours and corners
only, and bigger text becomes a separate item that can be tested screen by screen. With B, the card
gains "Text size: Standard / Large", and Large makes all text on every till and dashboard about 30%
bigger at once, so longer names wrap (in the picture "Tinto de verano" takes two lines). Pictures:
`11-q4-text-size-light.png`.

- **A (recommended):** no text size in the look; bigger text is its own later item.
- **B:** a Text size choice on the card, Standard or Large.

**Custom themes — not a question; the owner's words, 2026-10-20, through the watcher:** about 02:25,
"Perhaps even allow saving custom settings as named profiles"; 02:28, "Use themes instead"; 02:30,
"And the same look in all devices"; 02:32, "Custom themes". Folded in: section 8b. The watcher's
reading proposed asking the first as a question ("perhaps"); I read the four messages together as
the owner's decision and did not ask it, and the question file says so in one line. The per-device
part is answered (02:30) and not asked. What a custom theme holds was then settled by the revised
Q8 answer, below.

No question is open. Q5 to Q8 were answered on 2026-10-20 through the watcher; the answers come
first under each question below, then the question as it was asked.

**Q7 — Which typefaces may a theme use? ANSWERED 2026-10-20** (about 05:42, through the watcher):
**B — "also uploaded font files", designed and built after this as their own item** (licence, file
size and format questions to settle there). The owner did not correct the reading sent with it:
text size is the 100–130% slider, and "each place we set it" is the four shared text sizes (Small,
Normal, Large, Largest), not each screen element. Folded in: A841 offers the device's own fonts,
"The device's own" and "Serif", and leaves a seam for uploaded fonts (section 5a); the fonts item is
a new, unnumbered backlog entry under A841 in `docs/backlog.md`. Picture `35-q7-typefaces-light.png`
is kept as what the owner saw. The question as asked: Today every
screen draws text in the device's own font, and Waitron ships no font file of its own except Google's
for its sign-in button (section 3). Bar Lucía's manager wants the bar's menus and headings to look
like its sign, which uses a serif. With A, the Text section's Typeface offers "The device's own"
(today's) and "Serif"; she picks Serif, and every till and dashboard draws text in the serif the
device already has; which serif that is depends on the device, as today's sans-serif already does. With B, she can also upload the font file of the bar's own typeface
(a WOFF2 file), and every screen draws exactly that face. Uploading carries what A does not: the
venue must hold a licence that allows the font to be served to its own screens, which Waitron cannot
check; each file adds tens to hundreds of kilobytes that a till fetches from the box (on the venue's
network, so no internet is needed) and draws its own font until the file arrives; a face wider than
the system fonts wraps names sooner than the 130% top was measured at, so the layout cases re-run in
it; and it needs a place to keep fonts, since the image library takes images only — so B is its own
design pass and slice after this one. Pictures: `35-q7-typefaces-light.png`.

- **A (recommended):** the device's own fonts only — "The device's own" or "Serif". Nothing to
  license, nothing to download. The Serif stack, as Chromium on macOS draws it, was measured at 130%
  with hyphenation (section 5a): long Spanish words broke only at a syllable with a hyphen.
- **B (chosen):** also an uploaded font file, after its own design pass (licence, size, storage, first paint).

**Q8 — What should the account menu's "Theme" be called now? ANSWERED 2026-10-20, then REVISED.**
First answer, about 05:45, through the watcher: **B — "Screen mode"**. **Superseded** about 06:00,
through the watcher, in the owner's words: "The user should be able to specify custom light and dark
themes which will continue to switch with follow device. That functionality is called custom themes.
Light and dark switching should still be called theme (or display theme)". Folded in: every theme
has a light version and a dark version, and each screen's Theme setting picks which one it shows
(section 7, which says what each version has of its own, how the editor shows the pair, and what
Waitron's own two versions are); the storage keeps one row per theme holding both (section 11); the
item keeps the name **Theme** — "Display theme" was weighed and not taken (section 7) — so nothing
is renamed, the rename slice is gone and CLAUDE.md §3 is unchanged. Pictures 37, 38 and 39; picture
34, which showed the rename, is deleted, and `36-q8-theme-naming-light.png` is kept as what the
owner saw. The question as asked: Today the menu under the person icon has "Theme", with Light, Dark and Follow device:
each browser's own choice of light or dark screens. Custom themes are something else — the venue's
colours, text and logo, the same on every screen. If both are called "Theme", Lucía's waiter who
opens their menu to make the till dark reads "Theme" and may expect the bar's Christmas look. With
A, the menu item becomes "Light or dark" ("Claro u oscuro"), on the dashboard and on the till's
person menu and sign-in screen, and "theme" means only the venue's themes. With B, it becomes
"Screen mode" ("Modo de pantalla"). With C, it stays "Theme", and the two share the word. Pictures:
`36-q8-theme-naming-light.png` (and `34-account-menu-light-or-dark-light.png` for A; deleted, in
git history before 51d612bc6).

- **A (recommended):** "Light or dark" — says exactly what the three buttons do, in plain words.
- **B (chosen at 05:45, superseded at 06:00):** "Screen mode".
- **C:** keep "Theme" for both. (The revised answer keeps "Theme", and adds the light and dark
  versions.)

**Q5 — Should the new logo also print on receipts? ANSWERED 2026-10-20** (about 05:35, through the
watcher): **A — "the new logo also prints on receipts and A4 invoices** wherever no department
receipt logo applies; a department's own receipt logo still wins; the Look card shows how it will
print". Folded in: section 8a (how "the department wins" is decided today, and the fallback),
slices 7 and 9; picture 42. Picture `23-q5-logo-on-receipts-light.png` is kept as what the owner
saw. The question as asked: Today each department sets its own receipt logo on its Receipt tab, and a department without one
prints none (section 3). A receipt printer prints black dots only: a colour logo comes out in grey
dots, and a white or pale one comes out faint or blank (section 8a). Lucía, the manager, uploads
the bar's green logo for the screens; the bar department has no receipt logo of its own. With A,
the bar's receipts and A4 invoices print the logo in dots from then on — in the picture its words
are readable — and the Look card shows how it prints; for something else on paper, she sets a
receipt logo on the department, and that wins. With B, the logo is for screens only, and the bar's
receipts stay without a logo until she sets one on the department, as today. Pictures:
`23-q5-logo-on-receipts-light.png`.

- **A (recommended; chosen):** one upload; it also prints wherever no department receipt logo applies. One
  upload covers the usual venue with one logo, the department's own receipt logo already gives paper
  a different picture where one is needed, and the printing code was written to fall back to a venue
  logo (section 3).
- **B:** screens only; receipts stay as they are.

**Q6 — When a venue sets its logo, what happens to Waitron's? ANSWERED 2026-10-20** (about 05:38,
through the watcher): **A — "the venue's logo takes Waitron's place** in the dashboard banner and
the till's top bar, with a small 'Powered by Waitron' line under the dashboard and till sign-in
forms". Folded in: section 8a (exactly where the line sits, its size and its tokens; and the
counter till's bar, which since #1905 has no "Waitron" to replace — my call keeps the logo there
while the bar has room), slices 8 and 14; pictures 40 and 41. Picture `24-q6-waitron-logo-light.png`
is kept as what the owner saw. The question as asked: Today the top of the dashboard shows Waitron's logo and then "BAR LUCÍA S.L.", and the
till's top bar starts with the word "Waitron". With A, Bar Lucía's logo takes Waitron's place in
both, and the dashboard's and the till's sign-in screens show a small "Powered by" line with
Waitron's logo under the form. With B, the bar's logo takes Waitron's place and Waitron's logo is
gone from the bar's screens; it stays only in the browser tab's icon, the installed till's icon, the
first-time setup and the certificate (trust) page (section 8a). With C, both logos show side by
side, Waitron's first. Pictures: `24-q6-waitron-logo-light.png` (and
`22-logo-sign-in-{light,dark}.png` for A's sign-in screens).

- **A (recommended; chosen):** the venue's logo in Waitron's place; "Powered by Waitron" on the sign-in
  screens. The working screens are the venue's, and Waitron is still named where it takes no working
  space: the till bar is short of room already, and leaves out the word "Waitron" first when it runs
  out.
- **B:** the venue's logo in Waitron's place, with no Waitron logo on the venue's screens.
- **C:** both logos side by side.
