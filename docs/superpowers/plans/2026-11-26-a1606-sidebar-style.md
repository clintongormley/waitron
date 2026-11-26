# A1606 PR 2 sidebar styling

Staff can distinguish headings from pages at a glance in the full sidebar and phone drawer and
recognise the same sections by icon in the folded strip. This implements decisions 4–6 of the
[approved design](../specs/2026-11-26-dashboard-sidebar-and-account-menu-design.md#5-the-sidebars-look)
on top of #4428. PR 3 owns the banner, account menu and shared help, theme and language controls.

1. Start with the existing browser checks. In `apps/dashboard/src/dashboard-app.sidebar-fold.test.ts`,
   update the expected glyphs and extend the mounted checks to cover an 18 px in-row icon and 12 px
   gap, muted at rest and full text colour on hover and on the current section. Close the current
   section and check its icon retains that colour. Check headings and the folded-panel title use
   full text colour, sentence case and normal letter spacing. Check 20 px icons inside 44 px folded
   buttons, muted at rest and full text colour on the current section. Check regular page padding
   in the folded panel. Keep its keyboard and both theme axe checks.
   In `apps/dashboard/src/dashboard-app.test.ts`, keep the first-line chevron alignment, narrow
   wrapping and keyboard focus checks, expect the arrow to be visible at rest, and replace the
   old left offset with matching label starts. Update the System glyph check and keep the single
   current page and accent check. Run those files before changing production, then run them again
   with `dashboard-app.touch.test.ts`, `dashboard-app.text-size.test.ts` and
   `dashboard-app.a11y.test.ts` through `pnpm --filter @waitron/dashboard exec vitest run`.
2. In `apps/dashboard/src/dashboard-app.ts`, keep the existing rows, disclosures and strip panel.
   Give the existing Overview and Bookings rows and section headings `wt-icon` size `lg` (18 px)
   and a `--wt-space-3` gap to the label. Put the spacing on the icon so the label-to-chevron gap
   stays `--wt-space-1`. Keep the divider and the chevron's first-line position.
   Use `--wt-color-text`, `--wt-font-size-md`, `--wt-font-weight-bold` (600) and sentence case for
   headings and the folded panel title, with normal letter spacing. Set section spacing to
   `--wt-space-2`. Show the muted chevron
   on every toggle and keep the search heading spacer. Scope indentation to headed lists so their
   text starts under the heading. Keep regular page padding in the folded panel and in the unheaded
   My schedule and Orders links for staff. Size strip icons with `--wt-space-4` plus `--wt-space-1`.
   Use `--wt-color-text-muted` at rest and `--wt-color-text` on hover and in the current section
   for heading icons, Overview and Bookings row icons and the folded strip's buttons. Use
   `#isCurrentNavPage` on the section's permitted rows before search filtering.
   Keep `aria-current="page"`, the current page's teal line and bold text, the strip's current marker,
   and 44 px touch and 32 px fine-pointer rows.
3. In `apps/dashboard/src/icons.ts`, use Google's Material Symbols Outlined weight 400 paths on the
   `wt-icon` 16-unit grid. Adapt `receipt_long`, `devices`, `dns` and `event` from Google's
   `49d4db35df873165d6bd6ba09b063c7dafbac2f4` revision. Reuse matching `home`, `group`,
   `menu_book`, `storefront`, `shopping_cart` and `search` paths. Keep `section-service` for department settings and the
   `section-menu` glyph also used in menu widgets. Give System a `section-system` key for `dns` and
   remove `gear` if the consumer search still finds only the System row and its tests. Bookings
   keeps declaring `event` in its contribution. Keep the existing Apache notice.
   [Google's SVG source and licence guide](https://developers.google.com/fonts/docs/material_symbols)
4. Rewrite the sidebar section and its old style references in `docs/developers/design-system.md`.
   In `docs/backlog/dashboard.md`, update A654's description of icon colour and add its dated
   revision pointer. Leave the banner and account menu as the remaining A1606 work. Compare the real
   demo with the approved pictures at 1440, 1024 folded and 390 drawer, in EN and ES, light and dark. Include the current page,
   a collapsed section, the open folded panel and the account menu with many languages. Send the
   pictures to the watcher for the owner's decision before landing.

Estimate 105 production additions and 60 removals, 65 test additions and 35 removals, plus docs.
