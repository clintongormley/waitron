# A1606 PR 2 sidebar styling

Staff can distinguish headings from pages at a glance in the full sidebar and phone drawer and
recognise the same sections by icon in the folded strip. This implements decisions 4–6 of the
[approved design](../specs/2026-11-26-dashboard-sidebar-and-account-menu-design.md#5-the-sidebars-look)
on top of #4428. PR 3 owns the banner, account menu and shared help, theme and language controls.

1. Start with the existing browser checks. In `apps/dashboard/src/dashboard-app.sidebar-fold.test.ts`,
   update the expected glyphs and extend the mounted checks to cover an 18 px in-row icon and 12 px
   gap, muted at rest and full text colour on hover and on the current section. Close the current
   section and check its icon retains that colour. Check 20 px icons inside 44 px folded buttons and
   regular page padding inside the folded panel. Keep the panel's keyboard and both theme axe checks.
   In `apps/dashboard/src/dashboard-app.test.ts`, keep the first-line chevron alignment, narrow
   wrapping and keyboard focus checks, expect the arrow to be visible at rest, and replace the
   old left-offset expectation with a page label aligned to its heading label. Keep the single
   current page and accent check. Run those files before changing production, then run them again
   with `dashboard-app.touch.test.ts`, `dashboard-app.text-size.test.ts` and
   `dashboard-app.a11y.test.ts` through `pnpm --filter @waitron/dashboard exec vitest run`.
2. In `apps/dashboard/src/dashboard-app.ts`, keep the existing rows, disclosures and strip panel.
   Make Overview and Bookings top-level rows with an in-row icon and the existing divider. Apply
   sentence case, 14 px semibold text and 8 px section spacing. Use the shared `.nav-group` styles
   for search labels, keeping their spacer in place of the disclosure chevron. Keep the muted chevron
   visible on each toggle. Align headed page text to the heading text with token-based indentation
   scoped to those page lists. Keep the strip panel pages and the staff-only rows without icon
   columns. Use existing `--wt-*` tokens for default 18 px icons and the 12 px gap. Set folded icons
   to 20 px using the spacing tokens. Apply the muted and full text colours to the icon hosts,
   using the same current-page check as the strip and keeping it independent of open/closed or search
   state. Keep `aria-current="page"`, the teal leading line and bold teal text on the current
   page, and the strip's current marker. Keep 44 px touch and 32 px fine-pointer rows.
3. In `apps/dashboard/src/icons.ts`, use Google's Material Symbols Outlined weight 400 paths on the
   existing `wt-icon` 16-unit grid. Use `home`, `event`, `receipt_long`, `group`, `menu_book`,
   `storefront`, `devices`, `shopping_cart`, `dns` and `search` as specified. Trace icon-key consumers
   before replacing paths. Reuse matching paths and keep unrelated widgets' glyphs. Bookings keeps
   declaring its icon in its dashboard contribution. Keep the existing Apache notice.
   [Google's SVG source and licence guide](https://developers.google.com/fonts/docs/material_symbols)
4. Rewrite the sidebar section and its old style references in `docs/developers/design-system.md`.
   In `docs/backlog/dashboard.md`, add the dated pointer to the A654 revision and leave the banner
   and account menu as the remaining A1606 work. Compare the real demo with the approved pictures
   at 1440, 1024 folded and 390 drawer, in EN and ES, light and dark. Include the current page,
   a collapsed section, the open folded panel and the account menu with many languages. Send the
   pictures to the watcher for the owner's decision before landing.

Estimate 105 production additions and 60 removals, 65 test additions and 35 removals, plus docs.
