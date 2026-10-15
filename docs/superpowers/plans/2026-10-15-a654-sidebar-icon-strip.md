# A654 — the dashboard sidebar folds to a strip of icons (design, 2026-10-15)

Status: design; four owner questions open (lane C `questions.md`, "A654"). Build after the answers.
Backlog: [A654](../../backlog/dashboard.md#a654--the-sidebar-folds-to-a-strip-of-icons).
Drawings: [`docs/backlog/mockups/a654-sidebar-icons/`](../../backlog/mockups/a654-sidebar-icons/)
(the HTML beside the pictures is their source; it is a drawing, not the product's CSS).

## What it is

On a screen wider than a phone, the sidebar can fold to a narrow strip holding one icon per
section, so a wide page such as Products gets the room (picture 1). Phones (48rem wide or less,
`DRAWER_BREAKPOINT` in `apps/dashboard/src/dashboard-app.ts`) keep today's drawer, which always
shows the full sidebar.

## The four questions (recommended answer first)

1. **Where the fold button sits** (picture 2). (a) The banner's ☰ button, today shown only on
   phones, is shown at every width: on a wide screen it folds and unfolds the sidebar, on a phone it
   opens the drawer as today. (b) A "Fold" button at the foot of the sidebar, which becomes an
   unfold icon at the foot of the strip.
2. **How a folded section opens its pages** (picture 3). (a) Clicking a section's icon opens a small
   panel beside it listing that section's pages; choosing one opens it and closes the panel, and the
   strip stays folded. (b) Clicking unfolds the whole sidebar with that section open.
3. **Remembered, and tablets** (picture 4). (a) The choice is remembered in this browser. Until
   someone chooses, a window under 64rem (1024 px, a tablet) opens folded and a wider one unfolded.
   (b) Not remembered: every visit opens unfolded.
4. **The icons** (picture 5): Overview home, Reporting bar chart, Service room service (the
   cloche), Products and menus menu book, Venue operations storefront, Team group, Purchasing
   shopping cart, Settings the outlined gear in place of today's solid one, each with an
   alternative drawn beside it. All from Google's Material Symbols (Apache 2.0, the attribution
   `apps/dashboard/src/icons.ts` already carries), redrawn for `wt-icon`'s 16×16 box.

## Decided here, not asked

- **The section you are in** is marked in the strip as the current page is in the sidebar: the
  primary-coloured bar on its leading edge, with the lifted fill.
- **Pointing at or focusing an icon shows the section's name**, with the shared icon-button tooltip
  (`trackIconTooltip`, design-system.md → "Icon buttons with a tooltip"); each icon is a button
  named by the section.
- **A section with exactly one page the person may open goes straight to it** (today: Overview,
  Service with Bookings, Purchasing) — there is nothing to choose in a panel. A section with none
  shows no icon, as it shows no header today.
- **Search**: a magnifier at the top of the strip unfolds the sidebar and puts the cursor in its
  search box; the sidebar then stays unfolded until folded again.
- **Staff sign-ins** have no section headers today (`My schedule` and `Orders` under Overview); folded,
  they see one Overview icon that opens those two.
- **Keyboard**: the panel opens on Enter or Space, Escape closes it and returns focus to its icon,
  and Tab leaves it. Phones never show the strip, so the drawer's `inert` rule is unchanged.
- No shared `wt-*` primitive changes are expected: the strip and its panel live in
  `apps/dashboard`. If a primitive has to change, the review path becomes FULL.

## Build outline (refined once the answers are in)

1. The icons: each section's icon in `DASHBOARD_ICONS`, `icon` on every `NAV_GROUPS` entry, and the
   unfolded sidebar's headers drawing them. Real-Chromium test first: every group a module can fill
   has a registered icon.
2. Folding: the fold control, the strip, the current-section mark, the tooltip, single-page sections
   going straight there, and remembering the choice if question 3 says so.
3. The panel (or the unfold, per question 2), with its keyboard handling.
4. LOOK in both themes at 390, 1024 and 1280 px; tokens only for every colour and size.
